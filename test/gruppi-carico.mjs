// 1RM stimato da una serie a ripetizioni, e i gruppi di carico che ne escono.
//
//   node test/gruppi-carico.mjs
//
// Perche' questo test esiste. Tre cose possono andare storte in silenzio:
//
//   1. la stima. Una formula sola da' un numero pulito e nessuno sa di quanto
//      sbaglia. Qui sono sei e la mediana e' la stima: il test verifica dove
//      l'intervallo fra la piu' bassa e la piu' alta resta stretto e dove
//      esplode, perche' e' quello a dire quando il numero non vale piu' niente.
//   2. l'origine del dato. Una stima da ripetizioni non e' un massimale
//      sollevato. Se finisce nello storico senza marchio, fra sei mesi non si
//      distingue piu' — e la scala dei carichi della curva carico-velocita'
//      parte da un numero inventato credendolo misurato.
//   3. i gruppi. Tre atlete e un carico solo: qualcuna lavora piu' pesante del
//      previsto. Il test verifica che i gruppi si taglino dove la lista ha i
//      salti veri, non ogni tre nomi.

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
run(`normalize();`);   // S.cfg con i valori di default, come all'avvio vero

// niente disegno, niente rete: interessa solo cosa finisce nei dati
run(`var LASTT=""; render=function(){}; save=function(){}; toast=function(m){LASTT=String(m)};`);

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};
const vicino = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, (msg || "") + " atteso ~" + b + ", ottenuto " + a);

console.log("\n1RM da ripetizioni");

/* ── 1. la matematica ── */
prova("una ripetizione al cedimento E' il massimale, non una stima", () => {
  // Le formule a r=1 non tornano a 1 (Lander +1,4%, O'Conner +2,5%):
  // farle girare su un massimale vero lo gonfierebbe senza motivo.
  const e = run(`rmEstimate(100,1,0)`);
  assert.equal(e.kg, 100);
  assert.equal(e.lo, 100);
  assert.equal(e.hi, 100);
  assert.equal(e.liv, "misurato");
});

prova("a 5 ripetizioni la stima sta dove dice la letteratura", () => {
  const e = run(`rmEstimate(100,5,0)`);
  vicino(e.kg, 116.6, 1.5, "1RM da 100x5");
  assert.ok(e.lo < e.kg && e.kg < e.hi, "la mediana deve stare dentro l'intervallo");
  assert.ok(e.spread < 6, "a 5 ripetizioni le formule non possono divergere di piu' del 6%");
});

prova("l'intervallo resta stretto fino a 6 ripetizioni e poi esplode", () => {
  // Non cresce in modo regolare: da 2 a 6 sta fra il 4 e il 5%. E' da li' in
  // avanti che si apre, ed e' il motivo del tetto a 10.
  const s = n => run(`rmEstimate(100,${n},0)`).spread;
  [2, 3, 5, 6].forEach(n => assert.ok(s(n) < 6, n + " ripetizioni: spread " + s(n).toFixed(1) + "%"));
  assert.ok(s(10) > s(6), "a 10 deve essere piu' largo che a 6");
  assert.ok(s(15) > 15, "a 15 le formule divergono di oltre il 15%: " + s(15).toFixed(1) + "%");
});

prova("le ripetizioni di riserva si sommano a quelle fatte", () => {
  // 5 ripetizioni con 2 ancora in canna = 7 al cedimento. Non dichiararle
  // abbassa la stima, ed e' l'errore che fa un'under 18 che non va a cedimento.
  const conRir = run(`rmEstimate(50,5,2)`);
  const senza = run(`rmEstimate(50,7,0)`);
  assert.equal(conRir.kg, senza.kg);
  assert.equal(conRir.rEff, 7);
  const ignorata = run(`rmEstimate(50,5,0)`);
  assert.ok(conRir.kg > ignorata.kg, "ignorare la riserva sottostima");
  assert.ok((conRir.kg - ignorata.kg) / ignorata.kg > 0.04, "e la sottostima non e' trascurabile");
});

