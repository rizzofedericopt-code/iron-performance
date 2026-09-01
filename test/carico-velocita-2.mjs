// Curva carico-velocita': le formule, e quanto vale davvero il numero che esce.
//
//   node test/carico-velocita-2.mjs
//
// Tre difetti corretti qui dentro, in ordine di gravita':
//
// 1. L'1RM usciva come un numero secco, con il decimo di chilo. «140,3 kg».
//    Ma e' una CALIBRAZIONE INVERSA: si fitta v = b + m·carico e poi si chiede
//    a quale carico la retta tocca l'MVT. L'incertezza di quella risposta
//    cresce con la lunghezza dell'estrapolazione, e su 4 punti e' di parecchi
//    chili. Scriverla al decimo era una precisione inventata.
//
// 2. Il modulo chiedeva «velocita' media» senza dire QUALE. I dispositivi VBT
//    danno MPV (solo fase propulsiva) e MV (tutta la concentrica): sui carichi
//    leggeri differiscono molto, e i riferimenti MVT dell'app vengono da
//    letteratura su MPV. Misurare in MV e usarli lo stesso e' un errore che
//    non si vede: il numero esce comunque.
//
// 3. Nessun controllo sull'AMPIEZZA dei carichi. Cinque punti fra 60 e 70 kg
//    danno R² 0,99 e una pendenza che non significa niente.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const el = {
  addEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
  focus() {}, select() {}, click() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", checked: false,
};
const sandbox = {
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
              createElement: () => el, addEventListener() {}, body: el, documentElement: el, hidden: false },
  window: { addEventListener() {} }, navigator: { userAgent: "test" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "index.html:<script>" });

const { linRegLV, lvEstimate, lvUncertainty, lvLadder, epley1RM, lvRound, tCrit,
        lvStartingMax, lvKnownMVT, lvExInfo } = sandbox;

/* ═══════════ 1. La retta ═══════════ */

prova("la regressione ritrova una retta perfetta", () => {
  // v = 1,00 − 0,005·carico  →  a 60 kg 0,70; a 100 kg 0,50
  const pts = [40, 60, 80, 100].map((L) => ({ load: L, v: 1.00 - 0.005 * L }));
  const r = linRegLV(pts);
  assert.ok(Math.abs(r.m + 0.005) < 1e-12, "pendenza " + r.m);
  assert.ok(Math.abs(r.b - 1.00) < 1e-12, "intercetta " + r.b);
  assert.ok(Math.abs(r.r2 - 1) < 1e-12, "R² " + r.r2);
  assert.equal(r.n, 4);
  assert.ok(Math.abs(r.meanL - 70) < 1e-12, "baricentro dei carichi " + r.meanL);
  // Sxx = Σ(L−L̄)² = 900+100+100+900 = 2000
  assert.ok(Math.abs(r.Sxx - 2000) < 1e-9, "Sxx " + r.Sxx);
  assert.ok(r.s < 1e-12, "su una retta perfetta i residui sono zero");
});

prova("l'1RM è il carico a cui la retta tocca l'MVT", () => {
  const pts = [40, 60, 80, 100].map((L) => ({ load: L, v: 1.00 - 0.005 * L }));
  const est = lvEstimate(linRegLV(pts), 0.30);
  // 0,30 = 1,00 − 0,005·L  →  L = 140
  assert.ok(Math.abs(est - 140) < 1e-9, "atteso 140 kg, ottenuto " + est);
});

prova("con due punti soli la retta esiste ma non la sua dispersione", () => {
  const r = linRegLV([{ load: 60, v: 0.70 }, { load: 100, v: 0.50 }]);
  assert.ok(r, "due punti definiscono comunque una retta");
  assert.equal(r.s, null, "con 2 punti i gradi di libertà sono zero: s non è stimabile");
  assert.equal(lvUncertainty(r, lvEstimate(r, 0.30)), null,
    "e senza s non si può dichiarare un'incertezza");
});

/* ═══════════ 2. L'incertezza ═══════════ */

