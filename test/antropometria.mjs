// Peso e statura nel tempo, e quello che ne nasce: forza relativa e crescita.
//
//   node test/antropometria.mjs
//
// Perche' questo test esiste. Peso e statura sembrano due numeri innocui.
// Non lo sono, per quattro ragioni:
//   1. non hanno un verso. Un chilo in piu' non e' «meglio» ne' «peggio»: un
//      pallino verde sul peso di una sedicenne e' un giudizio sul suo corpo, e
//      un'app che lo da' e' un'app che fa danni. Niente colori, niente
//      classifiche, niente «migliori in cima».
//   2. il peso non deve comparire in tabella da solo. Basta un'anamnesi con il
//      peso per creare la colonna: se si vedesse in automatico, alla prima
//      proiezione in palestra c'e' il peso di tutte sul muro.
//   3. la forza relativa ha bisogno di un peso VICINO nel tempo. Un massimale
//      di ottobre diviso per il peso di marzo non e' forza relativa.
//   4. la posizione in squadra sulla forza relativa: il rapporto semplice
//      favorisce le piu' leggere (Jaric et al. 2005). Per il confronto fra
//      atlete si usa la scala allometrica, kg / peso^0,67.

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
  S.athletes=[{id:"a1",name:"Sara",sex:"F",team:"t1",profile:{}},
              {id:"a2",name:"Giulia",sex:"F",team:"t1",profile:{}}];
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}];
  S.activeTeam="t1"; S.sport="pallavolo"; S.data={}; S.pres={}; S.tomb={}; S.te={}; S.cfg.deltaNoise=5;
