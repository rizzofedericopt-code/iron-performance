// Salti dal video: il motore (tracce, salti, verifica) e i salti nel carico.
//
//   node test/video.mjs
//
// Il modello di posa non gira qui: gira nel browser (prova in Chromium a
// parte). Qui si prova tutto quello che viene DOPO le rilevazioni, con
// traiettorie costruite apposta, e il salvataggio nello stato.
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

// una persona alta H (frazione del fotogramma), piedi a terra a y=g, che salta
// ai tempi dati di una frazione «alza» della sua altezza per 0,5 s
const traccia = (o) => run(`(function(){
  const o=${JSON.stringify(o)}, fps=o.fps||10, H=o.H||0.2, pts=[];
  let seme=7; const rnd=()=>{ seme=(seme*9301+49297)%233280; return seme/233280-0.5; };
  for(let k=0;k<=o.dur*fps;k++){
    const t=k/fps; let g=o.g||0.8, su=0, suH=0;
    (o.deriva||[]).forEach(d=>{ if(t>=d.da) g-=Math.min(t-d.da, d.a-d.da)/(d.a-d.da)*d.dy*H; });
    (o.salti||[]).forEach(s=>{ const fl=s.volo||0.5, u=(t-(s.t-fl/2))/fl; if(u>0&&u<1){ const z=4*u*(1-u); su+=z*s.alza*H; suH+=z*(s.anche!=null?s.anche:s.alza)*H; } });
    const n=(o.rumore||0.01)*H;
    pts.push({t:Math.round(t*100)/100, x:o.x||0.5, y0:g-H-su+rnd()*n, y1:g-su+rnd()*n, h:H, ank:g-su+rnd()*n, hip:g-0.38*H-suH+rnd()*n});
  }
  return {id:"t1", pts:pts};
})()`);

console.log("\nSalti dal video");

prova("trova i salti veri, non la corsa verso la rete ne' un calcio", () => {
  const tr = traccia({dur:12, salti:[{t:2, alza:0.25},{t:5.5, alza:0.3},{t:10.5, alza:0.15, anche:0}], deriva:[{da:7, a:8, dy:0.5}]});
  const s = j(`vidSaltiTraccia(${JSON.stringify(tr)})`);
  assert.deepEqual(s.map(e => Math.round(e.t)), [2, 6], JSON.stringify(s.map(e => [e.t, e.alza])));
});

prova("un'alzata in salto (poco) si', un saltello no", () => {
  const tr = traccia({dur:8, salti:[{t:2, alza:0.13, anche:0.09},{t:5, alza:0.05}]});
  const s = j(`vidSaltiTraccia(${JSON.stringify(tr)})`);
  assert.deepEqual(s.map(e => Math.round(e.t)), [2]);
});

prova("troppo a lungo in aria non e' un salto", () => {
  const tr = traccia({dur:8, salti:[{t:4, alza:0.3, volo:1.6}]});
  assert.equal(j(`vidSaltiTraccia(${JSON.stringify(tr)})`).length, 0);
});

prova("anche a 6 fotogrammi al secondo", () => {
  const tr = traccia({fps:6, dur:10, salti:[{t:3, alza:0.25},{t:7, alza:0.25}]});
  assert.equal(j(`vidSaltiTraccia(${JSON.stringify(tr)})`).length, 2);
});

prova("tracce: due persone lontane = due tracce; persa per piu' di un secondo = traccia nuova", () => {
  const fr = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 10, dets = [{x:0.2, y0:0.6, y1:0.8, h:0.2, ank:0.8, hip:0.72}];
    if (t < 1.5 || t > 3) dets.push({x:0.7, y0:0.55, y1:0.78, h:0.23, ank:0.78, hip:0.69});
    fr.push({t, dets});
  }
  const tr = j(`vidTraccia(${JSON.stringify(fr)})`);
  assert.equal(tr.length, 3, tr.map(x => x.pts.length).join(","));
  const fr2 = [];
  for (let k = 0; k <= 40; k++) {
    const tt = k / 10, dets = [{x:0.2, y0:0.6, y1:0.8, h:0.2, ank:0.8, hip:0.72}];
    if (tt < 1.5 || tt > 2.2) dets.push({x:0.7, y0:0.55, y1:0.78, h:0.23, ank:0.78, hip:0.69});
    fr2.push({t:tt, dets});
  }
  assert.equal(j(`vidTraccia(${JSON.stringify(fr2)})`).length, 2, "un buco breve non spezza la traccia");
});