prova("oltre le 10 ripetizioni effettive la stima si dichiara inutilizzabile", () => {
  assert.equal(run(`rmEstimate(40,12,0)`).liv, "inutilizzabile");
  assert.equal(run(`rmEstimate(40,9,2)`).liv, "inutilizzabile");  // 11 effettive
  assert.equal(run(`rmEstimate(40,8,2)`).liv, "accettabile");     // 10 effettive
  assert.equal(run(`rmEstimate(40,4,2)`).liv, "buona");           // 6 effettive
});

prova("il carico per n ripetizioni e' l'inverso esatto della stima", () => {
  for (const r of [2, 3, 5, 8, 10]) {
    const est = run(`rmEstimate(60,${r},0)`).kg;
    const back = run(`rmLoadFor(${est},${r})`);
    vicino(back, 60, 0.01, r + "RM");
  }
});

prova("il 5RM sta all'87% circa dell'1RM", () => {
  const q = run(`rmLoadFor(100,5)`);
  vicino(q, 86, 3, "5RM su 100 kg");
  const t = run(`rmLoadFor(100,3)`);
  vicino(t, 92, 3, "3RM su 100 kg");
});

prova("le ripetizioni teoriche a una percentuale sono quelle delle tabelle", () => {
  assert.equal(run(`rmRepsAtPct(100)`), 1);
  assert.equal(run(`rmRepsAtPct(80)`), 8);
  assert.ok(Math.abs(run(`rmRepsAtPct(90)`) - 4) <= 1, "90% ~ 4 ripetizioni");
  assert.equal(run(`rmRepsAtPct(0)`), null);
  assert.equal(run(`rmRepsAtPct(140)`), null);
});

prova("input impossibili non producono numeri", () => {
  assert.equal(run(`rmEstimate(0,5,0)`), null);
  assert.equal(run(`rmEstimate(50,0,0)`), null);
  assert.equal(run(`rmEstimate("",5,0)`), null);
  assert.equal(run(`rmEstimate(50,"x",0)`), null);
  assert.equal(run(`rmEstimate(-20,5,0)`), null);
});

console.log("\nIl bilanciere vero");

prova("i carichi si arrotondano a quello che si puo' caricare davvero", () => {
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);
  assert.equal(run(`rmRound(63.7)`), 62.5);
  assert.equal(run(`rmRound(64.0)`), 65);
  assert.equal(run(`rmRound(61.3)`), 62.5);
});

prova("la scomposizione in dischi torna al chilo", () => {
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);
  for (const kg of [20, 22.5, 40, 62.5, 87.5, 100, 137.5]) {
    const p = run(`rmPlates(${kg})`);
    assert.equal(p.sotto, false, kg + " kg non e' sotto il bilanciere");
    const somma = 20 + 2 * p.perSide.reduce((a, b) => a + b, 0) + 2 * p.resto;
    vicino(somma, kg, 0.001, kg + " kg scomposto");
    assert.equal(p.resto, 0, kg + " kg deve chiudersi senza avanzi");
  }
});

prova("i dischi escono dal piu' pesante al piu' leggero, senza inutili", () => {
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);
  assert.equal(run(`rmPlates(62.5).perSide`).join(","), "20,1.25");
  assert.equal(run(`rmPlates(60).perSide`).join(","), "20");
  assert.equal(run(`rmPlates(50).perSide`).join(","), "15");
  assert.equal(run(`rmPlates(20).perSide`).length, 0, "bilanciere scarico");
});

prova("sotto il bilanciere scarico il carico viene segnalato, non inventato", () => {
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);
  // 15 kg al 60% di un 1RM di 25 kg su military press: succede davvero
  assert.equal(run(`rmPlates(15).sotto`), true);
  assert.ok(/sotto il bilanciere/.test(run(`rmPlatesText(15)`)));
});

prova("un bilanciere diverso cambia tutto, e viene dalle impostazioni", () => {
  run(`S.cfg.rmBar=10; S.cfg.rmStep=1;`);
  assert.equal(run(`rmPlates(30).perSide`).join(","), "10");
  assert.equal(run(`rmRound(30.4)`), 30);
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);   // ripristino
});

console.log("\nGruppi di carico");

const lista = kgs => `[${kgs.map((k, i) => `{nome:"a${i}",kg:${k}}`).join(",")}]`;

