// Presenze: chi c'era, chi no, e cosa ne consegue.
//
//   node test/presenze.mjs
//
// Perche' questo test esiste. Le presenze sono il dato piu' banale del
// software e il piu' facile da rendere inutile. Quattro modi di sbagliarlo:
//
//   1. il denominatore. Se segni solo le assenti, "presenze 0 su 3" e' falso:
//      le altre c'erano, nessuno l'ha scritto. Chiudere l'appello deve
//      scrivere uno stato per OGNI atleta della squadra, altrimenti la
//      percentuale di frequenza — il primo numero da guardare quando una non
//      migliora — e' un numero inventato.
//   2. il filtro. "Oggi sono dodici su sedici" deve togliere dai gruppi di
//      carico SOLO chi e' segnata assente. Un'atleta non segnata non e'
//      un'assente: e' un'atleta su cui non hai ancora detto niente. Se il
//      filtro escludesse anche lei, un appello iniziato e non finito
//      svuoterebbe la palestra.
//   3. la sincronizzazione. Due telefoni, lo stesso allenamento: tu segni
//      meta' squadra, il tuo collaboratore l'altra meta'. Se l'unione lavora
//      sulla data invece che sull'atleta, una delle due meta' sparisce.
//   4. la cancellazione. Un'atleta cancellata deve uscire anche da qui.
//      Un'assenza e' un dato personale di una minorenne: restare nel cloud
//      dopo la cancellazione non e' una dimenticanza, e' una violazione.

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

const squadra = () => run(`
  S.athletes=[{id:"a1",name:"Sara",sex:"F",team:"t1"},
              {id:"a2",name:"Giulia",sex:"F",team:"t1"},
              {id:"a3",name:"Marta",sex:"F",team:"t1"}];
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}];
  S.activeTeam="t1"; S.data={}; S.pres={}; S.tomb={};
`);

console.log("\nPresenze");

/* ── 1. le fondamenta ── */
prova("normalize crea il contenitore delle presenze", () => {
  run(`S.pres=undefined; normalize();`);
  assert.equal(run(`typeof S.pres`), "object");
  assert.ok(run(`S.pres && !Array.isArray(S.pres)`), "deve essere un oggetto per atleta, non una lista");
});

prova("uno stato per atleta e per data, e si rilegge", () => {
  squadra();
  run(`presSet("a1","2026-10-12","p"); presSet("a1","2026-10-13","a");`);
  assert.equal(run(`presGet("a1","2026-10-12")`), "p");
  assert.equal(run(`presGet("a1","2026-10-13")`), "a");
  assert.equal(run(`presGet("a1","2026-10-14")`), null, "una data non segnata non e' un'assenza");
  assert.equal(run(`presGet("a2","2026-10-12")`), null);
});

prova("gli stati ammessi sono tre e nient'altro entra", () => {
  squadra();
  run(`presSet("a1","2026-10-12","x"); presSet("a2","2026-10-12","presente");`);
  assert.equal(run(`presGet("a1","2026-10-12")`), null, "uno stato inventato non deve entrare");
  assert.equal(run(`presGet("a2","2026-10-12")`), null);
  run(`presSet("a1","2026-10-12","r");`);
  assert.equal(run(`presGet("a1","2026-10-12")`), "r", "il lavoro ridotto e' uno stato legittimo");
});

prova("riscrivere lo stesso giorno non crea un doppione", () => {
  squadra();
  run(`presSet("a1","2026-10-12","p"); presSet("a1","2026-10-12","a"); presSet("a1","2026-10-12","r");`);
  assert.equal(run(`S.pres.a1.length`), 1);
  assert.equal(run(`presGet("a1","2026-10-12")`), "r");
});

prova("le date restano in ordine anche se le inserisci al contrario", () => {
  squadra();
  run(`presSet("a1","2026-10-20","p"); presSet("a1","2026-10-05","p"); presSet("a1","2026-10-12","a");`);
  assert.deepEqual(j(`S.pres.a1.map(e=>e.d)`), ["2026-10-05", "2026-10-12", "2026-10-20"]);
});

/* ── 2. il denominatore ── */
prova("chiudere l'appello scrive uno stato per OGNI atleta della squadra", () => {
  // Il difetto piu' insidioso: segni le due assenti, salvi, e la terza resta
  // senza riga. Dopo tre mesi la percentuale di frequenza e' calcolata su un
  // denominatore che conta solo i giorni in cui qualcuno era assente.
  squadra();
  run(`presSalva("2026-10-13",{a1:"a"});`);
  assert.equal(run(`presGet("a1","2026-10-13")`), "a");
  assert.equal(run(`presGet("a2","2026-10-13")`), "p", "non toccata = presente, ma SCRITTA");
  assert.equal(run(`presGet("a3","2026-10-13")`), "p");
});

