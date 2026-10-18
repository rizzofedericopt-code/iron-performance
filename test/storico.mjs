// Copie automatiche sul server: il vero handler di api/store.js su un Postgres
// in memoria (PGlite).
//
//   node test/storico.mjs
//
// Cosa deve essere vero:
//   1. il primo salvataggio lascia una copia; i successivi entro l'ora no
//   2. un salvataggio che riduce di colpo lo stato mette da parte la versione
//      di PRIMA — e' quella che serve quando qualcuno ha cancellato per sbaglio
//   3. oltre 48 ore resta una copia al giorno; oltre 30 giorni niente
//   4. un'atleta cancellata sparisce anche dalle copie
//   5. le copie di un altro account non si vedono e non si leggono
//   6. «elimina account» cancella anche le copie
//   7. se lo storico si rompe, il salvataggio riesce lo stesso

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import assert from "node:assert/strict";

let PGlite;
try { ({ PGlite } = await import("@electric-sql/pglite")); }
catch (e) {
  console.log("\n  ~~ SALTATO: manca @electric-sql/pglite (dipendenza di sviluppo).");
  console.log("     Non e' un errore dell'app: il resto della suite vale lo stesso.\n");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const pg = new PGlite();
await pg.exec(readFileSync(join(here, "..", "schema.sql"), "utf8"));
await pg.exec(`DROP TABLE IF EXISTS payload_history`);   // la deve creare il codice da solo

const mappa = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
let rotto = false;
const sql = (strings, ...vals) => {
  let text = strings[0];
  vals.forEach((v, i) => { text += "$" + (i + 1) + strings[i + 1]; });
  if (rotto && /payload_history/.test(text)) return Promise.reject(new Error("storico rotto"));
  return pg.query(text, vals).then(mappa);
};
const db = { connect: async () => ({ query: (t, p) => pg.query(t, p).then(mappa), release() {} }) };
globalThis.__PG = { sql, db };

// il modulo vero, con il solo import del database sostituito
const src = readFileSync(join(here, "..", "api", "store.js"), "utf8")
  .replace('import { sql, db } from "@vercel/postgres";', "const { sql, db } = globalThis.__PG;");
const dir = mkdtempSync(join(tmpdir(), "storico-"));
writeFileSync(join(dir, "store.mjs"), src);
process.env.POSTGRES_URL = "postgres://finto";
const { default: handler } = await import(pathToFileURL(join(dir, "store.mjs")).href);

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
async function account(email, tok) {
  await pg.query("INSERT INTO users (email, pw_hash) VALUES ($1,'x') ON CONFLICT DO NOTHING", [email]);
  await pg.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,$2, now() + interval '1 day')", [sha(tok), email]);
}
async function chiama(tok, body) {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  await handler({ method: "POST", headers: { authorization: "Bearer " + tok, "x-real-ip": "10.0.0.1" }, body }, res);
  return res;
}
let V = 0;
async function salva(tok, data) {
  const r = await chiama(tok, { action: "save", data, baseVersion: V });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  V = r.body.version;
  return r;
}
const stato = (n, extra) => Object.assign({
  athletes: Array.from({ length: n }, (_, i) => ({ id: "a" + i, name: "Atleta " + i })),
  data: Object.fromEntries(Array.from({ length: n }, (_, i) => ["a" + i, { cmj: Array.from({ length: 120 }, (_, k) => ({ d: "2026-0" + (1 + k % 9) + "-1" + (k % 9), v: 30 + k / 10 })) }])),
  gruppi: { "rmSquat@t1": { g: [Array.from({ length: n }, (_, i) => "a" + i)] } },
  tomb: {},
}, extra || {});
const righe = async () => (await pg.query("SELECT id, at, motivo, atleti, ids FROM payload_history WHERE email='c@t.it' ORDER BY at")).rows;

