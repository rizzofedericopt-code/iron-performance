// Profilo prestazioni, ruoli e calendario gare.
//
//   node test/profilo.mjs
//
// Perche' questo test esiste.
//   1. Il profilo e' il foglio che esce dall'app: va in mano a una famiglia o
//      a una societa'. Se ci finisce dentro l'anamnesi, e' una fuga di dati
//      sanitari di una minorenne. Il test lo controlla parola per parola.
//   2. Il ruolo e' testo libero: «schiacciatrice», «banda», «Ala grande». Se
//      non si riconosce bene, una ragazza finisce confrontata col ruolo
//      sbagliato — o con nessuno.
//   3. Con due atlete per ruolo una mediana e' un aneddoto: non si mostra.
//   4. L'avviso gara deve uscire solo quando serve, o diventa rumore.

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


const fra = (gg) => { const d = new Date(); d.setDate(d.getDate() + gg); return d.toISOString().slice(0, 10); };
const squadra = () => run(`{
  S.teams=[{id:"t1",name:"U18",sport:"pallavolo"},{id:"t2",name:"Calcio",sport:"calcio"}];
  S.activeTeam="t1"; S.sport="pallavolo"; S.pres={}; S.tomb={}; S.te={}; S.gare={}; S.cfg.deltaNoise=5;
  const R=[["a1","Sara","schiacciatrice"],["a2","Giulia","Banda"],["a3","Marta","Schiacc."],
           ["a4","Elena","centrale"],["a5","Chiara","Centrale"],["a6","Anna",""],["a7","Bea","palleggiatrice"]];
  S.athletes=R.map(x=>({id:x[0],name:x[1],sex:"F",team:"t1",profile:{role:x[2],birth:"2010-01-01"}}));
  S.data={};
  R.forEach((x,i)=>{ S.data[x[0]]={cmj:[{d:"2026-09-01",v:30+i},{d:"2026-10-01",v:31+i}]}; });
}`);

console.log("\nRuoli");

prova("il ruolo scritto in mille modi diventa uno", () => {
  squadra();
  const r = j(`S.athletes.map(a=>ruoloDi(a))`);
  assert.deepEqual(r, ["Schiacciatore","Schiacciatore","Schiacciatore","Centrale","Centrale",null,"Palleggiatore"]);
});

prova("fra due ruoli simili vince quello scritto per intero", () => {
  run(`S.teams.push({id:"tb",name:"B",sport:"basket"});`);
  assert.equal(run(`ruoloDi({team:"tb",profile:{role:"ala grande"}})`), "Ala grande");
  assert.equal(run(`ruoloDi({team:"tb",profile:{role:"Ala"}})`), "Ala");
  assert.equal(run(`ruoloDi({team:"tb",profile:{role:"Ala grande (4)"}})`), "Ala grande", "non «Ala»: la radice piu' lunga vince");
  assert.equal(run(`ruoloDi({team:"t1",profile:{role:"jolly"}})`), "jolly", "un ruolo che non conosco resta com'e'");
});

prova("la mediana del ruolo solo da tre atlete in su", () => {
  squadra();
  const s = j(`ruoloMediana(S.athletes[0],"cmj")`);
  assert.equal(s.n, 3);
  assert.equal(s.v, 32, "31, 32, 33 → 32");
  assert.equal(run(`ruoloMediana(S.athletes[3],"cmj")`), null, "due centrali non fanno una mediana");
});

prova("ordinate per ruolo: l'ordine dello sport, chi non ce l'ha in fondo", () => {
  squadra();
  run(`SORT={by:"ruolo",desc:false};`);
  assert.deepEqual(j(`atleteOrdinate().map(a=>a.name)`), ["Bea","Giulia","Marta","Sara","Chiara","Elena","Anna"]);
  run(`sortClear();`);
});

prova("il confronto fra ruoli mostra i valori, non una mediana, sotto le tre", () => {
  squadra();
  const T = j(`ruoliTabella("F")`);
  assert.deepEqual(T.ruoli.map(x => x.r), ["Palleggiatore","Schiacciatore","Centrale","Senza ruolo"]);
  assert.equal(T.celle.Schiacciatore.cmj.med, 32);
  assert.equal(T.celle.Centrale.cmj.med, null);
  assert.deepEqual(T.celle.Centrale.cmj.valori, [34, 35]);
});

prova("il peso non entra nel confronto fra ruoli", () => {
  squadra();
  run(`S.teams[0].tests=["cmj","bw"]; S.data.a1.bw=[{d:"2026-10-01",v:60}];`);
  assert.ok(j(`ruoliTabella("F").tests`).indexOf("bw") < 0);
  run(`delete S.teams[0].tests;`);
});

console.log("\nProfilo prestazioni");

prova("nel profilo non c'è niente di sanitario", () => {
  squadra();
  run(`Object.assign(S.athletes[0].profile, {injuriesCurrent:"tendinite rotulea dx", injuriesPast:"frattura polso 2024",
       medical:"asma da sforzo", notes:"famiglia complicata", scHeart:true, painLevel:"6", medicalExpiry:"2027-01-01"});
       S.readiness={a1:[{d:"2026-10-01",sl:1,so:1,fa:1,st:1}]};`);
  const h = run(`profiloHtml("a1",{})`);
  ["tendinite", "frattura", "asma", "famiglia complicata", "Readiness", "Problemi cardiaci", "cardiac", "idoneità", "2027"].forEach(w =>
    assert.ok(h.toLowerCase().indexOf(w.toLowerCase()) < 0, "nel profilo c'e' «" + w + "»"));
  assert.ok(/CMJ/.test(h), "ma le prestazioni si'");
  // e la cartella completa, quella riservata, resta un'altra cosa
  assert.ok(/printAthlete/.test(html) && /openProfilo/.test(html));
});

