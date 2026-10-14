// Il controllo d'insieme: ogni cosa che l'app salva deve sopravvivere a
// backup, ripristino e sincronizzazione fra due dispositivi.
//
//   node test/completo.mjs
//
// Perche' questo test esiste. Il difetto piu' ripetuto di questo progetto e'
// sempre lo stesso: un campo nuovo che l'export scrive e l'import (o l'unione
// fra dispositivi) butta via in silenzio. E' successo con screen, lv, la
// batteria di squadra, l'origine delle stime, i test in evidenza. Ogni volta
// la prova era sul singolo campo; qui la prova e' sull'insieme: uno stato con
// TUTTO dentro, e un elenco di cio' che deve tornare indietro intero.
//
// Se aggiungi una chiave allo stato e questo test non la conosce, fallisce
// la prova «nessuna chiave sconosciuta»: e' voluto. Aggiungila all'elenco
// DOPO aver verificato che export, import e unione la gestiscono.

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


const PIENO = `{
  sport:"pallavolo", view:"today", activeTeam:"t1", cvar:"percussione",
  teams:[{id:"t1",name:"U18",sport:"pallavolo",tests:["cmj","rmSquat","bw","stat","rmSquatRel"],pin:["cmj"]}],
  athletes:[{id:"a1",name:"Sara",sex:"F",team:"t1",profile:{role:"schiacciatrice",birth:"2010-01-01",weight:"56",weightSync:"56",height:"168",heightSync:"168"}},
            {id:"a2",name:"Giulia",sex:"F",team:"t1",profile:{role:"centrale"}}],
  data:{a1:{cmj:[{d:"2026-09-01",v:30},{d:"2026-10-01",v:32}],
            rmSquat:[{d:"2026-10-01",v:80,fonte:"reps",rmW:70,rmR:5,rmRir:1,rmLo:78,rmHi:83}],
            bw:[{d:"2026-10-01",v:56}], stat:[{d:"2026-02-01",v:166},{d:"2026-10-01",v:168}],
            cx1:[{d:"2026-10-01",v:120}]},
        a2:{cmj:[{d:"2026-10-01",v:34}]}},
  readiness:{a1:[{d:"2026-10-01",sl:4,so:3,fa:4,st:4}]},
  load:{a1:[{d:"2026-10-01",rpe:6,min:90}]},
  screen:{a1:[{d:"2026-09-01",posture:{ant:{devs:[1],note:"x"}},items:{}}]},
  lv:{a1:[{d:"2026-09-15",exercise:"Squat",points:[{load:40,v:1},{load:60,v:0.7}],mvt:0.3,est1RM:95,vType:"MPV",mvtSource:"riferimento"}]},
  pres:{a1:[{d:"2026-10-01",s:"p"},{d:"2026-10-03",s:"r"}], a2:[{d:"2026-10-01",s:"a"}]},
  mjl:{a1:[{d:"2026-10-01",exercise:"CMJ#1",tipo:"CMJ",m:{h:32,Prel:26.8,x_altro:3}}]},
  gruppi:{"rmSquat@t1":{d:"2026-10-01",g:[["a1","a2"]],x:[{kg:50,pct:75,nota:"occhio",nome:"Rientri",pg:70,sr:"3×8",ind:{a1:{kg:40,pct:70,nota:"schiena"}}}]}},
  sedute:{t1:{ex:[{t:"rmSquat",pct:75,sr:"4×5",mode:"min"}],rif:"rmSquat",size:3}},
  gare:{t1:[{d:"2026-11-02",avv:"Rossi",casa:true}]},
  custom:[{id:"cx1",name:"Leg press",unit:"kg",base:"pred"}],
  te:{cmj:3.1, stat:0.3},
  cfg:{deltaNoise:5, rmBar:20},
  policy:{version:2, text:"informativa"},
  tomb:{"p:a2:2026-09-20":"2026-10-01T00:00:00.000Z"}
}`;

