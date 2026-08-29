import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
// Qui c'era un percorso assoluto della macchina su cui il test e' stato scritto.
// Funzionava solo li': sul computer di chi usa il progetto, `npm test` moriva
// con ENOENT al primo test. Un test che gira su una macchina sola non e' una
// rete di sicurezza, e' un promemoria.
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const el={addEventListener(){},appendChild(){},setAttribute(){},getAttribute(){return null},focus(){},select(){},click(){},
  querySelector(){return null},querySelectorAll(){return []},classList:{add(){},remove(){},toggle(){},contains(){return false}},
  style:{},dataset:{},value:"",textContent:"",innerHTML:"",checked:false};
const sb={document:{getElementById:()=>el,querySelector:()=>el,querySelectorAll:()=>[],createElement:()=>el,addEventListener(){},body:el,documentElement:el,hidden:false},
  window:{addEventListener(){}},navigator:{userAgent:"t"},location:{href:"https://t/",origin:"https://t",pathname:"/",search:""},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:()=>Promise.reject(new Error("no")),confirm:()=>true,
  setTimeout,clearTimeout,setInterval,clearInterval,URL,Blob:class{},FileReader:class{},console};
sb.globalThis=sb; vm.createContext(sb); vm.runInContext(src,sb,{filename:"app"});
let failed=0;
const prova=(n,f)=>{ try{f();console.log("  ok   "+n);}catch(e){failed++;console.log("  FAIL "+n+" — "+e.message);} };

prova("da altezza a tempo di volo: 20 cm = 0,404 s", () => {
  const t = sb.tVoloDaAltezza(0.20);
  assert.ok(Math.abs(t-0.4039)<0.001, "atteso ~0,404 s, ottenuto "+t);
});
prova("il giro inverso torna: t -> h -> t", () => {
  const h = 9.81*Math.pow(0.404,2)/8;
  assert.ok(Math.abs(h-0.20)<0.001);
});
prova("un solo valore = altezza media su n salti", () => {
  const r = sb.boscoAltezze("19", 55);
  assert.equal(r.quanti,1);
  assert.ok(Math.abs(r.tf - 55*sb.tVoloDaAltezza(0.19))<1e-9);
});
prova("piu' valori = somma dei singoli tempi di volo", () => {
  const r = sb.boscoAltezze("21, 20.5 19\n18", 4);
  assert.equal(r.quanti,4);
  const atteso=[21,20.5,19,18].reduce((s,h)=>s+sb.tVoloDaAltezza(h/100),0);
  assert.ok(Math.abs(r.tf-atteso)<1e-9);
  assert.ok(Math.abs(r.media-19.625)<1e-9);
});
prova("altezze e tempo di volo danno la STESSA potenza", () => {
  const n=55, dur=30, h=0.19;
  const tf = n*sb.tVoloDaAltezza(h);
  const daAltezze = sb.boscoPower(dur, n, sb.boscoAltezze("19", n).tf);
  const daTempo   = sb.boscoPower(dur, n, tf);
  assert.ok(Math.abs(daAltezze-daTempo)<1e-9, "le due strade devono coincidere");
  assert.ok(daAltezze>20 && daAltezze<60, "potenza fuori scala plausibile: "+daAltezze);
});
prova("dati incoerenti vengono rifiutati", () => {
  assert.equal(sb.boscoPower(30, 55, 31), null, "tempo di volo maggiore della durata");
  assert.equal(sb.boscoPower(30, 0, 20), null, "zero salti");
  assert.equal(sb.boscoAltezze("", 55), null);
  assert.equal(sb.boscoAltezze("abc", 55), null);
});
console.log(failed?`\n${failed} test falliti`:"\nTutti i test passati");
process.exit(failed?1:0);
