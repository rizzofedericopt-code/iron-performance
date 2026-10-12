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

console.log("\nLa batteria della squadra");

prova("un ripristino da backup non cancella la batteria personalizzata", () => {
  /* `tests` dice quali colonne vuoi vedere per quella squadra. L'export la
     scriveva, l'import la buttava via: tornavi da un backup e ti ritrovavi
     tutte le colonne del catalogo al posto delle tue, senza un avviso. */
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }],
    data: {},
    teams: [{ id: "t1", name: "YV", sport: "pallavolo", tests: ["cmj", "sj", "mat"] },
            { id: "t2", name: "Senza", sport: "calcio" }],
  });
  const o = run(`sanitizeImport(${b})`);
  const t1 = o.teams.filter(t => t.id === "t1")[0];
  assert.ok(t1, "la squadra deve esserci");
  assert.ok(t1.tests, "la batteria personalizzata è sparita nel ripristino");
  assert.equal(t1.tests.join(","), "cmj,sj,mat");
  const t2 = o.teams.filter(t => t.id === "t2")[0];
  assert.equal(t2.tests, undefined, "chi non ha una batteria non deve ritrovarsene una");
});

prova("un backup manomesso non fa entrare id inventati nella batteria", () => {
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }], data: {},
    teams: [{ id: "t1", name: "YV", sport: "pallavolo", tests: ["cmj", "../evil", 42, null, "sj"] }],
  });
  const o = run(`sanitizeImport(${b})`);
  assert.equal(o.teams[0].tests.join(","), "cmj,sj");
});

prova("il contatore dei test dice su quanti, non solo quanti", () => {
  // «Test · 22» da solo sembra completo: con una batteria personalizzata un
  // test nuovo del catalogo non compare e non hai motivo di sospettarlo
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo",tests:["cmj","sj","dj"]}];
       S.activeTeam="t1"; S.sport="pallavolo"; S.athletes=[]; S.data={};
       renderBar();`);
  const h = run(`document.getElementById("bar").innerHTML`);
  assert.ok(/Test · 3/.test(h), "manca il numero scelto: " + h.slice(0, 160));
  assert.ok(/di \d+/.test(h), "manca il totale dello sport: " + h.slice(0, 160));
  const tot = run(`TESTS.filter(x=>x.sports.includes("pallavolo")).length`);
  assert.ok(h.indexOf("di " + tot) > 0, "il totale deve essere quello della pallavolo (" + tot + ")");
});

prova("senza batteria personalizzata il contatore non inventa numeri", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; renderBar();`);
  const h = run(`document.getElementById("bar").innerHTML`);
  assert.ok(!/di \d+/.test(h), "niente totale se non c'è una selezione: " + h.slice(0, 160));
});

