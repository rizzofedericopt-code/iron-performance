// Analisi a fotogrammi: salto e velocità del bilanciere da un video al rallentatore.
//
//   node test/fotogrammi.mjs
//
// Il metodo è quello di My Jump e My Lift: due fotogrammi segnati a mano, il
// tempo fra loro, una formula. Qui si controlla che le formule siano quelle
// giuste, che il tempo si conti sui fotogrammi della RIPRESA e non su quelli del
// file, che la lettura dei fotogrammi al secondo non si faccia ingannare dallo
// schermo, e che i numeri arrivino dove devono: archivio salti, colonna del
// test, curva carico-velocità.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));
const mem = new Map(), cache = {};
const elFor = () => ({ value: "", dataset: {}, style: {}, textContent: "", innerHTML: "", addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, focus() {}, select() {}, click() {} });
const sandbox = {
  document: { getElementById: (id) => (cache[id] ||= elFor()), querySelector: () => elFor(), querySelectorAll: () => [], createElement: () => elFor(),
    addEventListener() {}, body: elFor(), documentElement: elFor(), hidden: false },
  window: { addEventListener() {}, open: () => null }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  fetch: () => Promise.reject(new Error("no")), confirm: () => true, prompt: () => "",
  setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const j = (c) => { const r = run("JSON.stringify(" + c + ")"); return r === undefined ? undefined : JSON.parse(r); };
run(`normalize(); render=function(){}; save=function(){}; toast=function(m){ globalThis.__toast=m; };`);

const vicino = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + " " + a + " invece di " + b);
const squadra = () => run(`{ S.teams=[{id:"t1",name:"U18",sport:"pallavolo"}]; S.activeTeam="t1";
  S.athletes=[{id:"a1",name:"Sara Rossi",team:"t1",sex:"F",profile:{}}]; S.data={a1:{}}; S.mjl={}; S.lv={}; S.tomb={};
  FOT.aid="a1"; FOT.data="2026-11-04"; FOT.segni={}; FOT.punti=[]; FOT.colonna=true; FOT.fpsRip=240; FOT.fpsFile=240; FOT.modo="salto"; FOT.tipo="CMJ"; }`);

let failed = 0;
const prove = [];
const prova = (nome, fn) => prove.push([nome, fn]);

