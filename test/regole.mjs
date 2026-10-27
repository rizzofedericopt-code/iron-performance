// Le regole approvate del doc «Regole pallavolo» (27/10/2026): 1, 2, 3, 4, 6, 7, 8.
//
//   node test/regole.mjs
//
// Per ogni regola: scatta quando deve, tace quando mancano i dati, e porta
// il numero da cui nasce. La 6 è provata in profilo.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const cache = {};
const elFor = () => ({ value: "", dataset: {}, style: {}, textContent: "", innerHTML: "", addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, focus() {}, select() {}, click() {} });
const sandbox = {
  document: { getElementById: (id) => (cache[id] ||= elFor()), querySelector: () => elFor(), querySelectorAll: () => [], createElement: () => elFor(),
    addEventListener() {}, body: elFor(), documentElement: elFor(), hidden: false },
  window: { addEventListener() {}, open: () => null }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const j = (c) => { const r = run("JSON.stringify(" + c + ")"); return r === undefined ? undefined : JSON.parse(r); };
run(`normalize(); render=function(){}; save=function(){}; toast=function(){};`);

let failed = 0;
const prova = (nome, fn) => { try { fn(); console.log("  ok   " + nome); } catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); } };
const OGGI = "2026-10-27";
const fa = (g) => run(`(function(){ const d=new Date("${OGGI}T12:00:00Z"); d.setUTCDate(d.getUTCDate()-(${g})); return d.toISOString().slice(0,10); })()`);
const squadra = () => run(`{ S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}]; S.activeTeam="t1";
  S.athletes=[["a1","Sara","schiacciatrice"],["a2","Giulia","centrale"],["a3","Marta","opposto"],["a4","Elena","palleggiatrice"],["a5","Pia","libero"]]
    .map(x=>({id:x[0],name:x[1]+" Rossi",team:"t1",sex:"F",profile:{role:x[2]}}));
  S.load={}; S.salti={}; S.scout={}; S.gare={t1:[]}; S.pres={}; S.tomb={}; S.readiness={}; S.data={}; S.sedute={}; }`);
const valuta = (d = OGGI) => j(`regoleValuta("${d}")`);
const salti = (aid, lista) => run(`S.salti[${JSON.stringify(aid)}]=${JSON.stringify(lista.map(([g, n], i) => ({ d: fa(g), exercise: "v" + i, nome: "x", n, att: 0, muro: 0, batt: 0, alz: 0, alt: 0, src: "mano" })))}`);
// quattro settimane con 60 salti l'una, più quello che si passa
const storia = (aid, ultimi) => salti(aid, [[9, 60], [16, 60], [23, 60], [30, 60]].concat(ultimi));

console.log("\nRegola 1 · settimana con molti più salti");
prova("scatta oltre 1,3 volte la sua media e almeno 50 in più", () => {
  squadra(); storia("a1", [[2, 70], [4, 50]]);       // 120 contro 60
  const r = valuta().filter((x) => x.r === 1);
  assert.equal(r.length, 1); assert.match(r[0].testo, /120 salti negli ultimi 7 giorni contro una media di 60/);
});
prova("non scatta con 1,3 volte ma meno di 50 in più", () => {
  squadra(); salti("a1", [[9, 20], [16, 20], [23, 20], [30, 20], [2, 40]]);   // ×2 ma +20
  assert.equal(valuta().filter((x) => x.r === 1).length, 0);
});
prova("tace se una delle 4 settimane prima non ha salti registrati", () => {
  squadra(); salti("a1", [[9, 60], [16, 60], [30, 60], [2, 200]]);
  assert.equal(valuta().filter((x) => x.r === 1).length, 0, "una settimana senza conteggio non è una settimana a zero");
});

console.log("\nRegola 2 · due partite in 7 giorni");
prova("scatta fra due partite a meno di 7 giorni, guardando avanti", () => {
  squadra(); run(`S.gare.t1=[{d:"${fa(-2)}",avv:"A"},{d:"${fa(-6)}",avv:"B"}]`);
  const r = valuta().filter((x) => x.r === 2);
  assert.equal(r.length, 1); assert.match(r[0].testo, /Due partite in 4 giorni/);
});
prova("non scatta a 7 giorni o più", () => {
  squadra(); run(`S.gare.t1=[{d:"${fa(-2)}",avv:"A"},{d:"${fa(-9)}",avv:"B"}]`);
  assert.equal(valuta().filter((x) => x.r === 2).length, 0);
});

console.log("\nRegola 3 · salta molto più delle compagne");
const partita = (g, per) => { run(`S.gare.t1.push({d:"${fa(g)}",avv:"P${g}"})`);
  Object.entries(per).forEach(([aid, n]) => run(`(S.salti[${JSON.stringify(aid)}]=S.salti[${JSON.stringify(aid)}]||[]).push({d:"${fa(g)}",exercise:"vp${g}",nome:"P",n:${n},att:0,muro:0,batt:0,alz:0,alt:0,src:"mano"})`)); };
