// La vista Oggi: cosa si legge senza aprire niente, e quando la notifica si spegne.
//
//   node test/oggi.mjs
//
// Due difetti, uno visibile e uno no.
//
// Visibile: «🚩 Screening 2» non dice QUALI due. Per saperlo bisognava aprire
// l'anamnesi — cioe' la schermata esisteva per evitarti di aprirla e ti
// costringeva ad aprirla lo stesso.
//
// Non visibile: il certificato medico scaduto non compariva da nessuna parte
// in Oggi. Un'atleta con l'idoneita' scaduta e nessun altro segnale finiva
// nell'elenco dei "Pronti". E' la cosa che ti fa fermare qualcuno a bordo
// campo, e la scoprivi per caso.

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

const { schedaDigest, screenPositives, medicalState } = sandbox;
const oggi = sandbox.todayISO();
const fraGiorni = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const testo = (a) => schedaDigest(a).righe.map((r) => r.t).join(" || ");

// S.cfg non era inizializzata nella sandbox: si usa la configurazione vera
// dell'app, cosi' le soglie provate qui sono quelle che vede Federico
vm.runInContext("S.cfg = Object.assign({}, CFG_DEF);", sandbox);
assert.equal(vm.runInContext("S.cfg.painCut", sandbox), 4);

/* ── 1. Le voci di screening si leggono per nome ── */

prova("le voci di screening spuntate si chiamano per nome", () => {
  const sc = screenPositives({ scChest: true, scFamily: true });
  assert.equal(sc.length, 2);
  sc.forEach((x) => {
    assert.ok(x.length > 3, "etichetta vuota");
    assert.ok(!/^sc[A-Z]/.test(x), "non deve uscire il nome della chiave: " + x);
  });
  assert.match(sc.join(" "), /petto/i, "«scChest» deve diventare qualcosa di leggibile");
  assert.match(sc.join(" "), /cardiac|cuore/i);
});

prova("le etichette brevi arrivano da PROFILE, non da un secondo elenco", () => {
  const blocco = html.match(/const PROFILE=\[([\s\S]*?)\n\];/)[1];
  const conBreve = [...blocco.matchAll(/k:"(sc[A-Za-z]+)"[\s\S]{0,300}?s:"/g)].map((x) => x[1]);
  assert.equal(conBreve.length, 7,
    "tutte e sette le voci di screening devono avere l'etichetta breve, trovate " + conBreve.length);
  const f = html.match(/function screenPositives\(p\)[\s\S]*?\n}/)[0];
  assert.match(f, /PROFILE\.filter/,
    "un secondo elenco scritto a mano si separerebbe dalle domande alla prima modifica");
});

prova("il riassunto nomina le voci invece di contarle", () => {
  const t = testo({ profile: { birth: "2009-04-02", scChest: true, scDizzy: true } });
  assert.ok(!/Screening 2/.test(t), "il conteggio da solo non dice niente");
  assert.match(t, /petto/i);
  assert.match(t, /capogiri/i);
});

/* ── 2. L'idoneita' medica ── */

prova("un certificato scaduto viene visto", () => {
  const s = medicalState({ medical: "Idoneo", medicalExpiry: fraGiorni(-40) });
  assert.ok(s, "un certificato scaduto da 40 giorni deve produrre un segnale");
  assert.equal(s.c, "down");
  assert.match(s.t, /scadut/i);
});

prova("un certificato in scadenza avvisa prima, non dopo", () => {
  const s = medicalState({ medical: "Idoneo", medicalExpiry: fraGiorni(10) });
  assert.ok(s, "dieci giorni alla scadenza sono il momento di muoversi");
  assert.equal(s.c, "amber");
  assert.match(s.t, /scade fra/i);
});

prova("un certificato valido e lontano non fa rumore", () => {
  assert.equal(medicalState({ medical: "Idoneo", medicalExpiry: fraGiorni(200) }), null,
    "avvisare quando non serve insegna a ignorare gli avvisi");
});

prova("«non idoneo» e «idoneità non registrata» non sono la stessa cosa", () => {
  const no = medicalState({ medical: "Non idoneo" });
  const vuoto = medicalState({});
  assert.equal(no.c, "down");
  assert.equal(vuoto.c, "amber");
  assert.notEqual(no.t, vuoto.t);
});

prova("l'idoneità entra fra i segnali di «Da gestire»", () => {
  const f = html.match(/function renderToday\(\)[\s\S]*?\n}\nfunction renderReadiness/);
  assert.ok(f, "renderToday non trovata");
  assert.match(f[0], /const med=medicalState\(p\);/,
    "senza questo un'atleta con l'idoneità scaduta e nulla d'altro finiva fra i «Pronti»");
  assert.match(f[0], /sev\+=\(med\.c==="down"\?5:1\)/,
    "un certificato scaduto deve pesare come uno screening positivo");
});

/* ── 3. Quando la notifica si spegne ── */

prova("una scheda con uno screening positivo è rossa", () => {
  assert.equal(schedaDigest({ profile: { birth: "2009-01-01", scHeart: true } }).rosso, true);
});

prova("una scheda con un infortunio in corso è rossa", () => {
  assert.equal(schedaDigest({ profile: { injuriesCurrent: "caviglia dx, da due settimane" } }).rosso, true);
});

