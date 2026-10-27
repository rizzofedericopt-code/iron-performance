// Lo scout dal PDF e il rapporto dopo-gara.
//
//   node test/scout.mjs
//
// Il PDF è una stampa: le tabelle si ricostruiscono dalla posizione delle
// scritte. La fixture è il testo, con le posizioni, di un PDF vero di una
// partita, con nomi, squadra e data cambiati. Le prove controllano che i
// numeri finiscano nella colonna giusta, che le somme tornino, e che quando
// non tornano l'import si fermi invece di indovinare.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const PAGINE = readFileSync(join(here, "fixtures", "scout-esempio.json"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));

const mem = new Map();
const cache = {};
const elFor = (id) => ({
  value: "", dataset: {}, style: {}, textContent: "", innerHTML: "",
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector() { return null; }, querySelectorAll() { return []; },
  appendChild() {}, focus() {}, select() {}, click() {},
});
let STAMPA = "";
const sandbox = {
  document: {
    getElementById: (id) => (cache[id] ||= elFor(id)),
    querySelector: () => elFor("__q"), querySelectorAll: () => [], createElement: () => elFor("__c"),
    addEventListener() {}, body: elFor("__b"), documentElement: elFor("__d"), hidden: false,
  },
  window: { addEventListener() {}, open: () => ({ document: { write: (x) => { STAMPA = x; }, close() {} }, focus() {}, print() {} }) },
  navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
sandbox.window.open = sandbox.window.open;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const j = (c) => { const r = run("JSON.stringify(" + c + ")"); return r === undefined ? undefined : JSON.parse(r); };
run(`normalize();`);
run(`var LASTT=""; render=function(){}; save=function(){}; closeM=function(){}; toast=function(m){LASTT=String(m)}; setTimeout=function(){};`);
run(`var PAGINE=${PAGINE};`);

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};
const D = "2026-01-17";
const leggi = (mod) => j(`scoutLeggi(${mod ? `(function(){ const p=JSON.parse(JSON.stringify(PAGINE)); (${mod})(p); return p; })()` : "PAGINE"})`);
const squadra = () => run(`{
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}]; S.activeTeam="t1"; S.load={}; S.salti={}; S.scout={}; S.pres={}; S.tomb={}; S.readiness={}; S.data={};
  S.gare={t1:[]}; GV={d:null};
  S.athletes=["Anna Rossini","Bea Conti","Carla Zeni","Dora Castellani","Elisa Gallinari","Franca Mariani","Gaia Bassi","Ilaria Moro",
    "Lara Bruni","Marta Rinaldelli","Nora Pozzi","Olga Tonelli","Pia Villa","Rita Bellini","Sara Esterna"].map((n,i)=>({id:"a"+i,name:n,team:"t1",sex:"F",profile:{}}));
}`);
const id = (cognome) => run(`S.athletes.find(a=>a.name.endsWith(${JSON.stringify(cognome)})).id`);

console.log("\nLettura del PDF");

prova("intestazione, data e set con durata e punteggio", () => {
  const R = leggi();
  assert.deepEqual(R.errori, []);
  assert.equal(R.data, D); assert.equal(R.ora, "18:31"); assert.equal(R.risultato, "3-2");
  assert.deepEqual(R.set.map((s) => s.min), [31, 24, 23, 26, 15]);
  assert.deepEqual(R.set.map((s) => s.punteggio), ["22-25", "25-14", "25-16", "16-25", "15-9"]);
});

prova("ogni numero nella sua colonna: la somma delle atlete dà il totale", () => {
  const R = leggi();
  assert.ok(R.controlli.some((c) => /Squadra A: la somma delle atlete dà il totale/.test(c)));
  const g = R.squadre["Squadra A"].gioc["8"];
  assert.equal(g.v.att_tot, 39); assert.equal(g.v.att_pt, 17); assert.equal(g.v.bat_tot, 18); assert.equal(g.v.ric_tot, 29);
  assert.equal(g.v.att_ptp, 44); assert.equal(g.v.att_eff, 87);
  assert.equal(g.muriToccati, 2, "dai riquadri «Valutazioni»");
  assert.equal(R.squadre["Squadra A"].gioc["10"].v.att_ptp, 100, "«100%100%» attaccati: due colonne");
  assert.equal(R.squadre["Squadra A"].gioc["10"].v.att_eff, 100);
});

prova("set per set: chi compare in ogni set e chi parte nel sestetto", () => {
  const R = leggi(), s = R.squadre["Squadra A"].gioc;
  assert.deepEqual(s["8"].set, [1, 2, 3, 4, 5]); assert.deepEqual(s["8"].sestetto, [1, 2, 3, 4, 5]);
  assert.deepEqual(s["11"].set, [1, 5]); assert.deepEqual(s["3"].sestetto, [3, 4, 5]);
  assert.equal(s["8"].nome, "Castellani", "il nome intero dal sestetto, non quello troncato della tabella");
});

prova("chi è in campo senza toccare palla per le tabelle non esiste: lo dice il sestetto", () => {
  const R = leggi();
  assert.deepEqual(R.soloSestetto, { "40|Bellini": [2] });
});