// chiave di S → come si controlla che sia tornata intera
const CHIAVI = {
  sport:   o => o.sport === "pallavolo",
  view:    o => o.view === "today",
  activeTeam: o => o.activeTeam === "t1",
  teams:   o => o.teams[0].tests.length === 5 && o.teams[0].pin[0] === "cmj",
  athletes:o => o.athletes.length === 2 && o.athletes[0].profile.role === "schiacciatrice" && o.athletes[0].profile.weightSync === "56",
  data:    o => o.data.a1.cmj.length === 2 && o.data.a1.rmSquat[0].fonte === "reps" && o.data.a1.rmSquat[0].rmRir === 1 &&
                o.data.a1.bw[0].v === 56 && o.data.a1.stat.length === 2 && o.data.a1.cx1[0].v === 120,
  readiness:o => o.readiness.a1[0].sl === 4,
  load:    o => o.load.a1[0].rpe === 6,
  screen:  o => o.screen.a1[0].posture.ant.devs[0] === 1,
  lv:      o => o.lv.a1[0].vType === "MPV" && o.lv.a1[0].mvtSource === "riferimento",
  pres:    o => o.pres.a1.length === 2 && o.pres.a1[1].s === "r" && o.pres.a2[0].s === "a",
  mjl:     o => o.mjl.a1[0].m.Prel === 26.8 && o.mjl.a1[0].m.x_altro === 3 && o.mjl.a1[0].tipo === "CMJ",
  gruppi:  o => { const x=o.gruppi["rmSquat@t1"].x[0]; return x.nota === "occhio" && x.kg === 50 && x.nome === "Rientri" &&
                  x.pg === 70 && x.sr === "3×8" && x.ind.a1.kg === 40 && x.ind.a1.nota === "schiena"; },
  sedute:  o => o.sedute.t1.ex[0].mode === "min" && o.sedute.t1.rif === "rmSquat",
  gare:    o => o.gare.t1[0].avv === "Rossi" && o.gare.t1[0].casa === true,
  custom:  o => o.custom[0].name === "Leg press",
  te:      o => o.te.cmj === 3.1 && o.te.stat === 0.3,
  cfg:     o => o.cfg.deltaNoise === 5,
  policy:  o => o.policy.version === 2,
  tomb:    o => !!o.tomb["p:a2:2026-09-20"],
  cvar:    o => true,              // preferenza di visualizzazione, non un dato
};

console.log("\nControllo d'insieme");

prova("backup → ripristino: torna indietro tutto", () => {
  const o = j(`sanitizeImport(JSON.parse(JSON.stringify(${PIENO})))`);
  const persi = Object.keys(CHIAVI).filter(k => k !== "cvar").filter(k => { try { return !CHIAVI[k](o); } catch (e) { return true; } });
  assert.deepEqual(persi, [], "PERSI al ripristino: " + persi.join(", "));
});

prova("sincronizzazione: un dispositivo vuoto non cancella niente", () => {
  const o = j(`mergeState({athletes:[],data:{}}, ${PIENO})`);
  const persi = Object.keys(CHIAVI).filter(k => !["view", "cvar"].includes(k)).filter(k => { try { return !CHIAVI[k](o); } catch (e) { return true; } });
  assert.deepEqual(persi, [], "PERSI nell'unione: " + persi.join(", "));
});

prova("sincronizzazione al contrario: il server pieno, il telefono vuoto", () => {
  const o = j(`mergeState(${PIENO}, {athletes:[],data:{}})`);
  const persi = ["data","pres","gruppi","sedute","gare","custom","te","mjl"].filter(k => { try { return !CHIAVI[k](o); } catch (e) { return true; } });
  assert.deepEqual(persi, [], "PERSI: " + persi.join(", "));
});

prova("dopo il caricamento (normalize) non cambia niente di quello che conta", () => {
  run(`S=${PIENO}; normalize();`);
  const o = j(`S`);
  const persi = Object.keys(CHIAVI).filter(k => { try { return !CHIAVI[k](o); } catch (e) { return true; } });
  assert.deepEqual(persi, [], "ALTERATI da normalize: " + persi.join(", "));
});

prova("nessuna chiave sconosciuta: ogni chiave dello stato è in questo elenco", () => {
  run(`S={}; normalize();`);
  const chiavi = j(`Object.keys(S)`).filter(k => k[0] !== "_");
  const ignote = chiavi.filter(k => !(k in CHIAVI));
  assert.deepEqual(ignote, [], "chiavi nuove non verificate: " + ignote.join(", ") +
    " — controlla export, sanitizeImport e mergeState, poi aggiungile a CHIAVI");
});

prova("cancellare un'atleta la toglie da ogni posto in cui compare", () => {
  run(`S=${PIENO}; normalize(); delAthlete("a2");`);
  const s = JSON.stringify(j(`{data:S.data, readiness:S.readiness, load:S.load, screen:S.screen, lv:S.lv, pres:S.pres, gruppi:S.gruppi, athletes:S.athletes}`));
  assert.ok(s.indexOf('"a2"') < 0, "un'atleta cancellata e' rimasta da qualche parte: " + s.slice(0, 200));
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