console.log("\nLe formule");
prova("altezza dal tempo di volo: h = g·t²/8, la stessa di My Jump", () => {
  vicino(j(`fotAltezza(0.5)`), 9.81 * 0.25 / 8 * 100, 1e-9);
  vicino(j(`fotAltezza(0.5)`), 30.656, 0.001);
  assert.equal(j(`fotAltezza(0)`), null);
  // la stessa coppia altezza/volo passa il controllo di coerenza dell'archivio
  assert.deepEqual(j(`mjCoerenza({h:30.7, tv:500})`), []);
});
prova("salto: 120 fotogrammi a 240 = mezzo secondo di volo = 30,7 cm, ±0,5 cm per fotogramma", () => {
  const r = j(`fotSalto({stacco:10, atterr:130}, 240, "CMJ")`);
  vicino(r.tv, 0.5, 1e-12); vicino(r.h, 30.656, 0.001);
  vicino(r.ris, 9.81 * 0.5 / 4 / 240 * 100, 1e-9);
  // la risoluzione è la derivata: un fotogramma in più sposta l'altezza di quel tanto
  const r2 = j(`fotSalto({stacco:10, atterr:131}, 240, "CMJ")`);
  vicino(r2.h - r.h, r.ris, 0.01);
  assert.deepEqual(r.avvisi, []);
  assert.equal(r.rsi, undefined);
});
prova("salto: segni mancanti o al contrario non danno un numero", () => {
  assert.ok(j(`fotSalto({stacco:10}, 240, "CMJ")`).err);
  assert.ok(j(`fotSalto({stacco:50, atterr:50}, 240, "CMJ")`).err);
  assert.ok(j(`fotSalto({stacco:50, atterr:10}, 240, "CMJ")`).err);
  assert.ok(j(`fotSalto({stacco:10, atterr:130}, 0, "CMJ")`).err);
});
prova("drop jump: contatto → stacco = tempo di contatto, RSI = altezza in metri / contatto", () => {
  assert.ok(j(`fotSalto({stacco:48, atterr:168}, 240, "Drop Jump")`).err, "senza contatto non c'è RSI");
  assert.ok(j(`fotSalto({contatto:60, stacco:48, atterr:168}, 240, "Drop Jump")`).err);
  const r = j(`fotSalto({contatto:0, stacco:48, atterr:168}, 240, "Drop Jump")`);
  vicino(r.tc, 0.2, 1e-12); vicino(r.rsi, 0.30656 / 0.2, 0.0001);
  assert.deepEqual(r.avvisi, []);
});
prova("avvisi: ripresa lenta, salti impossibili, contatti strani", () => {
  assert.ok(j(`fotSalto({stacco:0, atterr:15}, 30, "CMJ")`).avvisi.some((x) => /100 fotogrammi/.test(x)));
  assert.ok(j(`fotSalto({stacco:0, atterr:400}, 240, "CMJ")`).avvisi.some((x) => /80 cm/.test(x)));
  assert.ok(j(`fotSalto({stacco:0, atterr:20}, 240, "CMJ")`).avvisi.some((x) => /5 cm/.test(x)));
  assert.ok(j(`fotSalto({contatto:0, stacco:12, atterr:130}, 240, "Drop Jump")`).avvisi.some((x) => /contatto/.test(x)));
  assert.ok(j(`fotSalto({contatto:0, stacco:200, atterr:320}, 240, "Drop Jump")`).avvisi.some((x) => /contatto/.test(x)));
});
prova("VBT: escursione / tempo di spinta = velocità media concentrica", () => {
  const r = j(`fotVbt({inizio:100, fine:220}, 240, "50")`);
  vicino(r.t, 0.5, 1e-12); vicino(r.v, 1.0, 1e-12);
  vicino(r.err1, 1.0 / (0.5 * 240), 1e-12);
  // un fotogramma in più cambia la velocità di circa err1
  vicino(r.v - j(`fotVbt({inizio:100, fine:221}, 240, "50")`).v, r.err1, 0.0001);
  vicino(j(`fotVbt({inizio:0, fine:240}, 240, "45,5")`).v, 0.455, 1e-12);
  assert.deepEqual(r.avvisi, []);
});
prova("VBT: niente numero senza escursione credibile o con i segni al contrario", () => {
  assert.ok(j(`fotVbt({inizio:0, fine:240}, 240, "")`).err);
  assert.ok(j(`fotVbt({inizio:0, fine:240}, 240, "3")`).err);
  assert.ok(j(`fotVbt({inizio:0, fine:240}, 240, "200")`).err);
  assert.ok(j(`fotVbt({inizio:240, fine:0}, 240, "50")`).err);
  assert.ok(j(`fotVbt({inizio:0}, 240, "50")`).err);
  assert.ok(j(`fotVbt({inizio:0, fine:4}, 240, "60")`).avvisi.some((x) => /2,5/.test(x)));
  assert.ok(j(`fotVbt({inizio:0, fine:2400}, 240, "20")`).avvisi.some((x) => /0,1/.test(x)));
});

console.log("\nFotogrammi al secondo");
const tempi = (fps, passi) => { const t = [0]; passi.forEach((p) => t.push(t[t.length - 1] + p / fps)); return JSON.stringify(t); };
prova("file a 30, 60, 240: li riconosce", () => {
  assert.equal(j(`fotFpsDaTempi(${tempi(30, Array(20).fill(1))})`), 30);
  assert.equal(j(`fotFpsDaTempi(${tempi(60, Array(20).fill(1))})`), 60);
  assert.equal(j(`fotFpsDaTempi(${tempi(240, Array(30).fill(1))})`), 240);
  assert.equal(j(`fotFpsDaTempi(${tempi(29.97, Array(20).fill(1))})`), 30, "NTSC 29,97 → 30");
});
prova("240 su uno schermo che ne salta qualcuno: legge 240, non la media dei salti", () => {
  // a velocità ridotta lo schermo mostra quasi tutti i fotogrammi, ma ne salta qualcuno
  const p = []; for (let i = 0; i < 39; i++) p.push(i % 3 === 0 ? 2 : 1);
  assert.equal(j(`fotFpsDaTempi(${tempi(240, p)})`), 240);
  // anche quando ne salta più della metà: la mediana direbbe 120, il quantile basso 240
  const q = []; for (let i = 0; i < 39; i++) q.push(i % 3 === 0 ? 1 : 2);
  assert.equal(j(`fotFpsDaTempi(${tempi(240, q)})`), 240);
});
prova("pochi fotogrammi o tempi assurdi: non indovina", () => {
  assert.equal(j(`fotFpsDaTempi(${tempi(30, [1, 1, 1])})`), null);
  assert.equal(j(`fotFpsDaTempi([0,0,0,0,0,0,0,0])`), null);
});
prova("si misura a velocità ridotta, così lo schermo non mangia i fotogrammi", () => {
  assert.ok(/fotMisuraFps[\s\S]{0,800}playbackRate=0\.25/.test(html));
});
prova("file a 30 con «Girato a» 240: avvisa che vale solo se il rallentatore copre tutta la clip", () => {
  squadra();
  run(`FOT.url="blob:x"; FOT.fpsFile=30; FOT.fpsLetto=30; FOT.fpsRip=240; fotPannelli();`);
  const h = j(`document.getElementById("fotSet").innerHTML`);
  assert.ok(/rallentatore 8× già applicato/.test(h)); assert.ok(/tutta la clip/.test(h)); assert.ok(/Nel file ho letto 30/.test(h));
  run(`FOT.fpsRip=30; fotPannelli();`);
  assert.ok(!/già applicato/.test(j(`document.getElementById("fotSet").innerHTML`)), "video normale: nessun avviso");
  run(`FOT.url=null; FOT.fpsLetto=null;`);
});
prova("un file a 120 o 240 è a velocità reale: «Girato a» si allinea da solo", () => {
  assert.ok(/if\(FOT\.fpsFile>=100\) FOT\.fpsRip=/.test(html));
});