prova("un numero cambiato: le somme non tornano e l'import si ferma", () => {
  const R = leggi(`p=>{ const it=p[0].items.find(i=>i.s==="39"); it.s="38"; }`);
  assert.equal(R.ok, false);
  assert.ok(R.errori.some((e) => /non danno il totale|non danno quelli della partita/.test(e)), R.errori.join(" | "));
});

prova("un totale cambiato nel PDF: la somma delle atlete non lo dà, e si ferma", () => {
  const R = leggi(`p=>{ const tot=p[0].items.filter(i=>i.s==="150")[0]; tot.s="151"; }`);
  assert.equal(R.ok, false);
  assert.ok(R.errori.some((e) => /non danno il totale/.test(e)), R.errori.join(" | "));
});

prova("un set che non torna con la partita: si ferma", () => {
  // set 1: gli attacchi di una sola atleta cambiati, la partita no
  const R = leggi(`p=>{ const pg=p[2]; const r=pg.items.find(i=>i.s==="Castellan"); const v=pg.items.filter(i=>Math.abs(i.y-r.y)<1.5 && i.s==="13")[0]; v.s="12"; }`);
  assert.equal(R.ok, false);
  assert.ok(R.errori.some((e) => /non danno quelli della partita/.test(e)), R.errori.join(" | "));
});

prova("due percentuali stampate attaccate («100%100%») vanno in due colonne", () => {
  const R = leggi(`p=>{ const it=p[0].items; const n=it.find(i=>i.s==="Gallinari"); const r=it.filter(i=>Math.abs(i.y-n.y)<1.5 && i.s==="100%");
    r[0].s="100%100%"; r[0].w=(r[1].x+r[1].w)-r[0].x; it.splice(it.indexOf(r[1]),1); }`);
  assert.deepEqual(R.errori, []);
  assert.equal(R.squadre["Squadra A"].gioc["10"].v.att_ptp, 100);
  assert.equal(R.squadre["Squadra A"].gioc["10"].v.att_eff, 100);
});

prova("una colonna in più o in meno: formato non riconosciuto, niente import", () => {
  const R = leggi(`p=>{ const it=p[0].items.find(i=>i.s==="prf%"); it.s="exc%"; }`);
  assert.equal(R.ok, false);
  assert.ok(R.errori.some((e) => /intestazione delle colonne/.test(e)));
});

prova("un PDF che non è uno scout: niente tabelle, niente import", () => {
  const R = j(`scoutLeggi([{w:595,h:842,items:[{s:"Fattura",x:40,y:800,w:40},{s:"Totale 120",x:40,y:700,w:50}]}])`);
  assert.equal(R.ok, false);
});

prova("nomi troncati e accenti: lo stesso cognome si riconosce, uno diverso no", () => {
  assert.equal(run(`scoutStessoNome("Castellan","Castellani")`), true);
  assert.equal(run(`scoutStessoNome("Viganò","vigano")`), true);
  assert.equal(run(`scoutStessoNome("Conti","Contini")`), false, "sotto i 6 caratteri non si indovina");
});

console.log("\nImport nella gara");

const importa = (d = null, abb = null) => {
  run(`scoutPrepara(scoutLeggi(PAGINE), "partita.pdf", ${d ? JSON.stringify(d) : "null"})`);
  if (abb) run(`Object.assign(SCI.abb, ${JSON.stringify(abb)})`);
  run(`scoutImporta()`);
};

prova("le atlete si abbinano da sole per cognome, e la maglia resta nella scheda", () => {
  squadra(); importa();
  assert.equal(j(`scoutDi(${JSON.stringify(id("Castellani"))},"${D}").att`), 39);
  assert.equal(run(`S.athletes.find(a=>a.name.endsWith("Castellani")).profile.maglia`), "8");
  assert.equal(j(`scoutArr(${JSON.stringify(id("Esterna"))})`).length, 0, "chi non è nel PDF non riceve niente");
});

prova("la gara nasce dal PDF se non c'è: data, durate, punteggi, risultato", () => {
  squadra(); importa();
  const g = j(`garaDi("${D}")`);
  assert.deepEqual(g.setDur, [31, 24, 23, 26, 15]); assert.equal(g.durata, 119); assert.equal(g.setTot, 5); assert.equal(g.ris, "3-2");
  assert.equal(g.avv, "Avversaria"); assert.equal(g.casa, true, "la nostra squadra è quella «Locali»");
});

prova("Bellini: in campo nel set 2 senza azioni, importata come tale", () => {
  squadra(); importa();
  const e = j(`scoutDi(${JSON.stringify(id("Bellini"))},"${D}")`);
  assert.deepEqual(e.set, [2]); assert.equal(e.solo, 1); assert.equal(e.att, 0);
});