prova("i gruppi coprono tutte le atlete, una volta sola, in ordine", () => {
  const g = run(`rmGruppi(${lista([100, 95, 90, 85, 80, 75, 70, 65])},3)`);
  const piatto = [].concat.apply([], g).map(x => x.kg);
  assert.equal(piatto.join(","), "100,95,90,85,80,75,70,65");
  assert.equal(piatto.length, 8);
});

prova("il taglio rispetta i salti veri della lista, non conta fino a tre", () => {
  // 4 forti e 3 deboli. Il taglio ingenuo ogni 3 metterebbe la quarta forte
  // insieme a due deboli: 97 kg e 59 kg sullo stesso bilanciere.
  const g = run(`rmGruppi(${lista([100, 99, 98, 97, 60, 59, 58])},3)`);
  assert.equal(g.length, 2, "due gruppi, non tre");
  assert.equal(g[0].map(x => x.kg).join(","), "100,99,98,97");
  assert.equal(g[1].map(x => x.kg).join(","), "60,59,58");
});

prova("un'atleta da sola su un bilanciere non e' un gruppo", () => {
  // Con la penalita' sbagliata la programmazione dinamica preferiva sei gruppi
  // da uno: dispersione zero, e il cambio dischi a ogni serie.
  run(`rmGruppi(${lista([100, 90, 80, 70, 60, 50])},2)`).forEach(g =>
    assert.ok(g.length > 1, "gruppo da 1"));
  run(`rmGruppi(${lista([100, 90, 80, 70, 60, 50, 40])},3)`).forEach(g =>
    assert.ok(g.length > 1, "gruppo da 1"));
});

prova("liste corte non si spezzano", () => {
  assert.equal(run(`rmGruppi(${lista([80])},3)`).length, 1);
  assert.equal(run(`rmGruppi(${lista([80, 70])},3)`).length, 1);
  assert.equal(run(`rmGruppi([],3)`).length, 0);
});

prova("gruppi da 2 e da 4 fanno quello che dicono", () => {
  const due = run(`rmGruppi(${lista([100, 90, 80, 70, 60, 50])},2)`);
  assert.equal(due.length, 3);
  due.forEach(g => assert.ok(g.length >= 2 && g.length <= 3, "gruppo da " + g.length));
  const quattro = run(`rmGruppi(${lista([100, 90, 80, 70, 60, 50, 40, 30])},4)`);
  assert.equal(quattro.length, 2);
});

prova("il carico medio dice a ciascuna quale percentuale le tocca davvero", () => {
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);
  const r = run(`rmGruppoCarico(${lista([100, 90, 80])},70,"media")`);
  // ideali 70 / 63 / 56 → media 63 → 62,5 sul bilanciere
  assert.equal(r.load, 62.5);
  vicino(r.righe[0].eff, 62.5, 0.1, "la piu' forte");
  vicino(r.righe[2].eff, 78.1, 0.2, "la piu' debole");
  assert.equal(r.righe[0].cls, "warn", "-7,5 punti: piu' leggero, si segnala ma non e' un rischio");
  assert.equal(r.righe[2].cls, "bad", "+8,1 punti: e' pesante davvero");
  assert.equal(r.cls, "bad");
  assert.equal(r.sopra, 1, "una sola lavora davvero sopra il previsto");
});

prova("la soglia non e' simmetrica: sopra pesa piu' che sotto", () => {
  // 5 punti sotto il previsto e' uno stimolo piu' leggero; 5 punti sopra sono
  // ripetizioni che saltano. Trattarli uguale e' l'errore da non fare.
  assert.equal(run(`rmScarto(-5)`), "warn");
  assert.equal(run(`rmScarto(5)`), "warn");
  assert.equal(run(`rmScarto(-7)`), "warn");
  assert.equal(run(`rmScarto(7)`), "bad", "+7 punti deve essere rosso");
  assert.equal(run(`rmScarto(-9)`), "bad");
  assert.equal(run(`rmScarto(-3.5)`), "ok");
  assert.equal(run(`rmScarto(3.5)`), "warn", "+3,5 punti non e' gia' «a posto»");
});

prova("un gruppo omogeneo non produce allarmi", () => {
  const r = run(`rmGruppoCarico(${lista([82, 80, 78])},70,"media")`);
  assert.equal(r.cls, "ok", "tre atlete a 4 kg di distanza non devono allarmare");
  assert.equal(r.sopra, 0);
});

