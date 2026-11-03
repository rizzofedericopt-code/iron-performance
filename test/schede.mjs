// Schede esercizi in PDF da mandare su WhatsApp, e i loro modelli.
//
//   node test/schede.mjs
//
// Il PDF lo scrive l'app da sola: qui si controlla che sia un PDF vero (lo
// rilegge PDF.js, la stessa libreria dei browser), che dica quello che hai
// scritto, accenti compresi, che i link si aprano, e che i modelli non si
// perdano né resuscitino fra telefono e computer.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const mem = new Map(), cache = {};
const elFor = () => ({ value: "", dataset: {}, style: {}, textContent: "", innerHTML: "", addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, focus() {}, select() {}, click() {} });
let SCARICATO = null, PROMPT = "";
const sandbox = {
  document: { getElementById: (id) => (cache[id] ||= elFor()), querySelector: () => elFor(), querySelectorAll: () => [], createElement: () => elFor(),
    addEventListener() {}, body: elFor(), documentElement: elFor(), hidden: false },
  window: { addEventListener() {}, open: () => null }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true, prompt: () => PROMPT,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const j = (c) => { const r = run("JSON.stringify(" + c + ")"); return r === undefined ? undefined : JSON.parse(r); };
run(`normalize(); render=function(){}; save=function(){}; toast=function(){}; dl=function(n,c,t){ globalThis.__dl={n:n, len:c.length}; };`);

let failed = 0;
const prove = [];
const prova = (nome, fn) => prove.push([nome, fn]);
const squadra = () => run(`{ S.teams=[{id:"t1",name:"YOUNG Volley U18",sport:"pallavolo"}]; S.activeTeam="t1";
  S.athletes=[{id:"a1",name:"Sara Rossi",team:"t1",sex:"F",profile:{}}]; S.data={a1:{rmSquat:[{d:"2026-10-01",v:70}]}}; S.modelli=[]; S.tomb={}; }`);
const pdfDi = (sk, nome = "Sara Rossi", aid = "a1") => Buffer.from(j(`Array.from(schedaPdf(${JSON.stringify(sk)}, ${JSON.stringify(nome)}, ${JSON.stringify(aid)}, "YOUNG Volley U18"))`));
const SK = { titolo: "Lavoro a casa — settimana 45", data: "2026-11-03", note: "Due volte: però non di fila, perché il recupero conta.",
  ex: [{ nome: "Squat bulgaro", sr: "3×8", carico: "manubri 6 kg", rec: "90\"", note: "Ginocchio in linea col piede", link: "https://youtu.be/abc(1)" },
       { nome: "Back squat", sr: "4×5", carico: "75%", rm: "rmSquat", rec: "2'" }] };

console.log("\nIl PDF");
prova("è un PDF ben fatto: intestazione, tabella degli oggetti, fine", () => {
  squadra(); const b = pdfDi(SK), s = b.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4")); assert.ok(s.trimEnd().endsWith("%%EOF"));
  // ogni oggetto sta esattamente dove la tabella xref dice
  const xr = parseInt(s.match(/startxref\n(\d+)/)[1], 10);
  assert.equal(s.slice(xr, xr + 4), "xref");
  const righe = s.slice(xr).split("\n").slice(3).filter((r) => / n $/.test(r));
  righe.forEach((r, i) => { const off = parseInt(r.slice(0, 10), 10); assert.equal(s.slice(off, off + String(i + 1).length + 6), (i + 1) + " 0 obj", "oggetto " + (i + 1)); });
});
prova("accenti italiani in WinAnsi, caratteri impossibili come «?»", () => {
  const a = run(`pdfAnsi("però è città ☺ ×")`);
  assert.equal(a, "per\xf2 \xe8 citt\xe0 ? \xd7");
  assert.equal(run(`pdfStr("a(b)c\\\\d")`), "(a\\(b\\)c\\\\d)");
});
prova("i chili dal massimale: 75% di 70 kg = 52,5", () => {
  squadra(); assert.equal(run(`schedaKg("a1",{carico:"75%",rm:"rmSquat"})`), 52.5);
  assert.equal(run(`schedaKg("a1",{carico:"60 kg",rm:"rmSquat"})`), null, "niente percentuale, niente calcolo");
  assert.equal(run(`schedaKg("a1",{carico:"75%"})`), null, "niente massimale scelto, niente calcolo");
});
prova("tanti esercizi: più pagine, numerate", () => {
  squadra(); const sk = JSON.parse(JSON.stringify(SK));
  for (let i = 0; i < 25; i++) sk.ex.push({ nome: "Esercizio " + i, sr: "3×10", carico: "RIR 2", note: "nota ".repeat(30) });
  const s = pdfDi(sk).toString("latin1");
  const n = parseInt(s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1], 10);
  assert.ok(n >= 3, "pagine: " + n); assert.match(s, new RegExp("pagina " + n + " di " + n));
});

