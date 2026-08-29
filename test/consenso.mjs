// Da dove viene un consenso, e perche' la differenza va vista.
//
//   node test/consenso.mjs
//
// Un consenso registrato dal server e uno importato da un foglio di calcolo
// erano indistinguibili nella scheda atleta: stessa spunta, stesso "consenso
// ✓". Il primo ha data, versione dell'informativa e ruolo stabiliti dal server
// e una riga nel registro accessi; il secondo ha quello che c'era nel file, e
// il file lo puo' riscrivere il preparatore. Non e' un errore da vietare — la
// mamma che firma in palestra esiste — ma confonderli si', perche' fra sei mesi
// non si sa piu' quali consensi si possono sostenere.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const store = readFileSync(join(here, "..", "api", "store.js"), "utf8");

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ── la sandbox del client, come negli altri test ── */
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const el = {
  addEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
  focus() {}, select() {}, click() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", checked: false,
};
const sandbox = {
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
              createElement: () => el, addEventListener() {}, body: el, documentElement: el, hidden: false },
  window: { addEventListener() {} }, navigator: { userAgent: "test" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "index.html:<script>" });

/* ── 1. Chi scrive l'origine ── */

prova("il server marca come dimostrabile solo cio' che registra lui", () => {
  assert.match(store, /consentSource: "form"/,
    "senza questo, un consenso del modulo non e' riconoscibile da uno importato");
  const decl = store.match(/const FORM_ALLOWED_KEYS = \[[\s\S]*?\];/)[0];
  assert.ok(!/consentSource/.test(decl),
    "l'origine non deve poterla dichiarare chi compila: la stabilisce il server");
});

prova("l'importazione da CSV dichiara di essere un'importazione", () => {
  assert.match(html, /p\.consentSource="import"/,
    "le righe importate devono restare riconoscibili");
});

prova("la spunta messa a mano nella scheda si dichiara tale", () => {
  assert.match(html, /if\(p\.consent && !p\.consentSource\) p\.consentSource="manual"/,
    "un consenso spuntato a mano e' una dichiarazione del preparatore");
  assert.match(html, /if\(!p\.consent\)\{ delete p\.consentSource; \}/,
    "togliendo la spunta deve sparire anche l'origine, altrimenti resta appiccicata");
});

/* ── 2. Il giudizio ── */

prova("dimostrabile vuol dire: registrato dal server, con versione dell'informativa", () => {
  const { consentProven } = sandbox;
  assert.equal(typeof consentProven, "function", "consentProven deve esistere");

  assert.equal(consentProven({ consent: true, consentSource: "form", consentPolicyVersion: 2 }), true,
    "modulo + versione = dimostrabile");
  assert.equal(consentProven({ consent: true, consentSource: "form" }), false,
    "senza versione dell'informativa il consenso rimanda a un documento ignoto");
  assert.equal(consentProven({ consent: true, consentSource: "import", consentPolicyVersion: 2 }), false,
    "un foglio di calcolo puo' contenere qualunque numero di versione");
  assert.equal(consentProven({ consent: true, consentSource: "manual", consentPolicyVersion: 2 }), false,
    "la spunta a mano resta una dichiarazione, per quanto vera");
  assert.equal(consentProven({ consentSource: "form", consentPolicyVersion: 2 }), false,
    "senza consenso non c'e' niente da dimostrare");
  assert.equal(consentProven({}), false);
  assert.equal(consentProven(null), false, "un profilo assente non deve far esplodere niente");
});

prova("i consensi dichiarati si contano, quelli dimostrabili no", () => {
  const { consentDeclared } = sandbox;
  assert.equal(typeof consentDeclared, "function");
  vm.runInContext(`S.athletes=[
    {id:"a1",name:"Dal modulo",   profile:{consent:true,consentDate:"2026-08-29",consentSource:"form",consentPolicyVersion:2}},
    {id:"a2",name:"Importata",    profile:{consent:true,consentDate:"2026-08-01",consentSource:"import"}},
    {id:"a3",name:"Spuntata",     profile:{consent:true,consentDate:"2026-08-02",consentSource:"manual"}},
    {id:"a4",name:"Senza niente", profile:{}}
  ];`, sandbox);
  const nomi = sandbox.consentDeclared().map(a => a.name).sort().join(",");
  assert.equal(nomi, "Importata,Spuntata",
    "devono comparire solo i consensi che dichiari tu, non quelli registrati dal server");
});