console.log("\nDove vanno i numeri");
prova("il tempo si conta sui fotogrammi della RIPRESA: file rallentato a 30, girato a 240", () => {
  squadra();
  run(`FOT.fpsFile=30; FOT.fpsRip=240; FOT.segni={stacco:10, atterr:130}; fotSalvaSalto();`);
  const e = j(`S.mjl.a1[0]`);
  assert.equal(e.m.tv, 500); vicino(e.m.h, 30.7, 0.001);
});
prova("salvare un salto: archivio con fonte «video», migliore del giorno nella colonna CMJ", () => {
  squadra();
  run(`FOT.segni={stacco:0, atterr:120}; fotSalvaSalto(); FOT.segni={stacco:0, atterr:126}; fotSalvaSalto();`);
  const l = j(`S.mjl.a1`);
  assert.equal(l.length, 2);
  assert.ok(l.every((e) => e.fonte === "video" && e.tipo === "CMJ" && e.d === "2026-11-04"));
  assert.deepEqual(l.map((e) => e.exercise), ["CMJ#1", "CMJ#2"]);
  const col = j(`S.data.a1.cmj`);
  assert.equal(col.length, 1); vicino(col[0].v, j(`fotAltezza(126/240)`), 0.01);
  assert.equal(j(`FOT.segni`).stacco, undefined, "dopo il salvataggio i segni ripartono da zero");
});
prova("«metti nella colonna» tolto: il salto va solo in archivio", () => {
  squadra();
  run(`FOT.colonna=false; FOT.segni={stacco:0, atterr:120}; fotSalvaSalto();`);
  assert.equal(j(`S.mjl.a1`).length, 1);
  assert.equal(j(`S.data.a1.cmj`), undefined);
});
prova("drop jump salvato: RSI e contatto in archivio, RSI nella colonna del drop jump", () => {
  squadra();
  run(`FOT.tipo="Drop Jump"; FOT.segni={contatto:0, stacco:48, atterr:168}; fotSalvaSalto();`);
  const e = j(`S.mjl.a1[0]`);
  assert.equal(e.m.tc, 200); assert.equal(e.m.rsi, 1.53);
  assert.equal(j(`S.data.a1.dj[0].v`), 1.53);
});
prova("senza atleta o senza segni non salva niente", () => {
  squadra();
  run(`FOT.aid=""; FOT.segni={stacco:0, atterr:120}; fotSalvaSalto();`);
  assert.equal(j(`(S.mjl.a1||[]).length`), 0);
  run(`FOT.aid="a1"; FOT.segni={stacco:0}; fotSalvaSalto();`);
  assert.equal(j(`(S.mjl.a1||[]).length`), 0);
});
prova("lo stesso salto salvato due volte resta uno", () => {
  squadra();
  run(`FOT.segni={stacco:0, atterr:120}; fotSalvaSalto(); FOT.segni={stacco:0, atterr:120}; fotSalvaSalto();`);
  assert.equal(j(`S.mjl.a1`).length, 1);
});
prova("backup e sincronizzazione: la fonte «video» resta, una fonte inventata no; la pagina si ricorda", () => {
  const o = j(`sanitizeImport({athletes:[{id:"a1",name:"S",team:"t1",profile:{}}], teams:[{id:"t1",name:"U18"}], data:{}, view:"fotogrammi",
    mjl:{a1:[{d:"2026-11-04",exercise:"CMJ#1",tipo:"CMJ",m:{h:30.7,tv:500},fonte:"video"},{d:"2026-11-04",exercise:"CMJ#2",tipo:"CMJ",m:{h:31},fonte:"<x>"}]}})`);
  assert.equal(o.mjl.a1[0].fonte, "video");
  assert.equal(o.mjl.a1[1].fonte, undefined);
  assert.equal(o.view, "fotogrammi");
});

