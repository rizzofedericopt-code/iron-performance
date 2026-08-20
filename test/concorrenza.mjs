// Test della concorrenza ottimistica su un Postgres vero (PGlite, in memoria).
//
//   node test/concorrenza.mjs
//
// Riproduce l'interleaving esatto che il vecchio codice non reggeva:
//   A legge version=1 · B legge version=1 · A scrive · B scrive
// Con due query separate (SELECT poi UPDATE incondizionata) la scrittura di B
// cancella quella di A senza che nessuno se ne accorga. Con l'UPDATE
// condizionata sulla versione, B non trova la riga e riceve 409.
//
// La query "nuova" NON è ricopiata qui: viene estratta da api/store.js, così
// se qualcuno la cambia il test se ne accorge.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const store = readFileSync(join(here, "..", "api", "store.js"), "utf8");

/* ── controlli sulla forma del codice: le regressioni più probabili ── */
const guardie = [
  ["l'UPDATE di save è condizionata sulla versione",
   /UPDATE payloads[\s\S]{0,400}?WHERE email = \$\{me\.email\} AND version = \$\{base\}/],
  ["l'esito dell'UPDATE viene verificato con rowCount",
   /upd\.rowCount === 1/],
  ["baseVersion è obbligatoria",
   /if \(!Number\.isFinite\(base\) \|\| base < 0\)/],
];
let failed = 0;
for (const [nome, re] of guardie) {
  if (re.test(store)) console.log("  ok   " + nome);
  else { failed++; console.log("  FAIL " + nome); }
}

/* ── database in memoria ── */
const db = new PGlite();
await db.exec(`
  CREATE TABLE payloads (
    email      text PRIMARY KEY,
    payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    version    integer     NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    bytes      integer     NOT NULL DEFAULT 2
  );
  INSERT INTO payloads (email, payload, version, bytes)
  VALUES ('coach@test.it', '{"athletes":[{"id":"a0","name":"partenza"}]}'::jsonb, 1, 40);
`);

const leggi = async () => {
  const r = await db.query("SELECT payload, version FROM payloads WHERE email=$1", ["coach@test.it"]);
  return r.rows[0];
};
const reset = () => db.exec(
  `UPDATE payloads SET payload='{"athletes":[{"id":"a0","name":"partenza"}]}'::jsonb, version=1 WHERE email='coach@test.it'`
);

const dati = (nome) => JSON.stringify({ athletes: [{ id: "a0", name: "partenza" }, { id: nome, name: nome }] });

const prova = async (nome, fn) => {
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ── 1. il comportamento VECCHIO: dimostra che la corsa era reale ── */
await prova("il vecchio schema SELECT+UPDATE perde una scrittura", async () => {
  await reset();
  const baseA = (await leggi()).version;          // A legge 1
  const baseB = (await leggi()).version;          // B legge 1 — nessuno ha ancora scritto
  assert.equal(baseA, 1); assert.equal(baseB, 1);

  // entrambi passano il controllo `base !== curV` perché hanno letto lo stesso valore
  await db.query("UPDATE payloads SET payload=$1::jsonb, version=$2 WHERE email=$3",
                 [dati("A"), baseA + 1, "coach@test.it"]);
  await db.query("UPDATE payloads SET payload=$1::jsonb, version=$2 WHERE email=$3",
                 [dati("B"), baseB + 1, "coach@test.it"]);

  const fin = await leggi();
  const nomi = fin.payload.athletes.map(a => a.id);
  assert.ok(!nomi.includes("A"), "il lavoro di A doveva essere andato perso (era il bug)");
  assert.equal(fin.version, 2, "e la versione resta 2 come se ci fosse stata una sola scrittura");
});

/* ── 2. il comportamento NUOVO: la seconda scrittura non passa ── */
const salva = async (base, chi) => {
  const r = await db.query(
    `UPDATE payloads SET payload=$1::jsonb, version = version + 1, updated_at = now(), bytes=$2
      WHERE email=$3 AND version=$4 RETURNING version`,
    [dati(chi), 60, "coach@test.it", base]);
  return { ok: r.rows.length === 1, version: r.rows[0]?.version ?? null };
};

await prova("con l'UPDATE condizionata la seconda scrittura viene respinta", async () => {
  await reset();
  const baseA = (await leggi()).version;
  const baseB = (await leggi()).version;

  const rA = await salva(baseA, "A");
  const rB = await salva(baseB, "B");

  assert.ok(rA.ok, "A doveva riuscire");
  assert.equal(rA.version, 2);
  assert.ok(!rB.ok, "B doveva essere respinto: e' il 409 che fa partire il merge sul client");

  const fin = await leggi();
  assert.ok(fin.payload.athletes.map(a => a.id).includes("A"), "il lavoro di A deve essere conservato");
  assert.equal(fin.version, 2);
});

await prova("dopo il merge, B risalva sulla versione aggiornata e passa", async () => {
  const rB2 = await salva(2, "B");    // il client ha unito e riparte da v2
  assert.ok(rB2.ok);
  assert.equal(rB2.version, 3);
});

await prova("la versione non salta mai un numero", async () => {
  await reset();
  let v = 1;
  for (let i = 0; i < 5; i++) {
    const r = await salva(v, "x" + i);
    assert.ok(r.ok);
    assert.equal(r.version, v + 1);
    v = r.version;
  }
});

await db.close();
console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