prova("i minuti di gara diventano quelli veri dei suoi set", () => {
  squadra(); importa();
  const g = j(`garaDi("${D}")`);
  const ma = id("Mariani");                                            // set 1 e 5: 31 + 15
  assert.equal(run(`garaMinuti(garaDi("${D}"), 2, ${JSON.stringify(ma)})`), 46);
  assert.equal(run(`garaMinuti(garaDi("${D}"), 3, ${JSON.stringify(ma)})`), Math.round(119 * 3 / 5), "set diversi da quelli dello scout: si torna alla proporzione");
  assert.ok(g);
});

prova("un carico già segnato prende i minuti veri all'import", () => {
  squadra();
  run(`S.gare.t1=[{d:"${D}",avv:"Avversaria",durata:120,setTot:5}]; S.load={${JSON.stringify(id("Mariani"))}:[{d:"${D}",exercise:"gara",rpe:7,min:48,set:2}]}`);
  importa();
  assert.equal(j(`garaCarico(${JSON.stringify(id("Mariani"))},"${D}").min`), 46);
});

prova("dalla scheda di un'altra gara il PDF non entra", () => {
  squadra(); run(`S.gare.t1=[{d:"2026-02-01",avv:"X"}]`);
  importa("2026-02-01");
  assert.equal(j(`scoutArr(${JSON.stringify(id("Castellani"))})`).length, 0);
});

prova("la stessa atleta su due maglie: si ferma", () => {
  squadra(); importa(null, { "3": id("Castellani") });
  assert.equal(j(`scoutArr(${JSON.stringify(id("Castellani"))})`).length, 0);
});

prova("reimportare sostituisce, e chi non è più abbinata viene tolta anche sugli altri dispositivi", () => {
  squadra(); importa();
  importa(null, { "30": "" });
  const v = id("Villa");
  assert.equal(j(`scoutArr(${JSON.stringify(v)})`).length, 0);
  assert.ok(run(`!!S.tomb["sc:${v}:${D}|gara"]`));
  assert.equal(j(`scoutArr(${JSON.stringify(id("Castellani"))})`).length, 1, "una voce per partita, non due");
});

prova("lo scout si unisce fra dispositivi e sparisce con l'atleta", () => {
  squadra(); importa();
  const c = id("Castellani");
  const out = j(`mergeState({athletes:S.athletes, teams:S.teams, scout:{}, tomb:{}}, {athletes:S.athletes, teams:S.teams, scout:S.scout, tomb:{}})`);
  assert.equal(out.scout[c][0].att, 39);
  run(`delAthlete(${JSON.stringify(c)})`);
  assert.equal(run(`S.scout[${JSON.stringify(c)}]===undefined`), true);
});

console.log("\nRapporto dopo-gara");

prova("il riassunto dice chi ha portato il carico, chi non si vede e cosa manca", () => {
  squadra(); importa();
  const r = j(`garaRiassunto("${D}")`).join(" ");
  assert.match(r, /3-2/); assert.match(r, /119′ di gioco/);
  assert.match(r, /Più azioni in salto registrate: Dora 41/);
  assert.match(r, /senza nessuna azione registrata: Rita \(set 2\)/);
  const b = j(`garaBuchi("${D}")`).join(" ");
  assert.match(b, /non distingue battuta in salto e flottante/);
  assert.match(b, /in campo senza RPE/);
});

prova("se i set segnati a mano non sono quelli dello scout, il rapporto lo dice", () => {
  squadra(); importa();
  run(`S.load[${JSON.stringify(id("Mariani"))}]=[{d:"${D}",exercise:"gara",rpe:7,min:119,set:5}]`);
  assert.match(j(`garaBuchi("${D}")`).join(" "), /set segnati diversi dallo scout: Franca 5 invece di 2/);
});

prova("la tabella per il preparatore incrocia scout, carico, check-in e CMJ dei giorni dopo", () => {
  squadra(); importa();
  const c = id("Castellani");
  run(`S.load[${JSON.stringify(c)}]=[{d:"${D}",exercise:"gara",rpe:8,min:119,set:5}];
       S.readiness[${JSON.stringify(c)}]=[{d:"2026-01-18",sl:2,so:4,fa:4,st:3}];
       S.data[${JSON.stringify(c)}]={cmj:[{d:"2026-01-10",v:34},{d:"2026-01-19",v:31}]}; S.te={cmj:1};`);
  const h = run(`garaRapportoHtml("${D}")`);
  assert.match(h, /Dora Castellani<\/td><td>5<\/td><td>39<\/td><td>2<\/td><td>18<\/td><td><b>41<\/b>/);
  assert.match(h, />952<small>RPE 8/);
  assert.match(h, /\+1 gg/); assert.match(h, />31<small class="down">-3</);
  assert.match(h, /Proposte per i giorni dopo:<\/b> arrivano con le regole/);
});

prova("la stampa per l'allenatore non porta check-in né CMJ", () => {
  squadra(); importa();
  const c = id("Castellani");
  run(`S.readiness[${JSON.stringify(c)}]=[{d:"2026-01-18",sl:2,so:4,fa:4,st:3}]; garaStampa("${D}")`);
  assert.match(STAMPA, /Dora Castellani/);
  assert.ok(!/Check-in|CMJ|readiness/i.test(STAMPA), "dati di benessere e fatica restano al preparatore");
});

console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