prova("in modalita' «la piu' leggera» nessuna lavora sopra il previsto", () => {
  run(`S.cfg.rmBar=20; S.cfg.rmStep=2.5;`);
  const r = run(`rmGruppoCarico(${lista([120, 100, 80])},75,"min")`);
  r.righe.forEach(x => assert.ok(x.eff <= 75 + 1.6,
    "nessuno oltre il 75% previsto (oltre l'arrotondamento): " + x.eff));
});

console.log("\nOrigine del dato");

prova("la stima finisce nello storico marchiata «reps»", () => {
  run(`S.athletes=[{id:"a1",name:"Sara",team:null,sex:"F"}]; S.data={}; S.lv={};`);
  Object.keys(campi).forEach(k => delete campi[k]);
  campi.rmD = "2026-09-15"; campi.rmEx = "Back squat";
  cache.rmSaveBtn = elFor("rmSaveBtn");
  Object.assign(cache.rmSaveBtn.dataset, { est: "100", lo: "96", hi: "104", w: "85", r: "4", rir: "1" });
  run(`saveRepMax("a1")`);
  const serie = run(`S.data["a1"].rmSquat`);
  assert.equal(serie.length, 1);
  assert.equal(serie[0].v, 100);
  assert.equal(serie[0].fonte, "reps");
  assert.equal(serie[0].rmW, 85, "il carico usato si conserva");
  assert.equal(serie[0].rmR, 4, "le ripetizioni si conservano");
  assert.equal(serie[0].rmRir, 1, "la riserva dichiarata si conserva");
});