prova("tracce: una persona che salta resta la stessa traccia", () => {
  const tr = traccia({dur:6, salti:[{t:3, alza:0.35}]});
  const fr = tr.pts.map(p => ({t:p.t, dets:[{x:p.x, y0:p.y0, y1:p.y1, h:p.h, ank:p.ank, hip:p.hip}]}));
  const r = j(`vidSalti(${JSON.stringify(fr)})`);
  assert.equal(r.tracce.length, 1);
  assert.equal(r.salti.length, 1);
});

prova("verifica: trovati, giusti, persi, inventati", () => {
  const x = j(`vidVerifica([{t:1,aid:"a1"},{t:5,aid:"a2"},{t:9,aid:"a1"}], [{t:1.3,aid:"a1"},{t:5.5,aid:"a3"},{t:12}])`);
  assert.equal(x.giusti, 2); assert.equal(x.veri, 3); assert.equal(x.proposti, 3);
  assert.ok(Math.abs(x.recall - 2/3) < 1e-9); assert.ok(Math.abs(x.precisione - 2/3) < 1e-9);
  assert.deepEqual(x.persi.map(e => e.t), [9]); assert.deepEqual(x.inventati.map(e => e.t), [12]);
  assert.equal(x.atletaGiusta, 0.5);
  assert.equal(j(`vidVerifica([], [])`).recall, null);
});

prova("verifica: una proposta vale per un solo salto vero", () => {
  const x = j(`vidVerifica([{t:1},{t:1.4}], [{t:1.2}])`);
  assert.equal(x.giusti, 1); assert.equal(x.persi.length, 1);
});

prova("a mano e AI sullo stesso salto contano una volta", () => {
  const u = j(`vidUnisci([{t:10,aid:"a1",fonte:"mano",tipo:"att"},{t:10.4,aid:"a1",fonte:"ai"},{t:10.5,aid:"a2",fonte:"ai"},{t:20,aid:null,fonte:"ai"},{t:30,aid:"a1",fonte:"ai"}])`);
  assert.deepEqual(u.map(e => e.t), [10, 10.5, 20, 30]);
});

prova("conta per atleta e per tipo; senza nome o «non nostra» non contano", () => {
  const c = j(`vidConta([{aid:"a1",tipo:"att"},{aid:"a1",tipo:"muro"},{aid:"a1"},{aid:"a2",tipo:"batt"},{aid:"no"},{aid:null}])`);
  assert.deepEqual(c, {a1:{n:3,att:1,muro:1,batt:0,alz:0,alt:1}, a2:{n:1,att:0,muro:0,batt:1,alz:0,alt:0}});
});

prova("tempi: 1:02:05 e ritorno", () => {
  assert.equal(run(`vidTempo(3725)`), "1:02:05");
  assert.equal(run(`vidTempo(65)`), "1:05");
  assert.equal(run(`vidSecondi("1:05")`), 65);
  assert.equal(run(`vidSecondi("abc")`), null);
});

prova("MoveNet: punti e riquadro riportati al fotogramma intero", () => {
  const d = new Array(56).fill(0);
  d[55] = 0.8; d[51] = 0.2; d[52] = 0.4; d[53] = 0.8; d[54] = 0.6;   // riquadro
  d[33] = 0.5; d[35] = 0.9; d[36] = 0.5; d[38] = 0.9;                // anche (y, x, s) 11 e 12
  d[45] = 0.78; d[47] = 0.9; d[48] = 0.8; d[50] = 0.9;               // caviglie 15 e 16
  const x = j(`vidDaMoveNet(${JSON.stringify(d)}, {x0:0.5,x1:1,y0:0.3,y1:1})`);
  assert.ok(Math.abs(x.x - 0.75) < 1e-9);
  assert.ok(Math.abs(x.y0 - (0.3 + 0.2*0.7)) < 1e-9);
  assert.ok(Math.abs(x.ank - (0.3 + 0.79*0.7)) < 1e-9);
  assert.ok(Math.abs(x.hip - (0.3 + 0.5*0.7)) < 1e-9);
  d[55] = 0.1;
  assert.equal(j(`vidDaMoveNet(${JSON.stringify(d)}, {x0:0,x1:1,y0:0,y1:1})`), null);
});

prova("riquadri sovrapposti: la stessa persona vista due volte resta una", () => {
  const r = j(`vidSenzaDoppi([{x:0.5,y1:0.8,h:0.2,s:0.7},{x:0.51,y1:0.81,h:0.2,s:0.9},{x:0.8,y1:0.8,h:0.2,s:0.6}])`);
  assert.equal(r.length, 2); assert.equal(r[0].s, 0.9);
});

