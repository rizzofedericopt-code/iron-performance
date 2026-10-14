// Scheda di seduta: piu' esercizi, gli stessi gruppi dall'inizio alla fine.
//
//   node test/seduta.mjs
//
// Perche' questo test esiste. Gruppi fissi per tutta la seduta vogliono dire
// un compromesso: due ragazze vicine nello squat possono essere lontane nello
// stacco. La scheda non lo deve risolvere di nascosto. Deve:
//   1. tenere davvero gli stessi gruppi su tutti gli esercizi
//   2. formarli, di default, su tutti gli esercizi insieme
//   3. dire esercizio per esercizio chi lavora fuori percentuale
//   4. dire quando le ripetizioni scritte non si chiudono alla percentuale
//      effettiva di una ragazza — al 75% teorico puo' stare all'80% vero
//   5. lasciare fuori le assenti e non perdere chi non ha un massimale

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));

const mem = new Map();
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
  localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
// gli array nati dentro la vm hanno un altro prototipo: deepEqual li rifiuta
const j = (c) => JSON.parse(run("JSON.stringify(" + c + ")"));
run(`normalize();`);
run(`var LASTT=""; render=function(){}; save=function(){}; toast=function(m){LASTT=String(m)};`);

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};


const squadra = () => run(`{
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}];
  S.activeTeam="t1"; S.pres={}; S.tomb={}; S.te={}; S.gruppi={}; S.sedute={};
  LG.ord="asc";
  const A=[["a1","Sara",50,70],["a2","Giulia",52,90],["a3","Marta",54,72],
           ["a4","Elena",70,95],["a5","Chiara",72,75],["a6","Anna",74,98]];
  S.athletes=A.map(x=>({id:x[0],name:x[1],sex:"F",team:"t1"}));
  S.data={}; A.forEach(x=>{ S.data[x[0]]={rmSquat:[{d:"2026-09-01",v:x[2]}], rmDead:[{d:"2026-09-01",v:x[3]}]}; });
}`);
const cfg = (o) => JSON.stringify(Object.assign({ex:[{t:"rmSquat",pct:75,sr:"4×5",mode:"media"},{t:"rmDead",pct:75,sr:"4×5",mode:"media"}], rif:"tutti", size:3}, o||{}));

console.log("\nScheda di seduta");

prova("gli stessi gruppi su tutti gli esercizi", () => {
  squadra();
  const r = j(`sedutaCalc(${cfg()})`);
  r.gruppi.forEach(g => {
    const ids = g.membri.map(m => m.id).sort().join();
    g.ex.forEach(x => {
      const dentro = x.r.righe.map(y => y.a.id).sort().join();
      assert.equal(dentro, ids, "il gruppo cambia fra un esercizio e l'altro");
    });
  });
  const tutti = r.gruppi.flatMap(g => g.membri.map(m => m.id)).sort();
  assert.deepEqual(tutti, ["a1","a2","a3","a4","a5","a6"], "nessuna persa, nessuna doppia");
});

prova("solo squat: i gruppi seguono lo squat e lo stacco paga il prezzo, scritto", () => {
  squadra();
  const r = j(`sedutaCalc(${cfg({rif:"rmSquat"})})`);
  // sullo squat: (Sara, Giulia, Marta) e (Elena, Chiara, Anna)
  assert.deepEqual(r.gruppi.map(g => g.membri.map(m => m.id).sort().join()), ["a1,a2,a3", "a4,a5,a6"]);
  // nello stacco Giulia (90) sta con Sara (70) e Marta (72): media 77,3 → 57,5 kg
  // per Sara e' l'82%: oltre 6 punti sopra
  assert.ok(r.avvisi[1].sopra >= 1, "lo stacco deve dire che qualcuna lavora troppo pesante");
  assert.equal(r.avvisi[0].sopra, 0, "lo squat no");
});

prova("su tutti gli esercizi i gruppi reggono meglio che su uno solo", () => {
  squadra();
  const scarto = (r) => r.gruppi.reduce((s, g) => s + g.ex.reduce((t, x) =>
    t + x.r.righe.reduce((u, y) => u + Math.abs(y.dpp), 0), 0), 0);
  const tutti = scarto(j(`sedutaCalc(${cfg()})`));
  const squat = scarto(j(`sedutaCalc(${cfg({rif:"rmSquat"})})`));
  assert.ok(tutti < squat, "scarto totale: tutti " + tutti.toFixed(1) + ", solo squat " + squat.toFixed(1));
});