prova("una scheda senza consenso è rossa", () => {
  assert.equal(schedaDigest({ profile: { birth: "2005-01-01" } }).rosso, true,
    "senza consenso non si tratta niente: non può spegnersi da sola");
});

prova("una scheda pulita non è rossa", () => {
  const d = schedaDigest({ profile: {
    birth: "2005-06-01", height: "172", weight: "60", role: "Centrale",
    consent: true, consentSource: "form", consentPolicyVersion: 1,
    medical: "Idoneo", medicalExpiry: fraGiorni(200) } });
  assert.equal(d.rosso, false, "righe: " + d.righe.map((r) => r.t).join(" | "));
});

prova("solo le schede pulite si spengono da sole", () => {
  const f = html.match(/const nuove=items\.filter[\s\S]*?\n  \}/);
  assert.ok(f, "la sezione delle schede nuove non c'è");
  assert.match(f[0], /const daSpegnere=nuove\.filter\(x=>conRosso\.indexOf\(x\.a\.id\)<0\)/,
    "una bandierina cardiaca non può sparire perché sei passato dalla schermata");
  assert.match(f[0], /markSheetSeen/,
    "quelle rosse devono avere un modo esplicito per essere chiuse");
});

prova("lo spegnimento automatico non ridisegna la pagina sotto le mani", () => {
  const f = html.match(/const daSpegnere=nuove\.filter[\s\S]*?\},0\);/);
  assert.ok(f, "il blocco di spegnimento non c'è");
  // si tolgono i commenti: la prima versione di questo test pescava la parola
  // render() dentro il commento che spiega perche' render() NON va chiamata
  const codice = f[0].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(codice, /if\(n\) save\(\);/);
  assert.ok(!/render\(\)/.test(codice),
    "ridisegnare mentre la stai leggendo te la fa sparire davanti agli occhi");
});

prova("«Visto» si può premere senza aprire la scheda", () => {
  const f = html.match(/function markSheetSeen\(id, ev\)[\s\S]*?\n}/);
  assert.ok(f, "markSheetSeen non c'è");
  assert.match(f[0], /ev\.stopPropagation\(\)/,
    "il pulsante sta dentro una card cliccabile: senza questo apre anche l'anamnesi");
  assert.match(html, /markSheetSeen\(\\''\+x\.a\.id\+'\\',event\)/,
    "l'evento va passato, altrimenti stopPropagation non ha niente da fermare");
});

prova("markSheetSeen spegne davvero, e solo quella", () => {
  vm.runInContext(`S.athletes=[
    {id:"a1",name:"Una",profile:{formNew:true}},
    {id:"a2",name:"Due",profile:{formNew:true}}
  ]; save=function(){}; render=function(){};`, sandbox);
  sandbox.markSheetSeen("a1");
  const st = vm.runInContext("S.athletes.map(a=>a.id+':'+(a.profile.formNew?1:0)).join(',')", sandbox);
  assert.equal(st, "a1:0,a2:1");
});

prova("«segna tutte come lette» esiste solo quando ce n'è più di una", () => {
  const f = html.match(/const nuove=items\.filter[\s\S]*?\n  \}/)[0];
  assert.match(f, /nuove\.length>1\?[\s\S]{0,120}markAllSheetsSeen/,
    "con una scheda sola un «segna tutte» è rumore");
});

/* ── 4. Il riassunto dice le cose che contano ── */

prova("il riassunto mostra il testo dell'infortunio, non che ce n'è uno", () => {
  const t = testo({ profile: { injuriesCurrent: "dolore al ginocchio destro dopo i salti, da tre settimane" } });
  assert.match(t, /ginocchio destro/i, "sapere DOVE cambia la seduta di oggi");
});

prova("il dolore porta con sé quando compare", () => {
  const t = testo({ profile: { painLevel: "6", painContext: "Mentre mi alleno" } });
  assert.match(t, /6\/10/);
  assert.match(t, /mentre mi alleno/i, "«6/10» da solo non dice se puoi allenarla");
});

prova("farmaci e allergie si vedono senza aprire niente", () => {
  const t = testo({ profile: { meds: "salbutamolo al bisogno", allergies: "arachidi" } });
  assert.match(t, /salbutamolo/i);
  assert.match(t, /arachidi/i);
});

prova("i testi lunghi vengono tagliati, non spalmati su mezza pagina", () => {
  const lungo = "x".repeat(500);
  schedaDigest({ profile: { injuriesCurrent: lungo, conditions: lungo, meds: lungo } })
    .righe.forEach((r) => assert.ok(r.t.length <= 130, "riga lunga " + r.t.length));
});

prova("la crescita rapida compare, perché cambia il carico di salti", () => {
  const t = testo({ profile: { growth: "Sì, parecchio" } });
  assert.match(t, /cresciut/i);
  const t2 = testo({ profile: { growth: "No" } });
  assert.ok(!/cresciut/i.test(t2), "chi non è cresciuta non deve occupare una riga");
});

prova("un consenso solo dichiarato viene detto, non nascosto", () => {
  const t = testo({ profile: { consent: true, consentSource: "import" } });
  assert.match(t, /importato/i);
  const t2 = testo({ profile: { consent: true, consentSource: "form", consentPolicyVersion: 2 } });
  assert.ok(!/non registrato/i.test(t2), "quello dimostrabile non ha bisogno di avvisi");
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
