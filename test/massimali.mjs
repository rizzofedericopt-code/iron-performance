// Un massimale, una colonna: le stime da xRM→1RM finiscono nella colonna
// del loro esercizio (1RM Squat, 1RM Stacco…), e la forza relativa le segue.
//
//   node test/massimali.mjs
//
// Perche' questo test esiste. Da xRM→1RM si poteva creare una colonna
// «Squat» separata da «1RM Squat». Risultato: il massimale dello squat stava in
// due posti, la forza relativa e i gruppi di carico ne leggevano uno solo, e
// l'altro invecchiava senza che nessuno se ne accorgesse.

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
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo",tests:["rmSquat","rmSquatRel","pred"],pin:[]}];
  S.activeTeam="t1"; S.pres={}; S.tomb={}; S.te={}; S.gruppi={}; S.sedute={}; S.custom=[];
  S.athletes=[{id:"a1",name:"Sara",sex:"F",team:"t1",profile:{}}];
  S.data={a1:{bw:[{d:"2026-10-01",v:56}]}};
  applyCustom();
}`);

console.log("\nUn massimale, una colonna");

prova("i nomi degli esercizi standard si riconoscono", () => {
  assert.equal(run(`rmStdPerNome("Squat")`), "rmSquat");
  assert.equal(run(`rmStdPerNome("back squat")`), "rmSquat");
  assert.equal(run(`rmStdPerNome("Stacco da terra")`), "rmDead");
  assert.equal(run(`rmStdPerNome("Panca piana")`), "rmBench");
  assert.equal(run(`rmStdPerNome("Box squat")`), "rmBox");
  assert.equal(run(`rmStdPerNome("Hip Thrust")`), "rmHip");
  assert.equal(run(`rmStdPerNome("Military press")`), "rmOhp");
  assert.equal(run(`rmStdPerNome("Front squat")`), "rmFront", "il front squat ha la sua colonna, non quella del back squat");
  assert.equal(run(`rmStdPerNome("Stacco rumeno")`), null);
  assert.equal(run(`rmStdPerNome("Leg press")`), null);
  assert.equal(run(`rmStdPerNome("Trazioni")`), null, "trazioni: colonna a carico totale, una «Trazioni» tua puo' essere la sola zavorra");
});

prova("creare «Squat» da xRM→1RM porta alla colonna 1RM Squat, non a una nuova", () => {
  squadra();
  assert.equal(run(`customAdd("Squat","pred","kg")`), "rmSquat");
  assert.equal(run(`S.custom.length`), 0);
  assert.notEqual(run(`customAdd("Leg press","pred","kg")`), null);
  assert.equal(run(`S.custom.length`), 1, "un esercizio che non ha colonna la ottiene");
});

prova("una colonna «Squat» che c'era già confluisce in 1RM Squat, con tutto", () => {
  squadra();
  run(`S.custom=[{id:"uSq",name:"Squat",unit:"kg",base:"pred"}];
       S.data.a1.uSq=[{d:"2026-09-01",v:70,fonte:"reps",rmW:60,rmR:5,rmRir:1},{d:"2026-10-01",v:75,fonte:"reps"}];
       S.data.a1.rmSquat=[{d:"2026-08-01",v:68}];
       S.teams[0].tests.push("uSq"); S.teams[0].pin=["uSq"];
       S.gruppi={"uSq@t1":{d:"2026-10-01",g:[["a1"]],x:[{nota:"n"}]}};
       S.sedute={t1:{ex:[{t:"uSq",pct:75,sr:"4×5",mode:"media"}],rif:"uSq",size:3}};
       S.te={uSq:2.5};
       normalize();`);
  assert.deepEqual(j(`S.data.a1.rmSquat.map(e=>e.v)`), [68, 70, 75], "le stime entrano nella colonna giusta, in ordine");
  assert.equal(run(`S.data.a1.rmSquat[1].fonte`), "reps", "e restano marcate come stime");
  assert.equal(run(`S.data.a1.rmSquat[1].rmR`), 5, "con la loro storia");
  assert.ok(!run(`S.data.a1.uSq`), "la colonna doppia sparisce");
  assert.ok(!run(`S.custom.some(c=>c.id==="uSq")`));
  assert.ok(j(`S.teams[0].tests`).indexOf("uSq") < 0 && j(`S.teams[0].tests`).indexOf("rmSquat") >= 0);
  assert.deepEqual(j(`S.teams[0].pin`), ["rmSquat"]);
  assert.ok(run(`!!S.gruppi["rmSquat@t1"]`) && run(`S.gruppi["rmSquat@t1"].x[0].nota`) === "n", "i gruppi la seguono");
  assert.equal(run(`S.sedute.t1.ex[0].t`), "rmSquat");
  assert.equal(run(`S.sedute.t1.rif`), "rmSquat");
  assert.equal(run(`S.te.rmSquat`), 2.5);
});

prova("nello stesso giorno, una misura vera batte una stima", () => {
  squadra();
  run(`S.custom=[{id:"uSq",name:"Squat",unit:"kg",base:"pred"}];
       S.data.a1.uSq=[{d:"2026-10-01",v:75,fonte:"reps"},{d:"2026-10-05",v:80}];
       S.data.a1.rmSquat=[{d:"2026-10-01",v:72},{d:"2026-10-05",v:78,fonte:"reps"}];
       normalize();`);
  const s = j(`S.data.a1.rmSquat`);
  assert.equal(s.find(e => e.d === "2026-10-01").v, 72, "la misura vera resta");
  assert.equal(s.find(e => e.d === "2026-10-05").v, 80, "la misura vera sostituisce la stima");
});

prova("la forza relativa segue la stima arrivata da xRM→1RM", () => {
  squadra();
  run(`S.custom=[{id:"uSq",name:"Squat",unit:"kg",base:"pred"}];
       S.data.a1.uSq=[{d:"2026-10-01",v:84,fonte:"reps"}]; normalize();`);
  const r = j(`series("a1","rmSquatRel")`);
  assert.equal(r.length, 1);
  assert.equal(r[0].v, 1.5);
});

prova("un'unione rifatta non duplica niente (due dispositivi)", () => {
  squadra();
  run(`S.custom=[{id:"uSq",name:"Squat",unit:"kg",base:"pred"}];
       S.data.a1.uSq=[{d:"2026-10-01",v:75,fonte:"reps"}]; normalize();
       S.custom.push({id:"uSq",name:"Squat",unit:"kg",base:"pred"}); S.data.a1.uSq=[{d:"2026-10-01",v:75,fonte:"reps"}];
       normalize();`);
  assert.equal(run(`S.data.a1.rmSquat.length`), 1);
});

prova("dal selettore di xRM→1RM si sceglie anche 1RM Squat", () => {
  squadra();
  const ops = j(`xrmScelte().map(x=>x.id)`);
  ["rmSquat","rmFront","rmDead","rmBench","rmBox","rmHip","rmOhp","rmPull"].forEach(t => assert.ok(ops.indexOf(t) >= 0, "manca " + t));
  assert.equal(ops[0], "pred", "«senza esercizio» resta la prima");
});

prova("scegliendo 1RM Squat dal selettore si apre la stima da ripetizioni", () => {
  squadra();
  run(`CUR={a:"a1",t:"pred",mode:"reps"}; cellEx("rmSquat");`);
  assert.equal(run(`CUR.t`), "rmSquat");
  assert.equal(run(`CUR.mode`), "reps");
});

prova("forza relativa per tutti i massimali con una colonna", () => {
  ["rmSquat","rmFront","rmBox","rmBench","rmDead","rmHip","rmOhp","rmPull"].forEach(t => {
    assert.ok(run(`TESTS.some(x=>x.rel==="${t}")`), "manca la forza relativa di " + t);
  });
});

prova("le stime «senza esercizio» si spostano a mano nella colonna giusta", () => {
  squadra();
  run(`S.athletes.push({id:"z1",name:"Altra squadra",sex:"F",team:"t9",profile:{}});
       S.data.a1.pred=[{d:"2026-10-01",v:84,fonte:"reps"}]; S.data.z1={pred:[{d:"2026-10-01",v:100}]};
       S.data.a1.rmSquat=[{d:"2026-09-01",v:80}];`);
  const n = run(`colonnaSposta("pred","rmSquat")`);
  assert.equal(n, 1, "solo le atlete di questa squadra");
  assert.deepEqual(j(`S.data.a1.rmSquat.map(e=>e.v)`), [80, 84]);
  assert.ok(!run(`S.data.a1.pred`));
  assert.ok(run(`!!S.data.z1.pred`), "quelle dell'altra squadra non si toccano");
  assert.equal(j(`series("a1","rmSquatRel")`).slice(-1)[0].v, 1.5);
});

prova("una colonna tua con un nome qualunque si unisce a mano", () => {
  squadra();
  run(`S.custom=[{id:"uX",name:"Squat profondo",unit:"kg",base:"pred"}]; applyCustom();
       S.data.a1.uX=[{d:"2026-10-01",v:70,fonte:"reps"}];`);
  assert.equal(run(`rmStdPerNome("Squat profondo")`), null, "da solo non si riconosce");
  run(`colonnaSposta("uX","rmSquat")`);
  assert.deepEqual(j(`S.data.a1.rmSquat.map(e=>e.v)`), [70]);
  assert.ok(!run(`S.custom.length`), "e la colonna sparisce");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
