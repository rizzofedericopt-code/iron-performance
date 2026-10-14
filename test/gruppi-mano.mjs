// Gruppi di carico fatti a mano: chi non ha fatto il test, il carico scritto
// dal preparatore, le note.
//
//   node test/gruppi-mano.mjs
//
// Perche' questo test esiste. Tre libertà, tre modi di sbagliare in silenzio:
//   1. un'atleta senza massimale nel gruppo. Deve starci, ma NON nella media:
//      un numero che non c'e' non puo' spostare il carico delle altre. E la
//      scheda deve dire, ogni volta, che il suo carico non e' verificato.
//   2. il carico scritto a mano. Vale per la percentuale per cui e' stato
//      deciso: se passi dal 75 all'85%, 50 kg applicati in silenzio sono
//      l'errore peggiore — quello che non si vede.
//   3. le note. Stanno in un elenco parallelo ai gruppi: se un gruppo sparisce
//      e l'elenco non si accorcia allo stesso modo, la nota «Marta: schiena»
//      finisce sul gruppo di Giulia.

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


const squadra = (kgs, senza) => run(`{
  const kgs=${JSON.stringify(kgs)}, senza=${JSON.stringify(senza||[])};
  S.teams=[{id:"t1",name:"Sq",sport:"pallavolo"}]; S.activeTeam="t1";
  S.athletes=kgs.map((k,i)=>({id:"p"+i,name:"P"+i,team:"t1",sex:"F"}))
    .concat(senza.map(n=>({id:n,name:n,team:"t1",sex:"F"})));
  S.data={}; kgs.forEach((k,i)=>{ S.data["p"+i]={rmSquat:[{d:"2026-06-01",v:k}]}; });
  S.gruppi={}; S.pres={}; S.tomb={}; S.sedute={};
  LG={ex:"rmSquat",pct:75,size:3,mode:"media",man:"man",ord:"asc",sel:{}};
}`);
const key = `"rmSquat@t1"`;

console.log("\nGruppi a mano");

prova("chi non ha fatto il test si può mettere in un gruppo", () => {
  squadra([80, 60], ["Nuova"]);
  run(`LG.sel={p0:1,Nuova:1}; lgForma();`);
  assert.deepEqual(j(`S.gruppi[${key}].g`), [["p0", "Nuova"]]);
  const h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/Nuova/.test(h) && /senza 1RM · carico non verificato/.test(h), "deve stare nel gruppo, e dirlo");
});

prova("ma non sposta il carico delle altre", () => {
  squadra([80, 60], ["Nuova"]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1","Nuova"]]};`);
  const B = j(`lgBlocchiMan(lgCandidate("rmSquat").con, lgCandidate("rmSquat").senza).blocchi`);
  assert.equal(B[0].g.length, 2, "nella media solo chi ha il massimale");
  assert.equal(B[0].extra[0].id, "Nuova");
  const r = j(`rmGruppoCarico(lgCandidate("rmSquat").con, 75, "media")`);
  assert.equal(r.load, run(`rmRound((80+60)/2*0.75)`));
});

prova("si aggiunge una sola atleta a un gruppo che c'è già, e lascia l'altro", () => {
  squadra([80, 70, 60, 50], ["Nuova"]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1"],["p2","p3"]]};
       lgAggiungi(0,"Nuova"); lgAggiungi(1,"p1");`);
  assert.deepEqual(j(`S.gruppi[${key}].g`), [["p0","Nuova"],["p2","p3","p1"]], "un nome sta su un bilanciere solo");
});

prova("un gruppo di sole atlete senza massimale si vede e chiede il carico", () => {
  squadra([80], ["A","B"]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["A","B"]]};`);
  const h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/scrivi tu il carico/.test(h), "non deve sparire dalla schermata");
});

prova("il carico scritto a mano vale per la sua percentuale", () => {
  squadra([80, 60]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1"]]}; lgSetKg(0,"45");`);
  assert.deepEqual(j(`S.gruppi[${key}].x[0]`), {kg:45, pct:75});
  let h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/a mano/.test(h), "deve dire che e' a mano");
  // con 45 kg: 80 → 56%, 60 → 75%. Le percentuali si ricalcolano sul carico scritto.
  assert.ok(/56%/.test(h), "la percentuale vera di chi ha 80 di massimale");
  run(`LG.pct=85;`);
  h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/con il 85% non lo applico/.test(h), "a un'altra percentuale non si applica, e lo dice");
  assert.ok(!/lgman/.test(h), "e il carico mostrato e' quello calcolato");
  run(`LG.pct=75; lgSetKg(0,"");`);
  assert.equal(run(`(S.gruppi[${key}].x||[])[0]`), undefined, "svuotare il campo torna al calcolato");
});