prova("i valori di t sono quelli dei piccoli campioni, non 1,96", () => {
  // con 4 carichi i gradi di liberta' sono 2: t vale 4,30. Usare 1,96
  // dimezzerebbe la forbice dichiarata rispetto a quella vera.
  assert.equal(tCrit(0), null, "zero gradi di libertà: nessun t");
  assert.ok(Math.abs(tCrit(1) - 12.706) < 1e-3);
  assert.ok(Math.abs(tCrit(2) - 4.303) < 1e-3);
  assert.ok(Math.abs(tCrit(3) - 3.182) < 1e-3);
  assert.ok(Math.abs(tCrit(50) - 1.96) < 1e-9, "sui grandi campioni converge a 1,96");
});

prova("l'incertezza è calcolata con la formula della calibrazione inversa", () => {
  // Verifica numerica contro il calcolo fatto a mano.
  // Punti: (40, 0.800) (60, 0.700) (80, 0.610) (100, 0.490)
  const pts = [{ load: 40, v: 0.800 }, { load: 60, v: 0.700 },
               { load: 80, v: 0.610 }, { load: 100, v: 0.490 }];
  const r = linRegLV(pts);
  // Sxy = Σ(L−70)(v−v̄); v̄ = 0.650
  //  (−30)(0.150) + (−10)(0.050) + (10)(−0.040) + (30)(−0.160)
  //  = −4.5 − 0.5 − 0.4 − 4.8 = −10.2 ;  Sxx = 2000
  const mAtteso = -10.2 / 2000;
  assert.ok(Math.abs(r.m - mAtteso) < 1e-12, "pendenza attesa " + mAtteso + ", ottenuta " + r.m);
  const bAtteso = 0.650 - mAtteso * 70;
  assert.ok(Math.abs(r.b - bAtteso) < 1e-12);

  const est = lvEstimate(r, 0.30);
  const attesoEst = (0.30 - bAtteso) / mAtteso;
  assert.ok(Math.abs(est - attesoEst) < 1e-9);

  const inc = lvUncertainty(r, est);
  const seAtteso = (r.s / Math.abs(r.m)) *
    Math.sqrt(1 / 4 + Math.pow(est - 70, 2) / 2000);
  assert.ok(Math.abs(inc.se - seAtteso) < 1e-9, "se atteso " + seAtteso + ", ottenuto " + inc.se);
  assert.equal(inc.df, 2);
  assert.ok(Math.abs(inc.ci - inc.t * inc.se) < 1e-12);
  assert.ok(Math.abs((inc.hi - inc.lo) / 2 - inc.ci) < 1e-9, "l'intervallo è simmetrico attorno alla stima");
});

prova("più lunga è l'estrapolazione, più larga è la forbice", () => {
  // stessa dispersione, stesso numero di punti: cambia solo quanto ci si
  // allontana dal baricentro dei carichi provati
  const vicino = [{ load: 100, v: 0.500 }, { load: 110, v: 0.452 },
                  { load: 120, v: 0.398 }, { load: 130, v: 0.352 }];
  const lontano = [{ load: 40, v: 0.800 }, { load: 50, v: 0.752 },
                   { load: 60, v: 0.698 }, { load: 70, v: 0.652 }];
  const a = lvUncertainty(linRegLV(vicino), lvEstimate(linRegLV(vicino), 0.30));
  const b = lvUncertainty(linRegLV(lontano), lvEstimate(linRegLV(lontano), 0.30));
  assert.ok(b.ci > a.ci * 2,
    "estrapolare da carichi leggeri deve allargare molto: ±" + a.ci.toFixed(1) + " vs ±" + b.ci.toFixed(1));
});

prova("punti sporchi allargano la forbice, non solo l'R²", () => {
  const pulito = [{ load: 40, v: 0.800 }, { load: 60, v: 0.700 },
                  { load: 80, v: 0.600 }, { load: 100, v: 0.500 }];
  const sporco = [{ load: 40, v: 0.830 }, { load: 60, v: 0.680 },
                  { load: 80, v: 0.625 }, { load: 100, v: 0.470 }];
  const a = lvUncertainty(linRegLV(pulito), lvEstimate(linRegLV(pulito), 0.30));
  const b = lvUncertainty(linRegLV(sporco), lvEstimate(linRegLV(sporco), 0.30));
  assert.ok(b.ci > a.ci, "la dispersione dei residui deve entrare nell'intervallo");
});

