// Test di round-trip export -> import.
// Non testa una copia del codice: estrae il JS REALE da index.html, lo esegue
// in un DOM finto e verifica che un backup completo torni indietro intero.
//
//   node test/roundtrip.mjs
//
// Nasce dal bug in cui sanitizeImport scartava screen e lv senza dirlo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

/* ── estrae il blocco <script> dell'app e taglia via l'avvio automatico ── */
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
assert.ok(m, "blocco <script> dell'app non trovato in index.html");
let src = m[1];
const bootAt = src.indexOf("const _anamToken=anamToken();");
assert.ok(bootAt > 0, "marcatore di avvio non trovato: il test va aggiornato");
src = src.slice(0, bootAt);

/* ── DOM finto: quanto basta perché il file si carichi senza esplodere ── */
const el = {
  addEventListener() {}, appendChild() {}, setAttribute() {},
  getAttribute() { return null; }, focus() {}, select() {}, click() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", checked: false,
};
const sandbox = {
  document: {
    getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
    createElement: () => el, addEventListener() {},
    body: el, documentElement: el, hidden: false,
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { userAgent: "test", onLine: true },
  location: { href: "https://test.local/", origin: "https://test.local", pathname: "/", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("rete non disponibile nei test")),
  confirm: () => true, alert() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "index.html:<script>" });

const { sanitizeImport } = sandbox;
assert.equal(typeof sanitizeImport, "function", "sanitizeImport non esportata nello scope globale");

/* ── un backup che contiene UNO di ogni tipo di dato ── */
const backup = {
  sport: "pallavolo",
  view: "readiness",
  activeTeam: "t1",
  cfg: { rdGreen: 82, acwrHigh: 1.25 },
  teams: [{ id: "t1", name: "Prima squadra", sport: "pallavolo" }],
  athletes: [{
    id: "a1", name: "Marco Bianchi", sex: "M", team: "t1",
    profile: { birth: "2009-04-12", weight: "71", consent: true, role: "Centrale" },
  }],
  data: { a1: { cmj: [{ d: "2026-03-01", v: 41.5 }, { d: "2026-05-02", v: 43.0 }] } },
  readiness: { a1: [{ d: "2026-05-02", sl: 4, so: 3, fa: 4, st: 3 }] },
  load: { a1: [{ d: "2026-05-02", rpe: 7, min: 90 }] },
  screen: { a1: [{
    d: "2026-05-02",
    posture: { ant: { devs: [3, 5], note: "valgo dinamico a destra" }, lat: { devs: [0], note: "" } },
    items: {
      squatGlobal: { v: "fail", note: "tallone che si stacca" },
      oneLegSquat: { l: "pass", r: "fail", note: "" },
      bridgeMono: { l: "pass", r: "pass" },
    },
  }] },
  lv: { a1: [{
    d: "2026-05-02", exercise: "Squat",
    points: [{ load: 60, v: 0.82 }, { load: 80, v: 0.61 }, { load: 100, v: 0.42 }],
    mvt: 0.3, est1RM: 131.5, m: -0.01, b: 1.42, r2: 0.998,
  }] },
  tomb: { "ath:zz9": "2026-04-01T10:00:00.000Z" },
};

/* ── export -> import, esattamente come fa l'app ── */
const out = sanitizeImport(JSON.parse(JSON.stringify(backup)));

const checks = [
  ["atleti",                     () => assert.equal(out.athletes.length, 1)],
  ["nome atleta",                () => assert.equal(out.athletes[0].name, "Marco Bianchi")],
  ["profilo atleta",             () => assert.equal(out.athletes[0].profile.role, "Centrale")],
  ["squadre",                    () => assert.equal(out.teams.length, 1)],
  ["misurazioni CMJ",            () => assert.deepEqual(out.data.a1.cmj.map(e => e.v), [41.5, 43.0])],
  ["check-in readiness",         () => assert.equal(out.readiness.a1[0].fa, 4)],
  ["carico interno",             () => assert.equal(out.load.a1[0].rpe, 7)],
  ["screening: presente",        () => assert.equal(out.screen.a1.length, 1)],
  ["screening: deviazioni",      () => assert.deepEqual(out.screen.a1[0].posture.ant.devs, [3, 5])],
  ["screening: nota posturale",  () => assert.equal(out.screen.a1[0].posture.ant.note, "valgo dinamico a destra")],
  ["screening: esito bilaterale",() => assert.equal(out.screen.a1[0].items.oneLegSquat.r, "fail")],
  ["screening: nota item",       () => assert.equal(out.screen.a1[0].items.squatGlobal.note, "tallone che si stacca")],
  ["curva L-V: presente",        () => assert.equal(out.lv.a1.length, 1)],
  ["curva L-V: esercizio",       () => assert.equal(out.lv.a1[0].exercise, "Squat")],
  ["curva L-V: punti",           () => assert.equal(out.lv.a1[0].points.length, 3)],
  ["curva L-V: 1RM stimato",     () => assert.equal(out.lv.a1[0].est1RM, 131.5)],
  ["curva L-V: R quadro",        () => assert.equal(out.lv.a1[0].r2, 0.998)],
  ["tombstone conservate",       () => assert.ok(out.tomb["ath:zz9"])],
  ["vista readiness conservata", () => assert.equal(out.view, "readiness")],
  ["soglie conservate",          () => assert.equal(out.cfg.rdGreen, 82)],
];

let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + " — " + e.message); }
}

/* ── i dati di un atleta cancellato non devono rientrare ── */
try {
  const orfano = sanitizeImport({
    athletes: [], data: { ghost: { cmj: [{ d: "2026-01-01", v: 40 }] } },
    screen: { ghost: [{ d: "2026-01-01", posture: {}, items: {} }] },
    lv: { ghost: [{ d: "2026-01-01", exercise: "Squat", points: [] }] },
  });
  assert.equal(Object.keys(orfano.data).length, 0);
  assert.equal(Object.keys(orfano.screen).length, 0);
  assert.equal(Object.keys(orfano.lv).length, 0);
  console.log("  ok   dati orfani scartati");
} catch (e) { failed++; console.log("  FAIL dati orfani scartati — " + e.message); }

console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