prova("le ripetizioni che non si chiudono vanno dette", () => {
  squadra();
  const imp = j(`sedutaCalc(${cfg({ex:[{t:"rmSquat",pct:85,sr:"4×10",mode:"media"}]})})`);
  assert.equal(imp.avvisi[0].impossibile, true, "all'85% dieci ripetizioni non esistono per nessuna");
  // al 75% il massimo teorico e' ~10: con 4×9 e una ragazza al 79% effettivo, lei non chiude
  const r = j(`sedutaCalc(${cfg({rif:"rmSquat", ex:[{t:"rmDead",pct:75,sr:"4×9",mode:"media"}]})})`);
  assert.ok(r.avvisi[0].cedono >= 1, "chi lavora oltre il previsto non chiude 9 ripetizioni");
  assert.ok(!r.avvisi[0].impossibile, "ma per la percentuale scritta 9 sono possibili");
});

prova("serie×rip si leggono nelle forme di tutti i giorni", () => {
  assert.equal(run(`sedReps("4×5")`), 5);
  assert.equal(run(`sedReps("4x5")`), 5);
  assert.equal(run(`sedReps("3×8-10")`), 10, "si controlla il caso peggiore");
  assert.equal(run(`sedReps("5")`), 5);
  assert.equal(run(`sedReps("tanto")`), null);
});

prova("le assenti restano fuori", () => {
  squadra();
  run(`presSet("a2", todayISO(), "a");`);
  const r = j(`sedutaCalc(${cfg()})`);
  const ids = r.gruppi.flatMap(g => g.membri.map(m => m.id));
  assert.ok(ids.indexOf("a2") < 0);
  assert.equal(ids.length, 5);
});

prova("chi non ha un massimale su un esercizio esce da quel calcolo, non dal gruppo", () => {
  squadra();
  run(`delete S.data.a1.rmDead;`);
  const r = j(`sedutaCalc(${cfg()})`);
  const g = r.gruppi.find(g => g.membri.some(m => m.id === "a1"));
  assert.ok(g.ex[1].mancano.indexOf("Sara") >= 0, "deve dirlo");
  assert.ok(!g.ex[1].r.righe.some(y => y.a.id === "a1"), "e non deve entrare nella media dello stacco");
});

prova("i gruppi fatti a mano su un esercizio valgono per tutta la seduta", () => {
  squadra();
  run(`S.gruppi["rmSquat@t1"]={d:"2026-10-01", g:[["a1","a6"],["a2","a3"]]};`);
  const r = j(`sedutaCalc(${cfg({rif:"rmSquat"})})`);
  assert.equal(r.salvati, true);
  const g = r.gruppi.map(g => g.membri.map(m => m.id).sort().join());
  assert.ok(g.indexOf("a1,a6") >= 0 && g.indexOf("a2,a3") >= 0, "i tuoi gruppi: " + g.join(" | "));
  const resto = r.gruppi.flatMap(x => x.membri.map(m => m.id)).sort();
  assert.deepEqual(resto, ["a1","a2","a3","a4","a5","a6"], "chi non era nei tuoi gruppi non sparisce");
});

prova("senza massimale sull'esercizio dei gruppi: carico individuale, non sparisce", () => {
  squadra();
  run(`delete S.data.a5.rmSquat;`);
  const r = j(`sedutaCalc(${cfg({rif:"rmSquat"})})`);
  const s = r.singole.find(x => x.id === "a5");
  assert.ok(s, "Chiara deve comparire fra le senza gruppo");
  assert.equal(s.ex[1], run(`rmRound(75*0.75)`), "75% del suo 1RM di stacco, arrotondato ai dischi");
  assert.equal(s.ex[0], null, "sullo squat non ha un massimale: niente numero inventato");
});

prova("la scheda resta per squadra e sopravvive al ripristino", () => {
  const o = j(`sanitizeImport({athletes:[{id:"a1",name:"S"}], data:{},
     sedute:{t1:{ex:[{t:"rmSquat",pct:75,sr:"4×5",mode:"min"},{t:"nonEsiste",pct:70,sr:"3x5"},{t:"rmDead",pct:180,sr:"1"}], rif:"rmSquat", size:4},
             "../x":{ex:[{t:"rmSquat",pct:70}]}}})`);
  assert.ok(o.sedute.t1, "PERSA al ripristino");
  assert.equal(o.sedute.t1.ex.length, 1, "test inesistente e percentuale assurda fuori");
  assert.equal(o.sedute.t1.ex[0].mode, "min");
  assert.equal(o.sedute.t1.size, 4);
  assert.ok(!o.sedute["../x"], "chiave non valida fuori");
  const m = j(`mergeState({athletes:[],data:{},sedute:{t1:{ex:[{t:"rmSquat",pct:70}]},t2:{ex:[{t:"rmDead",pct:80}]}}},
                         {athletes:[],data:{},sedute:{t1:{ex:[{t:"rmSquat",pct:80}]}}})`);
  assert.equal(m.sedute.t1.ex[0].pct, 80, "per la stessa squadra vince questo dispositivo");
  assert.ok(m.sedute.t2, "ma la scheda dell'altra squadra non si perde");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
