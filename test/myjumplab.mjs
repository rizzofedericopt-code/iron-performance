// Importazione dei test da My Jump Lab.
//
//   node test/myjumplab.mjs
//
// My Jump Lab non ha un'API: esporta CSV e sincronizza su iCloud fra i
// dispositivi di chi lo usa. Non c'e' nessun account da collegare. Quindi
// resta una strada sola, e le cose che possono romperla in silenzio sono tre:
//
//   · le unita'. Le altezze escono in centimetri o in metri a seconda della
//     versione e delle impostazioni. 0,32 e 32 sono lo stesso salto: senza un
//     controllo, uno dei due finisce nello storico come un salto da 0,3 cm.
//   · i nomi. "Rossi Giulia" e "Giulia Rossi" sono la stessa ragazza; "Giulia"
//     e basta, con due Giulia in rosa, non e' nessuna delle due.
//   · l'origine del dato. Un numero importato e uno digitato devono restare
//     distinguibili, o alla prima discordanza non si sa piu' a chi credere.

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

const { mjlScale, parseCSV, normHdr, toISODate, guessCol, sanitizeImport } = sandbox;

/* ═══════════ 1. Le unità ═══════════ */

prova("altezze in metri vengono riconosciute e convertite", () => {
  // un export in metri: 0,28 / 0,31 / 0,34 sono salti da 28-34 cm
  const s = mjlScale([0.28, 0.31, 0.34, 0.30], "cm");
  assert.equal(s.f, 100, "senza conversione finirebbero in storico come salti da 0,3 cm");
  assert.match(s.nota, /metri/i, "e va detto, non fatto di nascosto");
});

prova("altezze già in centimetri non vengono toccate", () => {
  const s = mjlScale([28, 31, 34, 30], "cm");
  assert.equal(s.f, 1);
  assert.equal(s.nota, "");
});

prova("millimetri riconosciuti", () => {
  const s = mjlScale([280, 310, 340], "cm");
  assert.equal(s.f, 0.1);
  assert.match(s.nota, /millimetri/i);
});

prova("la decisione si prende sulla mediana, non su un valore isolato", () => {
  // un refuso (3,1 invece di 31) non deve trascinare l'intera colonna
  const s = mjlScale([3.1, 30, 32, 29, 33], "cm");
  assert.equal(s.f, 1, "un solo valore sbagliato non cambia l'unità di tutta la colonna");
});

prova("l'RSI non viene mai riscalato", () => {
  // valori tipici 0,8-2,0: assomigliano a metri ma non lo sono
  assert.equal(mjlScale([0.9, 1.4, 1.8], "RSI").f, 1,
    "riscalare l'RSI lo moltiplicherebbe per cento");
  assert.equal(mjlScale([0.9, 1.4, 1.8], "W/kg").f, 1);
});

prova("una colonna vuota non fa esplodere niente", () => {
  const s = mjlScale([], "cm");
  assert.equal(s.f, 1);
  assert.equal(mjlScale([NaN, 0, -3], "cm").f, 1);
});

/* ═══════════ 2. I nomi ═══════════ */

prova("l'ordine nome/cognome non fa due persone", () => {
  assert.equal(normHdr("Giulia Rossi"), normHdr("giulia  rossi"));
  assert.notEqual(normHdr("Giulia Rossi"), normHdr("Rossi Giulia"));
  // per questo l'indice registra anche la forma invertita
  const f = html.match(/const idx=\{\};[\s\S]*?\}\);/)[0];
  assert.match(f, /const rov=p\[1\]\+" "\+p\[0\]/,
    "«Rossi Giulia» e «Giulia Rossi» sono la stessa ragazza");
});

prova("un nome che non è in rosa viene saltato, non crea un'atleta", () => {
  const f = html.match(/function previewMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /ignoti\[nome\]/,
    "i nomi non abbinati vanno elencati, non ignorati in silenzio");
  assert.ok(!/athletes\.push/.test(f),
    "creare l'atleta da un nome scritto diverso produrrebbe una seconda scheda della stessa persona");
  assert.match(html, /Non le creo io/, "e va spiegato perché");
});

