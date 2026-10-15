// PDF della tabella dei test: da mostrare alle ragazze, da mandare.
//
//   node test/pdf-tabella.mjs
//
// Perche' questo test esiste. Un foglio che esce dall'app va in mano a
// sedicenni e, se lo mandi nel gruppo, a tutta la squadra. Non deve portarsi
// dietro niente che la tabella mostra a te e basta: infortuni, «nuova scheda»,
// il peso, le classifiche. E una tabella con venti colonne non sta su un A4:
// va spezzata, ripetendo i nomi, invece di uscire tagliata.

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
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo",tests:["cmj","sj","rmSquat","bw","spr10"]}]; S.activeTeam="t1"; S.sport="pallavolo";
  S.athletes=[{id:"a1",name:"Sara",sex:"F",team:"t1",profile:{injuriesCurrent:"tendinite rotulea",formNew:true,weight:"56",weightSync:"56"}},
              {id:"a2",name:"Anna",sex:"F",team:"t1",profile:{}},
              {id:"a3",name:"Marta",sex:"F",team:"t1",profile:{}}];
  S.data={a1:{cmj:[{d:"2026-09-01",v:30},{d:"2026-10-01",v:34}], bw:[{d:"2026-10-01",v:56}], rmSquat:[{d:"2026-10-01",v:80,fonte:"reps"}]},
          a2:{cmj:[{d:"2026-10-01",v:31}], spr10:[{d:"2026-10-01",v:2.01}]},
          a3:{cmj:[{d:"2026-09-01",v:30},{d:"2026-10-01",v:30.4}]}};
  S.te={}; S.cfg.deltaNoise=5; SORT={by:null,desc:false};
}`);

console.log("\nPDF della tabella");

prova("niente peso, niente infortuni, niente segni riservati", () => {
  squadra();
  const h = run(`tabPdfHtml({})`);
  ["Peso", "tendinite", "nuova", "⚠", "56 kg"].forEach(w => assert.ok(h.indexOf(w) < 0, "nel PDF c'e' «" + w + "»"));
  assert.ok(/CMJ/.test(h) && /1RM Squat/.test(h));
});

prova("il peso entra solo se lo chiedi", () => {
  squadra();
  assert.ok(/Peso/.test(run(`tabPdfHtml({peso:true})`)));
});

prova("in ordine alfabetico di default, non per prestazione", () => {
  squadra();
  run(`SORT={by:"cmj",desc:false};`);
  const h = run(`tabPdfHtml({})`);
  assert.ok(h.indexOf("Anna") < h.indexOf("Marta") && h.indexOf("Marta") < h.indexOf("Sara"));
  const h2 = run(`tabPdfHtml({ordine:"tabella"})`);
  assert.ok(h2.indexOf("Sara") < h2.indexOf("Anna"), "se lo scegli, l'ordine della tabella (CMJ migliore in cima)");
});

prova("la variazione dice il verdetto, non solo il segno", () => {
  squadra();
  const h = run(`tabPdfHtml({variazione:true})`);
  assert.ok(/migliorata/.test(h), "Sara +4 cm su 30");
  assert.ok(/stabile/.test(h), "Marta +0,4: dentro l'errore");
  assert.ok(!/migliorata|stabile|calata/.test(run(`tabPdfHtml({variazione:false})`)), "senza variazione, niente verdetti");
});

prova("una stima resta segnata come stima", () => {
  squadra();
  assert.ok(/≈<\/small>80/.test(run(`tabPdfHtml({})`)));
});

prova("con tante colonne la tabella si spezza e ripete i nomi", () => {
  squadra();
  run(`S.teams[0].tests=["cmj","sj","rmSquat","spr10","dj","cmjA","rsiMod","bjump","spr30","cod505","mat","yoyo1","ankleDF","rmDead"];
       S.teams[0].tests.forEach(t=>{ if(!S.data.a2[t]) S.data.a2[t]=[{d:"2026-10-01",v:5}]; });`);
  const h = run(`tabPdfHtml({})`);
  const tabelle = (h.match(/<table/g) || []).length;
  assert.ok(tabelle >= 2, "14 colonne con dati non stanno in una tabella sola: " + tabelle);
  assert.equal((h.match(/>Sara</g) || []).length, tabelle, "il nome in ogni pezzo");
});

prova("una pagina per ogni atleta: i profili, uno dopo l'altro", () => {
  squadra();
  const h = run(`profiliPdfHtml({})`);
  ["Sara", "Anna", "Marta"].forEach(n => assert.ok(h.indexOf(n) >= 0));
  assert.equal((h.match(/class="pagina"/g) || []).length, 3);
  assert.ok(h.indexOf("tendinite") < 0, "anche qui niente dati sanitari");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
