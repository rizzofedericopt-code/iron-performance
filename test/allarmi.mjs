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

prova("l'intestazione si tocca e porta a tutto quello che puoi farci", () => {
  // prima erano tre microscritte in una colonna da 96 px; ora è un menu solo
  squadra(["no", "no"]);
  run(`S.data={p0:{rmSquat:[{d:"2026-06-01",v:80}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(/openColMenu\('rmSquat'\)/.test(h), "l'intestazione deve aprire il menu della colonna");
  run(`openColMenu("rmSquat")`);
  const m = run(`document.getElementById("modal").innerHTML`);
  assert.ok(/openLoadGroups\('rmSquat'\)/.test(m), "da lì si devono raggiungere i gruppi di carico");
  assert.ok(/sortBy\('rmSquat'\)/.test(m), "e l'ordinamento");
  assert.ok(/pinToggle\('rmSquat'\)/.test(m), "e l'evidenza");
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

prova("la guida resta raggiungibile, una porta più in là ma non persa", () => {
  squadra(["no"]);
  run(`S.data={p0:{rmSquat:[{d:"2026-06-01",v:80}]}}; renderMatrix(); openColMenu("rmSquat");`);
  const m = run(`document.getElementById("modal").innerHTML`);
  assert.ok(/openGuide\('rmSquat'\)/.test(m), "la guida non deve sparire nel riordino");
});

prova("anche il massimale generico ha la sua porta", () => {
  // `rm1` non sta in LV_EX perche' non dice quale esercizio stai facendo — ma
  // per le percentuali di carico contano i chili, non il nome dell'esercizio.
  squadra(["no"]);
  run(`S.data={p0:{rm1:[{d:"2026-06-01",v:80}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  run(`openColMenu("rm1")`);
  assert.ok(/openLoadGroups\('rm1'\)/.test(run(`document.getElementById("modal").innerHTML`)),
    "la colonna 1RM generica non deve restare muta");
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
       S.view="matrix"; renderBar();`);
  const h = run(`document.getElementById("bar").innerHTML`);
  assert.ok(/Test · 3/.test(h), "manca il numero scelto: " + h.slice(0, 160));
  assert.ok(/di \d+/.test(h), "manca il totale dello sport: " + h.slice(0, 160));
  const tot = run(`TESTS.filter(x=>x.sports.includes("pallavolo")).length`);
  assert.ok(h.indexOf("di " + tot) > 0, "il totale deve essere quello della pallavolo (" + tot + ")");
});

prova("senza batteria personalizzata il contatore non inventa numeri", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.view="matrix"; renderBar();`);
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
  run(`S.view="matrix"; renderBar()`);
  assert.ok(/di \d+/.test(run(`document.getElementById("bar").innerHTML`)),
    "e la barra deve dire che ce ne sono altri");
});

prova("la barra «Test» c'è solo dove ci sono colonne di test", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo",tests:["cmj"]}]; S.activeTeam="t1";`);
  for (const v of ["today", "readiness", "piano", "mj", "video"]) {
    run(`S.view=${JSON.stringify(v)}; document.getElementById("bar").innerHTML="x"; renderBar();`);
    assert.equal(run(`document.getElementById("bar").innerHTML`), "", "in " + v + " la riga occupa spazio per niente");
  }
  for (const v of ["matrix", "trend"]) {
    run(`S.view=${JSON.stringify(v)}; renderBar();`);
    assert.ok(/Test/.test(run(`document.getElementById("bar").innerHTML`)), "in " + v + " serve");
  }
});

prova("i chip degli sport compaiono solo dove cambiano qualcosa", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo",tests:["cmj"]},{id:"t2",name:"B",sport:"calcio"}];`);
  assert.equal(run(`S.activeTeam="t1"; S.view="matrix"; sportsServono()`), false,
    "con la batteria della squadra lo sport non sceglie le colonne");
  assert.equal(run(`S.activeTeam="t2"; S.view="matrix"; sportsServono()`), true);
  assert.equal(run(`S.activeTeam="t2"; S.view="today"; sportsServono()`), false);
  assert.equal(run(`S.activeTeam="all"; S.view="trend"; sportsServono()`), true);
});

prova("in Matrice le colonne senza nessuna misura vanno in fondo, strette", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo",tests:["sj","cmj"]}]; S.activeTeam="t1"; S.view="matrix";
       S.athletes=[{id:"p1",name:"A",team:"t1",sex:"F",profile:{}}]; S.data={p1:{cmj:[{d:"2026-10-01",v:30}]}}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  const iCmj = h.indexOf(">CMJ<"), iSj = h.indexOf(">SJ<");
  assert.ok(iCmj > 0 && iSj > 0, "mancano le colonne");
  assert.ok(iCmj < iSj, "la colonna con i dati viene prima di quella vuota");
  assert.match(h, /th-test[^"]* vuota/);
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

console.log("\nUnità di misura degli esercizi tuoi");

prova("un plank si misura in secondi, non in chili", () => {
  pulisci();
  const id = run(`customAdd("Plank","pred","s")`);
  const t = run(`TMAP[${JSON.stringify(id)}]`);
  assert.equal(t.unit, "s");
  assert.equal(t.dir, 1, "sulla tenuta più alto è meglio");
  assert.ok(!run(`rmTestList().some(e=>e.test===${JSON.stringify(id)})`),
    "un plank non ha un massimale da stimare: fuori dai test di carico");
});

prova("su un tempo da abbassare la direzione si rovescia", () => {
  // senza, il colore del delta esce al contrario e nessuno se ne accorge
  pulisci();
  const id = run(`customAdd("Navetta 5-10-5","pred","s↓")`);
  const t = run(`TMAP[${JSON.stringify(id)}]`);
  assert.equal(t.unit, "s", "all'atleta mostri «s», non «s↓»");
  assert.equal(t.dir, -1, "più basso deve essere meglio");
  const d = run(`deltaInfo([{d:"2026-01-01",v:5.4},{d:"2026-02-01",v:5.1}], TMAP[${JSON.stringify(id)}].dir)`);
  assert.equal(d.cls, "up", "da 5,4 a 5,1 secondi è un miglioramento");
});

prova("solo le colonne in kg entrano nei carichi e nella stima", () => {
  pulisci();
  const kg = run(`customAdd("Leg press","pred","kg")`);
  const rip = run(`customAdd("Trazioni libere","pred","rip")`);
  assert.ok(run(`rmTestList().some(e=>e.test===${JSON.stringify(kg)})`));
  assert.ok(!run(`rmTestList().some(e=>e.test===${JSON.stringify(rip)})`));
  assert.equal(run(`TMAP[${JSON.stringify(kg)}].base`), "pred", "la colonna in kg eredita da xRM→1RM");
  assert.equal(run(`TMAP[${JSON.stringify(rip)}].base`), undefined, "le altre no");
});

prova("stesso nome con unità diverse sono due colonne diverse", () => {
  // «Trazioni» in kg (zavorra) e «Trazioni» in ripetizioni non sono lo stesso test
  pulisci();
  const a = run(`customAdd("Trazioni","pred","kg")`);
  const b = run(`customAdd("Trazioni","pred","rip")`);
  assert.notEqual(a, b);
  assert.equal(run(`S.custom.length`), 2);
});

prova("un ripristino conserva l'unità, e una inventata ricade su kg", () => {
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }], data: {},
    custom: [{ id: "ua", name: "Plank", unit: "s" },
             { id: "ub", name: "Strano", unit: "parsec" }],
  });
  const o = run(`sanitizeImport(${b})`);
  assert.equal(o.custom[0].unit, "s");
  assert.equal(o.custom[1].unit, "kg");
  assert.equal(o.custom[0].base, null, "un plank non nasce da xRM→1RM");
});