prova("una stima non sovrascrive un massimale misurato nella stessa data", () => {
  run(`S.athletes=[{id:"a1",name:"Sara"}]; S.data={a1:{rmSquat:[{d:"2026-09-15",v:92}]}};`);
  Object.keys(campi).forEach(k => delete campi[k]);
  campi.rmD = "2026-09-15"; campi.rmEx = "Back squat";
  cache.rmSaveBtn = elFor("rmSaveBtn");
  Object.assign(cache.rmSaveBtn.dataset, { est: "120", lo: "115", hi: "125", w: "100", r: "4", rir: "0" });
  run(`saveRepMax("a1")`);
  const serie = run(`S.data["a1"].rmSquat`);
  assert.equal(serie.length, 1);
  assert.equal(serie[0].v, 92, "il massimale misurato resta");
  assert.ok(/non l'ho toccato/.test(run(`LASTT`)), "e te lo dice: " + run(`LASTT`));
});

prova("rm1RM prende l'ultimo dato e dichiara se e' una stima", () => {
  run(`S.athletes=[{id:"a1",name:"Sara"}];
       S.data={a1:{rmSquat:[{d:"2026-01-10",v:80},{d:"2026-06-01",v:95,fonte:"reps"}]}};`);
  const r = run(`rm1RM("a1","rmSquat")`);
  assert.equal(r.kg, 95);
  assert.equal(r.stima, true);
  assert.equal(r.tag, "stima");
  const r2 = run(`rm1RM("a1","rmBench")`);
  assert.equal(r2, null, "un test senza dati non inventa un massimale");
});

prova("un massimale sollevato non viene etichettato come stima", () => {
  run(`S.data={a1:{rmSquat:[{d:"2026-06-01",v:95}]}};`);
  const r = run(`rm1RM("a1","rmSquat")`);
  assert.equal(r.stima, false);
  assert.equal(r.tag, "misurato");
});

/* ── il difetto che questa modifica poteva introdurre ──
   `lvStartingMax` scartava solo le stime da curva e trattava tutto il resto
   come massimale vero. Una stima da ripetizioni sarebbe entrata da quella
   porta: la scala dei carichi del test carico-velocita' sarebbe partita da un
   numero estrapolato dicendo «massimale del ...». */
prova("la curva carico-velocita' non scambia una stima per un massimale", () => {
  run(`S.lv={}; S.data={a1:{rmSquat:[{d:"2026-06-01",v:95,fonte:"reps"}]}};`);
  const s = run(`lvStartingMax("a1","Back squat")`);
  assert.equal(s.kg, 95);
  assert.ok(!/massimale/.test(s.fonte), "non deve dire «massimale»: dice " + s.fonte);
  assert.ok(/stima/.test(s.fonte), "deve dichiararsi stima: dice " + s.fonte);
});

prova("un ripristino da backup non perde l'origine ne' come e' nata la stima", () => {
  const backup = JSON.stringify({
    athletes: [{ id: "a1", name: "Sara", sex: "F" }],
    data: { a1: { rmSquat: [{ d: "2026-06-01", v: 95, fonte: "reps", rmW: 80, rmR: 5, rmRir: 1, rmLo: 91, rmHi: 99 }] } },
  });
  const o = run(`sanitizeImport(${backup})`);
  const e = o.data.a1.rmSquat[0];
  assert.equal(e.fonte, "reps", "l'origine si perdeva al primo ripristino");
  assert.equal(e.rmW, 80); assert.equal(e.rmR, 5); assert.equal(e.rmRir, 1);
  assert.equal(e.rmLo, 91); assert.equal(e.rmHi, 99);
});

console.log("\nLa schermata");

prova("i gruppi si aprono dal menu e la stima dalla scheda atleta", () => {
  assert.ok(/onclick="openLoadGroups\(\)"/.test(html), "voce di menu assente");
  assert.ok(/openRepMaxEntry\(/.test(html), "bottone nella scheda atleta assente");
});

prova("una stima resta riconoscibile nella tabella, nello storico e nel CSV", () => {
  assert.ok(html.includes("Stimato da una serie a ripetizioni"), "manca il segno nella matrice");
  assert.ok(html.includes("Stimato da una serie a ripetizioni, non sollevato"), "manca il segno nello storico");
  assert.ok(html.includes("stima da serie a ripetizioni"), "manca l'origine nell'export CSV");
});

prova("la schermata dei gruppi non si rompe senza dati", () => {
  run(`S.athletes=[{id:"a1",name:"Sara",team:null}]; S.data={}; S.activeTeam="all"; LG={ex:"rmSquat",pct:75,size:3,mode:"media"};`);
  const h = run(`lgRes()`);
  assert.ok(/Nessuna ha un 1RM/.test(h), "deve dirlo, non mostrare gruppi vuoti");
  assert.ok(/openRepMaxEntry/.test(h), "e deve offrire la scorciatoia per rimediare");
});

prova("la schermata dei gruppi elenca chi ha il dato e chi no", () => {
  run(`S.athletes=[{id:"a1",name:"Sara"},{id:"a2",name:"Giulia"},{id:"a3",name:"Marta"}];
       S.data={a1:{rmSquat:[{d:"2026-06-01",v:90}]},a2:{rmSquat:[{d:"2026-06-01",v:70,fonte:"reps"}]}};
       S.activeTeam="all"; LG={ex:"rmSquat",pct:75,size:3,mode:"media"};`);
  const h = run(`lgRes()`);
  assert.ok(/Sara/.test(h) && /Giulia/.test(h), "chi ha il dato deve comparire nei gruppi");
  assert.ok(/Senza 1RM/.test(h) && /Marta/.test(h), "chi non ce l'ha va elencato a parte");
  assert.ok(/stima<\/span>/.test(h), "la stima di Giulia deve restare marcata anche qui");
});

console.log("\nOrdine e gruppi a mano");

const squadra = (kgs) => {
  const ath = kgs.map((k, i) => `{id:"p${i}",name:"P${i}",team:"t1",sex:"F"}`).join(",");
  const dat = kgs.map((k, i) => `p${i}:{rmSquat:[{d:"2026-06-01",v:${k}}]}`).join(",");
  run(`S.teams=[{id:"t1",name:"Sq",sport:"pallavolo"}]; S.activeTeam="t1";
       S.athletes=[${ath}]; S.data={${dat}}; S.gruppi={}; S.lv={};
       LG={ex:"rmSquat",pct:75,size:3,mode:"media",man:"auto",ord:"asc",sel:{}};`);
};

prova("l'ordine di default e' dal piu' leggero: sul bilanciere i dischi si aggiungono", () => {
  squadra([90, 60, 75]);
  assert.equal(run(`lgCandidate("rmSquat").con.map(x=>x.kg)`).join(","), "60,75,90");
  run(`LG.ord="desc"`);
  assert.equal(run(`lgCandidate("rmSquat").con.map(x=>x.kg)`).join(","), "90,75,60");
});

prova("chi non ha il dato finisce nella lista di chi manca, non sparisce", () => {
  squadra([90, 60]);
  run(`S.athletes.push({id:"px",name:"Senza",team:"t1",sex:"F"});`);
  const c = run(`lgCandidate("rmSquat")`);
  assert.equal(c.con.length, 2);
  assert.equal(c.senza.length, 1);
  assert.equal(c.senza[0].name, "Senza");
});

prova("un gruppo formato a mano resta salvato, e con la data", () => {
  squadra([90, 80, 70, 60]);
  run(`LG.man="man"; LG.sel={p0:1,p1:1};`);
  run(`lgForma()`);
  const g = run(`S.gruppi["rmSquat@t1"].g`);
  assert.equal(g.length, 1);
  assert.equal(g[0].slice().sort().join(","), "p0,p1");
  assert.ok(run(`S.gruppi["rmSquat@t1"].d`), "la data di formazione va conservata");
  assert.equal(Object.keys(run(`LG.sel`)).length, 0, "la selezione si azzera dopo");
});

prova("un gruppo da una sola non si forma", () => {
  squadra([90, 80, 70]);
  run(`LG.man="man"; LG.sel={p0:1};`);
  run(`lgForma()`);
  assert.equal(run(`S.gruppi["rmSquat@t1"]`), undefined, "non deve salvare niente");
  assert.ok(/almeno due/.test(run(`LASTT`)), "e deve dirlo");
});

prova("togliere un'atleta dal gruppo la rimette fra quelle da assegnare", () => {
  squadra([90, 80, 70, 60]);
  run(`LG.man="man"; LG.sel={p0:1,p1:1,p2:1}; lgForma();`);
  run(`lgTogli(0,"p1")`);
  assert.equal(run(`S.gruppi["rmSquat@t1"].g[0]`).join(","), "p0,p2");
  const h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/Da assegnare \(2\)/.test(h), "p1 e p3 devono tornare nel serbatoio");
});

prova("sciogliere l'ultimo gruppo cancella la voce, non lascia un guscio vuoto", () => {
  squadra([90, 80]);
  run(`LG.man="man"; LG.sel={p0:1,p1:1}; lgForma();`);
  run(`lgSciogli(0)`);
  assert.equal(run(`S.gruppi["rmSquat@t1"]`), undefined);
});

prova("«parti dall'automatico» copia la proposta e da li' la sposti tu", () => {
  squadra([100, 99, 98, 97, 60, 59, 58]);
  run(`LG.man="man"; LG.size=3; lgDaAuto();`);
  const g = run(`S.gruppi["rmSquat@t1"].g`);
  assert.equal(g.length, 2);
  assert.equal(g.map(x => x.length).sort().join(","), "3,4");
});

prova("i gruppi salvati non contengono doppioni ne' atleti cancellati", () => {
  squadra([90, 80, 70]);
  // stato sporco come potrebbe arrivare da una sincronizzazione andata storta
  run(`S.gruppi={"rmSquat@t1":{d:"2026-06-01",g:[["p0","p1","p0"],["fantasma"],["p2"]]}};`);
  const g = run(`lgSalvati(lgKey())`);
  assert.equal(g.length, 2, "il gruppo del solo fantasma sparisce");
  assert.equal(g[0].join(","), "p0,p1", "niente doppioni");
  assert.equal(g[1].join(","), "p2");
});

prova("chi e' in un gruppo ma non ha piu' il dato viene nominato, non ignorato", () => {
  squadra([90, 80]);
  run(`S.athletes.push({id:"px",name:"Ferma",team:"t1",sex:"F"});
       S.gruppi={"rmSquat@t1":{d:"2026-06-01",g:[["p0","p1","px"]]}};
       LG.man="man";`);
  const h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/Ferma/.test(h), "il nome deve comparire");
  assert.ok(/non entra.* nel calcolo|non hanno|non ha/.test(h), "e va detto perche'");
});