// ── i salti nello stato ──
const squadra = () => run(`{ S.athletes=[{id:"a1",name:"Sara",team:"t1"},{id:"a2",name:"Giulia",team:"t1"}]; S.teams=[{id:"t1",name:"U18"}]; S.activeTeam="t1"; S.salti={}; S.tomb={}; }`);

prova("salvare una seduta, poi salvarla di nuovo: sostituisce, non somma", () => {
  squadra();
  run(`saltiSalva("vabc","2026-10-20","Partita vs X","mano",{a1:{n:40,att:20,muro:10,batt:5,alz:0,alt:5},a2:{n:12,att:2,muro:8,batt:2,alz:0,alt:0}})`);
  assert.equal(run(`S.salti.a1[0].n`), 40);
  run(`saltiSalva("vabc","2026-10-20","Partita vs X","misto",{a1:{n:44,att:22,muro:10,batt:5,alz:0,alt:7}})`);
  assert.equal(j(`S.salti.a1`).length, 1); assert.equal(run(`S.salti.a1[0].n`), 44);
  assert.equal(run(`S.salti.a2`), undefined, "a2 non ha piu' salti in questa seduta");
  assert.ok(run(`!!S.tomb["salto:a2:2026-10-20|vabc"]`), "e la cancellazione si propaga");
  // cambiata la data: la tombstone e' sulla data vecchia
  run(`saltiSalva("vabc","2026-10-21","Partita vs X","misto",{a1:{n:44,att:22,muro:10,batt:5,alz:0,alt:7}})`);
  assert.equal(run(`S.salti.a1[0].d`), "2026-10-21");
  assert.ok(run(`!!S.tomb["salto:a1:2026-10-20|vabc"]`));
});

prova("due sedute nello stesso giorno restano due", () => {
  squadra();
  run(`saltiSalva("v1","2026-10-20","Allenamento","mano",{a1:{n:60,att:0,muro:0,batt:0,alz:0,alt:60}}); saltiSalva("v2","2026-10-20","Partita","mano",{a1:{n:40,att:0,muro:0,batt:0,alz:0,alt:40}})`);
  assert.equal(j(`S.salti.a1`).length, 2);
});

prova("riassunto: ultimi 7 giorni e media delle 4 settimane prima", () => {
  squadra();
  run(`S.salti.a1=[{d:"2026-09-25",exercise:"v1",n:100},{d:"2026-10-05",exercise:"v2",n:80},{d:"2026-10-12",exercise:"v3",n:120},{d:"2026-10-20",exercise:"v4",n:90},{d:"2026-10-22",exercise:"v5",n:60}]`);
  const r = j(`saltiRiassunto("a1","2026-10-24")`);
  assert.equal(r.sett, 150);
  assert.equal(r.media4, Math.round((100+80+120)/4));
  assert.equal(r.ultima.n, 60);
  assert.equal(j(`saltiRiassunto("a2","2026-10-24")`), null);
});

prova("merge: le sedute si uniscono, una cancellata non torna", () => {
  squadra();
  const server = j(`{athletes:S.athletes, data:{}, salti:{a1:[{d:"2026-10-20",exercise:"v1",n:50},{d:"2026-10-21",exercise:"v2",n:30}]}}`);
  run(`S.salti={a1:[{d:"2026-10-22",exercise:"v3",n:20}]}; S.tomb={"salto:a1:2026-10-21|v2":"2026-10-23T00:00:00Z"}`);
  const out = j(`mergeState(${JSON.stringify(server)}, S)`);
  assert.deepEqual(out.salti.a1.map(e => e.exercise), ["v1","v3"]);
});

prova("backup e ripristino: tornano interi; niente di strano entra", () => {
  squadra();
  run(`S.salti={a1:[{d:"2026-10-20",exercise:"vabc",nome:"Partita",n:40,att:20,muro:10,batt:5,alz:0,alt:5,src:"mano"}], fantasma:[{d:"2026-10-20",exercise:"v1",n:3}]}`);
  const o = j(`sanitizeImport(JSON.parse(JSON.stringify(S))).salti`);
  assert.deepEqual(o, {a1:[{d:"2026-10-20",exercise:"vabc",nome:"Partita",n:40,att:20,muro:10,batt:5,alz:0,alt:5,src:"mano"}]});
  run(`S.salti={a1:[{d:"ieri",exercise:"v1",n:3},{d:"2026-10-20",exercise:"<b>",n:3},{d:"2026-10-20",exercise:"v2",n:-4},{d:"2026-10-20",exercise:"v3",n:99999}]}`);
  assert.equal(run(`sanitizeImport(JSON.parse(JSON.stringify(S))).salti.a1`), undefined);
});

