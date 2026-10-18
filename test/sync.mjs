// Lo stato della sincronizzazione, a parole.
//
//   node test/sync.mjs
//
// Il 18 ottobre 2026 i dati «erano spariti»: non erano ancora arrivati al
// server, e l'unico segnale era un pallino colorato. Cosa deve essere vero:
//   1. ogni modifica conta come «da inviare» finche' il server non la conferma
//   2. un invio riuscito azzera il conto; uno a meta' (modifiche durante il
//      volo) no
//   3. senza rete, sessione scaduta, dati troppo grandi: la frase lo dice
//   4. memoria piena: si sacrificano prima le copie di «Annulla», poi si avvisa
//   5. il conto sopravvive a una ricarica della pagina
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
run(`var LASTT=""; render=function(){}; toast=function(m){LASTT=String(m)}; triggerCloud=function(){}; bkTocca=function(){};`);
run(`S={athletes:[{id:"a1",name:"Sara"}],data:{a1:{cmj:[{d:"2026-10-01",v:30}]}}}; normalize(); AUTH={email:"x",token:"t"};`);

let failed = 0;
const seq = [];
const prova = (nome, fn) => seq.push([nome, fn]);
const testo = () => run(`document.getElementById("syncTxt").textContent`);
const colore = () => run(`document.getElementById("syncTxt").className`);
const flush = () => new Promise(r => setImmediate(r));

console.log("\nSincronizzazione a parole");

prova("tutto a posto: sotto il logo resta il nome", async () => {
  run(`document.getElementById("syncTxt").textContent="@federizzo_trainer"; SYNC.pend=0; SYNC.motivo=""; S._dirty=false; setSync("ok")`);
  assert.equal(testo(), "@federizzo_trainer");
  assert.equal(colore(), "");
});

prova("ogni modifica conta come da inviare", async () => {
  run(`save(); save(); save();`);
  assert.equal(run(`SYNC.pend`), 3);
  assert.match(testo(), /3 da inviare/);
  assert.equal(colore(), "sw");
});

prova("invio riuscito: il conto si azzera e si annota l'ora", async () => {
  run(`apiCall=function(){ return Promise.resolve({version:5}); }; _saving=false; cloudSave();`);
  await flush(); await flush();
  assert.equal(run(`SYNC.pend`), 0);
  assert.ok(run(`!!SYNC.okAt`));
  assert.equal(testo(), "@federizzo_trainer");
});

prova("modifiche durante l'invio: non sono al sicuro, il conto resta", async () => {
  run(`var RIS; apiCall=function(){ return new Promise(r=>{ RIS=r; }); }; save(); _saving=false; cloudSave(); save(); save();`);
  run(`RIS({version:6})`);
  await flush(); await flush();
  assert.equal(run(`SYNC.pend`), 2);
  assert.match(testo(), /invio di 2|2 da inviare/);
});

prova("senza rete: lo dice in rosso", async () => {
  run(`setTimeout=function(){ return 1; }; apiCall=function(){ const e=new Error("rete"); return Promise.reject(e); }; _saving=false; _retryMs=0; save(); cloudSave();`);
  await flush(); await flush();
  assert.equal(run(`SYNC.motivo`), "rete");
  assert.match(testo(), /non inviate/);
  assert.equal(colore(), "sx");
});

prova("sessione scaduta: dice di rientrare", async () => {
  run(`showLogin=function(){}; apiCall=function(){ const e=new Error("x"); e.status=401; return Promise.reject(e); }; _saving=false; save(); cloudSave();`);
  await flush(); await flush();
  assert.match(testo(), /rientra/);
});

prova("dati troppo grandi: lo dice, e lo dice anche il dettaglio", async () => {
  run(`apiCall=function(){ const e=new Error("x"); e.status=413; return Promise.reject(e); }; _saving=false; save(); cloudSave();`);
  await flush(); await flush();
  assert.match(testo(), /troppo grandi/);
  run(`var MOD=""; modal=function(h){ MOD=h; }; openSync();`);
  const h = run(`MOD`);
  assert.match(h, /rifiuta i dati/);
  assert.match(h, /Test e misure/);
  assert.match(h, /Spazio sul server/);
});

prova("dopo un invio riuscito torna tutto a posto, anche dopo un errore", async () => {
  run(`apiCall=function(){ return Promise.resolve({version:9}); }; _saving=false; cloudSave();`);
  await flush(); await flush();
  assert.equal(run(`SYNC.motivo`), "");
  assert.equal(testo(), "@federizzo_trainer");
  run(`var MOD=""; modal=function(h){ MOD=h; }; openSync();`);
  assert.match(run(`MOD`), /Tutto è sul server/);
});

prova("il conto sopravvive a una ricarica", async () => {
  run(`SYNC.pend=4; syncSalva();`);
  const o = JSON.parse(run(`localStorage.getItem("ip_sync")`));
  assert.equal(o.pend, 4);
  run(`S._dirty=false; setSync("ok")`);
  assert.equal(run(`SYNC.pend`), 0, "se lo stato e' pulito, il conto vecchio non conta");
});

prova("spazio quasi finito: avvisa", async () => {
  run(`SYNC.pend=0; SYNC.motivo=""; SYNC.stato="ok"; SYNC.bytes=SYNC_MAX*0.95; syncMostra();`);
  assert.match(testo(), /spazio 95%/);
  run(`SYNC.bytes=1000; syncMostra();`);
});

prova("memoria piena: via prima le copie di «Annulla», i dati restano", async () => {
  // localStorage finto con un tetto
  run(`(function(){
    const m=new Map(); var TETTO=0;
    localStorage={ getItem:k=>m.has(k)?m.get(k):null, removeItem:k=>m.delete(k), key:i=>[...m.keys()][i], get length(){ return m.size; },
      setItem:(k,v)=>{ const tot=[...m.entries()].reduce((a,[kk,vv])=>a+(kk===k?0:vv.length),0)+String(v).length; if(TETTO&&tot>TETTO){ const e=new Error("QuotaExceededError"); e.name="QuotaExceededError"; throw e; } m.set(k,String(v)); } };
    globalThis.__tetto=v=>{ TETTO=v; };
  })();`);
  run(`localStorage.setItem(SNAPKEY, JSON.stringify([{label:"a",data:{x:"y".repeat(3000)}},{label:"b",data:{x:"y".repeat(3000)}}]));`);
  const dati = run(`JSON.stringify(S).length`);
  run(`__tetto(${dati} + 3500 + 200)`);
  run(`save()`);
  assert.ok(run(`!!localStorage.getItem(KEY)`), "i dati devono essere salvati");
  assert.equal(run(`snapshots().length`), 1, "una copia sacrificata");
  assert.notEqual(run(`SYNC.motivo`), "memoria");
  run(`__tetto(10)`);
  run(`save()`);
  assert.equal(run(`SYNC.motivo`), "memoria");
  assert.match(run(`LASTT`), /Memoria del dispositivo piena/);
  assert.match(testo(), /memoria piena/);
});

for (const [n, f] of seq) {
  try { await f(); console.log("  ok   " + n); }
  catch (e) { failed++; console.log("  FAIL " + n + " — " + e.message); }
}
console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