prova("le note seguono il loro gruppo anche quando un altro sparisce", () => {
  squadra([80, 70, 60, 50]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1"],["p2","p3"]]};
       lgSetNota(0,"P0: niente ultima serie"); lgSetNota(1,"P2: tecnica");`);
  // si cancella l'atleta p0 e poi p1: il primo gruppo si svuota
  run(`delAthlete("p0"); delAthlete("p1");`);
  assert.deepEqual(j(`S.gruppi[${key}].g`), [["p2","p3"]]);
  assert.equal(run(`S.gruppi[${key}].x[0].nota`), "P2: tecnica", "la nota di un gruppo sciolto non deve finire sull'altro");
});

prova("togliere l'ultima atleta di un gruppo porta via la sua nota, non quella del vicino", () => {
  squadra([80, 70, 60]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0"],["p1","p2"]], x:[{nota:"A"},{nota:"B"}]};
       lgTogli(0,"p0");`);
  assert.deepEqual(j(`S.gruppi[${key}].g`), [["p1","p2"]]);
  assert.equal(run(`S.gruppi[${key}].x[0].nota`), "B");
});

prova("un id morto in mezzo non sposta le note", () => {
  squadra([80, 70, 60]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["fantasma"],["p1","p2"]], x:[{nota:"A"},{nota:"B"}]};`);
  const X = j(`lgSalvatiX(${key})`);
  assert.equal(X.length, 1);
  assert.equal(X[0].x.nota, "B");
});

prova("il ripristino tiene note e carichi allineati e scarta quelli assurdi", () => {
  const o = j(`sanitizeImport({athletes:[{id:"a1",name:"A"},{id:"a2",name:"B"}], data:{},
    gruppi:{"rmSquat@t1":{d:"2026-10-01", g:[["morto"],["a1","a2"]],
      x:[{nota:"del morto"},{nota:"giusta", kg:50, pct:75}]},
            "rmDead@t1":{d:"2026-10-01", g:[["a1"]], x:[{kg:9999, pct:75, nota:"x".repeat(900)}]}}})`);
  assert.deepEqual(o.gruppi["rmSquat@t1"].g, [["a1","a2"]]);
  assert.deepEqual(o.gruppi["rmSquat@t1"].x, [{kg:50, pct:75, nota:"giusta"}]);
  const d = o.gruppi["rmDead@t1"].x[0];
  assert.equal(d.kg, undefined, "9999 kg non e' un carico");
  assert.equal(d.nota.length, 300, "note limitate");
});

prova("rifare in automatico con delle note chiede prima", () => {
  squadra([80, 70, 60]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1","p2"]], x:[{nota:"importante"}]};
       confirm=()=>false; lgDaAuto(); confirm=()=>true;`);
  assert.equal(run(`S.gruppi[${key}].x[0].nota`), "importante", "senza conferma non si tocca niente");
});

prova("la stampa porta chi non ha il massimale, il carico a mano e la nota", () => {
  squadra([80, 60], ["Nuova"]);
  run(`S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1","Nuova"]], x:[{kg:47.5, pct:75, nota:"occhio"}]};`);
  const B = j(`lgDaStampare()`);
  assert.equal(B[0].extra[0].nome, "Nuova");
  assert.equal(B[0].x.nota, "occhio");
  assert.equal(B[0].x.kg, 47.5);
});

prova("la scheda di seduta usa i gruppi a mano con tutto dentro", () => {
  squadra([80, 60], ["Nuova"]);
  run(`S.data.p0.rmDead=[{d:"2026-06-01",v:100}]; S.data.p1.rmDead=[{d:"2026-06-01",v:80}];
       S.gruppi[${key}]={d:"2026-10-01", g:[["p0","p1","Nuova"]], x:[{kg:47.5, pct:75, nota:"occhio"}]};`);
  const r = j(`sedutaCalc({ex:[{t:"rmSquat",pct:75,sr:"4×5",mode:"media"},{t:"rmDead",pct:75,sr:"4×5",mode:"media"}], rif:"rmSquat", size:3})`);
  assert.equal(r.gruppi.length, 1);
  assert.ok(r.gruppi[0].membri.some(m => m.id === "Nuova"), "chi non ha il massimale resta nel gruppo");
  assert.equal(r.gruppi[0].nota, "occhio");
  assert.equal(r.gruppi[0].ex[0].r.load, 47.5, "il carico a mano vale sullo squat al 75%");
  assert.equal(r.gruppi[0].ex[0].r.mano, true);
  assert.notEqual(r.gruppi[0].ex[1].r.load, 47.5, "e non sullo stacco");
  assert.ok(r.gruppi[0].ex[1].mancano.indexOf("Nuova") >= 0);
  assert.ok(!r.singole.some(s => s.id === "Nuova"), "non deve comparire anche fra le senza gruppo");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