console.log("\nTroppo o troppo poco: tre riferimenti, e si sa quale");

const squadraCon = (valori, eta) => {
  const ath = valori.map((v, i) =>
    `{id:"p${i}",name:"P${i}",team:"t1",sex:"F",profile:{birth:"${eta}"}}`).join(",");
  const dat = valori.map((v, i) => v == null ? null : `p${i}:{cmj:[{d:"2026-10-01",v:${v}}]}`)
    .filter(Boolean).join(",");
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[${ath}]; S.data={${dat}}; S.custom=[]; applyCustom();`);
};

prova("a un'adulta si applica la fascia di letteratura", () => {
  squadraCon([40], "1995-01-01");
  const r = run(`valuta(TMAP.cmj, S.athletes[0], series("p0","cmj"))`);
  assert.ok(r, "nessuna valutazione");
  assert.equal(r.fonte, "rif");
  assert.ok(/popolazione adulta/.test(r.nota));
});

prova("a un'under 18 NON si appiccica la fascia degli adulti", () => {
  // scriverle «sotto Base» con una tabella di adulti è il modo migliore per
  // farle credere una cosa falsa su di sé
  squadraCon([28, 30, 32, 34, 36, 38], "2010-06-01");
  const r = run(`valuta(TMAP.cmj, S.athletes[0], series("p0","cmj"))`);
  assert.ok(r, "ma un riferimento ci deve essere lo stesso");
  assert.notEqual(r.fonte, "rif");
  assert.equal(r.fonte, "squadra");
});

prova("con la squadra abbastanza numerosa, dice dove sta fra le compagne", () => {
  squadraCon([24, 28, 32, 36, 40, 44], "2010-06-01");
  const peggiore = run(`valuta(TMAP.cmj, S.athletes[0], series("p0","cmj"))`);   // 24
  const migliore = run(`valuta(TMAP.cmj, S.athletes[5], series("p5","cmj"))`);   // 44
  assert.equal(peggiore.fonte, "squadra");
  assert.ok(peggiore.liv < migliore.liv, "24 cm deve stare sotto 44 cm");
  assert.equal(peggiore.liv, 0);
  assert.equal(migliore.liv, 4);
  assert.ok(/non è un giudizio assoluto/.test(peggiore.nota), "va detto cosa NON è");
});

prova("su un tempo la classifica di squadra si rovescia", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[0,1,2,3,4,5].map(i=>({id:"q"+i,name:"Q"+i,team:"t1",sex:"F",profile:{birth:"2010-06-01"}}));
       S.data={}; [2.0,2.1,2.2,2.3,2.4,2.5].forEach((v,i)=>{S.data["q"+i]={spr10:[{d:"2026-10-01",v:v}]};});`);
  const veloce = run(`valuta(TMAP.spr10, S.athletes[0], series("q0","spr10"))`);
  const lenta  = run(`valuta(TMAP.spr10, S.athletes[5], series("q5","spr10"))`);
  assert.ok(veloce.liv > lenta.liv, "2,0 s deve valere più di 2,5 s: " + veloce.liv + " vs " + lenta.liv);
});

