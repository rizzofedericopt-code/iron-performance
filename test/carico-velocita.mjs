// Curva carico-velocita': la stima dell'1RM e' giusta, e finisce dove serve?
//
//   node test/carico-velocita.mjs
//
// Il motivo per cui questo test esiste: l'app usava una sola soglia di
// velocita' (0,30 m/s) per qualsiasi esercizio. Su panca e stacco, dove
// l'MVT reale sta fra 0,15 e 0,18, questo sottostima l'1RM del 14-16%.
// Federico fa la curva su squat, panca E stacco.

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
const campi = {};                       // valori dei campi del modulo
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
  window: { addEventListener() {} }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ── 1. la matematica della stima ── */
prova("l'1RM stimato e' il carico alla velocita' soglia", () => {
  // punti generati da una retta nota: v = 1.35 - 0.0075 * carico
  const pts = [60, 80, 100, 120].map(load => ({ load, v: 1.35 - 0.0075 * load }));
  const reg = run(`linRegLV(${JSON.stringify(pts)})`);
  assert.ok(Math.abs(reg.m + 0.0075) < 1e-9, "pendenza sbagliata");
  assert.ok(Math.abs(reg.r2 - 1) < 1e-9, "R² deve essere 1 su punti perfetti");
  const est = run(`lvEstimate(${JSON.stringify(reg)}, 0.30)`);
  assert.ok(Math.abs(est - 140) < 0.01, "atteso 140 kg, ottenuto " + est);
});

prova("una velocita' che NON cala col carico viene rifiutata", () => {
  const pts = [{ load: 60, v: 0.5 }, { load: 100, v: 0.9 }];
  const reg = run(`linRegLV(${JSON.stringify(pts)})`);
  assert.equal(run(`lvEstimate(${JSON.stringify(reg)}, 0.30)`), null,
    "con la velocita' che sale il dato e' sbagliato e va rifiutato");
});

/* ── 2. il difetto vero: una sola soglia per tutti gli esercizi ── */
prova("ogni esercizio ha la SUA soglia di velocita'", () => {
  const ex = run("JSON.stringify(LV_EX)");
  const L = JSON.parse(ex);
  const g = n => L.find(e => e.n === n);
  assert.ok(g("Back squat"), "manca il back squat");
  assert.ok(Math.abs(g("Panca piana").mvt - 0.17) < 0.03,
    "la panca deve stare intorno a 0,17 m/s, non a 0,30");
  assert.ok(Math.abs(g("Stacco da terra").mvt - 0.16) < 0.03,
    "lo stacco deve stare intorno a 0,16 m/s, non a 0,30");
  assert.ok(g("Panca piana").mvt < g("Back squat").mvt,
    "la panca ha una soglia piu' bassa dello squat");
});

prova("quanto sbagliava prima: panca e stacco sottostimati del 14-16%", () => {
  const casi = [
    { nome: "Panca piana",     b: 1.10, m: -0.0090 },
    { nome: "Stacco da terra", b: 1.05, m: -0.0060 },
  ];
  for (const c of casi) {
    const reg = { m: c.m, b: c.b, r2: 1 };
    const giusto = run(`lvEstimate(${JSON.stringify(reg)}, ${run(`lvExInfo(${JSON.stringify(c.nome)}).mvt`)})`);
    const vecchio = run(`lvEstimate(${JSON.stringify(reg)}, 0.30)`);
    const errore = (vecchio - giusto) / giusto * 100;
    assert.ok(errore < -10,
      c.nome + ": con la vecchia soglia unica l'errore doveva essere sotto il -10%, e' " + errore.toFixed(1) + "%");
    assert.ok(giusto > vecchio, c.nome + ": la soglia corretta deve dare un 1RM piu' alto");
  }
});

