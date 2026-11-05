// La settimana dell'atleta: salute (OSTRC-H2), rientro, lavoro a casa e la
// pagina per l'allenatore.
//
//   node test/settimana.mjs
//
// Due metà. La prima gira il vero api/store.js su un Postgres in memoria
// (PGlite): il link settimanale è un ingresso pubblico che scrive dati
// sanitari di minorenni, e le cose che devono essere vere lì non si provano
// leggendo il codice. La seconda gira l'app nel browser finto: punteggi,
// finestre di 7 giorni, chi finisce in Oggi, cosa sopravvive a backup e
// sincronizzazione.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const storeSrc = readFileSync(join(here, "..", "api", "store.js"), "utf8");

let failed = 0;
const prove = [];
const prova = (nome, fn) => prove.push([nome, fn]);
const sezione = (t) => prove.push([null, t]);

/* ═══════════════ 1. IL SERVER ═══════════════ */
let PGlite = null;
try { ({ PGlite } = await import("@electric-sql/pglite")); } catch (e) { PGlite = null; }
const romaOggi = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
const isoMeno = (iso, g) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - g); return d.toISOString().slice(0, 10); };
const OGGI = romaOggi();

let pg, handler;
if (PGlite) {
  pg = new PGlite();
  await pg.exec(readFileSync(join(here, "..", "schema.sql"), "utf8"));
  const mappa = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = (strings, ...vals) => { let t = strings[0]; vals.forEach((v, i) => { t += "$" + (i + 1) + strings[i + 1]; }); return pg.query(t, vals).then(mappa); };
  const db = { connect: async () => ({ query: (t, p) => pg.query(t, p).then(mappa), release() {} }) };
  globalThis.__PG = { sql, db };
  const dir = mkdtempSync(join(tmpdir(), "settimana-"));
  writeFileSync(join(dir, "store.mjs"), storeSrc.replace('import { sql, db } from "@vercel/postgres";', "const { sql, db } = globalThis.__PG;"));
  process.env.POSTGRES_URL = "postgres://finto";
  ({ default: handler } = await import(pathToFileURL(join(dir, "store.mjs")).href));
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
let IPN = 1;
async function chiama(tok, body, ip) {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  const h = { "x-real-ip": ip || "10.0.0." + (IPN++ % 200) };
  if (tok) h.authorization = "Bearer " + tok;
  await handler({ method: "POST", headers: h, body }, res);
  return res;
}
const payload = async () => (await pg.query("SELECT payload, version FROM payloads WHERE email='c@t.it'")).rows[0];
const STATO = () => ({
  athletes: [
    { id: "a1", name: "Sara Rossi", sex: "F", team: "t1", profile: { consent: true, birth: "2009-03-01", painLevel: "6" } },
    { id: "a2", name: "Giulia Verdi", sex: "F", team: "t1", profile: {} },
  ],
  teams: [{ id: "t1", name: "U18" }], data: {},
  skin: { a1: [{ d: isoMeno(OGGI, 3), exercise: "sk:k1", id: "k1", titolo: "Casa", n: 3, volte: 2, sett: 2 },
               { d: isoMeno(OGGI, 60), exercise: "sk:vecchia", id: "vecchia", titolo: "Vecchia", n: 3, volte: 2, sett: 2 }] },
  tomb: {}, policy: { version: 1, titolare: "x" },
});
let TOK = null;

sezione("\nIl link settimanale (server vero, database in memoria)");
prova("serve l'accesso per crearlo; il token esce una volta e in tabella c'è solo l'hash", async () => {
  if (!PGlite) return;
  await pg.query("INSERT INTO users (email, pw_hash) VALUES ('c@t.it','x')");
  await pg.query("INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1,'c@t.it', now() + interval '1 day')", [sha("tokC")]);
  await pg.query("INSERT INTO payloads (email, payload, version) VALUES ('c@t.it', $1::jsonb, 3)", [JSON.stringify(STATO())]);
  assert.equal((await chiama(null, { action: "weeklyLink", athleteId: "a1" })).code, 401);
  const r = await chiama("tokC", { action: "weeklyLink", athleteId: "a1", athleteName: "Sara Rossi" });
  assert.equal(r.code, 200); TOK = r.body.token;
  assert.ok(TOK.length >= 30);
  const q = await pg.query("SELECT token_hash, kind, expires_at FROM form_links WHERE athlete_id='a1'");
  assert.equal(q.rows[0].token_hash, sha(TOK)); assert.equal(q.rows[0].kind, "weekly");
  assert.ok(new Date(q.rows[0].expires_at) > new Date(Date.now() + 150 * 864e5), "deve durare una stagione");
});
prova("aprirlo: nome, squadra, schede aperte; niente anamnesi, niente compagne", async () => {
  if (!PGlite) return;
  const r = await chiama(null, { action: "weeklyInfo", token: TOK });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.nome, "Sara"); assert.equal(r.body.squadra, "U18"); assert.equal(r.body.oggi, OGGI);
  assert.deepEqual(r.body.schede.map((s) => s.id), ["k1"], "la scheda di due mesi fa non è più aperta");
  const testo = JSON.stringify(r.body);
  assert.ok(!/Giulia|painLevel|2009|Rossi/.test(testo), "non deve uscire niente oltre al nome: " + testo);
});
prova("il link settimanale NON apre il modulo anamnesi (e non può riscrivere il consenso)", async () => {
  if (!PGlite) return;
  assert.equal((await chiama(null, { action: "formInfo", token: TOK })).code, 401);
  const r = await chiama(null, { action: "formSubmit", token: TOK, profile: { injuriesCurrent: "x" }, consentRole: "guardian", consentName: "Mamma", policyRead: true, consentHealth: true });
  assert.equal(r.code, 401);
  assert.equal((await payload()).payload.athletes[0].profile.injuriesCurrent, undefined);
});
prova("…e un link anamnesi non apre la pagina della settimana", async () => {
  if (!PGlite) return;
  const f = await chiama("tokC", { action: "formLink", athleteId: "a1", athleteName: "Sara" });
  assert.equal((await chiama(null, { action: "weeklyInfo", token: f.body.token })).code, 401);
  assert.equal((await chiama(null, { action: "weeklySubmit", token: f.body.token, ostrc: { p: [] } })).code, 401);
});
prova("risposta valida: entra nel suo archivio con la data italiana, la versione sale", async () => {
  if (!PGlite) return;
  const v0 = (await payload()).version;
  const r = await chiama(null, { action: "weeklySubmit", token: TOK, ostrc: { p: [
    { t: "inf", z: "ginocchio", l: "dx", q1: 2, q2: 2, q3: 1, q4: 2, gg: 1, nuovo: true },
    { t: "mal", s: ["febbre", "gola"], q1: 3, gg: 2, nuovo: false }] } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const p = await payload();
  assert.equal(p.version, v0 + 1);
  const e = p.payload.ost.a1;
  assert.equal(e.length, 1); assert.equal(e[0].d, OGGI); assert.equal(e[0].exercise, "ostrc");
  assert.equal(e[0].p[0].z, "ginocchio"); assert.equal(e[0].p[1].q2, undefined, "con «non ho potuto partecipare» le altre domande non ci sono");
});
prova("nel registro accessi c'è CHE cosa è arrivato, mai il contenuto", async () => {
  if (!PGlite) return;
  const q = await pg.query("SELECT detail FROM audit_log WHERE action='weeklySubmit' AND outcome='ok'");
  assert.ok(q.rows.length);
  q.rows.forEach((x) => assert.ok(!/ginocchio|febbre|gola|q1|dx/.test(x.detail), x.detail));
});
prova("correggere lo stesso giorno sostituisce, non raddoppia", async () => {
  if (!PGlite) return;
  const r = await chiama(null, { action: "weeklySubmit", token: TOK, ostrc: { p: [] } });
  assert.equal(r.code, 200);
  const e = (await payload()).payload.ost.a1;
  assert.equal(e.length, 1); assert.deepEqual(e[0].p, []);
  assert.equal((await chiama(null, { action: "weeklyInfo", token: TOK })).body.ostrcGia, OGGI);
});
prova("risposte fuori dalle regole del questionario: rifiutate, niente scritto", async () => {
  if (!PGlite) return;
  const v0 = (await payload()).version;
  const male = [
    { p: [{ t: "inf", z: "naso", q1: 1, q2: 0, q3: 0, q4: 0, gg: 0 }] },                  // zona che non esiste
    { p: [{ t: "inf", z: "constructor", q1: 1, q2: 0, q3: 0, q4: 0, gg: 0 }] },
    { p: [{ t: "inf", z: "spalla", q1: 2, q3: 0, q4: 0, gg: 0 }] },                         // manca q2
    { p: [{ t: "inf", z: "spalla", q1: 2, q2: 4, q3: 0, q4: 0, gg: 0 }] },                  // fuori scala
    { p: [{ t: "inf", z: "spalla", q1: 0, q2: 0, q3: 0, q4: 0, gg: 0 }] },                  // «nessun problema» dentro un problema
    { p: [{ t: "inf", z: "spalla", q1: 1, q2: 0, q3: 0, q4: 0, gg: 8 }] },                  // 8 giorni in una settimana
    { p: [{ t: "mal", s: ["febbre", "febbre"], q1: 3, gg: 1 }] },
    { p: [{ t: "mal", s: [], q1: 3, gg: 1 }] },
    { p: [1, 2, 3, 4].map(() => ({ t: "inf", z: "piede", q1: 1, q2: 0, q3: 0, q4: 0, gg: 0 })) },
    { p: "nessuno" }, [],
  ];
  for (const o of male) {
    const r = await chiama(null, { action: "weeklySubmit", token: TOK, ostrc: o });
    assert.equal(r.code, 400, JSON.stringify(o));
  }
  assert.equal((await payload()).version, v0);
});
prova("sedute a casa: solo schede aperte, solo ultimi 7 giorni, RPE e minuti sensati", async () => {
  if (!PGlite) return;
  const ok = { sk: "k1", d: isoMeno(OGGI, 1), esito: "tutta", rpe: 6, min: 40 };
  const casi = [
    [{ ...ok, sk: "vecchia" }, 400], [{ ...ok, sk: "inventata" }, 400], [{ ...ok, d: isoMeno(OGGI, 8) }, 400],
    [{ ...ok, d: isoMeno(OGGI, -1) }, 400], [{ ...ok, rpe: 11 }, 400], [{ ...ok, min: 2 }, 400], [{ ...ok, esito: "no" }, 400],
  ];
  for (const [x, c] of casi) assert.equal((await chiama(null, { action: "weeklySubmit", token: TOK, sedute: [x] })).code, c, JSON.stringify(x));
  const r = await chiama(null, { action: "weeklySubmit", token: TOK, sedute: [ok, { ...ok, d: OGGI, esito: "parte", rpe: 4, min: 30 }] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const l = (await payload()).payload.skf.a1;
  assert.equal(l.length, 2); assert.equal(l[0].exercise, "f:k1"); assert.equal(l[1].esito, "parte");
  assert.equal((await chiama(null, { action: "weeklyInfo", token: TOK })).body.schede[0].fatte7, 2);
  assert.equal((await chiama(null, { action: "weeklySubmit", token: TOK })).code, 400, "vuoto: niente da inviare");
});
prova("senza consenso registrato non si raccoglie niente", async () => {
  if (!PGlite) return;
  const r = await chiama("tokC", { action: "weeklyLink", athleteId: "a2", athleteName: "Giulia" });
  assert.equal((await chiama(null, { action: "weeklyInfo", token: r.body.token })).code, 409);
  assert.equal((await chiama(null, { action: "weeklySubmit", token: r.body.token, ostrc: { p: [] } })).code, 409);
  assert.equal(((await payload()).payload.ost || {}).a2, undefined);
});
prova("rifare il link chiude il vecchio; «chiudi» lo chiude; l'elenco lo sa", async () => {
  if (!PGlite) return;
  const r = await chiama("tokC", { action: "weeklyLink", athleteId: "a1", athleteName: "Sara" });
  assert.equal((await chiama(null, { action: "weeklyInfo", token: TOK })).code, 410);
  assert.equal((await chiama(null, { action: "weeklySubmit", token: TOK, ostrc: { p: [] } })).code, 410);
  assert.equal((await chiama(null, { action: "weeklyInfo", token: r.body.token })).code, 200);
  let l = await chiama("tokC", { action: "weeklyLinks" });
  assert.deepEqual(l.body.links.map((x) => x.athlete_id).sort(), ["a1", "a2"]);
  await chiama("tokC", { action: "closeWeeklyLink", athleteId: "a1" });
  assert.equal((await chiama(null, { action: "weeklyInfo", token: r.body.token })).code, 410);
  l = await chiama("tokC", { action: "weeklyLinks" });
  assert.deepEqual(l.body.links.map((x) => x.athlete_id), ["a2"]);
});
prova("un'atleta cancellata: il suo link non scrive più", async () => {
  if (!PGlite) return;
  const r = await chiama("tokC", { action: "weeklyLink", athleteId: "a9", athleteName: "Nessuna" });
  assert.equal((await chiama(null, { action: "weeklySubmit", token: r.body.token, ostrc: { p: [] } })).code, 404);
});
prova("la potatura non cancella un link settimanale usato un mese fa", () => {
  assert.ok(/used_at < now\(\) - interval '30 days' AND kind <> 'weekly'/.test(storeSrc));
});
prova("la data della risposta è quella italiana: alle 00:30 di Roma è già domani", () => {
  const f = storeSrc.match(/function oggiRoma\(d\) \{[\s\S]*?\n\}/)[0];
  const sb = { now: () => new Date(), Intl };
  vm.createContext(sb); vm.runInContext(f + ";globalThis.__f=oggiRoma;", sb);
  assert.equal(sb.__f(new Date("2026-11-05T23:30:00Z")), "2026-11-06");
  assert.equal(sb.__f(new Date("2026-07-05T22:30:00Z")), "2026-07-06");
  assert.equal(sb.__f(new Date("2026-07-05T21:30:00Z")), "2026-07-05");
});
prova("zone e sintomi: le stesse liste nel server e nell'app", () => {
  const lista = (n) => JSON.parse(storeSrc.match(new RegExp("const " + n + " = (\\[[\\s\\S]*?\\]);"))[1].replace(/\s+/g, " "));
  const app = (n) => Object.keys(vm.runInNewContext("(" + html.match(new RegExp("const " + n + "=(\\{[\\s\\S]*?\\});"))[1] + ")"));
  assert.deepEqual(lista("OST_ZONE"), app("OST_ZONE"));
  assert.deepEqual(lista("OST_SINT"), app("OST_SINT"));
});

/* ═══════════════ 2. L'APP ═══════════════ */
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const mem = new Map(), cache = {};
const elFor = () => ({ value: "", dataset: {}, style: {}, textContent: "", innerHTML: "", addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, focus() {}, select() {}, click() {} });
const sandbox = {
  document: { getElementById: (id) => (cache[id] ||= elFor()), querySelector: () => elFor(), querySelectorAll: () => [], createElement: () => elFor(),
    addEventListener() {}, body: elFor(), documentElement: elFor(), hidden: false },
  window: { addEventListener() {}, open: () => null }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true, prompt: () => "",
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const j = (c) => { const r = run("JSON.stringify(" + c + ")"); return r === undefined ? undefined : JSON.parse(r); };
run(`normalize(); render=function(){}; save=function(){}; toast=function(){}; modal=function(h){ globalThis.__modal=h; };`);
const T = j(`todayISO()`);
const meno = (g) => j(`isoDaNum(dayNum(todayISO())-${g})`);
const squadra = () => run(`{ S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}]; S.activeTeam="t1"; S.cfg=Object.assign({},CFG_DEF);
  S.athletes=[{id:"a1",name:"Sara Rossi",team:"t1",sex:"F",profile:{consent:true}},{id:"a2",name:"Giulia Verdi",team:"t1",sex:"F",profile:{consent:true}},{id:"a3",name:"Anna Bianchi",team:"t1",sex:"F",profile:{consent:true}}];
  S.data={}; S.load={}; S.readiness={}; S.ost={}; S.disp={}; S.skin={}; S.skf={}; S.tomb={}; S.gare={}; S.scout={}; }`);

sezione("\nIl questionario: punteggio e finestra di 7 giorni");
prova("gravità come OSTRC-H2: 0/8/17/25 per domanda, 100 se non ha potuto partecipare", () => {
  assert.equal(j(`ostGrav({q1:1,q2:0,q3:0,q4:0})`), 8);
  assert.equal(j(`ostGrav({q1:1,q2:1,q3:1,q4:1})`), 32);
  assert.equal(j(`ostGrav({q1:2,q2:3,q3:3,q4:3})`), 92);
  assert.equal(j(`ostGrav({q1:3})`), 100);
});
prova("sostanziale: allenamento o prestazione ridotti abbastanza o molto, o non ha partecipato", () => {
  assert.equal(j(`ostSost({q1:1,q2:1,q3:1,q4:3})`), false, "molto dolore ma pochi cambi: non è sostanziale");
  assert.equal(j(`ostSost({q1:1,q2:2,q3:0,q4:0})`), true);
  assert.equal(j(`ostSost({q1:1,q2:0,q3:2,q4:0})`), true);
  assert.equal(j(`ostSost({q1:3})`), true);
});
prova("la risposta della settimana: 6 giorni fa conta, 7 no; vale l'ultima", () => {
  squadra();
  run(`S.ost.a1=[{d:"${meno(7)}",exercise:"ostrc",p:[{t:"inf",z:"spalla",q1:3,gg:5}]}]`);
  assert.equal(j(`ostDellaSett("a1")`), null);
  run(`S.ost.a1.push({d:"${meno(6)}",exercise:"ostrc",p:[]}, {d:"${meno(2)}",exercise:"ostrc",p:[{t:"inf",z:"ginocchio",q1:1,q2:0,q3:0,q4:1,gg:0}]})`);
  assert.equal(j(`ostDellaSett("a1").d`), meno(2));
});
prova("la squadra: risposte, problemi, sostanziali, chi manca", () => {
  squadra();
  run(`S.ost.a1=[{d:"${T}",exercise:"ostrc",p:[{t:"inf",z:"ginocchio",q1:2,q2:2,q3:1,q4:2,gg:1}]}];
       S.ost.a2=[{d:"${meno(1)}",exercise:"ostrc",p:[]}];`);
  const r = j(`ostSquadra(teamAthletes(), todayISO(), 0)`);
  assert.equal(r.risp, 2); assert.equal(r.prob, 1); assert.equal(r.sost, 1); assert.equal(r.tot, 3);
  assert.deepEqual(r.manca.map((a) => a.id), ["a3"]);
  const w1 = j(`ostSquadra(teamAthletes(), todayISO(), 1)`);
  assert.equal(w1.risp, 0, "la settimana prima non ha risposte");
});

sezione("\nCosa arriva in Oggi e in Fatica");
prova("svenimento, dolore al petto, palpitazioni, fiato: prima il medico, sopra a ogni altro consiglio", () => {
  squadra();
  run(`S.ost.a1=[{d:"${T}",exercise:"ostrc",p:[{t:"mal",s:["petto","stanchezza"],q1:1,q2:0,q3:0,q4:1,gg:0}]}]`);
  const f = j(`saluteFlags("a1")`);
  assert.ok(f[0].prio && /medico/.test(f[0].sug) && /dolore al petto/.test(f[0].sug));
  run(`S.readiness.a1=[{d:"${T}",sl:1,so:5,fa:5,st:5}]`);
  run(`renderToday()`);
  const g = j(`document.getElementById("grid").innerHTML`);
  assert.ok(/medico/.test(g.slice(g.indexOf("Sara Rossi"))));
  assert.ok(j(`todayManageCount()`) >= 1);
});
prova("«fuori» sostituisce gli altri consigli: niente «riduci il volume» per chi non si allena", () => {
  squadra();
  run(`dispSalva("a1","fuori","${meno(1)}"); S.readiness.a1=[{d:"${T}",sl:1,so:5,fa:5,st:5}]; renderToday();`);
  const g = j(`document.getElementById("grid").innerHTML`);
  const card = g.slice(g.indexOf("Sara Rossi"));
  const sug = card.slice(card.indexOf("tsugg"), card.indexOf("</div>", card.indexOf("tsugg")));
  assert.ok(/percorso/.test(sug) && !/recupero|volume/.test(sug), sug);
});
prova("problema sostanziale: in «Da gestire»; un fastidio lieve: solo in Fatica", () => {
  squadra();
  run(`S.ost.a1=[{d:"${T}",exercise:"ostrc",p:[{t:"inf",z:"ginocchio",l:"dx",q1:2,q2:2,q3:2,q4:2,gg:2}]}];
       S.ost.a2=[{d:"${T}",exercise:"ostrc",p:[{t:"inf",z:"caviglia",q1:1,q2:1,q3:0,q4:1,gg:0}]}];`);
  assert.equal(j(`saluteFlags("a1").length`), 1);
  assert.equal(j(`saluteFlags("a2").length`), 0, "un fastidio lieve non deve riempire «Da gestire»");
  assert.equal(j(`todayManageCount()`), 1);
  assert.ok(/Caviglia/.test(j(`ostChip("a2")`)) && /amber/.test(j(`ostChip("a2")`)));
  assert.ok(/Ginocchio dx/.test(j(`ostChip("a1")`)) && /sost/.test(j(`ostChip("a1")`)));
});
prova("ansia o umore giù: un segnale da gestire parlando, non col carico", () => {
  squadra();
  run(`S.ost.a1=[{d:"${T}",exercise:"ostrc",p:[{t:"mal",s:["umore"],q1:1,q2:0,q3:1,q4:1,gg:0}]}]`);
  const f = j(`saluteFlags("a1")`);
  assert.equal(f.length, 1); assert.ok(/privato/.test(f[0].sug) && /Non è una questione di carico/.test(f[0].sug));
});
prova("rientro: «fuori» ferma, «lavoro adattato» avvisa, «disponibile» chiude", () => {
  squadra();
  run(`dispSalva("a1","fuori","${meno(10)}","caviglia"); dispSalva("a1","part","${meno(3)}");`);
  let f = j(`saluteFlags("a1")`);
  assert.equal(f[0].c, "amber"); assert.ok(/adattato/.test(f[0].t));
  assert.equal(j(`dispGiorniFuori("a1")`), 7, "dieci giorni fa fuori, tre giorni fa in rientro: sette giorni fuori");
  run(`dispSalva("a1","prest","${T}")`);
  assert.equal(j(`saluteFlags("a1").length`), 0);
  assert.equal(j(`dispOggi("a1")`), null);
  assert.equal(j(`dispGiorniFuori("a1")`), 7);
  run(`dispSalva("a2","fuori","${meno(2)}")`);
  f = j(`saluteFlags("a2")`); assert.ok(f[0].prio); assert.equal(j(`dispGiorniFuori("a2")`), 3, "fuori da due giorni fa a oggi compreso");
  assert.equal(j(`dispSalva("a2","constructor","${T}")`), false);
});

sezione("\nLavoro a casa");
prova("previste: volte a settimana per i giorni passati, per difetto", () => {
  squadra();
  run(`S.skin.a1=[{d:"${meno(2)}",exercise:"sk:k1",id:"k1",titolo:"Casa",volte:2,sett:2}]`);
  assert.equal(j(`skAderenza("a1")[0].prev`), 0, "dopo tre giorni non è in ritardo");
  run(`S.skin.a1[0].d="${meno(13)}"`);
  assert.equal(j(`skAderenza("a1")[0].prev`), 4);
  run(`S.skin.a1[0].d="${meno(40)}"`);
  assert.equal(j(`skAderenza("a1")[0].prev`), 4, "finita la scheda, le previste non crescono più");
  assert.equal(j(`skAderenza("a1")[0].finita`), true);
});
prova("le sedute segnate entrano nel carico settimanale", () => {
  squadra();
  run(`for(let w=1;w<=4;w++) for(const g of [1,3,5]) (S.load.a1=S.load.a1||[]).push({d:isoDaNum(dayNum(todayISO())-(w*7+g)),rpe:5,min:60});
       S.load.a1.push({d:"${meno(1)}",rpe:5,min:60});`);
  const prima = j(`caricoSett("a1").sett`);
  run(`S.skf.a1=[{d:"${meno(2)}",exercise:"f:k1",sk:"k1",esito:"tutta",rpe:6,min:40}]`);
  assert.equal(j(`caricoSett("a1").sett`), prima + 240);
});
prova("mandare una scheda la registra; rimandarla con un'altra data non la raddoppia", () => {
  squadra();
  run(`SK=skVuota("a1"); SK.titolo="Casa 45"; SK.ex=[{nome:"Plank",sr:"3×30s"},{nome:"Ponte",sr:"3×10"},{nome:""}]; SK.volte=3; SK.sett=4; skRegistra();`);
  let l = j(`S.skin.a1`);
  assert.equal(l.length, 1); assert.equal(l[0].n, 2); assert.equal(l[0].volte, 3); assert.equal(l[0].sett, 4); assert.equal(l[0].titolo, "Casa 45");
  const id = l[0].id;
  run(`SK.data="${meno(1)}"; skRegistra();`);
  l = j(`S.skin.a1`);
  assert.equal(l.length, 1); assert.equal(l[0].id, id); assert.equal(l[0].d, meno(1));
  assert.ok(j(`S.tomb`)["ki:a1:" + T + "|sk:" + id], "la versione vecchia va tolta anche dagli altri dispositivi");
  run(`SK=skVuota(""); SK.ex=[{nome:"Plank"}]; skRegistra();`);
  assert.equal(j(`Object.keys(S.skin)`).length, 1, "una scheda generica, senza atleta, non va da nessuna parte");
});
prova("«Condividi» registra la scheda anche quando il telefono non sa condividere file", async () => {
  squadra();
  run(`dl=function(){ globalThis.__dl=1; }; SK=skVuota("a2"); SK.ex=[{nome:"Plank",sr:"3×30s"}];`);
  await run(`skCondividi()`);
  assert.equal(j(`S.skin.a2.length`), 1);
});
prova("il PDF dice quante volte e come segnarla", () => {
  squadra();
  run(`SK=skVuota("a1"); SK.ex=[{nome:"Plank",sr:"3×30s"}]; SK.volte=2; SK.sett=3; globalThis.__f=skFile();`);
  const testo = Buffer.from(j(`Array.from(__f.byte)`)).toString("latin1");
  assert.ok(/Da fare 2 volte a settimana per 3 settimane/.test(testo));
  assert.ok(/link settimanale/.test(testo));
});

sezione("\nBackup, sincronizzazione, cancellazioni");
prova("dal backup: codici sconosciuti e risposte a metà si scartano interi", () => {
  const o = j(`sanitizeImport({athletes:[{id:"a1",name:"S",team:"t1",profile:{}}], teams:[{id:"t1",name:"U"}], data:{},
    ost:{a1:[{d:"2026-10-01",exercise:"ostrc",p:[{t:"inf",z:"constructor",q1:1,q2:0,q3:0,q4:0,gg:0}]},
             {d:"2026-10-02",exercise:"ostrc",p:[{t:"inf",z:"spalla",q1:1,q2:0,q3:0,q4:0,gg:0},{t:"inf",z:"spalla",q1:2,gg:0}]},
             {d:"2026-10-03",exercise:"ostrc",p:[{t:"mal",s:["febbre","__proto__"],q1:3,gg:1,x:"<b>"}]}],
         zz:[{d:"2026-10-01",exercise:"ostrc",p:[]}]},
    skf:{a1:[{d:"2026-10-01",sk:"k1",esito:"tutta",rpe:11,min:30},{d:"2026-10-02",sk:"k1",esito:"tutta",rpe:5,min:30}]},
    disp:{a1:[{d:"2026-10-01",stato:"toString"},{d:"2026-10-02",stato:"fuori",nota:"x".repeat(500)}]}})`);
  assert.equal(o.ost.a1.length, 1); assert.deepEqual(o.ost.a1[0].p[0].s, ["febbre"]); assert.equal(o.ost.a1[0].p[0].x, undefined);
  assert.equal(o.ost.zz, undefined);
  assert.equal(o.skf.a1.length, 1); assert.equal(o.skf.a1[0].exercise, "f:k1");
  assert.equal(o.disp.a1.length, 1); assert.equal(o.disp.a1[0].nota.length, 200);
});
prova("le risposte scritte dal server sopravvivono al salvataggio del telefono che non le aveva", () => {
  const server = { athletes: [{ id: "a1", name: "S" }], data: {}, ost: { a1: [{ d: "2026-11-02", exercise: "ostrc", p: [] }] }, skf: { a1: [{ d: "2026-11-01", exercise: "f:k1", sk: "k1", esito: "tutta", rpe: 5, min: 30 }] }, tomb: {} };
  const tel = { athletes: [{ id: "a1", name: "S" }], data: {}, ost: {}, skf: {}, disp: { a1: [{ d: "2026-11-01", exercise: "disp", stato: "fuori" }] }, tomb: {} };
  const o = j(`mergeState(${JSON.stringify(server)}, ${JSON.stringify(tel)})`);
  assert.equal(o.ost.a1.length, 1); assert.equal(o.skf.a1.length, 1); assert.equal(o.disp.a1[0].stato, "fuori");
});
prova("togliere una risposta la toglie anche dagli altri dispositivi", () => {
  squadra();
  run(`S.ost.a1=[{d:"2026-11-02",exercise:"ostrc",p:[]}]; ostTogli("a1","2026-11-02");`);
  const o = j(`mergeState({athletes:S.athletes, data:{}, ost:{a1:[{d:"2026-11-02",exercise:"ostrc",p:[]}]}, tomb:{}}, S)`);
  assert.equal(o.ost.a1, undefined);
});
prova("cancellare un'atleta cancella anche salute, rientro e lavoro a casa", () => {
  assert.ok(/\["data","readiness","load","screen","lv","pres","mjl","salti","scout","ost","skin","skf","disp"\]\.forEach\(k=>\{ if\(S\[k\]\) delete S\[k\]\[a\.id\]; \}\);/.test(html));
});

sezione("\nLa pagina della settimana (lato atleta)");
const INFO = `{nome:"Sara", squadra:"U18", oggi:"${T}", ostrcGia:null, schede:[{id:"k1", titolo:"Casa", d:"${meno(3)}", volte:2, fatte7:0}]}`;
const invia = () => { run(`globalThis.__inv=null; apiCall=function(a,b){ globalThis.__inv={a:a,b:b}; return new Promise(()=>{}); }; settInvia();`); return j(`__inv`); };
prova("«ho partecipato a tutto senza problemi»: una risposta con zero problemi", () => {
  run(`SETT={token:"tk", info:${INFO}, gate:null, probs:[], sed:[], rifai:false, err:"", invio:false};`);
  assert.equal(invia(), null, "senza la prima risposta non parte");
  run(`settGate(0)`);
  assert.deepEqual(invia(), { a: "weeklySubmit", b: { token: "tk", ostrc: { p: [] } } });
});
prova("un problema: tutte le domande, «non ho potuto partecipare» salta le tre centrali", () => {
  run(`SETT={token:"tk", info:${INFO}, gate:null, probs:[], sed:[], rifai:false, err:"", invio:false}; settGate(3);`);
  assert.equal(j(`SETT.probs[0].q1`), 3, "la prima risposta si porta nel problema");
  assert.equal(invia(), null);
  run(`settP(0,"t","inf"); settP(0,"z","ginocchio"); settP(0,"l","dx"); settP(0,"gg",3); settP(0,"nuovo",true);`);
  const b = invia().b;
  assert.deepEqual(b.ostrc.p, [{ t: "inf", q1: 3, gg: 3, nuovo: true, z: "ginocchio", l: "dx" }]);
  run(`SETT.invio=false; settP(0,"q1",2);`);
  assert.equal(invia(), null, "con «meno del solito» servono le altre tre");
  run(`settP(0,"q2",2); settP(0,"q3",1); settP(0,"q4",0);`);
  assert.deepEqual(invia().b.ostrc.p[0], { t: "inf", q1: 2, gg: 3, nuovo: true, z: "ginocchio", l: "dx", q2: 2, q3: 1, q4: 0 });
});
prova("già risposto: si mandano solo le sedute, e il questionario resta quello", () => {
  run(`SETT={token:"tk", info:Object.assign(${INFO},{ostrcGia:"${T}"}), gate:null, probs:[], sed:[], rifai:false, err:"", invio:false};`);
  assert.equal(invia(), null);
  run(`SETT.sed.push({sk:"k1", d:"${T}", esito:"tutta", rpe:6, min:45});`);
  assert.deepEqual(invia().b, { token: "tk", sedute: [{ sk: "k1", d: T, esito: "tutta", rpe: 6, min: 45 }] });
});
prova("un sintomo rosso, mentre lo segna, le dice di avvisare oggi stesso", () => {
  run(`SETT={token:"tk", info:${INFO}, gate:1, probs:[settNuovoProb(1)], sed:[], rifai:false, err:"", invio:false}; settP(0,"t","mal"); settP(0,"s","svenimento"); settDraw();`);
  assert.ok(/dillo oggi stesso/.test(j(`document.getElementById("pubform").innerHTML`)));
});
prova("si apre dal suo link senza login e senza toccare lo stato dell'app", () => {
  const boot = html.slice(html.indexOf("const _anamToken=anamToken();"));
  assert.ok(/if\(_settToken && !_anamToken\)\{[\s\S]{0,200}bootSettimana\(_settToken\);[\s\S]{0,40}\} else if\(_anamToken\)/.test(boot));
});

sezione("\nLa pagina per l'allenatore");
prova("disponibilità, carico, partite, test; la salute solo se la lasci", () => {
  squadra();
  run(`S.gare={t1:[{d:"${meno(3)}",avv:"Rozzano"}]}; S.load.a1=[{d:"${meno(3)}",exercise:"gara",rpe:7,min:110,set:4}];
       S.scout={a1:[{d:"${meno(3)}",exercise:"gara",pt:14,set:[1,2,3,4],sest:[]}]};
       S.ost.a1=[{d:"${meno(1)}",exercise:"ostrc",p:[{t:"inf",z:"spalla",q1:2,q2:2,q3:2,q4:2,gg:0}]}];
       dispSalva("a1","sport","${meno(5)}");
       S.data.a1={cmj:[{d:"${meno(30)}",v:30},{d:"${meno(2)}",v:33}]};`);
  const h = j(`allenHtml("a1", {})`);
  assert.ok(/Rientro: lavoro pieno/.test(h)); assert.ok(/Rozzano/.test(h) && />14</.test(h));
  assert.ok(/Spalla/.test(h) && /sostanziale/.test(h)); assert.ok(/CMJ|Countermovement/i.test(h));
  const senza = j(`allenHtml("a1", {salute:false})`);
  assert.ok(!/Spalla/.test(senza) && !/OSTRC/.test(senza), "senza salute non deve restare niente del questionario");
  assert.ok(!/painLevel|anamnesi patologica/i.test(h));
});
prova("si apre dalla scheda dell'atleta; link e salute dalle impostazioni", () => {
  assert.ok(/onclick="openAllen\(\\''\+id\+'\\'\)"/.test(html));
  assert.ok(/row\("🗓","Link settimanali"/.test(html) && /row\("🩹","Salute della squadra"/.test(html));
});

for (const [nome, fn] of prove) {
  if (nome === null) { console.log(fn); continue; }
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
}
if (!PGlite) console.log("\n  ~~ la parte server è saltata: manca @electric-sql/pglite (dipendenza di sviluppo)");
console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