prova("squadra troppo piccola: si ripiega su lei stessa, non si inventa", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[{id:"p0",name:"A",team:"t1",sex:"F",profile:{birth:"2010-06-01"}}];
       S.data={p0:{cmj:[{d:"2026-01-01",v:30},{d:"2026-02-01",v:31},{d:"2026-03-01",v:30},{d:"2026-04-01",v:36}]}};`);
  const r = run(`valuta(TMAP.cmj, S.athletes[0], series("p0","cmj"))`);
  assert.equal(r.fonte, "lei");
  assert.ok(/sopra la sua media/.test(r.lab), r.lab);
  assert.ok(/misure precedenti/.test(r.nota));
});

prova("con due misure e una compagna sola non si dice niente", () => {
  // il silenzio è una risposta: un quartile su tre persone è aria fritta
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[{id:"p0",name:"A",team:"t1",sex:"F",profile:{birth:"2010-06-01"}},
                   {id:"p1",name:"B",team:"t1",sex:"F",profile:{birth:"2010-06-01"}}];
       S.data={p0:{cmj:[{d:"2026-01-01",v:30},{d:"2026-02-01",v:31}]},p1:{cmj:[{d:"2026-01-01",v:33}]}};`);
  assert.equal(run(`valuta(TMAP.cmj, S.athletes[0], series("p0","cmj"))`), null);
});

