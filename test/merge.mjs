// Test del merge multi-dispositivo.
//
//   node test/merge.mjs
//
// Scenario reale: il coach cancella un dato sbagliato sul telefono, poi apre
// il tablet. Il tablet ha ancora la copia vecchia. Al primo salvataggio parte
// un merge. Senza tombstone, il dato cancellato torna indietro.
//
// Usa il mergeState REALE estratto da index.html, non una copia.
//
// Nota: gli oggetti creati dentro la sandbox hanno un prototipo diverso da
// quelli del test, quindi deepEqual di node:assert/strict fallisce anche su
// valori identici. I confronti su array usano join().

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
let src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));

const el = {
  addEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
  focus() {}, select() {}, click() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", checked: false,
};
const sandbox = {
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
              createElement: () => el, addEventListener() {}, body: el, documentElement: el, hidden: false },
  window: { addEventListener() {} }, navigator: { userAgent: "test" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "index.html:<script>" });

const { mergeState } = sandbox;
assert.equal(typeof mergeState, "function");

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* Stato di partenza, condiviso fra i due dispositivi. */
const base = () => ({
  teams: [{ id: "t1", name: "Prima squadra" }, { id: "t2", name: "Squadra da sciogliere" }],
  athletes: [{ id: "a1", name: "Marco", team: "t1" }],
  data: { a1: { cmj: [{ d: "2026-05-01", v: 41 }, { d: "2026-05-08", v: 55 }] } },
  readiness: { a1: [{ d: "2026-05-08", sl: 3, fa: 3 }] },
  load: { a1: [{ d: "2026-05-08", rpe: 8, min: 90 }] },
  lv: { a1: [{ d: "2026-05-08", exercise: "Squat", est1RM: 130 },
             { d: "2026-05-08", exercise: "Panca", est1RM: 90 }] },
  tomb: {},
});

/* Il telefono cancella; il server (tablet) ha ancora tutto. */
const telefono = () => {
  const s = base();
  const t = (k) => { s.tomb[k] = new Date().toISOString(); };
  s.teams = s.teams.filter(x => x.id !== "t2");        t("team:t2");
  s.data.a1.cmj = [s.data.a1.cmj[0]];                  t("m:a1:cmj:2026-05-08");
  delete s.readiness.a1;                               t("r:a1:2026-05-08");
  delete s.load.a1;                                    t("l:a1:2026-05-08");
  return s;
};

prova("una squadra cancellata non torna dal server", () => {
  const out = mergeState(base(), telefono());
  assert.equal(out.teams.map(t => t.id).join(","), "t1");
});

prova("una misurazione cancellata non torna dal server", () => {
  const out = mergeState(base(), telefono());
  assert.equal(out.data.a1.cmj.map(e => e.d).join(","), "2026-05-01",
    "il valore 55 del 08/05 era stato cancellato: non deve riapparire");
});

prova("un check-in readiness cancellato non torna dal server", () => {
  const out = mergeState(base(), telefono());
  assert.ok(!out.readiness.a1, "il check-in cancellato e' tornato indietro");
});

prova("una registrazione di carico cancellata non torna dal server", () => {
  const out = mergeState(base(), telefono());
  assert.ok(!out.load.a1, "il carico cancellato e' tornato indietro");
});

prova("cio' che NON e' stato cancellato viene conservato", () => {
  const out = mergeState(base(), telefono());
  assert.equal(out.athletes.length, 1);
  assert.equal(out.athletes[0].name, "Marco");
  assert.equal(out.data.a1.cmj[0].v, 41);
});

prova("due curve L-V nella stessa data non si annullano a vicenda", () => {
  const out = mergeState(base(), base());
  assert.equal(out.lv.a1.length, 2,
    "Squat e Panca sono nello stesso giorno: la chiave di merge deve includere l'esercizio");
  assert.equal(out.lv.a1.map(e => e.exercise).sort().join(","), "Panca,Squat");
});

prova("un dato nuovo sul server arriva sul telefono", () => {
  const srv = base();
  srv.data.a1.cmj.push({ d: "2026-05-15", v: 46 });
  const out = mergeState(srv, telefono());
  assert.equal(out.data.a1.cmj.map(e => e.d).join(","), "2026-05-01,2026-05-15",
    "il dato nuovo entra, quello cancellato resta fuori");
});

prova("a parita' di data vince il valore locale (correzione piu' recente)", () => {
  const loc = base();
  loc.data.a1.cmj[0].v = 42;   // corretto sul telefono
  const out = mergeState(base(), loc);
  assert.equal(out.data.a1.cmj.find(e => e.d === "2026-05-01").v, 42);
});

console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