prova("il risultato non viene più scritto al decimo di chilo", () => {
  // La prima versione di questo test partiva da /res\.innerHTML=/ e pescava
  // un blocco enorme, comprese le vecchie occorrenze: si guarda la riga.
  const f = html.match(/'<b>1RM stimato: '[^\n]*/);
  assert.ok(f, "riga del risultato non trovata");
  assert.ok(!/Math\.round\(est\*10\)\/10/.test(f[0]),
    "un decimo di chilo su una stima con ±5 kg di incertezza è precisione inventata");
  assert.match(f[0], /Math\.round\(est\)/);
  assert.match(html, /intervallo di confidenza al 95%/,
    "la forbice va mostrata, non solo calcolata");
});

/* ═══════════ 3. MPV o MV ═══════════ */

prova("si dichiara quale velocità sta misurando il dispositivo", () => {
  assert.match(html, /const LV_VTYPE=\[/, "manca la scelta del tipo di velocità");
  assert.match(html, /id="lvVType"/, "e il campo nella schermata");
  const d = html.match(/const LV_VTYPE=\[[\s\S]*?\];/)[0];
  assert.match(d, /MPV/); assert.match(d, /MV/);
  assert.match(d, /propulsiv/i, "va spiegata la differenza, non solo nominata");
});

prova("il tipo di velocità viene conservato nella curva", () => {
  const f = html.match(/const entry=\{d, exercise:ex, points:pts[\s\S]*?\};/)[0];
  assert.match(f, /vType:/, "senza, due curve non sono più confrontabili fra loro");
  assert.match(f, /mvtSource:/, "e non si distingue una soglia misurata da una copiata");
});

prova("mischiare MPV e MV sullo stesso esercizio produce un avviso", () => {
  assert.match(html, /prec\[prec\.length-1\]\.vType!==vtipo/,
    "e' un errore silenzioso: la pendenza cambia e il confronto nel tempo salta");
});

prova("il ripristino da backup non butta via tipo di velocità e origine dell'MVT", () => {
  // e' lo stesso difetto che una volta aveva cancellato screen e lv per intero
  const f = html.match(/Curve carico-velocità: stessa sorte[\s\S]*?\n  \}\);/)[0];
  assert.match(f, /r\.vType=e\.vType/);
  assert.match(f, /r\.mvtSource=e\.mvtSource/);
  assert.match(f, /"ci95"/, "anche l'incertezza salvata deve sopravvivere");
});

/* ═══════════ 4. Preparare il test per QUESTA atleta ═══════════ */

prova("Epley serve solo a scegliere i carichi, e fa il suo mestiere", () => {
  // 100 kg x 5 → 100·(1+5/30) = 116,67
  assert.ok(Math.abs(epley1RM(100, 5) - 116.6667) < 0.001);
  assert.ok(Math.abs(epley1RM(80, 1) - 82.6667) < 0.001);
  assert.equal(epley1RM(0, 5), null);
  assert.equal(epley1RM(100, 0), null);
  assert.equal(epley1RM("abc", 5), null);
});

prova("i carichi si arrotondano a quello che c'è sul bilanciere", () => {
  assert.equal(lvRound(63.7), 62.5);
  assert.equal(lvRound(64), 65);
  assert.equal(lvRound(63.7, 5), 65);
});

prova("la scala dei carichi copre un'ampiezza sufficiente", () => {
  const sc = lvLadder(140);
  assert.equal(sc.length, 5, "quattro-cinque gradini, non due");
  const pc = sc.map((x) => x.pc);
  assert.ok(Math.min.apply(null, pc) <= 0.50, "serve un carico leggero");
  assert.ok(Math.max.apply(null, pc) >= 0.85, "e uno vicino al massimale, o si estrapola nel vuoto");
  assert.ok(Math.max.apply(null, pc) < 1.0, "il senso del test è non fare il massimale");
  const kg = sc.map((x) => x.load);
  assert.ok((Math.max.apply(null, kg) - Math.min.apply(null, kg)) / 140 >= 0.40,
    "fra il più leggero e il più pesante deve esserci almeno il 40% della stima");
  for (let i = 1; i < kg.length; i++) assert.ok(kg[i] > kg[i - 1], "i carichi devono crescere");
});