prova("il segno dice sempre da dove viene il giudizio", () => {
  squadraCon([24, 28, 32, 36, 40, 44], "2010-06-01");
  run(`renderMatrix()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(/lvdot sq/.test(h), "il riferimento di squadra deve avere la sua forma");
  assert.ok(!/class="lvdot"[^>]*title="Base"/.test(h), "non deve sembrare una fascia di letteratura");
  // e la legenda lo spiega
  run(`S.view="matrix"; renderBar();`);
  const b = run(`document.getElementById("bar").innerHTML`);
  assert.ok(/fascia di riferimento/.test(b) && /rispetto alla squadra/.test(b) && /rispetto a lei stessa/.test(b),
    "senza legenda i tre segni sono tre pallini uguali");
});

console.log("\nOrdinare, evidenziare, e sapere quanto è vecchio il dato");

const squadraCMJ = (valori) => {
  const ath = valori.map((v, i) => `{id:"s${i}",name:"N${i}",team:"t1",sex:"F",profile:{}}`).join(",");
  const dat = valori.map((v, i) => v == null ? null : `s${i}:{cmj:[{d:"2026-10-01",v:${v}}]}`)
    .filter(Boolean).join(",");
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[${ath}]; S.data={${dat}}; S.custom=[]; SORT={by:null,desc:false}; applyCustom();`);
};
const ordine = () => run(`atleteOrdinate().map(a=>a.name)`).join(",");

prova("ordinare per un salto mette i migliori in cima", () => {
  squadraCMJ([30, 42, 36]);
  assert.equal(ordine(), "N0,N1,N2", "senza ordinamento resta l'ordine della rosa");
  run(`sortBy("cmj")`);
  assert.equal(ordine(), "N1,N2,N0", "42, 36, 30");
});

prova("su un tempo l'ordine si rovescia da solo", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[{id:"s0",name:"Lenta",team:"t1",sex:"F"},{id:"s1",name:"Veloce",team:"t1",sex:"F"}];
       S.data={s0:{spr10:[{d:"2026-10-01",v:2.4}]},s1:{spr10:[{d:"2026-10-01",v:2.0}]}};
       SORT={by:null,desc:false}; sortBy("spr10");`);
  assert.equal(ordine(), "Veloce,Lenta", "2,0 s è meglio di 2,4 s");
});

prova("toccare di nuovo inverte, ma chi non ha il dato resta in fondo", () => {
  // una cella vuota non è un risultato scarso: non deve finire in cima
  squadraCMJ([30, 42, null, 36]);
  run(`sortBy("cmj")`);
  assert.equal(ordine(), "N1,N3,N0,N2");
  run(`sortBy("cmj")`);
  assert.equal(ordine(), "N0,N3,N1,N2", "invertito, ma N2 (senza dato) resta ultima");
});

prova("si può ordinare per nome e tornare indietro", () => {
  squadraCMJ([30, 42, 36]);
  run(`S.athletes[0].name="Zoe"; S.athletes[1].name="Anna"; S.athletes[2].name="Marta"; sortBy("nome");`);
  assert.equal(ordine(), "Anna,Marta,Zoe");
  run(`sortClear()`);
  assert.equal(ordine(), "Zoe,Anna,Marta", "torna l'ordine della rosa");
});

prova("i test in evidenza passano davanti a tutti", () => {
  squadraCMJ([30]);
  const prima = run(`visibleTests().map(t=>t.id)`);
  assert.notEqual(prima[0], "spr10");
  run(`pinToggle("spr10"); pinToggle("cmj");`);
  const dopo = run(`visibleTests().map(t=>t.id)`);
  assert.equal(dopo[0], "spr10", "nell'ordine in cui li hai messi");
  assert.equal(dopo[1], "cmj");
  assert.equal(dopo.length, prima.length, "evidenziare non aggiunge né toglie colonne");
});

prova("in evidenza ce ne stanno sei, non quarantasette", () => {
  squadraCMJ([30]);
  ["cmj", "sj", "dj", "spr10", "cod505", "mat", "eur"].forEach(id => run(`pinToggle(${JSON.stringify(id)})`));
  assert.equal(run(`pinSet().length`), 6, "il settimo non deve entrare");
  run(`pinToggle("cmj")`);
  assert.equal(run(`pinSet().indexOf("cmj")`), -1, "e si tolgono");
});

prova("i test in evidenza sopravvivono al ripristino", () => {
  // stesso difetto che aveva già cancellato la batteria della squadra
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }], data: {},
    teams: [{ id: "t1", name: "YV", sport: "pallavolo", tests: ["cmj"], pin: ["cmj", "spr10"] }],
  });
  const o = run(`sanitizeImport(${b})`);
  assert.ok(o.teams[0].pin, "l'evidenza è sparita nel ripristino");
  assert.equal(o.teams[0].pin.join(","), "cmj,spr10");
});

prova("nella cella si vede quanto è vecchio il numero", () => {
  const oggi = new Date();
  const giorniFa = (n) => new Date(oggi.getTime() - n * 864e5).toISOString().slice(0, 10);
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[{id:"p0",name:"Fresca",team:"t1",sex:"F"},{id:"p1",name:"Vecchia",team:"t1",sex:"F"}];
       S.data={p0:{cmj:[{d:"${giorniFa(2)}",v:30}]},p1:{cmj:[{d:"${giorniFa(200)}",v:30}]}};
       SORT={by:null,desc:false}; renderMatrix();`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(/class="cold vecchio"/.test(h), "oltre quattro mesi il dato va segnalato");
  assert.equal((h.match(/class="cold/g) || []).length, 1,
    "un dato di due giorni fa non ha bisogno di etichette");
});

prova("si ordina anche per età, e chi non ha la data resta in fondo", () => {
  run(`S.teams=[{id:"t1",name:"YV",sport:"pallavolo"}]; S.activeTeam="t1"; S.sport="pallavolo";
       S.athletes=[{id:"v",name:"Vecchia",team:"t1",sex:"F",profile:{birth:"2006-01-01"}},
                   {id:"g",name:"Giovane",team:"t1",sex:"F",profile:{birth:"2012-01-01"}},
                   {id:"x",name:"Ignota",team:"t1",sex:"F",profile:{}}];
       S.data={}; SORT={by:null,desc:false}; sortBy("eta");`);
  assert.equal(run(`atleteOrdinate().map(a=>a.name)`).join(","), "Giovane,Vecchia,Ignota");
  run(`sortBy("eta")`);
  assert.equal(run(`atleteOrdinate().map(a=>a.name)`).join(","), "Vecchia,Giovane,Ignota",
    "invertito, ma chi non ha la data resta in fondo");
});

prova("l'ordine di inserimento si recupera sempre", () => {
  run(`sortBy("nome")`);
  assert.equal(run(`atleteOrdinate().map(a=>a.name)`).join(","), "Giovane,Ignota,Vecchia");
  run(`sortClear()`);
  assert.equal(run(`atleteOrdinate().map(a=>a.name)`).join(","), "Vecchia,Giovane,Ignota");
});

console.log("\nQuanto balla la misura");

prova("sotto la banda la variazione diventa grigia, non verde", () => {
  run(`S.te={}; S.cfg.deltaNoise=5; S.cfg.cmjNoise=1.5;`);
  // 40 → 40.5 su un CMJ: mezzo centimetro, cioè lo strumento che respira
  const piccolo = run(`deltaInfo([{d:"2026-01-01",v:40},{d:"2026-02-01",v:40.5}], 1, TMAP.cmj)`);
  assert.equal(piccolo.cls, "flat", "mezzo centimetro non è un progresso");
  assert.equal(piccolo.rumore, true);
  assert.ok(/rumore della misura/.test(piccolo.titolo), piccolo.titolo);
  // 40 → 44: quattro centimetri sono successi davvero
  const grosso = run(`deltaInfo([{d:"2026-01-01",v:40},{d:"2026-02-01",v:44}], 1, TMAP.cmj)`);
  assert.equal(grosso.cls, "up");
  assert.ok(!grosso.rumore);
});

prova("vale anche al contrario: un calo dentro il rumore non è un calo", () => {
  run(`S.te={}; S.cfg.deltaNoise=5;`);
  const d = run(`deltaInfo([{d:"2026-01-01",v:100},{d:"2026-02-01",v:97}], 1, TMAP.rmSquat)`);
  assert.equal(d.cls, "flat", "3 kg su 100 sono dentro il 5%");
  assert.equal(d.rumore, true);
  const vero = run(`deltaInfo([{d:"2026-01-01",v:100},{d:"2026-02-01",v:90}], 1, TMAP.rmSquat)`);
  assert.equal(vero.cls, "down");
});

prova("senza il test non si inventa nessuna banda", () => {
  // le chiamate vecchie passano solo (arr, dir): devono comportarsi come prima
  const d = run(`deltaInfo([{d:"2026-01-01",v:40},{d:"2026-02-01",v:40.2}], 1)`);
  assert.equal(d.cls, "up");
  assert.ok(!d.rumore);
});

prova("l'errore misurato da te batte la percentuale di riserva", () => {
  run(`S.te={}; S.cfg.deltaNoise=5;`);
  const prima = run(`bandaRumore(TMAP.rmSquat, 100)`);
  assert.equal(prima.fonte, "default");
  assert.equal(prima.b, 5);
  run(`S.te={rmSquat:1.5}`);
  const dopo = run(`bandaRumore(TMAP.rmSquat, 100)`);
  assert.equal(dopo.fonte, "misurata");
  assert.equal(dopo.te, 1.5, "l'errore tipico misurato resta leggibile");
});

/* L'errore tipico NON e' la soglia. La differenza fra due misure contiene
   l'errore di entrambe: la sua deviazione standard e' TE·√2. Usare TE come
   soglia significa colorare il 48% delle variazioni che non esistono —
   P(|Z| > 1/√2). La differenza minima per dire che un cambiamento c'e' e'
   1,96·√2·TE (Weir 2005, J Strength Cond Res 19:231, doi 10.1519/15184.1). */
prova("con l'errore misurato la soglia è la differenza minima rilevabile, non l'errore", () => {
  run(`S.te={rmSquat:1.5}; S.cfg.deltaNoise=5;`);
  const nb = run(`bandaRumore(TMAP.rmSquat, 100)`);
  const atteso = 1.96 * Math.SQRT2 * 1.5;   // 4,16 kg su 100
  assert.ok(Math.abs(nb.b - atteso) < 0.01, "attesa ±" + atteso.toFixed(2) + ", ottenuta ±" + nb.b);
  // +2,5 kg: oltre l'errore tipico, sotto la differenza minima → grigio
  const d = run(`deltaInfo([{d:"2026-01-01",v:100},{d:"2026-02-01",v:102.5}], 1, TMAP.rmSquat)`);
  assert.equal(d.cls, "flat", "2,5 kg con errore 1,5% non sono un progresso dimostrato");
  const v = run(`deltaInfo([{d:"2026-01-01",v:100},{d:"2026-02-01",v:105}], 1, TMAP.rmSquat)`);
  assert.equal(v.cls, "up", "5 kg si'");
});

prova("una variazione inesistente si colora solo una volta su venti", () => {
  // senza cambiamento vero, la differenza osservata e' N(0, √2·TE): la quota
  // che supera la soglia deve essere il 5%, non la meta'
  run(`S.te={rmSquat:2}; S.cfg.deltaNoise=5;`);
  const b = run(`bandaRumore(TMAP.rmSquat, 100).b`);
  const sdDiff = Math.SQRT2 * 2;
  const z = b / sdDiff;
  const erf = x => { const t = 1 / (1 + 0.3275911 * x), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return y; };
  const falsi = 1 - erf(z / Math.SQRT2);
  assert.ok(Math.abs(falsi - 0.05) < 0.005, "falsi allarmi attesi 5%, ottenuti " + (falsi * 100).toFixed(1) + "%");
});

prova("cmjNoise è un moltiplicatore del CV, non centimetri", () => {
  // Nelle soglie e' «Moltiplicatore del rumore (CV)», 1.5. La banda lo usava
  // come 1,5 cm: un numero che sembra plausibile proprio perche' e' sbagliato.
  run(`S.te={}; S.cfg.deltaNoise=5; S.cfg.cmjNoise=4;`);
  const nb = run(`bandaRumore(TMAP.cmj, 40)`);
  assert.notEqual(nb.b, 4, "un moltiplicatore 4 non sono 4 cm");
  assert.equal(nb.fonte, "default");
  run(`S.cfg.cmjNoise=1.5;`);
});

prova("l'errore tipico è la deviazione delle differenze diviso radice di 2", () => {
  // due prove identiche = errore zero
  assert.equal(run(`teCalc([[40,40],[38,38],[42,42],[36,36]]).te`), 0);
  // differenze costanti: nessuna dispersione, errore zero ma bias segnalato
  const costante = run(`teCalc([[40,41],[38,39],[42,43],[36,37]])`);
  assert.equal(Math.round(costante.te * 1000) / 1000, 0);
  assert.equal(costante.bias, -1, "le seconde prove sono sistematicamente più alte");
  // caso reale: differenze -1,+1,-1,+1 → sd=1.155, te=0.816
  const r = run(`teCalc([[40,41],[38,37],[42,43],[36,35]])`);
  assert.ok(Math.abs(r.te - 0.816) < 0.01, "atteso ~0,816, ottenuto " + r.te);
  assert.equal(r.n, 4);
});

prova("con meno di tre atlete non si calcola niente", () => {
  assert.equal(run(`teCalc([[40,41],[38,37]])`), null);
  assert.equal(run(`teCalc([])`), null);
});

prova("la soglia misurata sopravvive al ripristino", () => {
  // mezz'ora di palestra con cinque atlete: perderla in un backup sarebbe una beffa
  const b = JSON.stringify({ athletes: [{ id: "p0", name: "A" }], data: {},
    te: { cmj: 2.4, spr10: 1.8, "../evil": 3, bosco30: 900 } });
  const o = run(`sanitizeImport(${b})`);
  assert.equal(o.te.cmj, 2.4);
  assert.equal(o.te.spr10, 1.8);
  assert.equal(o.te["../evil"], undefined, "chiave non valida");
  assert.equal(o.te.bosco30, undefined, "un errore del 900% non è un errore, è un refuso");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