prova("ogni esercizio conosce il test dello storico in cui finire", () => {
  const L = JSON.parse(run("JSON.stringify(LV_EX)"));
  const atteso = { "Back squat": "rmSquat", "Panca piana": "rmBench", "Stacco da terra": "rmDead" };
  for (const [nome, test] of Object.entries(atteso)) {
    assert.equal(L.find(e => e.n === nome).test, test, nome + " non alimenta " + test);
  }
  const ids = JSON.parse(run("JSON.stringify(Object.keys(TMAP))"));
  L.filter(e => e.test).forEach(e =>
    assert.ok(ids.includes(e.test), "il test " + e.test + " non esiste nel catalogo"));
});

/* ── 3. la stima entra nello storico, senza doppio inserimento ── */
const scenario = (esercizio, punti, data) => {
  run(`S={athletes:[{id:"a1",name:"Giorgia",sex:"F",team:"t1",profile:{weight:"58"}}],
        teams:[{id:"t1",name:"Young Volley",sport:"pallavolo"}],
        data:{},readiness:{},load:{},screen:{},lv:{},tomb:{}}; normalize();
       CUR_LV_AID="a1"; LV_ROWS=${JSON.stringify(punti.map(p => ({ load: String(p.load), v: String(p.v) })))};`);
  campi.lvEx = esercizio; campi.lvD = data;
  campi.lvMvt = String(run(`lvExInfo(${JSON.stringify(esercizio)}).mvt`));
  run(`previewLV()`);
  run(`saveLV("a1")`);
};

prova("l'1RM stimato compare nello storico del test giusto", () => {
  scenario("Panca piana", [40, 50, 60, 70].map(load => ({ load, v: 1.10 - 0.0090 * load })), "2026-09-15");
  const serie = JSON.parse(run(`JSON.stringify(S.data.a1.rmBench||[])`));
  assert.equal(serie.length, 1, "la stima non e' entrata nello storico di 1RM Panca");
  assert.equal(serie[0].d, "2026-09-15");
  assert.ok(Math.abs(serie[0].v - 103.3) < 1.5, "atteso ~103 kg, trovato " + serie[0].v);
  assert.equal(serie[0].fonte, "lv", "va marcata come stima, non come massimale misurato");
});

prova("la curva resta anche nel suo archivio", () => {
  const lv = JSON.parse(run(`JSON.stringify(S.lv.a1||[])`));
  assert.equal(lv.length, 1);
  assert.equal(lv[0].exercise, "Panca piana");
  assert.equal(lv[0].points.length, 4);
  assert.ok(Math.abs(lv[0].mvt - 0.17) < 0.001, "la soglia usata va conservata con la sessione");
});

prova("una stima NON sovrascrive un massimale misurato nello stesso giorno", () => {
  run(`S.data.a1.rmSquat=[{d:"2026-10-01",v:95}];`);   // massimale vero, senza fonte
  scenarioSquat();
  const serie = JSON.parse(run(`JSON.stringify(S.data.a1.rmSquat)`));
  const g = serie.find(e => e.d === "2026-10-01");
  assert.equal(g.v, 95, "il massimale misurato e' stato sovrascritto da una stima");
  assert.ok(!g.fonte, "e non deve nemmeno essere marcato come stima");
});
function scenarioSquat() {
  run(`CUR_LV_AID="a1"; LV_ROWS=${JSON.stringify([60, 80, 100].map(load => ({ load: String(load), v: String(1.35 - 0.0075 * load) })))};`);
  campi.lvEx = "Back squat"; campi.lvD = "2026-10-01"; campi.lvMvt = "0.30";
  run(`previewLV()`); run(`saveLV("a1")`);
}

prova("il marcatore di stima sopravvive a un ripristino da backup", () => {
  const dopo = JSON.parse(run(`JSON.stringify(sanitizeImport(JSON.parse(JSON.stringify(S))))`));
  const serie = dopo.data.a1.rmBench || [];
  assert.equal(serie.length, 1);
  assert.equal(serie[0].fonte, "lv",
    "dopo un ripristino non si distinguerebbe piu' una stima da un massimale vero");
});

console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