let failed = 0;
const prova = async (nome, fn) => {
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

console.log("\nCopie automatiche sul server");
await account("c@t.it", "tokC");
await account("altro@t.it", "tokA");

await prova("il primo salvataggio lascia una copia (e la tabella nasce da sola)", async () => {
  await salva("tokC", stato(10));
  const r = await righe();
  assert.equal(r.length, 1);
  assert.equal(r[0].motivo, "oraria");
  assert.equal(r[0].atleti, 10);
});

await prova("entro l'ora, altri salvataggi non aggiungono copie", async () => {
  await salva("tokC", stato(10, { view: "x" }));
  await salva("tokC", stato(11));
  assert.equal((await righe()).length, 1);
});

await prova("passata l'ora, un salvataggio lascia una copia nuova", async () => {
  await pg.query("UPDATE payload_history SET at = at - interval '2 hours'");
  await salva("tokC", stato(11, { view: "y" }));
  const r = await righe();
  assert.equal(r.length, 2);
  assert.equal(r[1].atleti, 11);
});

await prova("un calo brusco mette da parte la versione di PRIMA", async () => {
  await salva("tokC", stato(1));               // 11 atlete → 1: qualcuno ha svuotato
  const r = await righe();
  const calo = r.filter((x) => x.motivo === "calo");
  assert.equal(calo.length, 1);
  assert.equal(calo[0].atleti, 11, "la copia deve essere quella di prima, con 11 atlete");
  await salva("tokC", stato(11));               // si torna normali
});

await prova("elenco e lettura di una copia", async () => {
  const l = await chiama("tokC", { action: "history" });
  assert.equal(l.code, 200);
  const c = l.body.copie.find((x) => x.motivo === "calo");
  assert.ok(c && c.atleti === 11 && !("z" in c) && !("data" in c));
  const g = await chiama("tokC", { action: "historyGet", id: c.id });
  assert.equal(g.code, 200);
  assert.equal(g.body.data.athletes.length, 11);
  assert.equal(g.body.data.data.a3.cmj.length, 120);
});

await prova("le copie di un altro account non si vedono e non si leggono", async () => {
  const l = await chiama("tokA", { action: "history" });
  assert.deepEqual(l.body.copie, []);
  const id = (await righe())[0].id;
  const g = await chiama("tokA", { action: "historyGet", id: String(id) });
  assert.equal(g.code, 404);
  const x = await chiama("tokC", { action: "historyGet", id: "1; DROP TABLE users" });
  assert.equal(x.code, 400);
});

await prova("un'atleta cancellata sparisce anche dalle copie", async () => {
  const s = stato(11);
  s.athletes = s.athletes.filter((a) => a.id !== "a3");
  delete s.data.a3;
  s.gruppi["rmSquat@t1"].g[0] = s.gruppi["rmSquat@t1"].g[0].filter((x) => x !== "a3");
  s.tomb = { "ath:a3": "2026-10-18T10:00:00.000Z" };
  await salva("tokC", s);
  for (const r of await righe()) {
    assert.ok(!r.ids.includes(",a3,"), "indice: " + r.ids);
    const g = await chiama("tokC", { action: "historyGet", id: String(r.id) });
    const txt = JSON.stringify(g.body.data);
    const senzaTomb = JSON.stringify(Object.assign({}, g.body.data, { tomb: {} }));
    assert.ok(!/"a3"/.test(senzaTomb), "a3 e' rimasta in una copia: " + txt.slice(0, 160));
  }
});

await prova("oltre 48 ore una copia al giorno; oltre 30 giorni niente", async () => {
  await pg.query("DELETE FROM payload_history");
  const ins = (ore, motivo) => pg.query(
    "INSERT INTO payload_history (email, at, version, bytes, atleti, ids, motivo, z) VALUES ('c@t.it', now() - ($1 || ' hours')::interval, 1, 1, 1, ',', $2, 'x')",
    [String(ore), motivo || "oraria"]);
  for (const h of [1, 5, 30, 50, 51, 52, 75, 76, 24 * 31, 24 * 40]) await ins(h);
  await ins(53, "calo");
  await pg.query("UPDATE payload_history SET at = date_trunc('day', at) + interval '12 hours' - (id % 5) * interval '1 hour' WHERE at < now() - interval '48 hours'");
  await salva("tokC", stato(11, { view: "pota" }));
  const r = await righe();
  const vecchie = r.filter((x) => new Date(x.at) < Date.now() - 48 * 36e5 && x.motivo !== "calo");
  const giorni = vecchie.map((x) => new Date(x.at).toISOString().slice(0, 10));
  assert.equal(new Set(giorni).size, giorni.length, "piu' di una copia nello stesso giorno: " + giorni.join(" "));
  assert.ok(r.every((x) => new Date(x.at) > Date.now() - 30 * 864e5 - 36e5), "una copia piu' vecchia di 30 giorni");
  assert.ok(r.some((x) => x.motivo === "calo"), "la copia «prima di un calo» non va potata per giorno");
  assert.ok(r.filter((x) => new Date(x.at) > Date.now() - 48 * 36e5).length >= 3, "le copie recenti restano tutte");
});

await prova("se lo storico si rompe, il salvataggio riesce lo stesso", async () => {
  rotto = true;
  const r = await chiama("tokC", { action: "save", data: stato(11, { view: "rotto" }), baseVersion: V });
  rotto = false;
  assert.equal(r.code, 200);
  V = r.body.version;
  const a = (await pg.query("SELECT detail FROM audit_log WHERE action='storico' AND outcome='error'")).rows;
  assert.ok(a.length >= 1, "l'errore va annotato nel registro");
});

await prova("elimina account: via anche le copie", async () => {
  // stesso formato di hashPassword in store.js: scrypt$N$r$p$sale$chiave (base64)
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync("una-password-lunga", salt, 64, { N: 16384, r: 8, p: 1 });
  const hash = ["scrypt", 16384, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
  await pg.query("UPDATE users SET pw_hash=$1 WHERE email='c@t.it'", [hash]);
  const r = await chiama("tokC", { action: "erase", confirm: "c@t.it", password: "una-password-lunga" });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal((await righe()).length, 0);
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