prova("un nome ambiguo non viene abbinato a caso", () => {
  const f = html.match(/const cand=idx\[normHdr\(nome\)\];[\s\S]{0,120}/)[0];
  assert.match(f, /cand\.length===1/,
    "con due omonime in rosa, sceglierne una a caso è peggio che saltare la riga");
});

/* ═══════════ 3. Le date ═══════════ */

prova("le date arrivano in formati diversi e vengono normalizzate", () => {
  assert.equal(toISODate("2026-07-14"), "2026-07-14");
  assert.equal(toISODate("14/07/2026"), "2026-07-14");
  assert.equal(toISODate("14.07.2026"), "2026-07-14");
  assert.equal(toISODate("14/07/26"), "2026-07-14");
});

prova("una riga con data illeggibile viene scartata e detta", () => {
  assert.equal(toISODate("boh"), "");
  const f = html.match(/function previewMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /scartate\.push/,
    "una riga persa in silenzio è un test che pensi di avere e non hai");
  assert.match(f, /if\(!d\)\{ scartate/);
});

/* ═══════════ 4. Il CSV ═══════════ */

prova("il lettore CSV regge punto e virgola, virgolette e accenti", () => {
  const r = parseCSV('Atleta;Data;CMJ (cm)\n"Rossi; Giulia";14/07/2026;31,5\nNicolò Bianchi;15/07/2026;28\n');
  assert.equal(r.length, 3, "intestazione più due righe");
  assert.equal(r[0][2], "CMJ (cm)");
  assert.equal(r[1][0], "Rossi; Giulia", "il punto e virgola fra virgolette non separa");
  assert.equal(r[2][0], "Nicolò Bianchi");
});

prova("la virgola decimale non viene persa", () => {
  const f = html.match(/function previewMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /replace\(",","\."\)/,
    "un export italiano scrive 31,5 e parseFloat si fermerebbe a 31");
});

prova("le intestazioni si indovinano ma si confermano a mano", () => {
  const hdr = ["Athlete", "Date", "CMJ height (cm)", "SJ height (cm)", "RSI"];
  const used = {};
  const iN = guessCol({ kw: ["athlete", "atleta", "name", "nome"] }, hdr, used);
  assert.equal(iN, 0);
  const iD = guessCol({ kw: ["date", "data"] }, hdr, used);
  assert.equal(iD, 1);
  // e la schermata di conferma esiste comunque
  assert.match(html, /function openMJLMap\(\)/);
  assert.match(html, /controllale/i,
    "una colonna indovinata male in silenzio metterebbe le altezze nella colonna dell'RSI");
});

prova("le parole chiave coprono italiano e inglese", () => {
  const d = html.match(/const MJL_TARGETS=\[[\s\S]*?\];/)[0];
  assert.match(d, /countermovement/); assert.match(d, /contromovimento/);
  assert.match(d, /sinistra/); assert.match(d, /left/);
  const meta = html.match(/const MJL_META=\[[\s\S]*?\];/)[0];
  assert.match(meta, /atleta/); assert.match(meta, /athlete/);
});

prova("i test di destinazione esistono davvero nel catalogo", () => {
  const mancanti = vm.runInContext(
    "MJL_TARGETS.filter(x=>!TESTS.some(t=>t.id===x.t)).map(x=>x.t).join(',')", sandbox);
  assert.equal(mancanti, "", "test inesistenti: " + mancanti);
});

/* ═══════════ 5. Cosa finisce nello storico ═══════════ */

prova("un dato importato resta riconoscibile da uno digitato", () => {
  const f = html.match(/function applyMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /fonte:"mjl"/,
    "alla prima discordanza fra app e storico è l'unica cosa che dice da dove viene");
});

prova("l'origine sopravvive a un ripristino da backup", () => {
  // e' lo stesso difetto che una volta aveva cancellato screen e lv per intero
  const out = sanitizeImport({
    athletes: [{ id: "a1", name: "Giulia", sex: "F" }],
    data: { a1: { cmj: [
      { d: "2026-07-14", v: 31.5, fonte: "mjl" },
      { d: "2026-07-20", v: 32.0 },
      { d: "2026-07-21", v: 33.0, fonte: "lv" },
      { d: "2026-07-22", v: 34.0, fonte: "inventata" },
    ] } },
  });
  const s = out.data.a1.cmj;
  assert.equal(s[0].fonte, "mjl", "l'origine dell'importazione deve sopravvivere");
  assert.equal(s[1].fonte, undefined, "un dato digitato non acquista un'origine");
  assert.equal(s[2].fonte, "lv", "e la stima dalla curva resta");
  assert.equal(s[3].fonte, undefined, "un'origine sconosciuta non entra");
});

prova("reimportare la stessa data aggiorna, non duplica", () => {
  const f = html.match(/function applyMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /const gia=serie\.find\(e=>e\.d===x\.d\);/);
  assert.match(f, /if\(gia\) Object\.assign\(gia,voce\); else serie\.push\(voce\);/,
    "rifare l'export dello stesso giorno non deve produrre due misurazioni");
});

prova("prima di importare si salva una copia da cui tornare indietro", () => {
  const f = html.match(/function applyMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /snapshotBeforeRisk\("importazione da My Jump Lab"\)/,
    "scrivere su tutto lo storico è un'operazione da cui si deve poter tornare");
});

prova("l'anteprima dice quante misurazioni verranno sostituite", () => {
  const f = html.match(/function previewMJL\(\)[\s\S]*?\n}/)[0];
  assert.match(f, /già presenti in quella data \(verranno sostituite\)/,
    "sostituire dati senza dirlo è il modo migliore per far sparire una misurazione buona");
});