prova("il MAT c'è nel catalogo della pallavolo, anche se una squadra non lo monitora", () => {
  // è esattamente la situazione che ha portato a «non trovo il MAT»
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo",tests:["cmj","sj"]}];
       S.activeTeam="t1"; S.sport="pallavolo"; S.athletes=[]; S.data={};`);
  assert.ok(run(`TESTS.some(t=>t.id==="mat" && t.sports.includes("pallavolo"))`),
    "il test deve esistere per la pallavolo");
  assert.ok(!run(`visibleTests().some(t=>t.id==="mat")`),
    "ma con una batteria personalizzata non si vede: è voluto, non è un difetto");
  const h = run(`document.getElementById("bar").innerHTML`);
  run(`renderBar()`);
  assert.ok(/di \d+/.test(run(`document.getElementById("bar").innerHTML`)),
    "e la barra deve dire che ce ne sono altri");
});

console.log("\nEsercizi tuoi: una colonna ciascuno");

const pulisci = () => run(`S.custom=[]; S.data={}; S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}];
  S.activeTeam="t1"; S.sport="pallavolo"; S.athletes=[{id:"p0",name:"A",team:"t1",sex:"F",profile:{}}];
  S.gruppi={}; applyCustom();`);

prova("un esercizio nuovo diventa una colonna vera del catalogo", () => {
  pulisci();
  const id = run(`customAdd("Leg press","pred")`);
  assert.ok(id && /^u[A-Za-z0-9]+$/.test(id), "id strano: " + id);
  assert.ok(run(`!!TMAP[${JSON.stringify(id)}]`), "non è entrato in TMAP");
  const t = run(`TMAP[${JSON.stringify(id)}]`);
  assert.equal(t.name, "Leg press");
  assert.equal(t.unit, "kg");
  assert.equal(t.dir, 1);
  assert.equal(t.base, "pred");
  assert.ok(t.custom, "deve essere riconoscibile come tuo");
  assert.ok(run(`TESTS.some(x=>x.id===${JSON.stringify(id)})`), "non è entrato in TESTS");
});

prova("eredita guida, uso e attrezzatura da xRM→1RM: non serve riscriverle", () => {
  pulisci();
  const id = run(`customAdd("Affondi bulgari","pred")`);
  assert.ok(run(`!!usoOf(${JSON.stringify(id)})`), "senza «cosa decidi» sarebbe un numero muto");
  assert.equal(run(`testEq(${JSON.stringify(id)}).join(",")`), run(`testEq("pred").join(",")`));
  run(`openGuide(${JSON.stringify(id)})`);
  const h = run(`document.getElementById("modal").innerHTML`);
  assert.ok(/class="step"/.test(h), "la guida deve mostrare il protocollo di xRM→1RM");
  assert.ok(/Affondi bulgari/.test(h), "e il nome dell'esercizio");
});

prova("lo stesso nome non crea due colonne", () => {
  pulisci();
  const a = run(`customAdd("Leg press","pred")`);
  const b = run(`customAdd("  LEG   PRESS ","pred")`);
  assert.equal(a, b, "«Leg press» e «LEG PRESS» sono lo stesso esercizio");
  assert.equal(run(`S.custom.length`), 1);
});

prova("un nome vuoto non crea niente", () => {
  pulisci();
  assert.equal(run(`customAdd("","pred")`), null);
  assert.equal(run(`customAdd("   ","pred")`), null);
  assert.equal(run(`S.custom.length`), 0);
});

prova("applyCustom si può chiamare mille volte senza duplicare colonne", () => {
  // normalize() gira all'avvio E dopo ogni import: senza idempotenza le
  // colonne raddoppiavano a ogni ripristino
  pulisci();
  run(`customAdd("Leg press","pred")`);
  const n0 = run(`TESTS.length`);
  run(`applyCustom(); applyCustom(); normalize(); applyCustom();`);
  assert.equal(run(`TESTS.length`), n0, "colonne duplicate");
  assert.equal(run(`TESTS.filter(t=>t.name==="Leg press").length`), 1);
});

prova("creandolo entra subito nella batteria della squadra", () => {
  // una squadra con batteria personalizzata non riceve i test nuovi del
  // catalogo — ed è giusto. Ma questo l'ha creato lui adesso.
  pulisci();
  run(`S.teams[0].tests=["cmj","sj"];`);
  const id = run(`customAdd("Pulley","pred")`);
  assert.ok(run(`S.teams[0].tests.indexOf(${JSON.stringify(id)})>=0`),
    "altrimenti lo crei e non lo vedi");
});

prova("entra fra i test di massimale: stima da ripetizioni e gruppi di carico", () => {
  pulisci();
  const id = run(`customAdd("Leg press","pred")`);
  assert.ok(run(`rmTestList().some(e=>e.test===${JSON.stringify(id)})`),
    "deve poter ricevere carico e ripetizioni");
  assert.equal(run(`rmTestEx(${JSON.stringify(id)})`), "Leg press");
  assert.ok(run(`lgEsercizi().some(e=>e.test===${JSON.stringify(id)})`),
    "e comparire fra gli esercizi dei gruppi di carico");
});

prova("le misure finiscono nella colonna dell'esercizio, non nel calderone", () => {
  pulisci();
  const id = run(`customAdd("Leg press","pred")`);
  Object.keys(campi).forEach(k => delete campi[k]);
  campi.rmD = "2026-10-12";
  cache.rmSaveBtn = elFor("rmSaveBtn");
  Object.assign(cache.rmSaveBtn.dataset, { est: "120", lo: "116", hi: "124", w: "100", r: "5", rir: "1" });
  run(`drawCell=function(){}; render=function(){}; saveRepMax("p0",${JSON.stringify(id)},"cella");`);
  assert.ok(run(`S.data.p0[${JSON.stringify(id)}]`), "deve finire su Leg press");
  assert.equal(run(`S.data.p0[${JSON.stringify(id)}][0].v`), 120);
  assert.equal(run(`S.data.p0.pred`), undefined, "e NON nella colonna generica");
});

prova("eliminarlo porta via la colonna e quello che c'era dentro", () => {
  pulisci();
  const id = run(`customAdd("Leg press","pred")`);
  run(`S.data.p0={${JSON.stringify(id)}:[{d:"2026-10-12",v:120}]}; S.teams[0].tests=["cmj",${JSON.stringify(id)}];
       S.gruppi={${JSON.stringify(id + "@t1")}:{d:"2026-10-12",g:[["p0"]]}};`);
  assert.equal(run(`customConDati(${JSON.stringify(id)})`), 1, "deve sapere quante misure ci sono dentro");
  run(`snapshotBeforeRisk=function(){}; confirm=function(){return true}; render=function(){}; openCustom=function(){};
       customDel(${JSON.stringify(id)});`);
  assert.equal(run(`S.custom.length`), 0);
  assert.ok(!run(`TMAP[${JSON.stringify(id)}]`), "la colonna deve sparire dal catalogo");
  assert.equal(run(`S.data.p0[${JSON.stringify(id)}]`), undefined, "e i dati con lei");
  assert.ok(run(`S.teams[0].tests.indexOf(${JSON.stringify(id)})<0`), "e dalla batteria della squadra");
  assert.equal(Object.keys(run(`S.gruppi`)).length, 0, "e dai gruppi di carico");
});

prova("un ripristino da backup non perde gli esercizi tuoi", () => {
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }],
    data: { p0: { uabc123: [{ d: "2026-10-12", v: 120 }] } },
    custom: [{ id: "uabc123", name: "Leg press", base: "pred" },
             { id: "udef456", name: "Pulley", base: "inesistente" }],
  });
  const o = run(`sanitizeImport(${b})`);
  assert.ok(Array.isArray(o.custom), "la chiave deve esistere");
  assert.equal(o.custom.length, 2);
  assert.equal(o.custom[0].name, "Leg press");
  assert.equal(o.custom[1].base, "pred", "un test base inventato ricade su xRM→1RM");
  assert.ok(o.data.p0.uabc123, "senza la colonna le misure sarebbero invisibili");
});

prova("una sincronizzazione non cancella gli esercizi creati sull'altro dispositivo", () => {
  const server = { athletes: [], data: {}, custom: [{ id: "u1", name: "Leg press", base: "pred" }] };
  const locale = { athletes: [], data: {}, custom: [{ id: "u2", name: "Pulley", base: "pred" }] };
  const out = run(`mergeState(${JSON.stringify(server)},${JSON.stringify(locale)})`);
  const nomi = out.custom.map(c => c.name).sort().join(",");
  assert.equal(nomi, "Leg press,Pulley", "si uniscono per id, non si sostituiscono: " + nomi);
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
