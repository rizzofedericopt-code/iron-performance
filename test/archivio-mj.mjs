// Archivio My Jump: ogni salto con tutti i suoi numeri, tenuto nel tempo.
//
//   node test/archivio-mj.mjs
//
// Perche' questo test esiste. L'archivio e' un dato nuovo nello stato, e il
// difetto piu' ripetuto del progetto e' il dato nuovo che il ripristino o la
// sincronizzazione buttano via. In piu':
//   1. un salto «a zero» (non elaborato in My Jump) non deve entrare: e' un
//      record falso che resta per sempre
//   2. altezza e tempo di volo sono LO STESSO dato: se non tornano, uno dei due
//      e' stato copiato male — va detto prima di salvare
//   3. la colonna CMJ prende il migliore del giorno, non l'ultimo digitato

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
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}]; S.activeTeam="t1";
  S.athletes=[{id:"a1",name:"Sara",sex:"F",team:"t1",profile:{}},{id:"a2",name:"Giulia",sex:"F",team:"t1",profile:{}}];
  S.data={}; S.mjl={}; S.tomb={}; S.pres={};
}`);
// 32 cm ↔ tempo di volo: t = sqrt(8h/g)
const tv = (cm) => Math.round(Math.sqrt(8 * cm / 100 / 9.81) * 1000);

console.log("\nArchivio My Jump");

prova("un salto si salva con tutti i suoi numeri", () => {
  squadra();
  const r = j(`mjSalva("a1","2026-10-01","CMJ",{h:32,tv:${tv(32)},F:1100,Frel:19.6,P:1500,Prel:26.8,vm:1.25,v0:2.5,imp:140})`);
  assert.equal(r.ok, true);
  const e = j(`S.mjl.a1[0]`);
  assert.equal(e.d, "2026-10-01"); assert.equal(e.tipo, "CMJ");
  assert.equal(e.m.h, 32); assert.equal(e.m.Prel, 26.8); assert.equal(e.m.imp, 140);
});

prova("un salto a zero non entra: è un salto non elaborato", () => {
  squadra();
  const r = j(`mjSalva("a1","2026-10-01","CMJ",{h:0,tv:0,F:0})`);
  assert.equal(r.ok, false);
  assert.ok(/non elaborato|zero/i.test(r.msg));
  assert.ok(!run(`(S.mjl.a1||[]).length`));
});

prova("altezza e tempo di volo che non tornano vengono segnalati", () => {
  assert.deepEqual(j(`mjCoerenza({h:32,tv:${tv(32)}})`), []);
  const w = j(`mjCoerenza({h:32,tv:400})`);
  assert.ok(w.length && /tempo di volo/i.test(w[0]), "32 cm vogliono circa " + tv(32) + " ms, non 400");
  assert.ok(j(`mjCoerenza({h:32,v0:3.5})`).length, "anche la velocita' di decollo e' l'altezza");
});

prova("la colonna CMJ prende il migliore del giorno", () => {
  squadra();
  run(`mjSalva("a1","2026-10-01","CMJ",{h:31}); mjSalva("a1","2026-10-01","CMJ",{h:33.5}); mjSalva("a1","2026-10-01","CMJ",{h:32});`);
  assert.equal(run(`S.mjl.a1.length`), 3, "tre prove nell'archivio");
  assert.deepEqual(j(`S.data.a1.cmj`), [{d:"2026-10-01", v:33.5, fonte:"mjl"}]);
});

prova("una misura scritta a mano più alta non viene abbassata", () => {
  squadra();
  run(`S.data.a1={cmj:[{d:"2026-10-01",v:35}]}; mjSalva("a1","2026-10-01","CMJ",{h:33});`);
  assert.equal(run(`S.data.a1.cmj[0].v`), 35);
});

prova("SJ e Abalakov vanno nelle loro colonne; senza spunta nessuna colonna", () => {
  squadra();
  run(`mjSalva("a1","2026-10-01","SJ",{h:28}); mjSalva("a1","2026-10-01","Abalakov",{h:38}); mjSalva("a2","2026-10-01","CMJ",{h:30},{colonna:false});`);
  assert.equal(run(`S.data.a1.sj[0].v`), 28);
  assert.equal(run(`S.data.a1.cmjA[0].v`), 38);
  assert.ok(!run(`(S.data.a2||{}).cmj`), "chi non vuole la colonna non la tocca");
});

prova("la tabella mostra il migliore di ogni giorno, per metrica", () => {
  squadra();
  run(`mjSalva("a1","2026-09-01","CMJ",{h:30,Prel:25}); mjSalva("a1","2026-10-01","CMJ",{h:31,Prel:26}); mjSalva("a1","2026-10-01","CMJ",{h:33,Prel:27.5});`);
  const r = j(`mjRighe("CMJ","Prel")`).find(x => x.id === "a1");
  assert.equal(r.ultimo.v, 27.5, "il salto migliore del giorno, e la sua potenza");
  assert.equal(r.prima.v, 25);
  assert.equal(r.n, 3);
});

prova("cancellare un salto lo toglie e la colonna si riallinea", () => {
  squadra();
  run(`mjSalva("a1","2026-10-01","CMJ",{h:31}); mjSalva("a1","2026-10-01","CMJ",{h:34});`);
  const k = run(`S.mjl.a1.find(e=>e.m.h===34).exercise`);
  run(`mjTogli("a1","2026-10-01","${k}")`);
  assert.equal(run(`S.mjl.a1.length`), 1);
  assert.equal(run(`S.data.a1.cmj[0].v`), 31, "il migliore del giorno ora e' 31");
  assert.ok(run(`!!S.tomb["j:a1:2026-10-01|${k}"]`), "e non torna dal server");
});

prova("CSV: tutte le colonne numeriche finiscono nell'archivio", () => {
  squadra();
  const n = run(`mjDaCSV(["Atleta","Data","Test","Altezza (cm)","Tempo di volo (ms)","Potenza relativa (W/kg)","Colonna strana"],
    [["Sara","01/10/2026","CMJ","0,32","${tv(32)}","26,8","7"],["Sara","01/10/2026","CMJ","0,32","${tv(32)}","26,8","7"]], 0, 1)`);
  assert.equal(n, 1, "la stessa riga due volte e' un salto solo");
  const e = j(`S.mjl.a1[0]`);
  assert.equal(e.m.h, 32, "0,32 m → 32 cm");
  assert.equal(e.m.Prel, 26.8);
  assert.equal(e.m.tv, tv(32));
  assert.equal(e.m.x_colonna_strana, 7, "una colonna sconosciuta si tiene, col suo nome");
  assert.equal(e.tipo, "CMJ");
});

prova("l'esportazione CSV contiene tutto", () => {
  squadra();
  run(`mjSalva("a1","2026-10-01","CMJ",{h:32,Prel:26.8})`);
  const c = run(`mjCSV()`);
  assert.ok(/Atleta;Data;Tipo;Prova/.test(c) && /Sara;2026-10-01;CMJ;1/.test(c) && /26,8/.test(c));
});

prova("backup, sincronizzazione e cancellazione dell'atleta", () => {
  squadra();
  run(`mjSalva("a1","2026-10-01","CMJ",{h:32,Prel:26.8,x_altro:3})`);
  const o = j(`sanitizeImport(JSON.parse(JSON.stringify(S)))`);
  assert.equal(o.mjl.a1[0].m.Prel, 26.8, "PERSO al ripristino");
  assert.equal(o.mjl.a1[0].m.x_altro, 3);
  const m = j(`mergeState({athletes:S.athletes,data:{},mjl:{a1:[{d:"2026-09-01",exercise:"CMJ#1",tipo:"CMJ",m:{h:30}}]}}, S)`);
  assert.equal(m.mjl.a1.length, 2, "due dispositivi: i salti di tutti e due");
  run(`delAthlete("a1")`);
  assert.ok(!run(`S.mjl.a1`), "un'atleta cancellata porta via il suo archivio");
});

prova("la vista My Jump c'è", () => {
  squadra();
  run(`mjSalva("a1","2026-10-01","CMJ",{h:32})`);
  assert.ok(run(`TABS.some(t=>t.v==="mj")`));
  run(`globalThis.requestAnimationFrame=function(){}; S.view="mj"; renderMJ();`);
  assert.ok(/Sara/.test(run(`document.getElementById("grid").innerHTML`)));
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
