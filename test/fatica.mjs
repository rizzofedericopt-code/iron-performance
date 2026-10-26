// Pagina Fatica e check-in.
//
//   node test/fatica.mjs
//
// Il modulo di check-in partiva con i valori dell'ultima volta e «Salva»
// registrava tutte le righe: chi non era stata interrogata riceveva un
// check-in di oggi copiato da quello di ieri. Un dato inventato che sembra
// vero. E la riga in Fatica mostrava «🔋 4» per una fatica 4 su 5: l'icona
// della batteria carica sopra un'atleta stanca.

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
const cache = {};
const elFor = (id) => ({
  value: "", dataset: {}, style: {}, textContent: "", innerHTML: "",
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector() { return null; }, querySelectorAll() { return []; },
  appendChild() {}, focus() {}, select() {}, click() {},
});
// righe finte del modulo: [{aid, v:{sl,so,fa,st}}]
let RIGHE = [];
const riga = (r) => ({
  getAttribute: (k) => (k === "data-a" ? r.aid : null),
  querySelectorAll: () => ["sl", "so", "fa", "st"].map((k) => ({
    value: r.v[k] == null ? "" : String(r.v[k]),
    getAttribute: () => k,
  })),
});
const sandbox = {
  document: {
    getElementById: (id) => (cache[id] ||= elFor(id)),
    querySelector: () => elFor("__q"),
    querySelectorAll: (q) => (q === ".ci-row" ? RIGHE.map(riga) : []),
    createElement: () => elFor("__c"),
    addEventListener() {}, body: elFor("__b"), documentElement: elFor("__d"), hidden: false,
  },
  window: { addEventListener() {}, open: () => null }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const j = (c) => JSON.parse(run("JSON.stringify(" + c + ")"));
run(`normalize();`);
run(`var LASTT=""; render=function(){}; save=function(){}; closeM=function(){}; toast=function(m){LASTT=String(m)};`);

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};
const squadra = () => run(`{ S.athletes=[{id:"a1",name:"Sara Rossi",team:"t1"},{id:"a2",name:"Giulia Bianchi",team:"t1"},{id:"a3",name:"Marta Verdi",team:"t1"}];
  S.teams=[{id:"t1",name:"U18"}]; S.activeTeam="t1"; S.readiness={}; S.load={}; S.salti={}; S.data={}; S.pres={}; }`);
const ieri = () => run(`(function(){ const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })()`);

console.log("\nCheck-in");

prova("chi non risponde non riceve un check-in copiato da ieri", () => {
  squadra();
  run(`S.readiness={a1:[{d:${JSON.stringify(ieri())},sl:4,so:2,fa:2,st:2}],a2:[{d:${JSON.stringify(ieri())},sl:3,so:3,fa:3,st:3}]}`);
  run(`openCheckin()`);
  const h = run(`document.getElementById("modal").innerHTML`);
  assert.ok(!/<option value="4" selected>/.test(h), "il modulo non deve partire con i valori di ieri");
  RIGHE = [{ aid: "a1", v: { sl: 3, so: 2, fa: 4, st: 2 } }, { aid: "a2", v: {} }, { aid: "a3", v: {} }];
  run(`document.getElementById("ciD").value=todayISO(); saveCheckin()`);
  assert.equal(j(`S.readiness.a1.length`), 2);
  assert.equal(j(`S.readiness.a2.length`), 1, "Giulia non ha risposto: niente check-in di oggi");
  assert.equal(run(`S.readiness.a3===undefined`), true);
  assert.match(run(`LASTT`), /\(1\)/);
});

prova("una riga a metà non si salva e lo dice", () => {
  squadra();
  RIGHE = [{ aid: "a1", v: { sl: 3, so: 2 } }, { aid: "a2", v: { sl: 3, so: 2, fa: 2, st: 2 } }];
  run(`document.getElementById("ciErr").textContent=""; saveCheckin()`);
  assert.equal(run(`S.readiness.a2===undefined`), true, "niente salvataggio parziale: o tutto o niente");
  assert.match(run(`document.getElementById("ciErr").textContent`), /Sara Rossi/);
});

prova("correggere il check-in di oggi lo riparte dai valori di oggi", () => {
  squadra();
  run(`S.readiness={a1:[{d:todayISO(),sl:2,so:4,fa:5,st:3}]}`);
  run(`openCheckin()`);
  const h = run(`document.getElementById("modal").innerHTML`);
  assert.match(h, /<option value="5" selected>/, "il check-in di oggi si corregge, non si riscrive da zero");
});

console.log("\nPagina Fatica");