prova("l'esportazione CSV dichiara l'origine di ogni riga", () => {
  assert.match(html, /importato da My Jump Lab/,
    "chi legge il CSV esportato deve sapere quali numeri sono stati importati");
});

/* ═══════════ 6. I test che My Jump Lab misura ═══════════
   Non tutti quelli che l'app misura: solo quelli che cambiano una decisione.
   Duty factor, pronazione e caduta del bacino restano fuori — sono
   informazioni vere, ma una colonna che non sai leggere e' rumore. */

prova("i test nuovi di My Jump Lab esistono nel catalogo", () => {
  const attesi = ["cmjA", "armCon", "rsiMod", "rsi105", "bjump",
                  "fvF0", "fvV0", "fvPmax", "sfvF0", "sfvV0", "sfvPmax",
                  "vcut", "nordicAng", "nordicTq", "hipIR"];
  const mancanti = attesi.filter(id => !vm.runInContext(
    "TESTS.some(t=>t.id===" + JSON.stringify(id) + ")", sandbox));
  assert.equal(mancanti.join(","), "", "mancano: " + mancanti.join(", "));
});

prova("ogni test nuovo ha unita', direzione e categoria coerenti", () => {
  const nuovi = vm.runInContext(`JSON.stringify(TESTS.filter(t=>
    ["cmjA","armCon","rsiMod","rsi105","bjump","fvF0","fvV0","fvPmax",
     "sfvF0","sfvV0","sfvPmax","vcut","nordicAng","nordicTq","hipIR"].indexOf(t.id)>=0)
    .map(t=>({id:t.id,unit:t.unit,dir:t.dir,cat:t.cat,sports:t.sports.length})))`, sandbox);
  JSON.parse(nuovi).forEach(t => {
    assert.ok(t.unit && t.unit.length, t.id + " senza unita'");
    assert.ok(t.dir === 1 || t.dir === -1, t.id + " direzione " + t.dir);
    assert.ok(t.cat && t.cat.length, t.id + " senza categoria");
    assert.ok(t.sports > 0, t.id + " non assegnato a nessuno sport");
  });
});

prova("il V-Cut e' un tempo: piu' basso e' meglio", () => {
  const dir = vm.runInContext("TESTS.find(t=>t.id==='vcut').dir", sandbox);
  assert.equal(dir, -1, "su un tempo la freccia verde deve essere quella che scende");
});

prova("il contributo delle braccia si calcola da solo", () => {
  const d = vm.runInContext("JSON.stringify(TESTS.find(t=>t.id==='armCon').derived.from)", sandbox);
  assert.equal(d, '["cmjA","cmj"]');
  const fn = vm.runInContext("TESTS.find(t=>t.id==='armCon').derived.fn", sandbox);
  // Abalakov 36, CMJ 30 → +20%
  assert.ok(Math.abs(fn(36, 30) - 20) < 1e-9, "atteso 20%, ottenuto " + fn(36, 30));
  assert.equal(fn(36, 0), null, "senza CMJ non si divide per zero");
  assert.equal(fn(36, null), null);
});