prova("due partite di fila oltre 1,5 volte la mediana: scatta", () => {
  squadra(); partita(1, { a1: 80, a2: 40, a3: 40, a4: 30 }); partita(5, { a1: 70, a2: 40, a3: 45, a4: 30 });
  const r = valuta().filter((x) => x.r === 3);
  assert.equal(r.length, 1); assert.match(r[0].testo, /Sara<\/b>: nelle ultime due partite 80 e 70/);
});
prova("una sola partita sopra non basta", () => {
  squadra(); partita(1, { a1: 80, a2: 40, a3: 40, a4: 30 }); partita(5, { a1: 45, a2: 40, a3: 45, a4: 30 });
  assert.equal(valuta().filter((x) => x.r === 3).length, 0);
});
prova("la libero non entra nella mediana", () => {
  // senza la libero la mediana è 40 e scatta solo Sara; con lei scenderebbe a 30 e scatterebbe anche Giulia
  squadra(); partita(1, { a1: 80, a2: 50, a3: 30, a4: 25, a5: 1 }); partita(5, { a1: 80, a2: 50, a3: 30, a4: 25, a5: 1 });
  assert.deepEqual(valuta().filter((x) => x.r === 3).map((x) => x.aid), ["a1"]);
});
prova("se una delle due partite non ha salti contati, tace", () => {
  squadra(); partita(1, { a1: 80, a2: 40, a3: 40, a4: 30 }); run(`S.gare.t1.push({d:"${fa(5)}",avv:"X"})`);
  assert.equal(valuta().filter((x) => x.r === 3).length, 0);
});

console.log("\nRegola 4 · ha giocato poco");
const set = (g, per) => { run(`S.gare.t1.push({d:"${fa(g)}",avv:"S${g}",durata:90,setTot:3})`);
  Object.entries(per).forEach(([aid, s]) => run(`(S.load[${JSON.stringify(aid)}]=S.load[${JSON.stringify(aid)}]||[]).push({d:"${fa(g)}",exercise:"gara",set:${s},min:30*${s}})`)); };
prova("al massimo 1 set nelle ultime 2 partite, entro 2 giorni: compensazione", () => {
  squadra(); set(1, { a1: 3, a2: 1 }); set(6, { a1: 3, a2: 0 });
  const r = valuta().filter((x) => x.r === 4).map((x) => x.aid).sort();
  assert.deepEqual(r, ["a2", "a3", "a4", "a5"], "chi non è segnata non ha giocato");
});
prova("oltre 2 giorni dall'ultima partita non si propone più", () => {
  squadra(); set(3, { a1: 3, a2: 1 }); set(6, { a1: 3, a2: 0 });
  assert.equal(valuta().filter((x) => x.r === 4).length, 0);
});
prova("se di una partita non si sa niente dei set, tace", () => {
  squadra(); set(1, { a1: 3, a2: 1 }); run(`S.gare.t1.push({d:"${fa(6)}",avv:"X"})`);
  assert.equal(valuta().filter((x) => x.r === 4).length, 0);
});

console.log("\nRegola 7 · dolore al ginocchio");
prova("dolore al ginocchio: nessuna proposta di carico per lei, solo il fisioterapista", () => {
  squadra(); storia("a1", [[2, 70], [4, 50]]); set(1, { a2: 3 }); set(6, { a2: 3 });
  run(`S.athletes[0].profile.injuriesCurrent="male al ginocchio destro dopo i salti"`);
  const l = valuta();
  assert.ok(l.some((x) => x.r === 7 && x.aid === "a1" && /fisioterapista/.test(x.testo) && /salti in aumento/.test(x.testo)));
  assert.ok(!l.some((x) => x.aid === "a1" && x.r !== 7), "nessun'altra proposta per lei");
});
prova("un dolore che non è al ginocchio non accende la regola 7", () => {
  squadra(); run(`S.athletes[0].profile.injuriesCurrent="caviglia sinistra"`);
  assert.equal(valuta().filter((x) => x.r === 7).length, 0);
});

console.log("\nRegola 8 · dati mancanti");
prova("partita senza salti né RPE: promemoria, e dice quali regole tacciono", () => {
  squadra(); set(1, { a1: 3 });
  const r = valuta().filter((x) => x.r === 8);
  assert.equal(r.length, 1); assert.match(r[0].testo, /mancano i salti e gli RPE di chi ha giocato/); assert.match(r[0].testo, /regole 1 e 3 tacciono/);
});
prova("dati completi: niente promemoria", () => {
  squadra(); set(1, { a1: 3 }); run(`S.load.a1[0].rpe=7; S.salti.a1=[{d:"${fa(1)}",exercise:"v1",n:30,att:0,muro:0,batt:0,alz:0,alt:0,src:"mano"}]`);
  assert.equal(valuta().filter((x) => x.r === 8).length, 0);
});

console.log("\nDove si vedono");
prova("in Oggi compaiono le proposte, con regola e fonte", () => {
  squadra(); storia("a1", [[2, 70], [4, 50]]);
  const h = run(`regoleHtml(regoleValuta("${OGGI}"),"Proposte")`);
  assert.match(h, /Proposte \(1\)/); assert.match(h, /Regola 1 · Settimana con molti più salti · Bahr e Bahr 2014/);
});
prova("la regola 5 è spenta", () => {
  assert.equal(run(`REGOLE_ON[5]`), false);
  assert.ok(!/r:5/.test(run(`regoleValuta.toString()`)));
});

console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