prova("ogni voce ha il suo nome: la fatica 4 non è una batteria carica", () => {
  squadra();
  run(`S.readiness={a1:[{d:todayISO(),sl:4,so:1,fa:4,st:2}]}; renderReadiness()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(!/🔋/.test(h), "l'icona della batteria diceva il contrario del numero");
  assert.match(h, /rd-wi bad">fatica <b>4<\/b>/, "fatica 4 su 5 va segnata");
  assert.match(h, /rd-wi">sonno <b>4<\/b>/, "sonno 4 è buono, niente colore");
});

prova("un check-in vecchio si vede vecchio e finisce sotto quelli di oggi", () => {
  squadra();
  run(`S.readiness={a1:[{d:${JSON.stringify(ieri())},sl:1,so:5,fa:5,st:5}], a2:[{d:todayISO(),sl:4,so:2,fa:2,st:2}]}; renderReadiness()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(h.indexOf("Giulia") < h.indexOf("Sara Rossi"), "Sara era stanca ieri: non va in cima come se fosse oggi");
  assert.match(h, /rd-score [a-z]+ vecchio/);
  assert.match(h, /ieri/);
});

prova("in alto c'è chi manca al check-in di oggi", () => {
  squadra();
  run(`S.readiness={a2:[{d:todayISO(),sl:4,so:2,fa:2,st:2}]}; renderReadiness()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /Check-in di oggi: 1\/3/);
  assert.match(h, /mancano: Sara, Marta/);
});

prova("i dati che mancano si leggono in italiano, non «CMJ 2/6»", () => {
  squadra();
  run(`S.data={a1:{cmj:[{d:todayISO(),v:30},{d:${JSON.stringify(ieri())},v:31}]}}; renderReadiness()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.ok(!/CMJ \d+\/\d+/.test(h));
  assert.match(h, /CMJ: 2 misure di \d+/);
});

console.log("\nReadiness rispetto alla sua media");

prova("un passo solo su una voce non è rosso per chi risponde sempre uguale", () => {
  squadra();
  run(`S.readiness={a1:[]}; for(let g=20;g>=1;g--){ const d=new Date(); d.setDate(d.getDate()-g);
       S.readiness.a1.push({d:d.toISOString().slice(0,10),sl:4,so:2,fa:2,st:2}); }`);
  const uno = j(`readinessEval("a1",{d:todayISO(),sl:4,so:2,fa:3,st:2})`);
  assert.notEqual(uno.color, "down", "fatica da 2 a 3 e nient'altro: z " + uno.z);
  const due = j(`readinessEval("a1",{d:todayISO(),sl:3,so:2,fa:3,st:2})`);
  assert.notEqual(due.color, "up", "due passi peggiori devono farsi vedere");
  const tanti = j(`readinessEval("a1",{d:todayISO(),sl:2,so:3,fa:4,st:3})`);
  assert.equal(tanti.color, "down");
});

console.log("\nCarico della settimana (al posto dell'ACWR)");

const giorniFa = (g) => run(`(function(){ const d=new Date(); d.setDate(d.getDate()-${g}); return d.toISOString().slice(0,10); })()`);
const carichi = (lista) => run(`S.load={a1:${JSON.stringify(lista.map(([g, rpe, min]) => ({ d: giorniFa(g), rpe, min })))}}`);
// quattro settimane normali: 3 sedute da RPE 5 × 60' = 900 AU a settimana
const normali = () => { const l = []; for (let w = 1; w <= 4; w++) for (const g of [1, 3, 5]) l.push([w * 7 + g, 5, 60]); return l; };

prova("una settimana normale non fa rumore", () => {
  squadra(); carichi(normali().concat([[1, 5, 60], [3, 5, 60], [5, 5, 60]]));
  const c = j(`caricoSett("a1")`);
  assert.equal(c.sett, 900); assert.equal(c.media, 900); assert.equal(c.stato, "ok");
});

prova("una settimana molto più carica si vede, in ambra e mai in rosso", () => {
  squadra(); carichi(normali().concat([[1, 8, 90], [2, 7, 90], [3, 7, 90], [5, 6, 60]]));
  const c = j(`caricoSett("a1")`);
  assert.equal(c.stato, "picco", JSON.stringify(c));
  run(`S.readiness={}; S.cfg.painCut=4; renderToday()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /tflag amber">📈 Settimana carica/);
  assert.ok(!/tflag down">📈/.test(h), "non è un rischio misurato: niente rosso");
});

prova("un rapporto alto su numeri piccoli non è un picco", () => {
  // 4 settimane da 100 AU, poi 160: ×1,6 ma meno di una seduta tipica in più
  squadra(); const l = []; for (let w = 1; w <= 4; w++) l.push([w * 7 + 2, 2, 50]); l.push([2, 2, 50], [4, 2, 30]);
  carichi(l);
  const c = j(`caricoSett("a1")`);
  assert.ok(c.rapporto >= 1.3, "il rapporto è alto: " + c.rapporto);
  assert.equal(c.stato, "ok", "60 AU in più non sono una settimana carica");
});

prova("le settimane senza niente registrato non abbassano la media", () => {
  // solo 3 settimane su 4 hanno dati: la media è su 3, non su 4
  squadra(); const l = normali().filter(([g]) => g < 28 || g >= 35); carichi(l.concat([[1, 5, 60], [3, 5, 60], [5, 5, 60]]));
  const c = j(`caricoSett("a1")`);
  assert.equal(c.settimane, 3); assert.equal(c.media, 900);
});

prova("con meno di 3 settimane di storico non c'è un confronto, e lo dice", () => {
  squadra(); carichi([[1, 5, 60], [9, 5, 60]]);
  const c = j(`caricoSett("a1")`);
  assert.equal(c.insufficient, true);
  assert.match(run(`caricoChip(caricoSett("a1"))`), /media: 1 sett\. di 3/);
});

prova("«ACWR» non compare più da nessuna parte nell'interfaccia", () => {
  const codice = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const resti = codice.match(/["'][^"'\n]*ACWR[^"'\n]*["']/g) || [];
  assert.deepEqual(resti, [], "testi rimasti: " + resti.join(" | "));
});

console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
