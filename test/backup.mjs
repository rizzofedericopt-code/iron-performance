// Backup automatico sul PC (File System Access API) e copie sul server.
//
//   node test/backup.mjs
//
// La cartella e' finta (in memoria), il codice e' quello vero dell'app.
// Cosa deve essere vero:
//   1. scrive il file che si sovrascrive e quello del giorno; dei giornalieri
//      ne tiene 7 e non tocca nient'altro nella cartella
//   2. NON sovrascrive se le atlete diminuiscono o le registrazioni calano
//      oltre il 20% — a meno che tu non lo chieda
//   3. senza permesso non scrive e lo dice
//   4. rifiuta la cartella del progetto (finirebbe su GitHub)
//   5. al massimo una scrittura ogni 10 minuti
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
const seq = [];
const provaS = (nome, fn) => seq.push([nome, fn]);

// cartella finta, con la stessa interfaccia di FileSystemDirectoryHandle
run(`
  function cartella(nome, perm){
    const f=new Map();
    return { name:nome, files:f, perm:perm||"granted",
      async queryPermission(){ return this.perm; },
      async requestPermission(){ return this.permDopo||this.perm; },
      async getFileHandle(n, o){
        if(!f.has(n)){ if(!(o&&o.create)){ const e=new Error("NotFound"); e.name="NotFoundError"; throw e; } f.set(n,""); }
        return { async getFile(){ return { async text(){ return f.get(n); } }; },
                 async createWritable(){ let buf=""; return { async write(t){ buf+=t; }, async close(){ f.set(n,buf); } }; } };
      },
      async *keys(){ for(const k of f.keys()) yield k; },
      async removeEntry(n){ f.delete(n); }
    };
  }
  var DIR=null;
  bkHandle=async function(set){ if(set===undefined) return DIR; DIR=set; return true; };
  window.showDirectoryPicker=async function(){ return PICK; };
  var PICK=null;
  function statoN(n, misure){
    const o={athletes:[], data:{}};
    for(let i=0;i<n;i++){ o.athletes.push({id:"a"+i,name:"A"+i}); o.data["a"+i]={cmj:[]};
      for(let k=0;k<misure;k++) o.data["a"+i].cmj.push({d:"2026-0"+(1+k%9)+"-1"+(k%9),v:30}); }
    return o;
  }
`);

console.log("\nBackup automatico");

provaS("conta atlete e registrazioni", async () => {
  assert.deepEqual(j(`bkConta({athletes:[{},{}], data:{a:{cmj:[1,2],sj:[1]}}, pres:{a:[1,2,3]}, mjl:{a:[1]}})`), {atlete:2, reg:7});
  assert.deepEqual(j(`bkConta(null)`), {atlete:0, reg:0});
});

provaS("la guardia: meno atlete o -20% di registrazioni ferma la sovrascrittura", async () => {
  assert.equal(run(`bkGuardia(null,{atlete:0,reg:0})`), null);
  assert.equal(run(`bkGuardia({atlete:12,reg:300},{atlete:12,reg:250})`), null);
  assert.match(run(`bkGuardia({atlete:12,reg:300},{atlete:11,reg:300})`), /1 atleta in meno/);
  assert.match(run(`bkGuardia({atlete:12,reg:300},{atlete:12,reg:239})`), /da 300 a 239/);
  assert.equal(run(`bkGuardia({atlete:2,reg:10},{atlete:2,reg:1})`), null, "sotto 20 registrazioni non e' un segnale");
});

provaS("tiene gli ultimi 7 giornalieri e non tocca altri file", async () => {
  const nomi = JSON.stringify(["iron-performance-2026-10-01.json","iron-performance-2026-10-02.json","iron-performance-2026-10-03.json",
    "iron-performance-2026-10-04.json","iron-performance-2026-10-05.json","iron-performance-2026-10-06.json","iron-performance-2026-10-07.json",
    "iron-performance-2026-10-08.json","iron-performance-2026-10-09.json","iron-performance-backup.json","tesi.docx","iron-performance-2026-10-10.json.bak"]);
  assert.deepEqual(j(`bkDaTogliere(${nomi},7)`), ["iron-performance-2026-10-01.json","iron-performance-2026-10-02.json"]);
});

provaS("riconosce la cartella del progetto", async () => {
  assert.equal(run(`bkCartellaProgetto(["index.html","api","package.json"])`), true);
  assert.equal(run(`bkCartellaProgetto([".git","README.md"])`), true);
  assert.equal(run(`bkCartellaProgetto(["aggiorna.bat"])`), true);
  assert.equal(run(`bkCartellaProgetto(["foto.jpg","iron-performance-backup.json"])`), false);
});

provaS("scrive il file sempre aggiornato e quello del giorno", async () => {
  run(`localStorage.removeItem(BKKEY); DIR=cartella("Backup"); bkStatoSet({attivo:true,cartella:"Backup"}); S=statoN(5,10); normalize();`);
  assert.equal(await run(`bkEsegui(false,false)`), "ok");
  const nomi = j(`[...DIR.files.keys()].sort()`);
  const oggi = run(`todayISO()`);
  assert.deepEqual(nomi, ["iron-performance-"+oggi+".json", "iron-performance-backup.json"].sort());
  const dentro = j(`JSON.parse(DIR.files.get("iron-performance-backup.json"))`);
  assert.equal(dentro.athletes.length, 5);
  assert.equal(dentro._dirty, undefined);
  assert.equal(j(`bkStato()`).ok, true);
  // il file e' quello che «Importa backup» sa leggere
  assert.equal(j(`sanitizeImport(JSON.parse(DIR.files.get("iron-performance-backup.json"))).athletes.length`), 5);
});