prova("nessun test nuovo si inventa una scala Base→Elite", () => {
  // le normative per ragazze under 18 su questi test o non esistono o
  // dipendono troppo dal protocollo: un pallino verde sarebbe una bugia
  const conBande = vm.runInContext(`TESTS.filter(t=>
    ["cmjA","armCon","rsiMod","rsi105","bjump","fvF0","fvV0","fvPmax",
     "sfvF0","sfvV0","sfvPmax","vcut","nordicAng","nordicTq","hipIR"].indexOf(t.id)>=0
    && t.lv).map(t=>t.id).join(",")`, sandbox);
  assert.equal(conBande, "", "hanno soglie inventate: " + conBande);
});

prova("ogni test nuovo ha la sua guida, non una pagina vuota", () => {
  const senza = vm.runInContext(`["cmjA","armCon","rsiMod","rsi105","bjump","fvF0","fvV0","fvPmax",
     "sfvF0","sfvV0","sfvPmax","vcut","nordicAng","nordicTq","hipIR"]
     .filter(id=>!PROTO[id]||!PROTO[id].what).join(",")`, sandbox);
  assert.equal(senza, "", "un test senza spiegazione e' una colonna che non sai leggere: " + senza);
});

prova("i test che caricano le articolazioni hanno un avviso", () => {
  ["rsi105", "nordicAng"].forEach(id => {
    const a = vm.runInContext("PROTO['" + id + "'] && PROTO['" + id + "'].alert ? 1 : 0", sandbox);
    assert.equal(a, 1, id + " deve avvisare su chi non deve farlo");
  });
});

prova("il profilo F-V verticale porta con se' il limite del telefono", () => {
  const t = vm.runInContext("PROTO.fvF0.alert.text", sandbox);
  assert.match(t, /pendenza|squilibrio/i,
    "la singola altezza e' affidabile, la pendenza del profilo no: va detto");
  assert.match(t, /telefono/i);
});

prova("RSI-mod e RSI del Drop Jump non vengono confusi", () => {
  const n = vm.runInContext("PROTO.rsiMod.note", sandbox);
  assert.match(n, /Drop Jump/, "sono due numeri diversi e non si confrontano fra loro");
  const u1 = vm.runInContext("TESTS.find(t=>t.id==='rsiMod').unit", sandbox);
  const u2 = vm.runInContext("TESTS.find(t=>t.id==='dj').unit", sandbox);
  assert.notEqual(u1, u2, "unita' diverse aiutano a non sovrapporli");
});

prova("l'Abalakov ricorda che senza CMJ nella stessa data non serve", () => {
  assert.match(vm.runInContext("PROTO.cmjA.note", sandbox), /stessa seduta|stessa data/i);
});

prova("le nuove colonne sono importabili da My Jump Lab", () => {
  const senza = vm.runInContext(`["cmjA","rsiMod","rsi105","bjump","fvF0","fvV0","fvPmax",
     "sfvF0","sfvV0","sfvPmax","vcut","nordicAng","nordicTq","hipIR"]
     .filter(id=>!MJL_TARGETS.some(x=>x.t===id)).join(",")`, sandbox);
  assert.equal(senza, "", "aggiunti al catalogo ma non importabili: " + senza);
  // armCon no: si calcola, non si importa
  assert.equal(vm.runInContext("MJL_TARGETS.some(x=>x.t==='armCon')", sandbox), false,
    "un test derivato non si importa: si calcola da Abalakov e CMJ");
});

prova("solo cm e altezze vengono riscalate, mai gradi angoli o rapporti", () => {
  const rischio = vm.runInContext(`MJL_TARGETS.filter(x=>x.unit==="cm").map(x=>x.t).join(",")`, sandbox);
  ["rsiMod", "rsi105", "nordicAng", "hipIR", "vcut", "fvV0"].forEach(id => {
    assert.ok(rischio.split(",").indexOf(id) < 0,
      id + " non deve essere trattato come un'altezza: verrebbe moltiplicato per cento");
  });
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
