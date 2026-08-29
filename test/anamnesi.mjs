// Test del modulo anamnesi: quali campi l'atleta puo' scrivere, e cosa serve
// perche' il consenso sia registrabile.
//
//   node test/anamnesi.mjs
//
// Il punto centrale: la lista dei campi ammessi vive in DUE posti — l'array
// PROFILE in index.html (cosa si vede) e FORM_ALLOWED_KEYS in api/store.js
// (cosa si puo' scrivere). Se divergono, o un campo diventa incompilabile,
// oppure — molto peggio — uno riservato al preparatore diventa scrivibile da
// chiunque abbia il link. Questo test confronta le due liste.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const store = readFileSync(join(here, "..", "api", "store.js"), "utf8");

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ── estrae PROFILE da index.html e la whitelist da store.js ── */
const profileBlock = html.match(/const PROFILE=\[([\s\S]*?)\n\];/);
assert.ok(profileBlock, "array PROFILE non trovato in index.html");
const profileKeys = [...profileBlock[1].matchAll(/\{k:"([A-Za-z0-9_]+)"/g)].map(m => m[1]);

const wlBlock = store.match(/const FORM_ALLOWED_KEYS = \[([\s\S]*?)\];/);
assert.ok(wlBlock, "FORM_ALLOWED_KEYS non trovato in api/store.js");
const allowed = [...wlBlock[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map(m => m[1]);

/* ── campi che il preparatore compila da solo: non devono MAI essere scrivibili
      da chi ha il link ── */
const RISERVATI = ["medical", "medicalExpiry", "notes",
                   "consent", "consentBy", "consentName", "consentDate", "consentDoc"];

prova("i campi riservati al preparatore non sono scrivibili dal modulo", () => {
  const bucati = RISERVATI.filter(k => allowed.includes(k));
  assert.equal(bucati.join(","), "",
    "scrivibili da chi ha il link, e non devono esserlo: " + bucati.join(", "));
});

prova("l'idoneita' medica in particolare non e' scrivibile", () => {
  assert.ok(!allowed.includes("medical"),
    "chi ha il link potrebbe dichiararsi idoneo");
  assert.ok(!allowed.includes("medicalExpiry"));
});

prova("ogni campo ammesso esiste davvero in PROFILE", () => {
  const fantasmi = allowed.filter(k => !profileKeys.includes(k));
  assert.equal(fantasmi.join(","), "",
    "presenti nella whitelist ma inesistenti nel modulo: " + fantasmi.join(", "));
});

prova("ogni campo del modulo e' ammesso dal server", () => {
  const attesi = profileKeys.filter(k => !RISERVATI.includes(k));
  const persi = attesi.filter(k => !allowed.includes(k));
  assert.equal(persi.join(","), "",
    "l'atleta li compila ma il server li scarta in silenzio: " + persi.join(", "));
});

prova("il modulo nasconde i campi riservati", () => {
  const skip = html.match(/const skipKey=\{([^}]*)\}/);
  assert.ok(skip, "skipKey non trovato in anamFields");
  ["medical", "medicalExpiry", "notes", "consent", "consentBy", "consentName", "consentDate", "consentDoc"]
    .forEach(k => assert.ok(new RegExp(k + ":1").test(skip[1]), k + " non e' nascosto nel modulo"));
});

/* ── il consenso ── */
prova("il server esige ruolo, lettura dell'informativa e consenso sanitario", () => {
  assert.match(store, /consentRole !== "athlete" && consentRole !== "guardian"/);
  assert.match(store, /body\.policyRead !== true \|\| body\.consentHealth !== true/);
});

prova("per un minorenne serve il nome di chi presta il consenso", () => {
  assert.match(store, /consentRole === "guardian" && consentName\.length < 3/);
});

prova("data e versione dell'informativa le stabilisce il server, non il client", () => {
  assert.match(store, /consentDate: now\(\)\.toISOString\(\)\.slice\(0, 10\)/,
    "la data del consenso deve venire dall'orologio del server");
  assert.match(store, /consentPolicyVersion: Number\(policy\.version\)/,
    "la versione deve venire dal payload, non dalla richiesta");
  assert.ok(!/consentDate: *(raw|body)\./.test(store),
    "la data non deve mai arrivare dal client");
});

prova("senza informativa pubblicata l'invio viene rifiutato", () => {
  assert.match(store, /if \(!policy \|\| !Number\(policy\.version\)/,
    "il server deve rifiutare l'invio se l'informativa non e' configurata");
});

prova("il consenso raccolto finisce nel registro accessi", () => {
  assert.match(store, /"formSubmit", "ok", ip,[\s\S]{0,600}consentBy/,
    "senza traccia in sola aggiunta, il consenso non e' dimostrabile");
});

prova("il modulo pubblico ha due conferme distinte, non una", () => {
  assert.match(html, /id="pfRead"/, "manca la conferma di lettura dell'informativa");
  assert.match(html, /id="pfHealth"/, "manca il consenso al trattamento dei dati sanitari");
  assert.match(html, /id="pfConsentRole"/, "manca il blocco che stabilisce chi presta il consenso");
});

// Prima qui si controllava la presenza di una tendina (id="pfRole") con
// l'opzione "sono l'atleta e sono maggiorenne". Una ragazza di sedici anni la
// sceglieva senza pensarci e il consenso risultava prestato da lei: invalido,
// e invisibile. L'asserzione ora e' piu' forte, non piu' debole — chi presta
// il consenso non e' piu' una risposta possibile, e' una conseguenza.
prova("chi presta il consenso lo decide l'eta', non una tendina", () => {
  assert.ok(!/id="pfRole"/.test(html),
    "la tendina permetteva a una minorenne di dichiararsi maggiorenne");
  assert.match(store, /eta\s*<\s*18\s*&&\s*consentRole\s*!==\s*"guardian"/,
    "il server deve rifiutare un minorenne che firma da solo");
  assert.match(store, /eta\s*>=\s*18\s*&&\s*consentRole\s*!==\s*"athlete"/,
    "per un maggiorenne il consenso ai dati sanitari lo presta l'interessato");
});

prova("l'informativa viene mostrata dentro il modulo", () => {
  assert.match(html, /class="polbox"/, "l'informativa deve essere leggibile nel modulo stesso");
  assert.match(store, /payload -> 'policy' AS policy/, "formInfo deve restituire l'informativa");
});

prova("il link non si genera senza informativa (blocco anche lato app)", () => {
  assert.match(html, /if\(!policyReady\(S\.policy\)\|\|!Number\(S\.policy\.version\)\)/);
});

console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