prova("le ripetizioni calano quando il carico sale", () => {
  const sc = lvLadder(140);
  for (let i = 1; i < sc.length; i++)
    assert.ok(sc[i].rip <= sc[i - 1].rip, "al 90% non si fanno 3 ripetizioni");
  assert.equal(sc[sc.length - 1].rip, 1);
});

prova("senza un 1RM di partenza non si inventa una scala", () => {
  assert.equal(lvLadder(null).length, 0);
  assert.equal(lvLadder(0).length, 0);
  assert.equal(lvLadder("x").length, 0);
});

prova("l'1RM di partenza viene dal dato più affidabile che c'è", () => {
  vm.runInContext(`
    S.athletes=[{id:"a1",name:"G",profile:{weight:"60"}}];
    S.lv={a1:[{d:"2026-05-01",exercise:"Back squat",est1RM:120},
              {d:"2026-07-01",exercise:"Back squat",est1RM:132}]};
    S.data={a1:{rmSquat:[{d:"2026-04-01",v:118}]}};`, sandbox);
  const s1 = lvStartingMax("a1", "Back squat");
  assert.equal(s1.kg, 132, "fra due curve vince la più recente");
  assert.match(s1.fonte, /curva/);

  vm.runInContext(`S.lv={a1:[]};`, sandbox);
  const s2 = lvStartingMax("a1", "Back squat");
  assert.equal(s2.kg, 118, "senza curve si prende il massimale dello storico");
  assert.match(s2.fonte, /massimale/);

  vm.runInContext(`S.data={a1:{}};`, sandbox);
  assert.equal(lvStartingMax("a1", "Back squat"), null,
    "senza niente non si inventa un numero: si chiede");
});

prova("un massimale misurato conta più di una stima", () => {
  vm.runInContext(`
    S.lv={a1:[]};
    S.data={a1:{rmSquat:[{d:"2026-06-01",v:140,fonte:"lv"},{d:"2026-04-01",v:118}]}};`, sandbox);
  const s = lvStartingMax("a1", "Back squat");
  assert.equal(s.kg, 118, "una stima precedente non deve fare da base a una stima nuova");
  assert.match(s.fonte, /massimale/);
});

/* ═══════════ 5. L'MVT dell'atleta ═══════════ */

prova("un MVT misurato sull'atleta viene riusato al posto del riferimento", () => {
  vm.runInContext(`
    S.lv={a1:[{d:"2026-06-01",exercise:"Back squat",mvt:0.34,mvtSource:"misurato"},
              {d:"2026-07-01",exercise:"Panca piana",mvt:0.30,mvtSource:"riferimento"}]};`, sandbox);
  const k = lvKnownMVT("a1", "Back squat");
  assert.ok(k, "va ritrovato");
  assert.equal(k.mvt, 0.34);
  assert.equal(lvKnownMVT("a1", "Panca piana"), null,
    "una soglia solo di riferimento non è un dato dell'atleta");
  assert.equal(lvKnownMVT("a1", "Stacco da terra"), null);
});

prova("la schermata offre di registrare l'MVT da un massimale vero", () => {
  assert.match(html, /function lvUseRealMVT\(\)/);
  assert.match(html, /id="lvMvtReal"/);
  assert.match(html, /dataset\.misurato=1/,
    "va marcato come misurato, altrimenti resta indistinguibile da un riferimento");
});

/* ═══════════ 6. Gli avvisi ═══════════ */

prova("carichi troppo vicini fra loro vengono segnalati", () => {
  assert.match(html, /const spread=est>0 \? \(maxLoad-minLoad\)\/est : 0;/,
    "cinque punti fra 60 e 70 kg danno R² 0,99 e una pendenza senza significato");
  assert.match(html, /spread<0\.30/);
});

prova("l'estrapolazione lunga resta segnalata", () => {
  assert.match(html, /if\(cop<0\.85\)/);
  assert.match(html, /if\(nPunti<4\)/);
  assert.match(html, /if\(reg\.r2<0\.95\)/);
});

/* ═══════════ 7. La spiegazione ═══════════ */