prova("la media dei selezionati si vede PRIMA di formare il gruppo", () => {
  squadra([100, 90, 80]);
  run(`LG.man="man"; LG.pct=70; LG.sel={p0:1,p1:1,p2:1};`);
  const h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(/3 selezionate/.test(h), "quante sono");
  assert.ok(/62\.5/.test(h), "il carico medio arrotondato: " + (h.match(/lgsk">([\d.]+)/) || [])[1]);
  assert.ok(/Forma il gruppo/.test(h));
});

prova("la stampa mostra i gruppi che hai davanti, non un'altra versione", () => {
  squadra([100, 99, 98, 60, 59, 58]);
  run(`LG.man="man"; LG.sel={p0:1,p3:1}; lgForma();`);   // un gruppo volutamente assurdo
  const g = run(`lgCorrenti().map(x=>x.map(y=>y.id))`);
  assert.equal(g.length, 1, "in manuale si stampa quello che c'e' salvato");
  assert.equal(g[0].slice().sort().join(","), "p0,p3");
  run(`LG.man="auto"`);
  assert.ok(run(`lgCorrenti().length`) >= 2, "in automatico torna la proposta");
});

prova("i gruppi seguono l'ordine scelto", () => {
  squadra([100, 98, 60, 58]);
  run(`LG.man="man"; LG.sel={p0:1,p1:1}; lgForma(); LG.sel={p2:1,p3:1}; lgForma(); LG.ord="asc";`);
  const asc = run(`lgCorrenti().map(g=>Math.round(g[0].kg))`);
  run(`LG.ord="desc"`);
  const desc = run(`lgCorrenti().map(g=>Math.round(g[0].kg))`);
  assert.ok(asc[0] < asc[asc.length - 1], "crescente: " + asc.join(","));
  assert.ok(desc[0] > desc[desc.length - 1], "decrescente: " + desc.join(","));
});

console.log("\nI gruppi sopravvivono a tutto il resto");

prova("cancellare un'atleta la toglie anche dai gruppi", () => {
  squadra([90, 80, 70]);
  run(`LG.man="man"; LG.sel={p0:1,p1:1,p2:1}; lgForma();`);
  run(`delAthlete("p1")`);
  const g = run(`S.gruppi["rmSquat@t1"].g`);
  assert.ok(!JSON.stringify(g).includes("p1"), "resterebbe un nome che non esiste piu'");
  assert.equal(g[0].join(","), "p0,p2");
});

prova("un ripristino da backup non perde i gruppi", () => {
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }, { id: "p1", name: "B" }, { id: "p2", name: "C" }],
    data: { p0: { rmSquat: [{ d: "2026-06-01", v: 90 }] } },
    gruppi: { "rmSquat@t1": { d: "2026-06-01", g: [["p0", "p1"], ["p2"]] } },
  });
  const o = run(`sanitizeImport(${b})`);
  assert.ok(o.gruppi, "la chiave deve esistere");
  assert.equal(o.gruppi["rmSquat@t1"].g.length, 2);
  assert.equal(o.gruppi["rmSquat@t1"].g[0].join(","), "p0,p1");
});

