// Promemoria: cosa non misuri da troppo.
//
//   node test/promemoria.mjs
//
// Perche' questo test esiste. Un promemoria che sbaglia in eccesso viene
// ignorato in due settimane; uno che sbaglia in difetto non serve. Quindi:
//   1. la frequenza viene dalla batteria dello sport, non da un numero unico
//   2. scaduto vuol dire oltre la tolleranza, non un giorno dopo
//   3. chi manca dall'ultima sessione (di solito le assenti) va nominato
//   4. un test mai fatto non e' «scaduto»: si dice a parte
//   5. i valori calcolati (EUR, forza relativa) non si «misurano»

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


const fa = (gg) => { const d = new Date(); d.setDate(d.getDate() - gg); return d.toISOString().slice(0, 10); };
const squadra = (tests) => run(`{
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo",tests:${JSON.stringify(tests)}}];
  S.activeTeam="t1"; S.sport="pallavolo"; S.pres={}; S.tomb={}; S.te={};
  S.athletes=["a1","a2","a3","a4"].map((id,i)=>({id,name:"N"+i,team:"t1",sex:"F"}));
  S.data={a1:{},a2:{},a3:{},a4:{}};
}`);
const metti = (tid, gg, chi) => run(`[${(chi || ["a1","a2","a3","a4"]).map(x => '"' + x + '"').join(",")}].forEach(id=>{
  S.data[id]["${tid}"]=[{d:"${fa(gg)}",v:40}]; })`);

console.log("\nPromemoria");

prova("la frequenza viene dalla batteria dello sport", () => {
  assert.equal(run(`promTier("cmj","pallavolo")`), "sett");
  assert.equal(run(`promTier("rm35","pallavolo")`), "ciclo");
  assert.equal(run(`promTier("dj","pallavolo")`), "anno");
  assert.equal(run(`promTier("bw","pallavolo")`), "bw");
  assert.equal(run(`promTier("stat","pallavolo")`), "stat");
});

prova("un CMJ di 10 giorni fa non è scaduto, uno di 20 sì", () => {
  squadra(["cmj"]);
  metti("cmj", 10);
  assert.equal(run(`promemoria().scaduti.length`), 0, "dentro la tolleranza di una settimana");
  metti("cmj", 20);
  const s = j(`promemoria().scaduti`);
  assert.equal(s.length, 1);
  assert.equal(s[0].t, "cmj");
  assert.equal(s[0].gg, 20);
});

prova("un test di inizio stagione di tre mesi fa non disturba", () => {
  squadra(["dj"]);
  metti("dj", 100);
  const p = j(`promemoria()`);
  assert.equal(p.scaduti.length, 0);
  metti("dj", 300);
  assert.equal(run(`promemoria().scaduti.length`), 1, "dieci mesi si'");
});

prova("chi manca dall'ultima sessione viene nominato", () => {
  squadra(["cmj"]);
  metti("cmj", 3, ["a1", "a2", "a3"]);
  const p = j(`promemoria()`);
  assert.equal(p.parziali.length, 1);
  assert.deepEqual(p.parziali[0].mancano, ["N3"]);
  assert.equal(p.parziali[0].fatte, 3);
});

prova("una misura vecchia non conta come fatta nell'ultima sessione", () => {
  squadra(["cmj"]);
  metti("cmj", 3, ["a1", "a2"]);
  metti("cmj", 40, ["a3"]);
  const p = j(`promemoria()`);
  assert.deepEqual(p.parziali[0].mancano, ["N2", "N3"]);
});

prova("un test mai fatto è a parte, non fra gli scaduti", () => {
  squadra(["cmj", "sj"]);
  metti("cmj", 2);
  const p = j(`promemoria()`);
  assert.equal(p.scaduti.length, 0);
  assert.deepEqual(p.mai.map(x => x.t), ["sj"]);
});

prova("i valori calcolati non si chiedono", () => {
  squadra(["cmj", "sj", "eur", "rmSquat", "rmSquatRel"]);
  const p = j(`promemoria()`);
  const tutti = p.mai.concat(p.scaduti).map(x => x.t);
  assert.ok(tutti.indexOf("eur") < 0 && tutti.indexOf("rmSquatRel") < 0, tutti.join());
});

prova("i più in ritardo, in proporzione alla loro frequenza, vengono prima", () => {
  squadra(["cmj", "rm35"]);
  metti("cmj", 30);          // 4 volte la settimana attesa
  metti("rm35", 80);         // 1,4 volte le 8 settimane
  assert.deepEqual(j(`promemoria().scaduti.map(x=>x.t)`), ["cmj", "rm35"]);
});

prova("in Oggi compare, con il pulsante per registrare", () => {
  squadra(["cmj"]);
  metti("cmj", 30);
  const h = run(`promHtml()`);
  assert.ok(/Da misurare/.test(h) && /openSessionOn\('cmj'\)/.test(h));
  squadra(["cmj"]);
  metti("cmj", 2);
  assert.equal(run(`promHtml()`), "", "niente da dire: niente sezione");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
