// Test della rete di sicurezza: le operazioni distruttive sono annullabili?
//
//   node test/annulla.mjs
//
// Esegue davvero il codice dell'app in un DOM finto, con un localStorage
// funzionante: cancella, importa, svuota — e verifica che dopo il ripristino
// i dati siano tornati identici. Non controlla che il codice ci sia:
// controlla che funzioni.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));

/* localStorage vero (in memoria), perche' e' dove vivono le copie */
const mem = new Map();
const el = {
  addEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
  focus() {}, select() {}, click() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", checked: false, type: "text",
};
const sandbox = {
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
              createElement: () => el, addEventListener() {}, body: el, documentElement: el, hidden: false },
  window: { addEventListener() {}, print() {} }, navigator: { userAgent: "test" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); },
  },
  fetch: () => Promise.reject(new Error("no")),
  confirm: () => true,          // l'utente conferma sempre
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (code) => vm.runInContext(code, sandbox, { filename: "test" });

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* Una stagione di lavoro: 3 atleti, misure, check-in, carichi, anamnesi */
const stagionePulita = `
  S = {athletes:[
        {id:"a1",name:"Giorgia Bocchi",sex:"F",team:"t1",profile:{birth:"2010-03-04",consent:true,consentDate:"2026-09-01"}},
        {id:"a2",name:"Ilaria Ruberto",sex:"F",team:"t1",profile:{}},
        {id:"a3",name:"Marta Camagna",sex:"F",team:"t1",profile:{}}],
      teams:[{id:"t1",name:"Young Volley",sport:"pallavolo"}],
      data:{a1:{cmj:[{d:"2026-09-10",v:28},{d:"2026-11-12",v:31},{d:"2027-01-14",v:33}]},
            a2:{cmj:[{d:"2026-09-10",v:30}]}},
      readiness:{a1:[{d:"2026-11-12",sl:4,so:4,fa:3,st:4}]},
      load:{a1:[{d:"2026-11-12",rpe:7,min:90}]},
      screen:{}, lv:{}, tomb:{}};
  normalize(); localStorage.setItem("ip_snapshots","[]");`;

const impronta = () => run(`JSON.stringify({
  atleti:S.athletes.map(a=>a.name).sort(),
  cmj:(S.data.a1&&S.data.a1.cmj||[]).map(e=>e.d+":"+e.v),
  readiness:Object.keys(S.readiness||{}).length,
  squadre:(S.teams||[]).map(t=>t.name)
})`);

prova("eliminare un'atleta è annullabile", () => {
  run(stagionePulita);
  const prima = impronta();
  run(`delAthlete("a1")`);
  assert.equal(run("S.athletes.length"), 2, "l'eliminazione non è avvenuta");
  assert.ok(run("snapshots().length") >= 1, "nessuna copia salvata prima di eliminare");
  run(`restoreSnapshot(0)`);
  assert.equal(impronta(), prima, "dopo il ripristino i dati non sono identici");
});

prova("svuotare tutto è annullabile", () => {
  run(stagionePulita);
  const prima = impronta();
  run(`wipe()`);
  assert.equal(run("S.athletes.length"), 0, "lo svuotamento non è avvenuto");
  run(`restoreSnapshot(0)`);
  assert.equal(impronta(), prima, "la stagione non è tornata");
});

prova("caricare i dati di esempio è annullabile", () => {
  run(stagionePulita);
  const prima = impronta();
  run(`loadDemo()`);
  assert.ok(run(`S.athletes.some(a=>a.name==="Marco Bianchi")`), "i dati di esempio non sono entrati");
  run(`restoreSnapshot(0)`);
  assert.equal(impronta(), prima, "le atlete vere non sono tornate");
});

prova("eliminare una squadra è annullabile", () => {
  run(stagionePulita);
  const prima = impronta();
  run(`delTeam("t1")`);
  assert.equal(run("S.teams.length"), 0);
  run(`restoreSnapshot(0)`);
  assert.equal(impronta(), prima);
});

prova("anche il ripristino è annullabile", () => {
  run(stagionePulita);
  const conStagione = impronta();
  run(`wipe()`);
  run(`restoreSnapshot(0)`);          // torno alla stagione
  assert.equal(impronta(), conStagione);
  run(`restoreSnapshot(0)`);          // annullo il ripristino: torno a vuoto
  assert.equal(run("S.athletes.length"), 0, "il ripristino non era a sua volta annullabile");
});

prova("si conservano più copie, la più recente per prima", () => {
  run(stagionePulita);
  run(`delAthlete("a3")`);
  run(`delAthlete("a2")`);
  const l = JSON.parse(run("JSON.stringify(snapshots())"));
  assert.ok(l.length >= 2, "solo " + l.length + " copie");
  assert.match(l[0].label, /Ilaria/, "la copia più recente non è in cima");
  assert.match(l[1].label, /Marta/);
});

prova("non si accumulano copie all'infinito", () => {
  run(stagionePulita);
  for (let i = 0; i < 6; i++) run(`snapshotBeforeRisk("prova ${i}")`);
  assert.ok(run("snapshots().length") <= 3, "le copie crescono senza limite");
});

prova("l'informativa privacy sopravvive allo svuotamento", () => {
  run(stagionePulita);
  run(`S.policy={version:2,updatedAt:"2026-08-20",titolare:"Federico Rizzo",email:"a@b.it",conservazione:"5 anni"}; save();`);
  run(`wipe()`);
  assert.equal(run("S.policy && S.policy.version"), 2,
    "svuotare i dati cancellava anche l'informativa, e il modulo anamnesi si sarebbe bloccato");
});

console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