prova("un backup manomesso non fa entrare id inventati nei gruppi", () => {
  const b = JSON.stringify({
    athletes: [{ id: "p0", name: "A" }],
    data: {},
    gruppi: {
      "../evil": { d: "2026-06-01", g: [["p0"]] },
      "rmSquat@t1": { d: "non-una-data", g: [["p0", "nessuno", "p0"], "non-un-array", []] },
    },
  });
  const o = run(`sanitizeImport(${b})`);
  assert.equal(o.gruppi["../evil"], undefined, "chiave di test non valida");
  assert.equal(o.gruppi["rmSquat@t1"].g.length, 1);
  assert.equal(o.gruppi["rmSquat@t1"].g[0].join(","), "p0", "solo id di atleti che esistono, senza doppioni");
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(o.gruppi["rmSquat@t1"].d), "data rimessa a posto");
});

prova("una sincronizzazione in conflitto non cancella i gruppi appena fatti", () => {
  const server = { athletes: [{ id: "p0", name: "A" }], data: {}, gruppi: {} };
  const locale = { athletes: [{ id: "p0", name: "A" }], data: {}, gruppi: { "rmSquat@t1": { d: "2026-06-01", g: [["p0", "p1"]] } } };
  const out = run(`mergeState(${JSON.stringify(server)},${JSON.stringify(locale)})`);
  assert.ok(out.gruppi && out.gruppi["rmSquat@t1"], "i gruppi locali devono sopravvivere al merge");
  assert.equal(out.gruppi["rmSquat@t1"].g[0].join(","), "p0,p1");
});