prova("la percentuale di frequenza conta ridotto come presenza, non come assenza", () => {
  squadra();
  run(`presSalva("2026-10-01",{});
       presSalva("2026-10-03",{a1:"a"});
       presSalva("2026-10-06",{a1:"r"});
       presSalva("2026-10-08",{});`);
  const s = run(`presStats("a1")`);
  assert.equal(s.tot, 4);
  assert.equal(s.p, 2);
  assert.equal(s.r, 1);
  assert.equal(s.a, 1, "una assenza");
  assert.equal(s.pc, 75, "tre sedute su quattro: e' stata in palestra");
  const s2 = run(`presStats("a2")`);
  assert.equal(s2.pc, 100);
  assert.equal(run(`presStats("a1","2026-10-05").tot`), 2, "la finestra temporale deve tagliare");
});

prova("senza nessun appello la frequenza non e' zero: e' sconosciuta", () => {
  squadra();
  const s = run(`presStats("a1")`);
  assert.equal(s.tot, 0);
  assert.equal(s.pc, null, "zero su zero non e' 0%, e mostrare 0% direbbe una bugia");
});

/* ── 3. il filtro ── */
prova("il filtro toglie solo chi e' segnata assente", () => {
  squadra();
  const oggi = run(`todayISO()`);
  run(`presSet("a2",${JSON.stringify(oggi)},"a");`);
  const ids = j(`presFiltra(teamAthletes()).map(a=>a.id)`);
  assert.deepEqual(ids, ["a1", "a3"], "a2 assente esce, le altre restano anche se non segnate");
});

prova("un appello non iniziato non svuota la palestra", () => {
  squadra();
  const ids = j(`presFiltra(teamAthletes()).map(a=>a.id)`);
  assert.deepEqual(ids, ["a1", "a2", "a3"]);
});

prova("il lavoro ridotto resta in palestra: c'e', con meno carico", () => {
  squadra();
  const oggi = run(`todayISO()`);
  run(`presSet("a1",${JSON.stringify(oggi)},"r");`);
  assert.deepEqual(j(`presFiltra(teamAthletes()).map(a=>a.id)`), ["a1", "a2", "a3"]);
});

prova("i gruppi di carico si formano solo con chi c'e'", () => {
  squadra();
  const oggi = run(`todayISO()`);
  run(`S.data={a1:{rmSquat:[{d:"2026-09-01",v:80}]},
               a2:{rmSquat:[{d:"2026-09-01",v:70}]},
               a3:{rmSquat:[{d:"2026-09-01",v:60}]}};
       LG={ex:"rmSquat",pct:75,size:3,mode:"media",ord:"asc"};
       presSet("a2",${JSON.stringify(oggi)},"a");`);
  const c = j(`lgCandidate("rmSquat").con.map(x=>x.id)`);
  assert.deepEqual(c, ["a3", "a1"], "a2 e' a casa: non deve comparire fra i carichi di oggi");
  run(`PRES_F=false;`);
  assert.equal(run(`lgCandidate("rmSquat").con.length`), 3, "e deve esserci un modo per rivederle tutte");
  run(`PRES_F=true;`);
});

/* ── 4. la sincronizzazione ── */
prova("due telefoni, meta' squadra ciascuno: non si perde nessuno", () => {
  const out = run(`
    var sv={athletes:[{id:"a1",name:"Sara"},{id:"a2",name:"Giulia"}],data:{},
            pres:{a1:[{d:"2026-10-13",s:"p"}]}};
    var lo={athletes:[{id:"a1",name:"Sara"},{id:"a2",name:"Giulia"}],data:{},
            pres:{a2:[{d:"2026-10-13",s:"a"}]}};
    mergeState(sv,lo);
  `);
  assert.ok(out.pres, "le presenze devono sopravvivere all'unione");
  assert.equal(out.pres.a1[0].s, "p");
  assert.equal(out.pres.a2[0].s, "a", "la meta' segnata sull'altro telefono non deve sparire");
});