prova("cancellare un'atleta toglie i suoi salti", () => {
  squadra();
  run(`S.salti={a1:[{d:"2026-10-20",exercise:"v1",n:3}],a2:[{d:"2026-10-20",exercise:"v1",n:5}]}; confirm=()=>true; closeM=()=>{}; delAthlete("a1")`);
  assert.equal(run(`S.salti.a1`), undefined);
  assert.equal(run(`S.salti.a2.length`), 1);
});

prova("la vista si disegna; senza video invita ad aprirne uno", () => {
  squadra();
  run(`S.view="video"; VID.rec=null; document.getElementById("grid").innerHTML=""; renderVideo()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /Salti dal video/);
  assert.match(h, /resta su questo computer/);
});

prova("segnare a mano: tipo, atleta, tempo; togliere", () => {
  squadra();
  run(`VID.rec=vidNuovoRec({name:"p.mp4"}); VID.key=null; vidEl=function(){ return {currentTime:12.345, pause(){}, play(){}}; }; VID.tipo="muro"; vidSegna("a2")`);
  assert.deepEqual(j(`VID.rec.eventi`), [{t:12.35, aid:"a2", tipo:"muro", fonte:"mano"}]);
  run(`vidTogli(12.35,"a2")`);
  assert.equal(j(`VID.rec.eventi`).length, 0);
});

prova("salvare nel carico: mano + AI con nome, una volta per salto", () => {
  squadra();
  run(`VID.rec=vidNuovoRec({name:"p.mp4"}); VID.rec.data="2026-10-24"; VID.rec.eventi=[{t:10,aid:"a1",tipo:"att",fonte:"mano"}];
       VID.rec.ai.candidati=[{t:10.3,tr:"t1"},{t:20,tr:"t1"},{t:30,tr:"t2"},{t:40,tr:"t3"}]; VID.rec.ai.tracce={t1:"a1",t2:"no"}; confirm=()=>true; vidSalvaCarico()`);
  assert.equal(run(`S.salti.a1[0].n`), 2, "10 a mano + 20 dall'AI; 10,3 e' lo stesso salto");
  assert.equal(run(`S.salti.a1[0].src`), "misto");
  assert.equal(run(`S.salti.a2`), undefined);
});

prova("Fatica mostra i salti della settimana", () => {
  squadra();
  run(`S.salti={a1:[{d:todayISO(),exercise:"v1",n:57}]}; S.readiness={}; S.load={}; renderReadiness()`);
  assert.match(run(`document.getElementById("grid").innerHTML`), /Salti 7gg 57/);
});

// ── i file che servono all'AI, e la regola di sicurezza che li lascia partire ──
import { existsSync } from "node:fs";
prova("modello e libreria ci sono, e il modello punta al suo file di pesi", () => {
  const root = join(here, "..");
  assert.ok(existsSync(join(root, "vendor", "tf.min.js")), "manca vendor/tf.min.js");
  const tfjs = readFileSync(join(root, "vendor", "tf.min.js"), "utf8");
  assert.ok(!/Function\(\s*["']return this["']\s*\)/.test(tfjs), "serve il bundle ES2017: quello classico usa Function('return this') e la CSP lo blocca");
  const m = JSON.parse(readFileSync(join(root, "models", "movenet-multipose.json"), "utf8"));
  m.weightsManifest.forEach(w => w.paths.forEach(pp => assert.ok(existsSync(join(root, "models", pp)), "manca models/" + pp)));
  assert.match(html, /s\.src="vendor\/tf\.min\.js"/);
  assert.match(html, /loadGraphModel\("models\/movenet-multipose\.json"\)/);
});
prova("la CSP del sito lascia leggere il video (media-src blob:)", () => {
  const vj = join(here, "..", "vercel.json");
  if (!existsSync(vj)) { console.log("        (vercel.json non c'e' qui: controllo saltato)"); return; }
  const csp = JSON.stringify(JSON.parse(readFileSync(vj, "utf8")));
  assert.match(csp, /media-src[^;]*blob:/, "senza media-src blob: il video aperto dal computer non si vede");
  assert.doesNotMatch(csp, /unsafe-eval/, "la CSP non deve aprirsi a eval: per questo si usa il bundle ES2017");
});

console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