`);

console.log("\nPeso e statura");

prova("peso e statura esistono e non hanno un verso", () => {
  assert.ok(run(`!!TMAP.bw && !!TMAP.stat`));
  assert.equal(run(`TMAP.bw.dir`), 0);
  assert.equal(run(`TMAP.stat.dir`), 0);
  assert.equal(run(`TMAP.bw.unit`), "kg");
  assert.equal(run(`TMAP.stat.unit`), "cm");
});

prova("nessun pallino e nessun colore sul peso", () => {
  squadra();
  // sei compagne con il peso: abbastanza per una posizione in squadra
  run(`for(let i=0;i<7;i++){ S.athletes.push({id:"x"+i,name:"X"+i,sex:"F",team:"t1"});
         S.data["x"+i]={bw:[{d:"2026-09-01",v:50+i*3}]}; }`);
  assert.equal(run(`valuta(TMAP.bw, S.athletes.find(a=>a.id==="x0"), series("x0","bw"))`), null,
    "un giudizio sul peso di una minorenne non deve esistere");
  const d = j(`deltaInfo([{d:"2026-09-01",v:55},{d:"2026-10-01",v:59}], TMAP.bw.dir, TMAP.bw)`);
  assert.equal(d.cls, "flat", "quattro chili in piu' non sono rossi ne' verdi");
});

prova("il peso non entra in tabella da solo, nemmeno se c'e' il dato", () => {
  squadra();
  run(`S.data.a1={bw:[{d:"2026-09-01",v:55}], stat:[{d:"2026-09-01",v:170}]};`);
  const ids = j(`visibleTests().map(t=>t.id)`);
  assert.ok(ids.indexOf("bw") < 0, "il peso si vede solo se lo scegli nella batteria");
  run(`S.teams[0].tests=["cmj","bw"];`);
  assert.ok(j(`visibleTests().map(t=>t.id)`).indexOf("bw") >= 0, "scelto: si vede");
  run(`delete S.teams[0].tests;`);
});

prova("sulla statura il 5% di riserva non vale: 8 cm di «rumore» sono un'assurdità", () => {
  squadra();
  run(`S.te={};`);
  const d = j(`deltaInfo([{d:"2026-02-01",v:166},{d:"2026-10-01",v:168.8}], TMAP.stat.dir, TMAP.stat)`);
  assert.ok(!d.rumore, "un metro misura al millimetro: 2,8 cm non sono rumore");
  run(`S.te={stat:0.3};`);
  const m = j(`bandaRumore(TMAP.stat, 168)`);
  assert.equal(m.fonte, "misurata", "con l'errore misurato, la banda c'e'");
  run(`S.te={};`);
});

prova("nessuna classifica per peso", () => {
  squadra();
  run(`S.data.a1={bw:[{d:"2026-09-01",v:60}]}; S.data.a2={bw:[{d:"2026-09-01",v:50}]};
       SORT={by:null,desc:false}; sortBy("bw");`);
  assert.equal(run(`SORT.by`), null, "ordinare la squadra per peso non e' uno strumento di lavoro");
  run(`sortBy("stat");`);
  assert.equal(run(`SORT.by`), "stat", "per statura si': nella pallavolo serve");
  run(`sortClear();`);
});

prova("il peso più vicino entro 90 giorni, e non oltre", () => {
  squadra();
  run(`S.data.a1={bw:[{d:"2026-03-01",v:52},{d:"2026-09-20",v:56},{d:"2026-11-15",v:57}]};`);
  assert.equal(run(`pesoAl("a1","2026-10-01").v`), 56, "il 20 settembre e' a 11 giorni, il 15 novembre a 45");
  assert.equal(run(`pesoAl("a1","2026-06-15")`), null, "marzo e settembre sono entrambi oltre 90 giorni");
});

prova("forza relativa: massimale diviso il peso più vicino", () => {
  squadra();
  run(`S.data.a1={bw:[{d:"2026-09-20",v:56}],
                  rmSquat:[{d:"2026-03-01",v:60},{d:"2026-10-01",v:84,fonte:"reps"}]};`);
  const s = j(`series("a1","rmSquatRel")`);
  assert.equal(s.length, 1, "il massimale di marzo non ha un peso vicino: niente rapporto inventato");
  assert.equal(s[0].v, 1.5);
  assert.equal(s[0].fonte, "reps", "una stima resta una stima anche divisa per il peso");
  assert.ok(run(`!!TMAP.rmSquatRel.derived`), "non si inserisce a mano");
});

prova("in squadra la forza relativa si confronta in scala allometrica", () => {
  // A: 100 kg a 80 kg di peso → 1,25 × peso, ma 5,30 in allometria
  // B:  70 kg a 50 kg        → 1,40 × peso, ma 5,09
  // Col rapporto A e B sono le prime due; in allometria B e' ultima.
  squadra();
  run(`S.athletes=[]; S.data={};
    const add=(id,kg,bw)=>{ S.athletes.push({id,name:id,sex:"F",team:"t1"});
      S.data[id]={bw:[{d:"2026-10-01",v:bw}], rmSquat:[{d:"2026-10-01",v:kg}]}; };
    add("A",100,80); add("B",70,50);
    // quattro compagne pesanti: rapporto 1,20-1,24 (sotto A e B), allometria 5,20-5,35
    add("c",102,85); add("d",103,85); add("e",104,85); add("f",105,85);`);
  const la = run(`valuta(TMAP.rmSquatRel, S.athletes[0], series("A","rmSquatRel")).liv`);
  const lb = run(`valuta(TMAP.rmSquatRel, S.athletes[1], series("B","rmSquatRel")).liv`);
  assert.ok(la > lb, "A deve stare sopra B: livelli " + la + " e " + lb);
  assert.ok(/allometric/i.test(run(`valuta(TMAP.rmSquatRel, S.athletes[0], series("A","rmSquatRel")).nota`)),
    "e la nota deve dire come e' stata calcolata");
});

prova("velocità di crescita su almeno sei mesi", () => {
  squadra();
  run(`S.data.a1={stat:[{d:"2026-01-01",v:165},{d:"2026-07-20",v:167},{d:"2026-10-01",v:168}]};`);
  const c = j(`crescita("a1")`);
  // dal 1 gennaio al 1 ottobre: 273 giorni, +3 cm → 4,0 cm/anno
  assert.ok(Math.abs(c.v - 4.0) < 0.05, "atteso ~4,0 cm/anno, ottenuto " + c.v);
  assert.equal(c.da, "2026-01-01", "luglio-ottobre e' troppo corto: l'errore della misura pesa piu' della crescita");
  run(`S.data.a2={stat:[{d:"2026-07-20",v:160},{d:"2026-10-01",v:161}]};`);
  assert.equal(run(`crescita("a2")`), null, "meno di sei mesi: niente velocita'");
});

prova("il peso scritto nella scheda diventa una misura con la data", () => {
  squadra();
  run(`S.athletes[0].profile={weight:"55", height:"168"}; antroSync();`);
  assert.equal(j(`series("a1","bw").map(e=>e.v)`).join(), "55");
  assert.equal(j(`series("a1","stat").map(e=>e.v)`).join(), "168");
  run(`antroSync();`);
  assert.equal(run(`series("a1","bw").length`), 1, "rieseguire la sincronia non crea doppioni");
  run(`S.athletes[0].profile.weight="57"; antroSync();`);
  const v = j(`series("a1","bw").map(e=>e.v)`);
  assert.ok(v[v.length - 1] === 57, "il peso nuovo deve diventare l'ultima misura: " + v.join());
});

prova("la scheda arrivata dal modulo porta la data del modulo", () => {
  squadra();
  run(`S.athletes[0].profile={weight:"54", height:"166", formAt:"2026-09-05T18:00:00.000Z"}; antroSync();`);
  assert.equal(run(`series("a1","bw")[0].d`), "2026-09-05");
  assert.equal(run(`series("a1","stat")[0].d`), "2026-09-05",
    "anche la statura: sincronizzare il peso non deve far sembrare il modulo gia' visto");
});

prova("una misura nuova in tabella aggiorna la scheda, senza rimbalzare", () => {
  squadra();
  run(`S.athletes[0].profile={weight:"55"}; antroSync();
       S.data.a1.bw.push({d:"2099-01-01",v:58}); antroSync();`);
  assert.equal(run(`S.athletes[0].profile.weight`), "58", "la scheda mostra l'ultimo peso misurato");
  assert.equal(run(`series("a1","bw").length`), 2, "e la sincronia non lo riscrive come misura nuova");
});

prova("nel report il peso si legge, non si giudica", () => {
  squadra();
  run(`S.data.a1={bw:[{d:"2026-09-01",v:55},{d:"2026-10-01",v:60}]};`);
  assert.equal(j(`cambioCalc("bw","prec").righe[0].verdetto`), "indice");
});

prova("guide per peso, statura e forza relativa", () => {
  ["bw", "stat", "rmSquatRel"].forEach(id => {
    assert.ok(run(`!!(PROTO["${id}"]&&PROTO["${id}"].steps&&PROTO["${id}"].steps.length)`), "manca la guida di " + id);
  });
  assert.ok(/stessa ora|stesso momento/i.test(run(`JSON.stringify(PROTO.stat)`)), "la statura cala durante il giorno: va detto");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