console.log("\nVBT verso la curva carico-velocità");
prova("ogni serie aggiunge un punto; l'escursione resta nella scheda dell'atleta, per esercizio", () => {
  squadra();
  run(`FOT.modo="vbt"; FOT.ex="Back squat"; FOT.rom="50"; FOT.kg="40"; FOT.segni={inizio:0, fine:120}; fotAggiungiPunto();
       FOT.kg="60"; FOT.segni={inizio:0, fine:200}; fotAggiungiPunto();`);
  assert.deepEqual(j(`FOT.punti`), [{ load: 40, v: 1 }, { load: 60, v: 0.6 }]);
  const p = j(`S.athletes[0].profile`);
  const k = Object.keys(p).find((x) => x.startsWith("rom_"));
  assert.equal(p[k], "50");
  assert.ok(/^[A-Za-z0-9_]{1,30}$/.test(k), "la chiave passa il controllo dei backup");
  // sopravvive a un backup
  const o = j(`sanitizeImport({athletes:S.athletes, teams:S.teams, data:{}})`);
  assert.equal(o.athletes[0].profile[k], "50");
});
prova("senza carico o con carico assurdo non aggiunge il punto", () => {
  squadra();
  run(`FOT.modo="vbt"; FOT.ex="Back squat"; FOT.rom="50"; FOT.kg=""; FOT.segni={inizio:0, fine:120}; fotAggiungiPunto();
       FOT.kg="900"; fotAggiungiPunto();`);
  assert.equal(j(`FOT.punti.length`), 0);
});
prova("«Apri la curva»: i punti entrano nella curva come MV, con esercizio e data", () => {
  squadra();
  run(`FOT.modo="vbt"; FOT.ex="Back squat"; FOT.punti=[{load:40,v:1},{load:60,v:0.6}]; fotApriCurva();`);
  const rows = j(`LV_ROWS`);
  assert.deepEqual(rows.slice(0, 2), [{ load: "40", v: "1" }, { load: "60", v: "0.6" }]);
  assert.equal(rows.length, 3, "almeno tre righe, come la curva vuota");
  assert.equal(j(`document.getElementById("lvVType").value`), "MV");
  assert.equal(j(`document.getElementById("lvEx").value`), "Back squat");
  assert.equal(j(`document.getElementById("lvD").value`), "2026-11-04");
  assert.equal(j(`CUR_LV_AID`), "a1");
});

console.log("\nIngressi e testi");
prova("si arriva dalle impostazioni, dal menu dei salti, dall'archivio My Jump e dalla curva", () => {
  assert.ok(/row\("📹","Analisi a fotogrammi"/.test(html));
  assert.ok(/riga\("📹","Misura dal video"/.test(html));
  assert.ok(/openFotogrammi\(\{modo:\\'salto\\',tipo:MJV\.tipo/.test(html));
  assert.ok(/openFotogrammi\(\{aid:\\''\+aid\+'\\',modo:\\'vbt\\'/.test(html));
  assert.ok(/if\(S\.view==="fotogrammi"\)\{ renderFotogrammi\(\); return; \}/.test(html));
});
prova("aprire lo strumento si ricorda da dove vieni e cosa misurare", () => {
  squadra();
  run(`S.view="mj"; openFotogrammi({modo:"salto", tipo:"SJ"});`);
  assert.equal(j(`S.view`), "fotogrammi"); assert.equal(j(`FOT.da`), "mj"); assert.equal(j(`FOT.tipo`), "SJ");
  run(`openFotogrammi({modo:"vbt"});`);
  assert.equal(j(`FOT.da`), "mj", "riaprire da dentro lo strumento non perde la provenienza");
});
prova("il video non lascia il dispositivo: niente upload, solo un URL locale", () => {
  const blocco = html.slice(html.indexOf("ANALISI A FOTOGRAMMI"), html.indexOf("PDF DELLA TABELLA"));
  assert.ok(/URL\.createObjectURL/.test(blocco));
  assert.ok(!/fetch\(|XMLHttpRequest|FormData|sendBeacon/.test(blocco));
});
prova("l'export CSV dice che la colonna può venire anche dal video", () => {
  assert.ok(html.includes("importato da My Jump Lab o misurato dal video"));
});

for (const [nome, fn] of prove) {
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
}
console.log(failed ? "\n" + failed + " falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
