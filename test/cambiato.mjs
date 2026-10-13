// «Cosa è cambiato»: il confronto fra due test, atleta per atleta.
//
//   node test/cambiato.mjs
//
// Perche' questo test esiste. Un report che dice «Sara +4 cm» e' facile. Un
// report che dice la verita' deve sapere quattro cose in piu':
//   1. se +4 cm superano l'errore della misura (altrimenti non e' successo niente)
//   2. da che parte e' il meglio (lo sprint migliora scendendo)
//   3. se uno dei due numeri e' una stima e l'altro una misura
//   4. quante sedute ha fatto in mezzo — prima di cambiare programma, verifica
//      che il programma l'abbia fatto

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


const squadra = () => run(`
  S.athletes=[{id:"a1",name:"Sara",sex:"F",team:"t1",profile:{birth:"2000-01-01"}},
              {id:"a2",name:"Giulia",sex:"F",team:"t1",profile:{birth:"2000-01-01"}},
              {id:"a3",name:"Marta",sex:"F",team:"t1",profile:{birth:"2000-01-01"}},
              {id:"a4",name:"Elena",sex:"F",team:"t1",profile:{birth:"2000-01-01"}}];
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}];
  S.activeTeam="t1"; S.pres={}; S.tomb={}; S.te={}; S.cfg.deltaNoise=5;
  S.data={
    a1:{cmj:[{d:"2026-09-01",v:30},{d:"2026-10-01",v:34}],             // +13%: oltre
        spr10:[{d:"2026-09-01",v:2.00},{d:"2026-10-01",v:1.90}]},       // -0,10 s: piu' veloce
    a2:{cmj:[{d:"2026-09-01",v:30},{d:"2026-10-01",v:30.6}]},          // +2%: rumore
    a3:{cmj:[{d:"2026-09-01",v:30},{d:"2026-10-01",v:26}]},            // -13%: calo vero
    a4:{cmj:[{d:"2026-10-01",v:31}]}                                   // un test solo
  };
`);

console.log("\nCosa è cambiato");

prova("ogni atleta ha un verdetto: su, giù o nel rumore", () => {
  squadra();
  const r = j(`cambioCalc("cmj","prec")`);
  const v = {}; r.righe.forEach(x => v[x.id] = x.verdetto);
  assert.equal(v.a1, "su");
  assert.equal(v.a2, "rumore", "+0,6 cm su 30 non e' un progresso");
  assert.equal(v.a3, "giu");
  assert.ok(!v.a4, "con un test solo non c'e' niente da confrontare");
  assert.deepEqual(r.senza.map(x => x.id), ["a4"], "ma va detto chi manca, non farla sparire");
});

prova("i cali vengono per primi: sono quelli che chiedono una decisione", () => {
  squadra();
  assert.deepEqual(j(`cambioCalc("cmj","prec").righe.map(x=>x.id)`), ["a3", "a1", "a2"]);
});

prova("fra due cali, il più grosso sta in cima", () => {
  squadra();
  run(`S.data.a4.cmj=[{d:"2026-09-01",v:30},{d:"2026-10-01",v:21}];`);   // -30%
  assert.deepEqual(j(`cambioCalc("cmj","prec").righe.map(x=>x.id)`).slice(0, 2), ["a4", "a3"]);
});

prova("per un test a tempo, scendere è migliorare", () => {
  squadra();
  const r = j(`cambioCalc("spr10","prec")`);
  assert.equal(r.righe[0].verdetto, "su", "da 2,00 a 1,90 s e' piu' veloce");
  assert.ok(r.righe[0].pc > 0, "la variazione nel verso del miglioramento e' positiva");
});

prova("il riepilogo conta e dà la mediana", () => {
  squadra();
  const s = j(`cambioCalc("cmj","prec").riepilogo`);
  assert.equal(s.su, 1); assert.equal(s.giu, 1); assert.equal(s.rumore, 1); assert.equal(s.n, 3);
  assert.ok(Math.abs(s.mediana - 2) < 0.01, "mediana delle variazioni +13, +2, -13 = +2%, ottenuta " + s.mediana);
});

