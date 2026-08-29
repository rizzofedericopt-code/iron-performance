// La migrazione dei link di squadra, provata su un Postgres vero (PGlite).
//
//   node test/migrazione.mjs
//
// Le colonne dei link di squadra servono al codice. La versione manuale era
// "lancia questo SQL prima di pubblicare": un ordine che si sbaglia una volta
// sola e lascia il modulo anamnesi rotto per TUTTI, compresi i link personali
// gia' in mano alle atlete. Quindi la migrazione se la applica il server.
//
// Le istruzioni NON sono ricopiate qui: vengono estratte da api/store.js, cosi'
// se qualcuno le cambia questo test le prova davvero. Ed e' un test che serve:
// una migrazione automatica che non gira, o che gira due volte e rompe, e'
// peggio del passaggio manuale che ha sostituito.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const store = readFileSync(join(here, "..", "api", "store.js"), "utf8");

let failed = 0;
const prova = async (nome, fn) => {
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ── le istruzioni vere, estratte dal codice che gira in produzione ── */
const blocco = store.match(/async function ensureLinkSchema\(\)[\s\S]*?\n}/);
assert.ok(blocco, "ensureLinkSchema non trovata in api/store.js");
const migrazione = [...blocco[0].matchAll(/sql`(ALTER TABLE[\s\S]*?)`/g)].map(m => m[1].trim());
assert.ok(migrazione.length >= 8,
  "attese almeno 8 istruzioni ALTER, trovate " + migrazione.length);

const sonda = blocco[0].match(/SELECT 1 FROM information_schema\.columns[\s\S]*?LIMIT 1/);
assert.ok(sonda, "manca la sonda che evita di rilanciare la migrazione a ogni richiesta");

/* ── la tabella com'era PRIMA: quella che c'e' adesso sul database di Federico ── */
const VECCHIA = `
CREATE TABLE form_links (
  token_hash    text PRIMARY KEY,
  coach_email   text        NOT NULL,
  athlete_id    text        NOT NULL,
  athlete_name  text,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);`;

async function db(conVecchia = true) {
  const d = new PGlite();
  if (conVecchia) await d.exec(VECCHIA);
  return d;
}
const applica = async (d) => { for (const q of migrazione) await d.exec(q); };
const colonne = async (d) => {
  const r = await d.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='form_links'`);
  return r.rows.map((x) => x.column_name).sort();
};

await prova("la migrazione gira sulla tabella vecchia senza errori", async () => {
  const d = await db();
  await applica(d);
  const c = await colonne(d);
  ["kind", "team_id", "team_name", "max_uses", "uses", "closed_at", "pass_hash"]
    .forEach((k) => assert.ok(c.includes(k), "manca la colonna " + k));
  await d.close();
});

await prova("i link personali gia' esistenti restano personali", async () => {
  const d = await db();
  await d.exec(`INSERT INTO form_links (token_hash, coach_email, athlete_id, athlete_name, expires_at)
                VALUES ('h1', 'f@r.it', 'a1', 'Giulia Rossi', now() + interval '2 days')`);
  await applica(d);
  const r = await d.query(`SELECT kind, uses, closed_at FROM form_links WHERE token_hash='h1'`);
  assert.equal(r.rows[0].kind, "athlete",
    "un link generato ieri non deve diventare un link di squadra");
  assert.equal(Number(r.rows[0].uses), 0);
  assert.equal(r.rows[0].closed_at, null);
  await d.close();
});

await prova("dopo la migrazione si puo' inserire un link senza atleta", async () => {
  // e' il punto per cui serve DROP NOT NULL: quando il link nasce, l'atleta
  // non esiste ancora
  const d = await db();
  await applica(d);
  await d.exec(`INSERT INTO form_links
      (token_hash, coach_email, athlete_id, kind, team_id, team_name, max_uses, expires_at)
    VALUES ('h2', 'f@r.it', NULL, 'team', 't1', 'Young Volley', 18, now() + interval '14 days')`);
  const r = await d.query(`SELECT kind, team_id, max_uses, uses FROM form_links WHERE token_hash='h2'`);
  assert.equal(r.rows[0].kind, "team");
  assert.equal(r.rows[0].team_id, "t1");
  assert.equal(Number(r.rows[0].max_uses), 18);
  assert.equal(Number(r.rows[0].uses), 0, "un link nuovo parte da zero schede");
  await d.close();
});

await prova("rilanciarla una seconda volta non rompe niente", async () => {
  // due istanze serverless che partono insieme la lanciano entrambe
  const d = await db();
  await applica(d);
  await d.exec(`INSERT INTO form_links (token_hash, coach_email, athlete_id, kind, team_id, expires_at, uses)
                VALUES ('h3','f@r.it',NULL,'team','t1', now() + interval '5 days', 7)`);
  await applica(d);
  await applica(d);
  const r = await d.query(`SELECT uses, kind FROM form_links WHERE token_hash='h3'`);
  assert.equal(Number(r.rows[0].uses), 7, "le schede gia' raccolte non devono azzerarsi");
  assert.equal(r.rows[0].kind, "team");
  await d.close();
});

await prova("il contatore delle schede si incrementa e il tetto si legge", async () => {
  const d = await db();
  await applica(d);
  await d.exec(`INSERT INTO form_links (token_hash, coach_email, athlete_id, kind, team_id, max_uses, expires_at)
                VALUES ('h4','f@r.it',NULL,'team','t1',2, now() + interval '5 days')`);
  await d.exec(`UPDATE form_links SET uses = uses + 1 WHERE token_hash='h4'`);
  await d.exec(`UPDATE form_links SET uses = uses + 1 WHERE token_hash='h4'`);
  const r = await d.query(
    `SELECT uses >= max_uses AS pieno FROM form_links WHERE token_hash='h4'`);
  assert.equal(r.rows[0].pieno, true, "al tetto il modulo deve risultare pieno");
  await d.close();
});

await prova("la sonda evita di rilanciare la migrazione quando le colonne ci sono", async () => {
  const d = await db();
  await applica(d);
  const r = await d.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'form_links' AND column_name = 'kind' LIMIT 1`);
  assert.equal(r.rows.length, 1, "la sonda deve trovare la colonna dopo la migrazione");
  const d2 = await db();
  const r2 = await d2.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'form_links' AND column_name = 'kind' LIMIT 1`);
  assert.equal(r2.rows.length, 0, "e non deve trovarla prima");
  await d.close(); await d2.close();
});

await prova("un fallimento non viene memorizzato: la richiesta dopo riprova", async () => {
  assert.match(blocco[0], /_linkSchema = null;\s*\n\s*throw e;/,
    "memorizzare l'errore spegnerebbe i moduli fino al riavvio dell'istanza");
});

await prova("schema.sql e il codice dicono la stessa cosa", async () => {
  const schema = readFileSync(join(here, "..", "schema.sql"), "utf8");
  migrazione.forEach((q) => {
    const col = /ADD COLUMN IF NOT EXISTS\s+(\w+)/.exec(q);
    if (col) assert.ok(new RegExp("ADD COLUMN IF NOT EXISTS\\s+" + col[1] + "\\b").test(schema),
      "schema.sql non prevede " + col[1] + ": chi ricrea il database da zero avrebbe una tabella diversa");
  });
  assert.match(schema, /ALTER COLUMN athlete_id DROP NOT NULL/);
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