provaS("si sovrascrive: il secondo backup prende il posto del primo", async () => {
  run(`S.data.a0.cmj.push({d:"2026-10-17",v:40}); S.athletes.push({id:"a9",name:"Nuova"});`);
  assert.equal(await run(`bkEsegui(false,false)`), "ok");
  assert.equal(j(`JSON.parse(DIR.files.get("iron-performance-backup.json")).athletes.length`), 6);
  assert.equal(j(`[...DIR.files.keys()].length`), 2, "nessun «backup (1).json»");
});

provaS("nella cartella vera: restano 7 giornalieri, gli altri file non si toccano", async () => {
  run(`for(let d=1; d<=9; d++) DIR.files.set("iron-performance-2026-09-0"+d+".json","{}"); DIR.files.set("tesi.docx","x");`);
  assert.equal(await run(`bkEsegui(false,false)`), "ok");
  const nomi = j(`[...DIR.files.keys()]`);
  const giorni = nomi.filter(n => /^iron-performance-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  assert.equal(giorni.length, 7, giorni.join(" "));
  assert.ok(giorni.includes("iron-performance-" + run(`todayISO()`) + ".json"), "quello di oggi resta");
  assert.ok(!giorni.includes("iron-performance-2026-09-01.json"), "i piu' vecchi se ne vanno");
  assert.ok(nomi.includes("tesi.docx") && nomi.includes("iron-performance-backup.json"));
});

provaS("se le atlete diminuiscono non sovrascrive, e lo dice", async () => {
  run(`S.athletes=S.athletes.slice(0,2);`);
  assert.equal(await run(`bkEsegui(false,false)`), "bloccato");
  assert.equal(j(`JSON.parse(DIR.files.get("iron-performance-backup.json")).athletes.length`), 6, "il backup buono deve restare");
  const st = j(`bkStato()`);
  assert.equal(st.bloccato, true);
  assert.match(st.msg, /4 atlete in meno/);
  // se e' voluto, si forza
  assert.equal(await run(`bkEsegui(true,true)`), "ok");
  assert.equal(j(`JSON.parse(DIR.files.get("iron-performance-backup.json")).athletes.length`), 2);
  assert.equal(j(`bkStato()`).bloccato, false);
});

provaS("senza permesso non scrive; con un tocco lo chiede", async () => {
  run(`DIR=cartella("Backup","prompt"); S=statoN(3,5); normalize();`);
  assert.equal(await run(`bkEsegui(false,false)`), "permesso");
  assert.equal(j(`DIR.files.size`), 0);
  assert.match(j(`bkStato()`).msg, /permesso/);
  run(`DIR.permDopo="granted"`);
  assert.equal(await run(`bkEsegui(false,true)`), "ok");
});

provaS("scegliere la cartella del progetto viene rifiutato", async () => {
  run(`localStorage.removeItem(BKKEY); DIR=null; PICK=cartella("iron-performance"); PICK.files.set("index.html","x"); PICK.files.set("api",""); openAutoBk=function(){};`);
  await run(`bkScegli()`);
  assert.equal(run(`DIR`), null);
  assert.match(run(`LASTT`), /progetto/);
  run(`PICK=cartella("Documenti backup")`);
  await run(`bkScegli()`);
  assert.equal(run(`DIR&&DIR.name`), "Documenti backup");
  assert.equal(j(`bkStato()`).attivo, true);
  assert.equal(j(`DIR.files.size`), 2, "il primo backup parte subito");
});

provaS("al massimo una scrittura ogni 10 minuti", async () => {
  run(`var ATT=[]; setTimeout=function(f,ms){ ATT.push(ms); return ATT.length; }; clearTimeout=function(){};`);
  run(`bkStatoSet({attivo:true, at:new Date(Date.now()-60e3).toISOString()}); bkTocca();`);
  const ms = run(`ATT[ATT.length-1]`);
  assert.ok(ms > 8*60e3 && ms <= 10*60e3, "attesa " + ms);
  run(`bkStatoSet({at:new Date(Date.now()-3600e3).toISOString()}); bkTocca();`);
  assert.equal(run(`ATT[ATT.length-1]`), 20000, "se l'ultimo e' vecchio, si aspetta solo che finisca il grappolo di modifiche");
  run(`bkStatoSet({attivo:false}); ATT=[]; bkTocca();`);
  assert.equal(run(`ATT.length`), 0, "spento: niente");
});

provaS("senza Chrome/Edge non promette niente", async () => {
  run(`delete window.showDirectoryPicker`);
  assert.match(run(`bkRiga()`), /Chrome o Edge/);
  run(`bkStatoSet({attivo:true}); var ATT=[]; bkTocca();`);
  assert.equal(run(`ATT.length`), 0);
});

for (const [n, f] of seq) {
  try { await f(); console.log("  ok   " + n); }
  catch (e) { failed++; console.log("  FAIL " + n + " — " + e.message); }
}
console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