prova("il peso entra solo se lo chiedi", () => {
  squadra();
  run(`S.data.a1.bw=[{d:"2026-10-01",v:60}];`);
  assert.ok(j(`profiloDati("a1").righe.map(r=>r.t)`).indexOf("bw") < 0);
  assert.ok(j(`profiloDati("a1",{peso:true}).righe.map(r=>r.t)`).indexOf("bw") >= 0);
  assert.ok(!/Peso/.test(run(`profiloHtml("a1",{})`)));
});

prova("il verdetto è quello del report: +1 cm su 30 è stabile, non migliorata", () => {
  squadra();
  const r = j(`profiloDati("a1").righe.find(x=>x.t==="cmj")`);
  assert.equal(r.delta.verdetto, "rumore");
  assert.ok(/stabile \(dentro l'errore\)/.test(run(`profiloHtml("a1",{})`)));
});

prova("la posizione fra le compagne va sul foglio solo se la scegli", () => {
  squadra();
  // sette atlete con il CMJ: abbastanza per una posizione in squadra
  assert.ok(!/quinto|media della squadra|rispetto alla squadra/.test(run(`profiloHtml("a1",{})`)), "di default nessuna classifica");
  assert.ok(/rispetto alla squadra/.test(run(`profiloHtml("a1",{squadra:true})`)), "se la chiedi, c'e'");
});

prova("il commento del preparatore va sul foglio", () => {
  squadra();
  assert.ok(/Lavorare sull&#39;atterraggio|Lavorare sull'atterraggio/.test(run(`profiloHtml("a1",{commento:"Lavorare sull'atterraggio"})`)));
});

console.log("\nCalendario gare");

prova("la prossima gara è la più vicina nel futuro", () => {
  squadra();
  run(`S.gare={t1:[{d:"${fra(-3)}",avv:"Passata"},{d:"${fra(10)}",avv:"Lontana"},{d:"${fra(3)}",avv:"Vicina"}]};`);
  const g = j(`prossimaGara("t1")`);
  assert.equal(g.avv, "Vicina");
  assert.equal(g.gg, 3);
  assert.equal(run(`mdLabel(3)`), "MD-3");
  assert.equal(run(`mdLabel(0)`), "giorno di gara");
});

prova("l'avviso sui carichi esce solo con gara vicina E carico alto", () => {
  squadra();
  run(`S.gare={t1:[{d:"${fra(1)}",avv:"X"}]};`);
  assert.ok(/Gara tra 1 giorno/.test(run(`garaAvviso(85)`)));
  assert.equal(run(`garaAvviso(70)`), "", "al 70% nessun avviso");
  run(`S.gare={t1:[{d:"${fra(5)}",avv:"X"}]};`);
  assert.equal(run(`garaAvviso(90)`), "", "a cinque giorni nessun avviso");
});

prova("in Oggi la gara compare entro la settimana", () => {
  squadra();
  run(`S.gare={t1:[{d:"${fra(4)}",avv:"Rossi",casa:false}]};`);
  assert.ok(/MD-4/.test(run(`garaBanner()`)) && /trasferta/.test(run(`garaBanner()`)));
  run(`S.gare={t1:[{d:"${fra(12)}",avv:"Rossi"}]};`);
  assert.equal(run(`garaBanner()`), "");
});

prova("il calendario sopravvive al ripristino e scarta il resto", () => {
  const o = j(`sanitizeImport({athletes:[{id:"a1",name:"A"}], data:{},
    gare:{t1:[{d:"2026-11-02",avv:"Rossi",casa:true},{d:"2/11/26",avv:"x"},{d:"2026-11-02",avv:"Rossi"},{d:"2026-11-09",avv:"y".repeat(100)}],
          "../x":[{d:"2026-11-02"}]}})`);
  assert.equal(o.gare.t1.length, 2, "data sbagliata e doppione fuori");
  assert.equal(o.gare.t1[0].casa, true);
  assert.equal(o.gare.t1[1].avv.length, 60);
  assert.ok(!o.gare["../x"]);
});

prova("due dispositivi: vince il locale sulla stessa squadra, l'altra non si perde", () => {
  const m = j(`mergeState({athletes:[],data:{},gare:{t1:[{d:"2026-11-02"}],t2:[{d:"2026-11-03"}]}},
                         {athletes:[],data:{},gare:{t1:[{d:"2026-11-05"}]}})`);
  assert.equal(m.gare.t1[0].d, "2026-11-05");
  assert.ok(m.gare.t2);
});

prova("una squadra cancellata si porta via calendario, scheda e gruppi", () => {
  squadra();
  run(`S.gare={t2:[{d:"${fra(3)}"}]}; S.sedute={t2:{ex:[]}}; S.gruppi={"rmSquat@t2":{g:[["a1"]]},"rmSquat@t1":{g:[["a1"]]}};
       delTeam("t2");`);
  assert.ok(!run(`S.gare.t2`) && !run(`S.sedute.t2`) && !run(`S.gruppi["rmSquat@t2"]`));
  assert.ok(run(`!!S.gruppi["rmSquat@t1"]`), "quelli dell'altra squadra restano");
  const m = j(`mergeState({athletes:[],data:{},gare:{t2:[{d:"2026-11-03"}]}}, {athletes:[],data:{},tomb:{"team:t2":"2026-10-14T00:00:00Z"}})`);
  assert.ok(!m.gare.t2, "e non torna dal server");
});

console.log(failed ? "\n" + failed + " PROVE FALLITE\n" : "\ntutto verde\n");
process.exit(failed ? 1 : 0);