console.log("\nDalla tabella dei test");

prova("nella cella di un massimale ci sono due strade per lo stesso numero", () => {
  squadra([90]);
  run(`openCell("p0","rmSquat")`);
  const h = run(`document.getElementById("modal").innerHTML`);
  assert.ok(/Massimale sollevato/.test(h), "la strada di sempre");
  assert.ok(/Da ripetizioni/.test(h), "e quella nuova");
  assert.ok(/gruppi di carico su questo test/i.test(h), "e da li' si arriva alle percentuali");
});

prova("i test che non sono massimali non offrono la stima da ripetizioni", () => {
  squadra([90]);
  run(`S.data.p0.cmj=[{d:"2026-06-01",v:30}];`);
  run(`openCell("p0","cmj")`);
  const h = run(`document.getElementById("modal").innerHTML`);
  assert.ok(!/Da ripetizioni/.test(h), "un CMJ non si stima da un carico");
});

prova("la cella si riapre nel modo usato l'ultima volta", () => {
  squadra([90]);
  run(`S.data.p0.rmSquat=[{d:"2026-06-01",v:90,fonte:"reps"}];`);
  run(`openCell("p0","rmSquat")`);
  assert.equal(run(`CUR.mode`), "reps");
  run(`S.data.p0.rmSquat=[{d:"2026-06-01",v:90}];`);
  run(`openCell("p0","rmSquat")`);
  assert.equal(run(`CUR.mode`), "max");
});

prova("salvando dalla cella l'esercizio e' quello della colonna, non il primo del menu", () => {
  squadra([90]);
  Object.keys(campi).forEach(k => delete campi[k]);
  campi.rmD = "2026-09-20";
  cache.rmSaveBtn = elFor("rmSaveBtn");
  Object.assign(cache.rmSaveBtn.dataset, { est: "70", lo: "68", hi: "72", w: "60", r: "4", rir: "1" });
  run(`CUR={a:"p0",t:"rmBench",mode:"reps"};`);
  run(`saveRepMax("p0","Panca piana","cella")`);
  assert.ok(run(`S.data.p0.rmBench`), "deve finire su panca");
  assert.equal(run(`S.data.p0.rmBench[0].v`), 70);
  assert.equal(run(`S.data.p0.rmSquat.length`), 1, "e NON su squat");
});

prova("ogni squadra ha i suoi gruppi: quelli del calcio non entrano in pallavolo", () => {
  squadra([90, 80, 70]);
  run(`S.teams.push({id:"t2",name:"Calcio",sport:"calcio"});
       S.athletes.push({id:"c1",name:"C1",team:"t2",sex:"M"},{id:"c2",name:"C2",team:"t2",sex:"M"});
       S.data.c1={rmSquat:[{d:"2026-06-01",v:120}]}; S.data.c2={rmSquat:[{d:"2026-06-01",v:110}]};
       LG.man="man"; LG.sel={p0:1,p1:1}; lgForma();`);
  assert.equal(run(`Object.keys(S.gruppi)`).join(","), "rmSquat@t1");
  // passo all'altra squadra: i gruppi della prima non devono comparire
  run(`S.activeTeam="t2"; LG.sel={c1:1,c2:1}; lgForma();`);
  assert.equal(run(`Object.keys(S.gruppi).sort()`).join(","), "rmSquat@t1,rmSquat@t2");
  assert.equal(run(`S.gruppi["rmSquat@t1"].g[0]`).join(","), "p0,p1", "la pallavolo non e' stata riscritta");
  const h = run(`lgResMan("Squat","Back squat")`);
  assert.ok(!/P0|P1/.test(h), "nessun nome dell'altra squadra qui dentro");
  assert.ok(/C1/.test(h));
  run(`S.activeTeam="t1"`);
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