prova("ogni origine ha una spiegazione diversa, non un'etichetta sola", () => {
  const { consentOrigine } = sandbox;
  const f = consentOrigine({ consent: true, consentSource: "form", consentPolicyVersion: 2 });
  const i = consentOrigine({ consent: true, consentSource: "import" });
  const n = consentOrigine({ consent: true });
  assert.equal(f.t, "dimostrabile");
  assert.equal(i.t, "importato");
  assert.equal(n.t, "dichiarato");
  assert.equal(f.c, "ok");
  assert.ok(i.c === "warn" && n.c === "warn", "solo il primo puo' essere presentato come acquisito");
  assert.equal(consentOrigine({}), null, "senza consenso non si mostra niente");
  assert.ok(new Set([f.d, i.d, n.d]).size === 3,
    "tre spiegazioni diverse: un'etichetta senza il perche' non insegna niente");
});

prova("l'origine si vede nella scheda atleta e nella schermata Privacy", () => {
  assert.match(html, /if\(f\.k==="consent"\)\{[\s\S]{0,200}consentOrigine\(p\)/,
    "sotto la spunta del consenso deve comparire da dove viene");
  assert.match(html, /const dich=consentDeclared\(\);/,
    "la schermata Privacy deve elencare i consensi dichiarati");
  assert.match(html, /\.csrc\{/, "manca lo stile del riquadro");
});

/* ── 3. Il foglio da stampare ── */

prova("il foglio nasce dalle stesse domande del modulo", () => {
  const f = html.match(/function printAnamnesi\(\)[\s\S]*?\n}/);
  assert.ok(f, "printAnamnesi deve esistere");
  // L'asserzione era /anamFields\(\)\.forEach/, cioe' legata alla forma esatta
  // della chiamata: e' bastato aggiungere un .filter() in mezzo per farla
  // fallire pur restando corretta la sostanza. Si controlla la sostanza.
  assert.match(f[0], /anamFields\(\)[\s\S]{0,60}\.forEach/,
    "un elenco di domande riscritto a mano si separa dal modulo alla prima aggiunta");
  assert.match(f[0], /f\.k!=="birth"/,
    "la data di nascita e' gia' nel riquadro anagrafico: chiederla due volte su carta la fa scrivere diversa");
  assert.ok(!/PROFILE\.forEach/.test(f[0]),
    "va usato anamFields, che toglie gia' i campi riservati al preparatore");
});

prova("il foglio non si stampa senza informativa pubblicata", () => {
  const f = html.match(/function printAnamnesi\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /if\(!policyReady\(pol\)\|\|!Number\(pol\.version\)\)/,
    "un consenso su carta che non cita una versione precisa non prova su cosa si e' acconsentito");
  assert.match(f, /versione '\+esc\(String\(pol\.version\)\)/,
    "la versione dell'informativa va stampata sul foglio");
});

prova("il foglio dice chi deve firmare per una minorenne", () => {
  const f = html.match(/function printAnamnesi\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /responsabilità genitoriale/,
    "sul foglio deve essere scritto: per una minorenne firma un genitore");
  assert.match(f, /art\. 9\.2\.a GDPR/,
    "il consenso ai dati sanitari va richiamato esplicitamente");
  assert.match(f, /revocare in qualsiasi momento/,
    "la revocabilita' e' parte del consenso, non un dettaglio");
});

prova("il foglio non entra in conflitto con la stampa della scheda atleta", () => {
  const f = html.match(/function printAnamnesi\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /window\.open\("", "_blank"\)/,
    "va stampato da una finestra propria: il CSS di stampa dell'app serve al PDF dell'atleta");
  assert.match(f, /if\(!w\)\{[\s\S]{0,120}popup/,
    "se il browser blocca la finestra bisogna dirlo, non fallire in silenzio");
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
