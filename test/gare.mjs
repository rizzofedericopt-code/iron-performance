// Pagina Gare e carico di gara.
//
//   node test/gare.mjs
//
// Il carico era una voce per atleta al giorno: allenamento al mattino e
// partita la sera si sovrascrivevano. Ora la partita è una voce sua
// (exercise:"gara") accanto all'allenamento, e queste prove controllano che
// le due non si mangino a vicenda in nessun punto: salvataggio, settimana,
// unione fra dispositivi, cancellazioni, import.

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
// righe finte dei moduli: {aid, v:{chiave:valore}}
let RIGHE = [];
const riga = (r, chiavi) => ({
  getAttribute: (k) => (k === "data-a" ? r.aid : null),
  querySelector: () => ({ value: r.v.rpe == null ? "" : String(r.v.rpe) }),
  querySelectorAll: () => chiavi.map((k) => ({ value: r.v[k] == null ? "" : String(r.v[k]), getAttribute: () => k })),
});
const sandbox = {
  document: {
    getElementById: (id) => (cache[id] ||= elFor(id)),
    querySelector: () => elFor("__q"),
    querySelectorAll: (q) => q === ".gv-ci" ? RIGHE.map((r) => riga(r, ["set", "rpe"]))
                          : q === ".ci-row" ? RIGHE.map((r) => riga(r, ["rpe"])) : [],
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
const j = (c) => { const r = run("JSON.stringify(" + c + ")"); return r === undefined ? undefined : JSON.parse(r); };
run(`normalize();`);
run(`var LASTT=""; render=function(){}; save=function(){}; closeM=function(){}; toast=function(m){LASTT=String(m)};`);

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};
const D = "2026-10-24";
const squadra = () => run(`{ S.athletes=[{id:"a1",name:"Sara",team:"t1"},{id:"a2",name:"Giulia",team:"t1"},{id:"a3",name:"Marta",team:"t1"}];
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}]; S.activeTeam="t1"; S.load={}; S.salti={}; S.pres={}; S.tomb={};
  S.gare={t1:[{d:"${D}",avv:"Volley Rossi",casa:false}]}; GV={d:null}; }`);
const campo = (id, v) => run(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(String(v))}`);
const salvaGara = (righe, dur = 90, set = 3) => { RIGHE = righe; campo("gvDur", dur); campo("gvSet", set); run(`document.getElementById("gvErr").textContent=""; garaSalva("${D}")`); };

console.log("\nCarico di gara accanto all'allenamento");

prova("allenamento e partita nello stesso giorno restano tutti e due", () => {
  squadra();
  run(`S.load={a1:[{d:"${D}",rpe:4,min:60}]}`);
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }]);
  const l = j(`S.load.a1`);
  assert.equal(l.length, 2, JSON.stringify(l));
  assert.ok(l.some((e) => !e.exercise && e.rpe === 4), "l'allenamento non deve sparire");
  assert.ok(l.some((e) => e.exercise === "gara" && e.rpe === 8 && e.min === 90 && e.set === 3));
  // e il contrario: risalvare l'allenamento non tocca la gara
  RIGHE = [{ aid: "a1", v: { rpe: 5 } }]; campo("ldD", D); campo("ldMin", 60); run(`saveLoad()`);
  const l2 = j(`S.load.a1`);
  assert.equal(l2.length, 2);
  assert.equal(l2.find((e) => e.exercise === "gara").rpe, 8);
  assert.equal(l2.find((e) => !e.exercise).rpe, 5);
});

prova("segnare l'allenamento dopo la partita non riscrive la partita", () => {
  squadra();
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }]);           // prima la gara: è la prima voce del giorno
  RIGHE = [{ aid: "a1", v: { rpe: 3 } }]; campo("ldD", D); campo("ldMin", 45); run(`saveLoad()`);
  const l = j(`S.load.a1`);
  assert.equal(l.length, 2, JSON.stringify(l));
  assert.equal(l.find((e) => e.exercise === "gara").rpe, 8);
});

prova("la settimana conta allenamento e partita", () => {
  squadra();
  run(`S.load={a1:[{d:todayISO(),rpe:4,min:60},{d:todayISO(),exercise:"gara",rpe:8,min:90,set:3}]}`);
  assert.equal(j(`caricoSett("a1").sett`), 240 + 720);
});

prova("i minuti di chi ha giocato meno sono in proporzione ai set", () => {
  squadra();
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }, { aid: "a2", v: { set: 1, rpe: 5 } }, { aid: "a3", v: { set: 0, rpe: 2 } }], 90, 3);
  assert.equal(j(`garaCarico("a2","${D}").min`), 30);
  assert.equal(j(`garaCarico("a3","${D}").min`), 0, "in panchina tutta la partita: niente minuti di gioco");
  assert.equal(j(`garaDi("${D}").durata`), 90);
  assert.equal(j(`garaDi("${D}").setTot`), 3);
});

prova("i set senza RPE non si salvano, e lo dice", () => {
  squadra();
  salvaGara([{ aid: "a1", v: { set: 3 } }]);
  assert.equal(j(`garaCarico("a1","${D}")`), null);
  assert.match(run(`document.getElementById("gvErr").textContent`), /Manca l'RPE per: Sara/);
});

prova("senza la durata della partita il carico non si calcola", () => {
  squadra();
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }], "", 3);
  assert.equal(j(`garaCarico("a1","${D}")`), null);
  assert.match(run(`document.getElementById("gvErr").textContent`), /durata/);
});

prova("più set della partita non si possono avere", () => {
  squadra();
  salvaGara([{ aid: "a1", v: { set: 5, rpe: 8 } }], 90, 3);
  assert.equal(j(`garaCarico("a1","${D}")`), null);
});

prova("chi non ha risposto non riceve niente", () => {
  squadra();
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }, { aid: "a2", v: {} }]);
  assert.equal(j(`garaCarico("a2","${D}")`), null);
  assert.equal(run(`S.load.a2===undefined`), true);
});

prova("svuotare una riga toglie il carico di gara, e solo quello", () => {
  squadra();
  run(`S.load={a1:[{d:"${D}",rpe:4,min:60}]}`);
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }]);
  salvaGara([{ aid: "a1", v: {} }]);
  const l = j(`S.load.a1`);
  assert.equal(l.length, 1); assert.ok(!l[0].exercise);
  assert.ok(run(`!!S.tomb["l:a1:${D}|gara"]`), "la cancellazione deve arrivare agli altri dispositivi");
  assert.ok(!run(`!!S.tomb["l:a1:${D}"]`), "e non deve cancellare l'allenamento sugli altri");
});

prova("cancellare la gara dallo storico lascia l'allenamento sugli altri dispositivi", () => {
  squadra();
  run(`S.load={a1:[{d:"${D}",rpe:4,min:60},{d:"${D}",exercise:"gara",rpe:8,min:90}]}; openReadinessHistory=function(){};`);
  run(`delLoad("a1",1)`);
  assert.ok(run(`!!S.tomb["l:a1:${D}|gara"]`));
  assert.ok(!run(`!!S.tomb["l:a1:${D}"]`));
});

prova("unione fra due dispositivi: allenamento da uno, gara dall'altro", () => {
  squadra();
  const out = j(`mergeState(
    {athletes:S.athletes, teams:S.teams, load:{a1:[{d:"${D}",rpe:4,min:60}]}, tomb:{}},
    {athletes:S.athletes, teams:S.teams, load:{a1:[{d:"${D}",exercise:"gara",rpe:8,min:90,set:3}]}, tomb:{}})`);
  assert.equal(out.load.a1.length, 2, JSON.stringify(out.load.a1));
});

prova("l'import di un backup tiene la gara e i set, e nient'altro di inventato", () => {
  squadra();
  const o = j(`sanitizeImport({athletes:[{id:"a1",name:"Sara",team:"t1"}], teams:[{id:"t1",name:"U18"}], data:{},
    load:{a1:[{d:"${D}",rpe:4,min:60},{d:"${D}",exercise:"gara",rpe:8,min:90,set:3},{d:"${D}",exercise:"<b>",rpe:1,min:1,set:9}]},
    gare:{t1:[{d:"${D}",avv:"Rossi",casa:false,durata:90,setTot:3,risultato:"3-0"}]}})`);
  const l = o.load.a1;
  assert.ok(l.some((e) => e.exercise === "gara" && e.set === 3));
  assert.ok(!l.some((e) => e.exercise && e.exercise !== "gara"), "un'etichetta sconosciuta non passa");
  assert.ok(!l.some((e) => e.set === 9));
  assert.equal(o.gare.t1[0].durata, 90); assert.equal(o.gare.t1[0].setTot, 3);
  assert.equal(o.gare.t1[0].risultato, undefined, "campi che non conosciamo non entrano");
});

prova("rimettere la stessa gara nel calendario non perde durata e set", () => {
  squadra();
  run(`S.gare.t1[0].durata=90; S.gare.t1[0].setTot=3; openGare=function(){};`);
  campo("gD", D); campo("gA", "Volley Rossi"); campo("gC", "casa");
  run(`garaAggiungi()`);
  const g = j(`garaDi("${D}")`);
  assert.equal(g.durata, 90); assert.equal(g.casa, true);
});

console.log("\nCarico dell'allenamento");

prova("il modulo del carico parte vuoto e non copia l'ultima seduta", () => {
  squadra();
  run(`S.load={a1:[{d:"2026-10-01",rpe:7,min:90}]}; openLoad()`);
  const h = run(`document.getElementById("modal").innerHTML`);
  assert.ok(!/<option value="7" selected>/.test(h), "l'RPE di un altro giorno non è quello di oggi");
  assert.ok(!/<option value="5" selected>/.test(h), "niente 5 di default");
  RIGHE = [{ aid: "a1", v: { rpe: 6 } }, { aid: "a2", v: {} }]; campo("ldD", D); campo("ldMin", 60);
  run(`saveLoad()`);
  assert.equal(run(`S.load.a2===undefined`), true, "Giulia non ha risposto: niente carico inventato");
  assert.equal(j(`S.load.a1.length`), 2);
});

console.log("\nPagina Gare");

prova("l'elenco dice cosa manca a ogni partita giocata", () => {
  squadra();
  run(`renderGare()`);
  let h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /vs Volley Rossi/); assert.match(h, /carico da segnare/);
  salvaGara([{ aid: "a1", v: { set: 3, rpe: 8 } }]);
  run(`S.salti={a1:[{d:"${D}",exercise:"v1",n:40,att:12,muro:20,batt:8}]}; renderGare()`);
  h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /carico 1\/3/); assert.match(h, /40 salti/);
});

prova("la scheda della gara mostra righe, salti e lo scout che non c'è ancora", () => {
  squadra();
  run(`S.salti={a2:[{d:"${D}",exercise:"v1",n:35,att:10,muro:18,batt:7}]}; GV.d="${D}"; renderGare()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /Chi ha giocato e quanto/);
  assert.equal((h.match(/class="ci-row gv-ci/g) || []).length, 3);
  assert.match(h, /Giulia<\/td><td><b>35/);
  assert.match(h, /Non ancora importato/); assert.match(h, /scoutScegli\(/);
});

prova("«conta i salti» apre il video con la data e il nome della partita", () => {
  squadra();
  run(`openVideo=function(){}; garaVideo("${D}")`);
  const r = j(`vidNuovoRec({name:"x.mp4"})`);
  assert.equal(r.data, D); assert.equal(r.seduta, "Partita vs Volley Rossi");
  assert.equal(j(`vidNuovoRec({name:"y.mp4"})`).data, run(`todayISO()`), "il preset vale una volta sola");
});

console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