prova("il protocollo sta dentro la schermata in cui si esegue il test", () => {
  const f = html.match(/<details class="asec lvhow">[\s\S]*?<\/details>'/);
  assert.ok(f, "un protocollo in un documento a parte non viene letto in palestra");
  const t = f[0];
  assert.match(t, /massima velocità possibile/i,
    "è la regola che regge il test: senza, la retta si piega");
  assert.match(t, /più veloce/i, "va detto quale ripetizione registrare");
  assert.match(t, /riscaldamento/i);
  assert.match(t, /fresc/i, "una curva a fine seduta misura la fatica, non la forza");
  assert.match(t, /stessa profondità|stesso bilanciere/i, "la ripetibilità è metà del valore del test");
  assert.match(t, /dispositivo/i, "va detto che serve uno strumento");
});

prova("gli MVT di riferimento restano quelli per esercizio", () => {
  assert.ok(Math.abs(lvExInfo("Panca piana").mvt - 0.17) < 1e-9);
  assert.ok(Math.abs(lvExInfo("Stacco da terra").mvt - 0.16) < 1e-9);
  assert.ok(Math.abs(lvExInfo("Back squat").mvt - 0.30) < 1e-9);
  assert.match(html, /letteratura su MPV/,
    "va detto da dove vengono, altrimenti sembrano costanti universali");
});

/* ═══════════ 8. Il dato deve VEDERSI ═══════════
   La stima veniva scritta nella serie di 1RM Squat... che con la pallavolo
   selezionata non compariva affatto, perche' quei test erano marcati
   "combattimento, forza". Il dato c'era, non si vedeva, e sembrava che la
   curva non servisse a niente. */

prova("un test con dati dentro non sparisce per colpa del filtro sport", () => {
  const f = html.match(/function visibleTests\(\)[\s\S]*?\n}/);
  assert.ok(f, "visibleTests non trovata");
  assert.match(f[0], /const conDati=\{\}/,
    "la batteria dice cosa raccogliere, non cosa nascondere");
  assert.match(f[0], /base\.concat\(extra\)/);
});

prova("i test con dati compaiono anche fuori dalla batteria", () => {
  vm.runInContext(`
    S.teams=[{id:"t1",name:"Volley",sport:"pallavolo",tests:["cmj"]}];
    S.activeTeam="t1"; S.sport="pallavolo";
    S.athletes=[{id:"a1",name:"G",team:"t1",profile:{}}];
    S.data={a1:{rmSquat:[{d:"2026-07-01",v:110,fonte:"lv"}]}};`, sandbox);
  const ids = vm.runInContext("visibleTests().map(t=>t.id).join(',')", sandbox);
  assert.ok(ids.split(",").indexOf("rmSquat") >= 0,
    "una colonna che non vedi e' una misurazione buttata — visibili: " + ids);
  assert.ok(ids.split(",").indexOf("cmj") >= 0, "la batteria resta");
});

prova("un test senza dati non si intrufola nella tabella", () => {
  vm.runInContext(`S.data={a1:{}};`, sandbox);
  const ids = vm.runInContext("visibleTests().map(t=>t.id).join(',')", sandbox);
  assert.ok(ids.split(",").indexOf("rmSquat") < 0,
    "senza dati non c'e' niente da mostrare: " + ids);
});

prova("ogni esercizio della curva ha un test dove finire", () => {
  const senza = vm.runInContext(
    "LV_EX.filter(e=>e.n!=='Altro' && !e.test).map(e=>e.n).join(',')", sandbox);
  assert.equal(senza, "",
    "hip thrust, military press e trazioni calcolavano una stima che non andava da nessuna parte: " + senza);
  const ids = vm.runInContext(
    "LV_EX.filter(e=>e.test).map(e=>e.test).filter(t=>!TESTS.some(x=>x.id===t)).join(',')", sandbox);
  assert.equal(ids, "", "test di destinazione inesistenti nel catalogo: " + ids);
});

prova("sulle trazioni viene detto che il carico e' la massa totale", () => {
  assert.match(html, /massa <b>totale mossa<\/b>/,
    "mettendo solo la zavorra sull'asse dei carichi la retta non significa niente");
});

/* ═══════════ 9. L'andamento delle curve ═══════════ */

