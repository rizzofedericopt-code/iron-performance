// Il triangolo rosso, e la porta dei carichi sull'intestazione della colonna.
//
//   node test/allarmi.mjs
//
// Il difetto che questo test protegge e' il peggiore che abbia incontrato in
// questa app, perche' non sbaglia un numero: spegne l'attenzione.
//
// I campi clinici dell'anamnesi sono testo libero, e l'allarme si accendeva se
// dentro c'era QUALSIASI cosa. Ma a «Dolori o infortuni che hai ADESSO»
// un'atleta sana non lascia vuoto: scrive «no». Sedici atlete su sedici col
// triangolo acceso — visto in una schermata vera, non immaginato.
//
// La regola nuova deve sbagliare SEMPRE dalla parte dell'allarme: nel dubbio
// accende. Un falso allarme costa uno sguardo, un allarme mancato costa
// un'atleta.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));

const campi = {};
const elFor = (id) => ({
  get value() { return campi[id] != null ? campi[id] : ""; },
  set value(v) { campi[id] = v; },
  dataset: {}, style: {}, disabled: false, textContent: "", innerHTML: "",
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector() { return null; }, querySelectorAll() { return []; },
  appendChild() {}, focus() {}, select() {}, click() {},
});
const cache = {};
const sandbox = {
  document: {
    getElementById: (id) => (cache[id] ||= elFor(id)),
    querySelector: () => cache.__q ||= elFor("__q"),
    querySelectorAll: () => [], createElement: () => elFor("__c"),
    addEventListener() {}, body: elFor("__b"), documentElement: elFor("__d"), hidden: false,
  },
  window: { addEventListener() {}, open: () => null }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
  requestAnimationFrame: (f) => f(), cancelAnimationFrame() {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
run(`normalize(); save=function(){}; toast=function(){};`);

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

console.log("\n«no» e' una risposta, non un dato");

prova("le negazioni secche non sono un infortunio", () => {
  const vuote = ["", "   ", "no", "No", "NO", "no.", "nooo", "nn", "n", "-", "--", "/", "0", "x",
    "niente", "Niente.", "nulla", "nessuno", "Nessuno", "nessuna", "NESSUNO!",
    "nessun dolore", "nessun infortunio", "no dolori", "no infortuni",
    "assente", "negativo", "non ho", "non ne ho", "tutto ok", "tutto bene", "sto bene", "ok"];
  vuote.forEach(v => assert.equal(run(`rispostaVuota(${JSON.stringify(v)})`), true,
    JSON.stringify(v) + " non deve accendere niente"));
});

prova("una risposta vera resta una risposta, anche corta", () => {
  const vere = ["caviglia", "schiena", "ginocchio destro", "spalla da 3 settimane",
    "mal di schiena la mattina", "dolore al tendine rotuleo",
    "no ma ogni tanto la spalla sinistra",
    "nessuno adesso ma l'anno scorso il ginocchio",
    "niente di grave, solo la caviglia che tira"];
  vere.forEach(v => assert.equal(run(`rispostaVuota(${JSON.stringify(v)})`), false,
    JSON.stringify(v) + " DEVE restare accesa"));
});

prova("sopra i 30 caratteri non si interpreta: si accende e basta", () => {
  // una frase lunga che comincia con una negazione e' comunque una risposta
  const lunga = "no, non ho proprio niente in questo momento";
  assert.ok(lunga.length > 30);
  assert.equal(run(`rispostaVuota(${JSON.stringify(lunga)})`), false);
});

prova("haInfortunio guarda il campo giusto e regge un profilo assente", () => {
  assert.equal(run(`haInfortunio({injuriesCurrent:"no"})`), false);
  assert.equal(run(`haInfortunio({injuriesCurrent:"caviglia"})`), true);
  assert.equal(run(`haInfortunio({})`), false);
  assert.equal(run(`haInfortunio(null)`), false);
  assert.equal(run(`haInfortunio(undefined)`), false);
  // gli infortuni PASSATI non sono un allarme di oggi
  assert.equal(run(`haInfortunio({injuriesPast:"crociato 2023"})`), false);
});

console.log("\nDove l'allarme si vede");

const squadra = (risposte) => {
  const ath = risposte.map((r, i) =>
    `{id:"p${i}",name:"P${i}",team:"t1",sex:"F",profile:{injuriesCurrent:${JSON.stringify(r)}}}`).join(",");
  run(`S.teams=[{id:"t1",name:"Sq",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[${ath}]; S.data={}; S.readiness={}; S.load={}; S.screen={}; S.lv={}; S.gruppi={};`);
};

prova("sedici «no» non accendono sedici triangoli nella matrice", () => {
  squadra(new Array(16).fill("no"));
  run(`renderMatrix()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.equal((h.match(/medflag/g) || []).length, 0, "nessun triangolo deve comparire");
});

prova("chi ha scritto un infortunio vero il triangolo ce l'ha", () => {
  squadra(["no", "caviglia destra", "nessuno", "", "dolore al ginocchio da un mese"]);
  run(`renderMatrix()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.equal((h.match(/medflag/g) || []).length, 2, "esattamente due su cinque");
});

prova("il contatore di «Oggi» conta le persone, non le risposte", () => {
  squadra(new Array(16).fill("nessuno"));
  assert.equal(run(`todayManageCount()`), 0, "sedici «nessuno» non sono sedici da gestire");
  squadra(["no", "caviglia", "niente"]);
  assert.equal(run(`todayManageCount()`), 1);
});

prova("«nessuna» alle allergie non e' un'allergia", () => {
  ["conditions", "meds", "allergies", "recurrent"].forEach(k => {
    assert.equal(run(`rispostaVuota(${JSON.stringify("nessuna")})`), true, k);
  });
  // e una vera si vede
  assert.equal(run(`rispostaVuota("lattosio")`), false);
});

console.log("\nLa porta dei carichi sull'intestazione");

prova("l'intestazione di un 1RM apre percentuali e gruppi", () => {
  squadra(["no", "no"]);
  run(`S.data={p0:{rmSquat:[{d:"2026-06-01",v:80}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(/openLoadGroups\('rmSquat'\)/.test(h), "il nome del test deve essere cliccabile");
  assert.ok(/🏋️ carichi/.test(h), "e deve vedersi che lo e'");
  assert.ok(/class="tn clic"/.test(h));
});

prova("le altre colonne restano come prima", () => {
  squadra(["no"]);
  run(`S.data={p0:{cmj:[{d:"2026-06-01",v:30}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  const carichi = (h.match(/🏋️ carichi/g) || []).length;
  const colonne = (h.match(/th-test/g) || []).length;
  assert.ok(colonne > carichi, "non tutte le colonne sono massimali: " + carichi + " su " + colonne);
  assert.ok(!/openLoadGroups\('cmj'\)/.test(h), "un CMJ non ha percentuali di carico");
});

prova("la guida resta raggiungibile dove era", () => {
  squadra(["no"]);
  run(`S.data={p0:{rmSquat:[{d:"2026-06-01",v:80}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(/openGuide\('rmSquat'\)/.test(h), "la ⓘ guida non deve sparire");
});

prova("anche il massimale generico ha la sua porta", () => {
  // `rm1` non sta in LV_EX perche' non dice quale esercizio stai facendo — ma
  // per le percentuali di carico contano i chili, non il nome dell'esercizio.
  squadra(["no"]);
  run(`S.data={p0:{rm1:[{d:"2026-06-01",v:80}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(/openLoadGroups\('rm1'\)/.test(h), "la colonna 1RM generica non deve restare muta");
  assert.ok(run(`lgEsercizi().some(e=>e.test==="rm1")`), "e deve comparire fra gli esercizi della finestra");
  assert.equal(run(`rmTestEx("rm1")`), "Massimale (generico)");
});

prova("una stima chiesta sul generico non finisce sullo squat", () => {
  // il menu elencava ESERCIZI: il generico non c'era e cadeva sul primo della
  // lista, cioe' Back squat. Il dato finiva nella colonna sbagliata in silenzio.
  squadra(["no"]);
  run(`S.data={}; CUR={a:"p0",t:"rm1",mode:"reps"};`);
  cache.rmSaveBtn = elFor("rmSaveBtn");
  Object.assign(cache.rmSaveBtn.dataset, { est: "70", lo: "68", hi: "72", w: "60", r: "4", rir: "1" });
  campi.rmD = "2026-09-20";
  run(`drawCell=function(){}; render=function(){}; saveRepMax("p0","rm1","cella");`);
  assert.ok(run(`S.data.p0.rm1`), "deve finire su 1RM generico");
  assert.equal(run(`S.data.p0.rmSquat`), undefined, "e NON sullo squat");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