prova("un'assenza cancellata non torna dal server", () => {
  const out = run(`
    var sv={athletes:[{id:"a1",name:"Sara"}],data:{},pres:{a1:[{d:"2026-10-13",s:"a"}]}};
    var lo={athletes:[{id:"a1",name:"Sara"}],data:{},pres:{},
            tomb:{"p:a1:2026-10-13":"2026-10-13T10:00:00.000Z"}};
    mergeState(sv,lo);
  `);
  assert.ok(!(out.pres.a1 && out.pres.a1.length), "la tombstone deve tenerla fuori");
});

prova("correggere un'assenza cancellata per sbaglio deve funzionare", () => {
  squadra();
  run(`presSet("a1","2026-10-13","a"); presSet("a1","2026-10-13",null);`);
  assert.equal(run(`presGet("a1","2026-10-13")`), null);
  assert.ok(run(`!!(S.tomb||{})["p:a1:2026-10-13"]`), "la cancellazione lascia una tombstone");
  run(`presSet("a1","2026-10-13","p");`);
  assert.equal(run(`presGet("a1","2026-10-13")`), "p");
  assert.ok(run(`!(S.tomb||{})["p:a1:2026-10-13"]`),
    "e riscriverla deve togliere la tombstone, o al primo conflitto sparisce di nuovo");
});

/* ── 5. il ripristino ── */
prova("un backup ripristinato non perde le presenze", () => {
  const out = run(`sanitizeImport({
    athletes:[{id:"a1",name:"Sara",sex:"F"}], data:{},
    pres:{a1:[{d:"2026-10-13",s:"p"},{d:"2026-10-14",s:"r"}]}
  })`);
  assert.ok(out.pres && out.pres.a1, "PERSA: l'export le scrive, l'import le buttava via");
  assert.equal(out.pres.a1.length, 2);
  assert.equal(out.pres.a1[1].s, "r");
});

prova("il ripristino scarta righe fuori forma e atleti che non esistono", () => {
  const out = run(`sanitizeImport({
    athletes:[{id:"a1",name:"Sara",sex:"F"}], data:{},
    pres:{a1:[{d:"13/10/2026",s:"p"},{d:"2026-10-13",s:"zzz"},{d:"2026-10-14",s:"a"}],
          fantasma:[{d:"2026-10-13",s:"p"}]}
  })`);
  assert.equal(out.pres.a1.length, 1, "data sbagliata e stato inventato non entrano");
  assert.equal(out.pres.a1[0].d, "2026-10-14");
  assert.ok(!out.pres.fantasma, "un atleta che non c'e' piu' non porta dentro i suoi dati");
});

/* ── 6. la cancellazione ── */
prova("cancellare un'atleta cancella anche le sue presenze", () => {
  squadra();
  run(`presSalva("2026-10-13",{a1:"a"});`);
  assert.ok(run(`!!S.pres.a1`));
  run(`delAthlete("a1")`);
  assert.ok(run(`!S.pres.a1`), "dato personale di una minorenne rimasto nel cloud dopo la cancellazione");
  assert.ok(run(`!!S.pres.a2`), "ma le altre non si toccano");
});

prova("i dati di esempio non lasciano in giro le presenze delle atlete vere", () => {
  squadra();
  run(`presSalva("2026-10-13",{});`);
  run(`loadDemo()`);
  assert.ok(run(`!S.pres.a1 && !S.pres.a2 && !S.pres.a3`),
    "le presenze delle atlete sostituite devono andarsene con loro");
});

/* ── 7. le liste di plumbing, quelle che si dimenticano ── */
prova("pres e' in tutte le liste che la devono citare", () => {
  const manca = [];
  if (!/TOMB_PREFIX=\{[^}]*pres:"p"/.test(html)) manca.push("TOMB_PREFIX");
  const liste = html.match(/\["data","readiness","load","screen","lv"\]/g) || [];
  if (liste.length) manca.push("una lista ancora senza pres: " + liste[0]);
  const l2 = html.match(/\["readiness","load","screen","lv"\]/g) || [];
  if (l2.length) manca.push("lista di merge senza pres");
  assert.equal(manca.length, 0, manca.join(" · "));
});

prova("il conteggio del giorno dice presenti, ridotti e assenti", () => {
  squadra();
  run(`presSalva("2026-10-13",{a1:"a",a2:"r"});`);
  const c = run(`presConta("2026-10-13")`);
  assert.equal(c.tot, 3);
  assert.equal(c.in, 2, "presenti + ridotti");
  assert.equal(c.a, 1);
  assert.equal(c.r, 1);
  assert.equal(run(`presConta("2026-10-20").segnato`), false, "un giorno senza appello va detto, non mostrato come 0 su 3");
  assert.equal(run(`presConta("2026-10-13").segnato`), true);
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