prova("rispetto a una data: il riferimento è l'ultima misura entro quella data", () => {
  squadra();
  run(`S.data.a1.cmj=[{d:"2026-06-01",v:28},{d:"2026-09-01",v:30},{d:"2026-10-01",v:34}];`);
  const r = j(`cambioCalc("cmj","data","2026-06-30")`);
  const a1 = r.righe.find(x => x.id === "a1");
  assert.equal(a1.prima.d, "2026-06-01");
  assert.equal(a1.dopo.d, "2026-10-01");
  assert.ok(!r.righe.find(x => x.id === "a2"), "a2 non ha misure entro giugno: non si inventa un riferimento");
  assert.ok(r.senza.find(x => x.id === "a2"));
});

prova("una stima confrontata con un massimale vero va dichiarata", () => {
  squadra();
  run(`S.data.a1.rmSquat=[{d:"2026-09-01",v:80,fonte:"reps"},{d:"2026-10-01",v:90}];`);
  const a1 = j(`cambioCalc("rmSquat","prec").righe[0]`);
  assert.equal(a1.stima, "misto", "una stima da ripetizioni contro un massimale sollevato non e' lo stesso confronto");
});

prova("le asimmetrie non si giudicano in percentuale di se stesse", () => {
  // Da 4% a 6% di asimmetria e' +50% «relativo»: un numero che non vuol dire
  // niente. Senza un errore misurato in punti, il verdetto non si da'.
  squadra();
  run(`S.data.a1.cmjAsym=[{d:"2026-09-01",v:4},{d:"2026-10-01",v:6}];`);
  const a1 = j(`cambioCalc("cmjAsym","prec").righe[0]`);
  assert.equal(a1.verdetto, "indice");
  const d = j(`deltaInfo([{d:"2026-09-01",v:4},{d:"2026-10-01",v:6}], TMAP.cmjAsym.dir, TMAP.cmjAsym)`);
  assert.equal(d.cls, "flat", "neanche in tabella: un colore qui sarebbe un giudizio senza base");
});

prova("la frequenza fra i due test accompagna il verdetto", () => {
  squadra();
  run(`presSalva("2026-09-10",{a3:"a"}); presSalva("2026-09-17",{a3:"a"});
       presSalva("2026-09-24",{}); presSalva("2026-11-01",{a3:"a"});`);
  const a3 = j(`cambioCalc("cmj","prec").righe.find(x=>x.id==="a3")`);
  assert.equal(a3.freq.tot, 3, "contano solo gli appelli fra i due test, non quello di novembre");
  assert.equal(a3.freq.pc, 33);
  const r = j(`cambioCalc("cmj","prec")`);
  assert.equal(r.freqSquadra, 100, "mediana delle compagne nello stesso intervallo");
});

prova("una minorenne con mesi fra i due test: la crescita va nominata", () => {
  squadra();
  run(`S.athletes[0].profile.birth="2011-01-01";
       S.data.a1.cmj=[{d:"2026-01-10",v:30},{d:"2026-10-01",v:34}];`);
  const a1 = j(`cambioCalc("cmj","prec").righe.find(x=>x.id==="a1")`);
  assert.equal(a1.crescita, true);
  const a2 = j(`cambioCalc("cmj","prec").righe.find(x=>x.id==="a2")`);
  assert.ok(!a2.crescita, "adulta, un mese: niente avviso");
});

prova("la panoramica elenca solo i test con almeno un confronto", () => {
  squadra();
  const p = j(`cambioPanoramica("prec")`);
  const ids = p.map(x => x.t);
  assert.ok(ids.indexOf("cmj") >= 0);
  assert.ok(ids.indexOf("spr10") >= 0);
  assert.ok(ids.indexOf("yoyo1") < 0, "un test senza dati non e' una riga vuota");
});

prova("la frequenza ha un limite superiore", () => {
  squadra();
  run(`presSalva("2026-09-10",{}); presSalva("2026-11-10",{a1:"a"});`);
  assert.equal(j(`presStats("a1","2026-09-01","2026-10-01")`).tot, 1);
  assert.equal(j(`presStats("a1")`).tot, 2);
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
