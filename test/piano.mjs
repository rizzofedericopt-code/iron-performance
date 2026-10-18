// Piano: il blocco di settimane fra due test.
//
//   node test/piano.mjs
//
// Cosa deve essere vero:
//   1. le settimane vanno dall'inizio al test; una settimana non toccata eredita
//      l'ultima scritta, e cambiare una settimana non riscrive quelle gia' fatte
//   2. i gruppi sono quelli della scheda di seduta, ma con tutte le atlete
//      (l'appello di oggi non dice chi ci sara' la settimana prossima)
//   3. l'RPE congela il carico del giorno: un massimale nuovo non riscrive la storia
//   4. il suggerimento viene dal RIR con le stesse formule della stima da
//      ripetizioni, non supera 5 punti, e' arrotondato a 2,5
//   5. il blocco sopravvive a merge, backup e ripristino; cancellare un'atleta
//      toglie i suoi RPE; cancellare la squadra toglie i suoi blocchi
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
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}];
  S.activeTeam="t1"; S.pres={}; S.tomb={}; S.te={}; S.gruppi={}; S.sedute={}; S.piani={}; S.gare={};
  PV={id:null,w:null};
  const A=[["a1","Sara",50,70],["a2","Giulia",52,90],["a3","Marta",54,72],
           ["a4","Elena",70,95],["a5","Chiara",72,75],["a6","Anna",74,98]];
  S.athletes=A.map(x=>({id:x[0],name:x[1],sex:"F",team:"t1"}));
  S.data={}; A.forEach(x=>{ S.data[x[0]]={rmSquat:[{d:"2026-09-01",v:x[2]}], rmDead:[{d:"2026-09-01",v:x[3]}]}; });
}`);
const blocco = (o) => run(`{
  const b=Object.assign({id:"b1", nome:"Forza", da:"2026-10-05", a:"2026-11-15", rif:"rmSquat", size:3,
    sedute:[{id:"sA",nome:"A",acc:"",ex:[{t:"rmSquat",mode:"media"},{t:"rmDead",mode:"media"}]},
            {id:"sB",nome:"B",acc:"core",ex:[{t:"rmSquat",mode:"media"}]}],
    sett:[{p:{"sA:rmSquat":{pct:70,sr:"4×6",rir:3},"sA:rmDead":{pct:70,sr:"3×5",rir:3},"sB:rmSquat":{pct:65,sr:"3×8",rir:3}}}],
    rpe:{}, kg:{}}, ${JSON.stringify(o||{})});
  S.piani={t1:[b]}; PV={id:null,w:null};
}`);

console.log("\nPiano: il blocco fra due test");

prova("le settimane vanno dall'inizio al test, al massimo 16", () => {
  squadra(); blocco();
  assert.equal(run(`pianoNSett(S.piani.t1[0])`), 6);
  assert.equal(run(`pianoNSett({da:"2026-10-05",a:"2026-10-05"})`), 1);
  assert.equal(run(`pianoNSett({da:"2026-01-01",a:"2026-12-31"})`), 16);
  assert.deepEqual(j(`pianoSettInt(S.piani.t1[0],5)`), {da:"2026-11-09", a:"2026-11-15"});
});

prova("una settimana non toccata eredita l'ultima scritta", () => {
  squadra(); blocco();
  assert.equal(run(`pianoPx(S.piani.t1[0],4,"sA","rmSquat").pct`), 70);
  run(`S.piani.t1[0].sett[2]={p:{"sA:rmSquat":{pct:77.5,sr:"4×5",rir:2}}}`);
  assert.equal(run(`pianoPx(S.piani.t1[0],1,"sA","rmSquat").pct`), 70);
  assert.equal(run(`pianoPx(S.piani.t1[0],4,"sA","rmSquat").pct`), 77.5);
});

prova("cambiare una settimana non riscrive quelle dopo gia' fatte o con un RPE", () => {
  squadra(); blocco();
  // la settimana 2 (indice 1) ha un RPE: era a 70%
  run(`S.piani.t1[0].rpe["1:sA:rmSquat"]={a1:8}`);
  run(`todayISO=()=>"2026-10-07"`);         // siamo nella settimana 1
  run(`pianoPxSet(0,"sA","rmSquat","pct",75)`);
  assert.equal(run(`pianoPx(S.piani.t1[0],0,"sA","rmSquat").pct`), 75);
  assert.equal(run(`pianoPx(S.piani.t1[0],1,"sA","rmSquat").pct`), 70, "la settimana con RPE resta a 70");
  assert.equal(run(`pianoPx(S.piani.t1[0],2,"sA","rmSquat").pct`), 70, "e quelle dopo ereditano da lei");
  run(`todayISO=()=>isoLoc(new Date())`);
});

prova("una settimana futura senza RPE segue il cambio", () => {
  squadra(); blocco();
  run(`todayISO=()=>"2026-10-07"`);
  run(`pianoPxSet(0,"sA","rmSquat","pct",75)`);
  assert.equal(run(`pianoPx(S.piani.t1[0],3,"sA","rmSquat").pct`), 75);
  run(`todayISO=()=>isoLoc(new Date())`);
});

prova("valori assurdi non entrano", () => {
  squadra(); blocco();
  run(`pianoPxSet(0,"sA","rmSquat","pct",140); pianoPxSet(0,"sA","rmSquat","rir",9); pianoPxSet(0,"sA","rmSquat","sr","<b>")`);
  assert.deepEqual(j(`pianoPx(S.piani.t1[0],0,"sA","rmSquat")`), {pct:70, sr:"4×6", rir:3});
});

prova("i gruppi sono quelli della scheda, ma con tutte le atlete anche se oggi assenti", () => {
  squadra(); blocco();
  run(`presSet("a1",todayISO(),"a"); presSet("a2",todayISO(),"a")`);
  const r = j(`(function(){ const b=S.piani.t1[0]; return pianoCalc(b,0,b.sedute[0]); })()`);
  const membri = r.gruppi.flatMap(g => g.membri.map(m => m.id)).sort();
  assert.deepEqual(membri, ["a1","a2","a3","a4","a5","a6"]);
  assert.equal(r.gruppi.length, 2);
  // la scheda di oggi invece le lascia fuori
  const oggi = j(`sedutaCalc({ex:[{t:"rmSquat",pct:70,sr:"4×6",mode:"media"}],rif:"rmSquat",size:3})`);
  assert.ok(!oggi.gruppi.flatMap(g => g.membri.map(m => m.id)).includes("a1"));
});

prova("i gruppi a mano della squadra valgono anche nel piano", () => {
  squadra(); blocco();
  run(`S.gruppi["rmSquat@t1"]={d:"2026-10-01", g:[["a1","a6"],["a2","a3","a4","a5"]]}`);
  const r = j(`(function(){ const b=S.piani.t1[0]; return pianoCalc(b,0,b.sedute[0]); })()`);
  const g = r.gruppi.map(g => g.membri.map(m => m.id).sort().join(","));
  assert.ok(g.includes("a1,a6"), g.join(" | "));
});

prova("l'RPE congela il carico del giorno; un massimale nuovo non riscrive la storia", () => {
  squadra(); blocco();
  run(`pianoSetRpe(0,"sA","rmSquat","a1",8)`);
  const kg0 = run(`S.piani.t1[0].kg["0:sA:rmSquat"].a1`);
  assert.ok(kg0 > 0);
  run(`S.data.a1.rmSquat.push({d:"2026-10-20",v:80}); S.data.a2.rmSquat.push({d:"2026-10-20",v:82}); S.data.a3.rmSquat.push({d:"2026-10-20",v:84})`);
  assert.equal(run(`S.piani.t1[0].kg["0:sA:rmSquat"].a1`), kg0);
  // cambiare il voto non cambia il carico congelato
  run(`pianoSetRpe(0,"sA","rmSquat","a1",9)`);
  assert.equal(run(`S.piani.t1[0].kg["0:sA:rmSquat"].a1`), kg0);
  assert.equal(run(`S.piani.t1[0].rpe["0:sA:rmSquat"].a1`), 9);
  // togliere il voto toglie anche il carico
  run(`pianoSetRpe(0,"sA","rmSquat","a1","")`);
  assert.equal(run(`S.piani.t1[0].kg["0:sA:rmSquat"].a1`), undefined);
});

prova("RPE fuori scala non entra; si arrotonda al mezzo punto", () => {
  squadra(); blocco();
  run(`pianoSetRpe(0,"sA","rmSquat","a1",14); pianoSetRpe(0,"sA","rmSquat","a2",7.3)`);
  assert.deepEqual(j(`S.piani.t1[0].rpe["0:sA:rmSquat"]`), {a2:7.5});
});

prova("suggerimento: dalle formule della stima da ripetizioni", () => {
  // 4×5 al 75% con RIR previsto 2: RPE 7 vuol dire RIR 3, cioe' piu' facile
  const s = j(`pianoSugg(75,"4×5",2,7)`);
  const atteso = run(`Math.round(Math.min(80,Math.max(70,75*rmFactor(8)/rmFactor(7)))/2.5)*2.5`);
  assert.equal(s.pct, atteso);
  assert.ok(s.pct > 75 && s.metodo === "formule");
  const giu = j(`pianoSugg(75,"4×5",2,9.5)`);
  assert.ok(giu.pct < 75, JSON.stringify(giu));
  assert.equal(j(`pianoSugg(75,"4×5",2,8)`).delta, 0);
});

prova("suggerimento: mai oltre 5 punti, arrotondato a 2,5", () => {
  const su = j(`pianoSugg(60,"5×3",1,4)`);
  assert.ok(su.pct <= 65 && su.pct % 2.5 === 0, JSON.stringify(su));
  const giu = j(`pianoSugg(85,"5×3",4,10)`);
  assert.ok(giu.pct >= 80 && giu.pct % 2.5 === 0, JSON.stringify(giu));
});

prova("suggerimento: la progressione che hai scritto resta, si corregge solo lo scarto", () => {
  // settimana dopo gia' prevista al 77,5: RPE come previsto → resta 77,5
  assert.equal(j(`pianoSugg(75,"4×5",2,8,77.5)`).pct, 77.5);
  assert.equal(j(`pianoSugg(75,"4×5",2,8,77.5)`).delta, 0);
  // piu' facile: si sale rispetto al 77,5, non rispetto al 75
  const su = j(`pianoSugg(75,"4×5",2,7,77.5)`);
  assert.ok(su.pct > 77.5 && su.pct <= 82.5, JSON.stringify(su));
  // regola pratica: lo scarto (RIR 4 contro 2) si somma alla settimana dopo
  assert.equal(j(`pianoSugg(65,"3×10",2,6,67.5)`).pct, 72.5);
});

prova("suggerimento: oltre 10 ripetizioni equivalenti, regola pratica", () => {
  const s = j(`pianoSugg(65,"3×10",2,6)`);
  assert.equal(s.metodo, "regola");
  assert.equal(s.pct, 70);   // RIR 4 contro 2: +5
  assert.equal(j(`pianoSugg(65,"3×10",2,"")`), null);
  assert.equal(j(`pianoSugg(65,"nulla",2,7)`), null);
});

prova("i numeri della settimana: intensita', ripetizioni, tonnellaggio a testa", () => {
  squadra(); blocco();
  const s = j(`pianoSettStat(S.piani.t1[0],0)`);
  // A: 4×6 al 70 + 3×5 al 70; B: 3×8 al 65 → 24+15+24 = 63 rip a testa
  assert.equal(s.rip, 63);
  const intens = (70*24 + 70*15 + 65*24) / 63;
  assert.ok(Math.abs(s.intens - intens) < 1e-9);
  assert.ok(s.ton > 0);
  assert.equal(s.rpe, null);
  assert.ok(Math.abs(s.obiettivo - 7) < 1e-9);
});

prova("le gare della settimana e le presenze dall'appello", () => {
  squadra(); blocco();
  run(`S.gare.t1=[{d:"2026-10-10",avv:"Volley X",casa:true},{d:"2026-10-30",avv:"Y",casa:false}]`);
  run(`presSet("a1","2026-10-06","p"); presSet("a2","2026-10-06","a")`);
  const s = j(`pianoSettStat(S.piani.t1[0],0)`);
  assert.equal(s.gare.length, 1);
  assert.equal(s.pres, 50);
});

prova("la seduta va nella scheda di seduta con le % della settimana", () => {
  squadra(); blocco();
  run(`S.piani.t1[0].sett[1]={p:{"sA:rmSquat":{pct:75,sr:"4×5",rir:2}}}; openSeduta=function(){}`);
  run(`pianoApriScheda(1,"sA")`);
  const c = j(`S.sedute.t1`);
  assert.equal(c.ex[0].pct, 75);
  assert.equal(c.ex[1].pct, 70);
  assert.equal(c.rif, "rmSquat");
});

prova("merge: la struttura vince qui, gli RPE si uniscono", () => {
  squadra(); blocco();
  const server = j(`(function(){ const o=JSON.parse(JSON.stringify(S)); o.piani.t1[0].nome="Vecchio"; o.piani.t1[0].rpe={"0:sA:rmSquat":{a2:8}}; return o; })()`);
  run(`S.piani.t1[0].rpe={"1:sA:rmSquat":{a1:7}}`);
  const out = j(`mergeState(${JSON.stringify(server)}, S)`);
  assert.equal(out.piani.t1[0].nome, "Forza");
  assert.deepEqual(out.piani.t1[0].rpe, {"0:sA:rmSquat":{a2:8}, "1:sA:rmSquat":{a1:7}});
});

prova("merge: un blocco eliminato non torna, una squadra eliminata nemmeno", () => {
  squadra(); blocco();
  const server = j(`JSON.parse(JSON.stringify(S))`);
  run(`confirm=()=>true; pianoElimina("b1")`);
  let out = j(`mergeState(${JSON.stringify(server)}, S)`);
  assert.equal((out.piani.t1 || []).length, 0);
  squadra(); blocco();
  run(`S.tomb["team:t1"]="2026-10-01T00:00:00Z"`);
  out = j(`mergeState(${JSON.stringify(server)}, S)`);
  assert.equal(out.piani.t1, undefined);
});

prova("backup e ripristino: il blocco torna intero", () => {
  squadra(); blocco();
  run(`pianoSetRpe(0,"sA","rmSquat","a1",8); S.piani.t1[0].sett[0].fase="accumulo"`);
  const prima = j(`S.piani.t1[0]`);
  const dopo = j(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1[0]`);
  assert.deepEqual(dopo, prima);
});