prova("le curve salvate si rivedono, raggruppate per esercizio", () => {
  vm.runInContext(`
    S.lv={a1:[
      {d:"2026-05-01",exercise:"Back squat",est1RM:104,r2:0.99,mvt:0.30,vType:"MPV",ci95:5,
       points:[{load:50,v:.8},{load:70,v:.66},{load:85,v:.52},{load:92,v:.42}]},
      {d:"2026-07-01",exercise:"Back squat",est1RM:112,r2:0.97,mvt:0.30,vType:"MPV",ci95:7,
       points:[{load:55,v:.8},{load:75,v:.66},{load:95,v:.5}]},
      {d:"2026-07-01",exercise:"Panca piana",est1RM:52,r2:0.99,mvt:0.17,vType:"MPV",
       points:[{load:30,v:.7},{load:45,v:.4}]}
    ]};`, sandbox);
  const h = vm.runInContext("lvHistory('a1')", sandbox);
  assert.equal(Object.keys(h).length, 2, "due esercizi distinti");
  assert.equal(h["Back squat"].length, 2);
  assert.equal(h["Back squat"][0].d, "2026-05-01", "in ordine di data crescente");
});

prova("la copertura si ricalcola: e' il numero che conta piu' dell'R2", () => {
  const { lvCoverage } = sandbox;
  const c = lvCoverage({ est1RM: 100, points: [{ load: 50 }, { load: 85 }] });
  assert.ok(Math.abs(c - 0.85) < 1e-9, "copertura " + c);
  assert.equal(lvCoverage({ est1RM: 100, points: [] }), null);
  assert.equal(lvCoverage({ points: [{ load: 50 }] }), null);
});

prova("una curva debole si distingue da una solida a colpo d'occhio", () => {
  const b = vm.runInContext("lvHistoryBlock('a1')", sandbox);
  assert.match(b, /lvh-ok/, "quella a 4 punti fino al 92% e' solida");
  assert.match(b, /lvh-weak/, "quella a 3 punti no");
  assert.match(b, /rumore di misura, non progresso/,
    "va detto perche' due numeri non si possono confrontare");
});

prova("la tabella mostra la differenza fra una curva e la precedente", () => {
  const b = vm.runInContext("lvHistoryBlock('a1')", sandbox);
  assert.match(b, /\+8/, "da 104 a 112 sono +8 kg");
  assert.match(b, /±7/, "con la sua forbice accanto");
  assert.match(b, /Back squat/); assert.match(b, /Panca piana/);
});

prova("mischiare MPV e MV fra curve dello stesso esercizio viene detto", () => {
  vm.runInContext(`S.lv={a1:[
    {d:"2026-05-01",exercise:"Back squat",est1RM:104,mvt:0.30,vType:"MPV",points:[{load:50,v:.8},{load:90,v:.4}]},
    {d:"2026-07-01",exercise:"Back squat",est1RM:118,mvt:0.30,vType:"MV", points:[{load:50,v:.7},{load:90,v:.3}]}
  ]};`, sandbox);
  const b = vm.runInContext("lvHistoryBlock('a1')", sandbox);
  assert.match(b, /non sono confrontabili/,
    "un +14 kg fra una curva MPV e una MV non e' un progresso, e' un cambio di unita'");
});

prova("un MVT misurato sull'atleta si riconosce nella tabella", () => {
  vm.runInContext(`S.lv={a1:[
    {d:"2026-07-01",exercise:"Back squat",est1RM:112,mvt:0.34,mvtSource:"misurato",vType:"MPV",
     points:[{load:60,v:.8},{load:100,v:.45}]}
  ]};`, sandbox);
  assert.match(vm.runInContext("lvHistoryBlock('a1')", sandbox), /lvh-m/);
});

prova("senza curve la scheda non mostra una tabella vuota", () => {
  vm.runInContext(`S.lv={a1:[]};`, sandbox);
  assert.equal(vm.runInContext("lvHistoryBlock('a1')", sandbox), "");
  vm.runInContext(`S.lv={};`, sandbox);
  assert.equal(vm.runInContext("lvHistoryBlock('a1')", sandbox), "");
});

prova("la tabella e' agganciata alla scheda atleta", () => {
  assert.match(html, /h\+=lvHistoryBlock\(id\);/,
    "calcolarla e non mostrarla e' esattamente il difetto che si sta correggendo");
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