console.log("\nLetto da PDF.js, come lo legge il telefono");
prova("dice quello che hai scritto, e il link si apre", async () => {
  squadra();
  // PDF.js in Node avvisa che non può disegnare (niente canvas): a noi serve solo leggere
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try {
  const lib = await import(pathToFileURL(join(root, "vendor", "pdf.min.mjs")).href);
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL(join(root, "vendor", "pdf.worker.min.mjs")).href;
  const doc = await lib.getDocument({ data: new Uint8Array(pdfDi(SK)), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const p = await doc.getPage(1), tc = await p.getTextContent();
  const testo = tc.items.map((i) => i.str).join(" ");
  const norm = testo.replace(/\s+/g, " ");
  ["Lavoro a casa — settimana 45", "Sara Rossi", "però non di fila, perché", "1. Squat bulgaro", "3×8", "75% · " + run(`fmtNum(52.5)`) + " kg", "Guarda il video", run(`fmtDate("2026-11-03")`)]
    .forEach((x) => assert.ok(norm.includes(x), "manca «" + x + "» in: " + norm));
  const an = await p.getAnnotations();
  assert.equal(an.length, 1); assert.equal(an[0].url, "https://youtu.be/abc(1)");
  await doc.destroy();
  } finally { console.log = log; console.warn = warn; }
});

console.log("\nLa scheda e i modelli");
prova("un link che non è https non entra nel PDF: lo dice e si ferma", () => {
  squadra(); run(`SK=skVuota("a1"); SK.ex=[{nome:"Plank",sr:"3×30s",carico:"",rec:"",note:"",link:"javascript:alert(1)",rm:""}]; globalThis.__dl=null; skScarica();`);
  assert.equal(run(`globalThis.__dl`), null);
  assert.match(run(`document.getElementById("skErr").textContent`), /Il link di «Plank» non va/);
});
prova("scheda vuota: niente PDF", () => {
  squadra(); run(`SK=skVuota("a1"); globalThis.__dl=null; skScarica();`);
  assert.equal(run(`globalThis.__dl`), null);
});
prova("scaricata: nome del file con atleta e data", () => {
  squadra(); run(`SK=skVuota("a1"); SK.data="2026-11-03"; SK.ex=[{nome:"Plank",sr:"3×30s",carico:"",rec:"",note:"",link:"",rm:""}]; skScarica();`);
  assert.equal(j(`globalThis.__dl.n`), "Scheda - Sara Rossi - " + run(`fmtDate("2026-11-03")`).replace(/\//g, "-") + ".pdf");
});
prova("la bozza resta se chiudi a metà", () => {
  squadra(); mem.clear(); run(`openScheda("a1"); skSet(0,"nome","Ponte glutei"); SK=null; openScheda("a1");`);
  assert.equal(j(`SK.ex[0].nome`), "Ponte glutei");
});
prova("modello: si salva, si riusa, e sostituisce quello con lo stesso nome", () => {
  squadra(); mem.clear();
  run(`SK=skVuota("a1"); SK.titolo="Casa"; SK.ex=[{nome:"Plank",sr:"3×30s",carico:"",rec:"",note:"",link:"https://youtu.be/p",rm:""},{nome:"",sr:"",carico:"",rec:"",note:"",link:"",rm:""}];`);
  PROMPT = "Casa 1"; run(`skSalvaModello()`);
  assert.equal(j(`S.modelli.length`), 1); assert.equal(j(`S.modelli[0].ex.length`), 1, "le righe vuote non entrano nel modello");
  run(`SK.ex[0].sr="4×45s"; skSalvaModello();`);
  assert.equal(j(`S.modelli.length`), 1); assert.equal(j(`S.modelli[0].ex[0].sr`), "4×45s");
  run(`SK=skVuota("a1"); skCaricaModello(S.modelli[0].id);`);
  assert.equal(j(`SK.ex[0].nome`), "Plank"); assert.equal(j(`SK.titolo`), "Casa");
});
prova("modello eliminato: non torna dall'altro dispositivo", () => {
  squadra(); PROMPT = "Casa 1";
  run(`SK=skVuota("a1"); SK.ex=[{nome:"Plank",sr:"",carico:"",rec:"",note:"",link:"",rm:""}]; skSalvaModello(); openModelli=function(){};`);
  const vecchio = j(`S.modelli`);
  run(`skEliminaModello(S.modelli[0].id)`);
  const out = j(`mergeState({athletes:S.athletes, teams:S.teams, modelli:${JSON.stringify(vecchio)}, tomb:{}}, {athletes:S.athletes, teams:S.teams, modelli:S.modelli, tomb:S.tomb})`);
  assert.equal(out.modelli.length, 0);
});
prova("due dispositivi con modelli diversi: restano tutti e due", () => {
  squadra();
  const out = j(`mergeState({athletes:[],teams:[],modelli:[{id:"m1",nome:"A",ex:[]}],tomb:{}}, {athletes:[],teams:[],modelli:[{id:"m2",nome:"B",ex:[]}],tomb:{}})`);
  assert.deepEqual(out.modelli.map((x) => x.id).sort(), ["m1", "m2"]);
});
prova("dall'import di un backup: link solo https, massimali che esistono, campi che conosciamo", () => {
  const o = j(`sanitizeImport({athletes:[], teams:[], data:{}, modelli:[{id:"m1",nome:"Casa",ex:[{nome:"Plank",link:"javascript:x",rm:"<b>",altro:"x"},{nome:"",sr:"3×8"}]}]})`);
  const e = o.modelli[0].ex;
  assert.equal(e.length, 1); assert.equal(e[0].link, ""); assert.equal(e[0].rm, ""); assert.equal(e[0].altro, undefined);
});

for (const [nome, fn] of prove) {
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
}
console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