prova("ripristino: niente codice, niente atlete che non esistono, niente esercizi sconosciuti", () => {
  squadra(); blocco();
  run(`const b=S.piani.t1[0]; b.sedute[0].ex.push({t:"<script>",mode:"x"}); b.sett[0].p["sA:rmSquat"].sr="4×5<img>";
       b.rpe["0:sA:rmSquat"]={a1:8, fantasma:7, a2:99}; b.nome="x".repeat(500); b.id="bad id!"`);
  assert.equal(run(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1`), undefined);
  run(`S.piani.t1[0].id="b1"`);
  const b = j(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1[0]`);
  assert.equal(b.sedute[0].ex.length, 2);
  assert.equal(b.sett[0].p["sA:rmSquat"].sr, "4×5");
  assert.deepEqual(b.rpe["0:sA:rmSquat"], {a1:8});
  assert.equal(b.nome.length, 60);
});

prova("cancellare un'atleta toglie i suoi RPE e i suoi carichi", () => {
  squadra(); blocco();
  run(`pianoSetRpe(0,"sA","rmSquat","a1",8); pianoSetRpe(0,"sA","rmSquat","a2",7); confirm=()=>true; closeM=()=>{}; delAthlete("a1")`);
  assert.deepEqual(j(`S.piani.t1[0].rpe["0:sA:rmSquat"]`), {a2:7});
  assert.equal(run(`S.piani.t1[0].kg["0:sA:rmSquat"].a1`), undefined);
});

prova("cancellare la squadra toglie i suoi blocchi", () => {
  squadra(); blocco();
  run(`confirm=()=>true; manageTeams=()=>{}; delTeam("t1")`);
  assert.equal(run(`S.piani.t1`), undefined);
});

prova("una colonna tua che confluisce nel massimale si porta dietro il piano", () => {
  squadra();
  run(`S.custom=[{id:"uSq",name:"Squat",unit:"kg",base:"pred"}]; applyCustom();`);
  run(`S.data.a1.uSq=[{d:"2026-09-10",v:60,fonte:"reps"}]`);
  blocco({rif:"uSq", sedute:[{id:"sA",nome:"A",acc:"",ex:[{t:"uSq",mode:"media"}]}],
          sett:[{p:{"sA:uSq":{pct:72.5,sr:"4×5",rir:2}}}], rpe:{"0:sA:uSq":{a1:8}}, kg:{}});
  run(`customUnisciTutti()`);
  const b = j(`S.piani.t1[0]`);
  assert.equal(b.sedute[0].ex[0].t, "rmSquat");
  assert.equal(b.sett[0].p["sA:rmSquat"].pct, 72.5);
  assert.deepEqual(b.rpe["0:sA:rmSquat"], {a1:8});
  assert.equal(b.rif, "rmSquat");
});

prova("la vista si disegna senza errori, anche senza blocco e senza squadra", () => {
  squadra();
  run(`document.getElementById("grid").innerHTML=""; renderPiano()`);
  assert.match(run(`document.getElementById("grid").innerHTML`), /Crea il blocco/);
  blocco();
  run(`renderPiano()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /Settimana/);
  assert.match(h, /Andamento del blocco/);
  run(`S.activeTeam="all"; renderPiano()`);
  assert.match(run(`document.getElementById("grid").innerHTML`), /Scegli una squadra/);
});

prova("il banner in Oggi compare solo durante il blocco", () => {
  squadra(); blocco();
  run(`todayISO=()=>"2026-10-20"`);
  assert.match(run(`pianoBanner()`), /S3\/6/);
  run(`todayISO=()=>"2026-12-20"`);
  assert.equal(run(`pianoBanner()`), "");
  run(`todayISO=()=>isoLoc(new Date())`);
});


// ── esercizi liberi ──────────────────────────────────────────────────────
const conLiberi = () => blocco({
  sedute:[{id:"sA",nome:"A",acc:"",ex:[{t:"rmSquat",mode:"media"},{t:"xAff1",nome:"Affondi bulgari",libero:true},{t:"xPlk1",nome:"Plank",libero:true}]},
          {id:"sB",nome:"B",acc:"",ex:[{t:"xNor1",nome:"Nordic",libero:true}]}],
  sett:[{p:{"sA:rmSquat":{pct:70,sr:"4×6",rir:3},"sA:xAff1":{sr:"3×8",rir:2,kg:10},"sA:xPlk1":{sr:"3×1",rir:2,kg:null},"sB:xNor1":{sr:"3×5",rir:2,kg:null}}}]});

prova("liberi: si legge la prescrizione, anche quella di default", () => {
  squadra(); conLiberi();
  const l = j(`pianoLiberi(S.piani.t1[0],0,S.piani.t1[0].sedute[0])`);
  assert.deepEqual(l.map(e => e.nome), ["Affondi bulgari","Plank"]);
  assert.equal(l[0].kg, 10);
  assert.equal(l[1].kg, null);
  assert.deepEqual(j(`pianoPx(S.piani.t1[0],0,"sA","xNuovo")`), {sr:"3×10", rir:2, kg:null});
  // non finiscono nel calcolo dei gruppi (non hanno massimale)
  assert.deepEqual(j(`pianoEx(S.piani.t1[0],0,S.piani.t1[0].sedute[0])`).map(e => e.t), ["rmSquat"]);
});

prova("liberi: carico a mano, vuoto = corpo libero, valori assurdi no", () => {
  squadra(); conLiberi();
  run(`pianoPxSet(0,"sA","xAff1","kg","12,5")`);
  assert.equal(run(`pianoPx(S.piani.t1[0],0,"sA","xAff1").kg`), 12.5);
  run(`pianoPxSet(0,"sA","xAff1","kg","")`);
  assert.equal(run(`pianoPx(S.piani.t1[0],0,"sA","xAff1").kg`), null);
  run(`pianoPxSet(0,"sA","xAff1","kg","900")`);
  assert.equal(run(`pianoPx(S.piani.t1[0],0,"sA","xAff1").kg`), null);
});

prova("liberi: suggerimento in kg con lo stesso conto, mai oltre il 10%", () => {
  // 3×8 con 10 kg, RIR previsto 2, RPE 7 → RIR 3: 8+3=11 > 10 → regola pratica +3,5%
  const r = j(`pianoSuggKg(10,"3×8",2,7,null)`);
  assert.equal(r.metodo, "regola");
  assert.equal(r.kg, 10.5);
  // 3×5 con 20 kg, RIR 2, RPE 7: formule
  const f = j(`pianoSuggKg(20,"3×5",2,7,null)`);
  const atteso = run(`Math.round(20*Math.min(1.1,rmFactor(8)/rmFactor(7))*2)/2`);
  assert.equal(f.metodo, "formule"); assert.equal(f.kg, atteso);
  // la settimana dopo come l'hai scritta: e' la base
  assert.equal(j(`pianoSuggKg(20,"3×5",2,8,22.5)`).kg, 22.5);
  // tetto
  assert.ok(j(`pianoSuggKg(20,"5×3",0,4,null)`).kg <= 22);
  assert.ok(j(`pianoSuggKg(20,"5×3",4,10,null)`).kg >= 18);
});

prova("liberi a corpo libero: si dice solo da che parte andare", () => {
  const s = j(`pianoSuggKg(null,"3×5",2,6,null)`);
  assert.equal(s.kg, null); assert.equal(s.diff, 2);
  squadra(); conLiberi();
  run(`pianoSetRpe(0,"sB","xNor1","a1",6); pianoSetRpe(0,"sB","xNor1","a2",6)`);
  const h = run(`(function(){ const b=S.piani.t1[0], sed=b.sedute[1]; return pianoLibSugHtml(b,0,6,sed,pianoLiberi(b,0,sed)[0]); })()`);
  assert.match(h, /più facile del previsto/);
  assert.doesNotMatch(h, /Applica/);
});

prova("liberi: l'RPE congela il carico previsto; cambiarlo dopo non riscrive", () => {
  squadra(); conLiberi();
  run(`pianoSetRpe(0,"sA","xAff1","a3",8)`);
  assert.equal(run(`S.piani.t1[0].kg["0:sA:xAff1"].a3`), 10);
  run(`pianoPxSet(0,"sA","xAff1","kg","14")`);
  assert.equal(run(`S.piani.t1[0].kg["0:sA:xAff1"].a3`), 10);
  run(`pianoSetRpe(0,"sA","xPlk1","a3",7)`);
  assert.equal(run(`S.piani.t1[0].kg["0:sA:xPlk1"].a3`), undefined, "a corpo libero niente kg");
});

prova("liberi: entrano nei numeri della settimana, per tutte", () => {
  squadra(); conLiberi();
  const s = j(`pianoSettStat(S.piani.t1[0],0)`);
  // squat 4×6=24 + affondi 3×8=24 + plank 3×1=3 + nordic 3×5=15 = 66 a testa
  assert.equal(s.rip, 66);
  assert.ok(Math.abs(s.intens - 70) < 1e-9, "l'intensità resta quella dei massimali");
  // tonnellaggio: squat (carico del gruppo) + affondi 24×10
  const soloSquat = j(`(function(){ const b=JSON.parse(JSON.stringify(S.piani.t1[0])); b.sedute[0].ex=b.sedute[0].ex.slice(0,1); b.sedute=b.sedute.slice(0,1); return pianoSettStat(b,0).ton; })()`);
  assert.equal(s.ton, soloSquat + 240);
});

prova("liberi: l'RPE si segna per tutte la squadra, anche senza massimali", () => {
  squadra(); conLiberi();
  run(`S.data.a6={}; S.athletes.push({id:"a6",name:"Nuova",team:"t1"}); openPianoRpe(0,"sB","xNor1");`);
  const h = run(`document.getElementById("prBody").innerHTML`);
  ["Sara","Giulia","Marta","Elena","Chiara","Anna","Nuova"].forEach(n => assert.ok(h.includes(n), n + " manca"));
});

prova("liberi nella scheda di seduta: vanno sotto «Poi»; seduta senza massimali non si apre", () => {
  squadra(); conLiberi();
  run(`openSeduta=function(){ APERTA=true }; var APERTA=false; pianoApriScheda(0,"sA")`);
  const c = j(`S.sedute.t1`);
  assert.deepEqual(c.ex.map(e => e.t), ["rmSquat"]);
  assert.match(c.altro, /Affondi bulgari — 3×8 · 10 kg · RIR 2/);
  assert.match(c.altro, /Plank — 3×1 · corpo libero/);
  run(`APERTA=false; pianoApriScheda(0,"sB")`);
  assert.equal(run(`APERTA`), false);
  assert.match(run(`LASTT`), /non ha esercizi con massimale/);
  // la scheda li conserva nel ripristino
  assert.match(j(`sanitizeImport(JSON.parse(JSON.stringify(S))).sedute.t1.altro`), /Affondi/);
});

prova("liberi: il blocco si crea anche senza nessun massimale", () => {
  squadra();
  run(`S.data={}; S.piani={}; PF=null; openPianoForm()`);
  const pf = j(`PF`);
  assert.equal(pf.sedute[0].ex.length, 1);
  assert.equal(pf.sedute[0].ex[0].libero, true);
  run(`pfSalva()`);
  assert.match(run(`LASTT`), /senza nome/, "un libero senza nome non si salva");
  run(`PF.sedute[0].ex[0].nome="  Affondi  "; pfSalva()`);
  assert.equal(run(`S.piani.t1[0].sedute[0].ex[0].nome`), "Affondi");
  assert.deepEqual(j(`pianoNomiLiberi()`), ["Affondi"]);
});

prova("liberi: backup e ripristino; id e nomi controllati", () => {
  squadra(); conLiberi();
  run(`pianoSetRpe(0,"sA","xAff1","a1",8)`);
  const prima = j(`S.piani.t1[0]`);
  assert.deepEqual(j(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1[0]`), prima);
  run(`S.piani.t1[0].sedute[0].ex.push({t:"x<img>",nome:"x",libero:true},{t:"xVuoto",nome:"   ",libero:true})`);
  const dopo = j(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1[0].sedute[0].ex`);
  assert.equal(dopo.length, 3);
});

prova("liberi: la vista e la stampa li mostrano", () => {
  squadra(); conLiberi();
  run(`renderPiano()`);
  const h = run(`document.getElementById("grid").innerHTML`);
  assert.match(h, /Affondi bulgari/); assert.match(h, /Nordic/); assert.match(h, /libero/);
});

prova("applicare un suggerimento non lo fa ricalcolare all'infinito", () => {
  squadra(); blocco();
  ["a1","a2","a3","a4","a5","a6"].forEach(a => run(`pianoSetRpe(0,"sA","rmDead","${a}",6)`));   // 3×5 RIR 3 → RPE 7 previsto, 6 = piu' facile
  const html = () => run(`(function(){ const b=S.piani.t1[0], sed=b.sedute[0], r=pianoCalc(b,0,sed); return pianoSugHtml(b,0,6,sed,r,1); })()`);
  const m = html().match(/<b>([\d.]+)%<\/b> invece di 70%/);
  assert.ok(m, html());
  const sugg = +m[1];
  run(`pianoApplica(1,"sA","rmDead",${sugg},6)`);
  assert.equal(run(`pianoPx(S.piani.t1[0],1,"sA","rmDead").pct`), sugg);
  const dopo = html();
  assert.match(dopo, /già adattata dall'RPE: da 70% a <b>/);
  assert.doesNotMatch(dopo, /Applica/);
  // se l'RPE cambia, il nuovo suggerimento parte ancora da 70, non da quello applicato
  ["a1","a2","a3","a4","a5","a6"].forEach(a => run(`pianoSetRpe(0,"sA","rmDead","${a}",7)`));
  assert.match(html(), /in linea con il previsto → settimana 2: <b>70%<\/b>/);
  // un carico cambiato a mano toglie il segno
  run(`pianoPxSet(1,"sA","rmDead","pct",80)`);
  assert.equal(run(`pianoPx(S.piani.t1[0],1,"sA","rmDead").adj`), undefined);
});

prova("il segno «adattata» di una settimana non vale per quelle che la ereditano", () => {
  squadra(); blocco();
  run(`S.piani.t1[0].sett[1]={p:{"sA:rmDead":{pct:72.5,sr:"3×5",rir:3,adj:{w:1,da:70,rpe:6}}}}`);
  assert.equal(run(`pianoBase(pianoPx(S.piani.t1[0],2,"sA","rmDead"),2,"pct")`), 72.5);
  assert.equal(run(`pianoBase(pianoPx(S.piani.t1[0],1,"sA","rmDead"),1,"pct")`), 70);
});

prova("liberi: anche col carico in kg il suggerimento applicato non si somma", () => {
  squadra(); conLiberi();
  ["a1","a2","a3"].forEach(a => run(`pianoSetRpe(0,"sA","xAff1","${a}",6)`));
  const html = () => run(`(function(){ const b=S.piani.t1[0], sed=b.sedute[0]; return pianoLibSugHtml(b,0,6,sed,pianoLiberi(b,0,sed)[0]); })()`);
  const kg = +html().match(/<b>([\d.]+) kg<\/b> invece di 10/)[1];
  run(`pianoApplicaKg(1,"sA","xAff1",${kg},6)`);
  assert.match(html(), /già adattata dall'RPE: da 10 a <b>/);
  assert.doesNotMatch(html(), /Applica/);
});

prova("liberi a tempo: 3×30s si scrive, non conta come ripetizioni, il consiglio e' in secondi", () => {
  squadra(); conLiberi();
  run(`pianoPxSet(0,"sA","xPlk1","sr","3×30s")`);
  assert.equal(run(`pianoPx(S.piani.t1[0],0,"sA","xPlk1").sr`), "3×30s");
  run(`pianoPxSet(0,"sA","rmSquat","sr","3×30s")`);
  assert.equal(run(`pianoPx(S.piani.t1[0],0,"sA","rmSquat").sr`), "4×6", "un massimale non va a tempo");
  const s = j(`pianoSettStat(S.piani.t1[0],0)`);
  assert.equal(s.rip, 24 + 24 + 15, "il plank non conta come ripetizioni");
  run(`pianoSetRpe(0,"sA","xPlk1","a1",5.5)`);
  const h = run(`(function(){ const b=S.piani.t1[0], sed=b.sedute[0]; return pianoLibSugHtml(b,0,6,sed,pianoLiberi(b,0,sed)[1]); })()`);
  assert.match(h, /secondi in più/);
  const back = j(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1[0].sett[0].p["sA:xPlk1"].sr`);
  assert.equal(back, "3×30s");
});

prova("ripristino: il segno «adattata» torna, se e' sensato", () => {
  squadra(); blocco();
  run(`S.piani.t1[0].sett[1]={p:{"sA:rmDead":{pct:72.5,sr:"3×5",rir:3,adj:{w:1,da:70,rpe:6}},"sA:rmSquat":{pct:72.5,sr:"4×6",rir:3,adj:{w:"<x>",da:-1}}}}`);
  const p = j(`sanitizeImport(JSON.parse(JSON.stringify(S))).piani.t1[0].sett[1].p`);
  assert.deepEqual(p["sA:rmDead"].adj, {w:1, da:70, rpe:6});
  assert.equal(p["sA:rmSquat"].adj, undefined);
});

console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
