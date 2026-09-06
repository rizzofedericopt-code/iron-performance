// Le batterie pronte: tre livelli, e la promessa che fanno.
//
//   node test/batterie.mjs
//
// La promessa e' semplice e si rompe in silenzio: «su campo» deve contenere
// SOLO test che si fanno con metro, coni, cronometro e telefono. Se ci finisce
// dentro un test che richiede un encoder, Federico porta la squadra in palestra
// e scopre li' che non puo' farlo — e la seduta di test e' saltata.
//
// La seconda promessa e' che i tre livelli siano incrementali: chi ha la sala
// fa tutto quello che si fa sul campo, piu' altro. Erano scritti come tre
// elenchi separati e alla prima modifica avrebbero smesso di contenere gli
// stessi test di base senza che nessuno se ne accorgesse. Ora si compongono,
// e questo test verifica che si compongano davvero.

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

const { batt2, batt2Tests, testLevel, testEq, eqList, tierMinuti, usoOf, livInfo } = sandbox;
const SPORT = ["pallavolo", "calcio", "basket", "atletica", "forza", "combattimento", "generale"];
const LIV = ["campo", "sala", "completa"];

/* ═══════════ 1. La promessa dei livelli ═══════════ */

prova("nel livello «su campo» non finisce niente che richieda strumenti", () => {
  const rotti = [];
  SPORT.forEach((sp) => batt2Tests(sp, "campo").forEach((id) => {
    if (testLevel(id) > 1) rotti.push(sp + "/" + id + " (serve " + eqList([id]).join(", ") + ")");
  }));
  assert.equal(rotti.join(" · "), "",
    "porti la squadra in palestra e scopri li' che non puoi farli: " + rotti.join(" · "));
});

prova("nel livello «campo + sala» non finisce niente che richieda elettronica", () => {
  const rotti = [];
  SPORT.forEach((sp) => batt2Tests(sp, "sala").forEach((id) => {
    if (testLevel(id) > 2) rotti.push(sp + "/" + id + " (serve " + eqList([id]).join(", ") + ")");
  }));
  assert.equal(rotti.join(" · "), "",
    "una sala pesi non ha un encoder: " + rotti.join(" · "));
});

prova("i tre livelli sono incrementali, non tre elenchi paralleli", () => {
  SPORT.forEach((sp) => {
    const c = batt2Tests(sp, "campo"), s = batt2Tests(sp, "sala"), o = batt2Tests(sp, "completa");
    const persiA = c.filter((x) => s.indexOf(x) < 0);
    const persiB = s.filter((x) => o.indexOf(x) < 0);
    assert.equal(persiA.join(","), "", sp + ": «sala» perde test del campo: " + persiA.join(","));
    assert.equal(persiB.join(","), "", sp + ": «completa» perde test della sala: " + persiB.join(","));
    assert.ok(s.length > c.length, sp + ": «sala» non aggiunge niente al campo");
    assert.ok(o.length > s.length, sp + ": «completa» non aggiunge niente alla sala");
  });
});

prova("ogni sport ha tutti e tre i livelli", () => {
  SPORT.forEach((sp) => LIV.forEach((l) => {
    const ids = batt2Tests(sp, l);
    assert.ok(ids.length >= 5, sp + "/" + l + " ha solo " + ids.length + " test");
  }));
});

prova("ogni test della batteria esiste davvero nel catalogo", () => {
  const fantasmi = [];
  SPORT.forEach((sp) => LIV.forEach((l) => batt2Tests(sp, l).forEach((id) => {
    if (!vm.runInContext("!!TMAP[" + JSON.stringify(id) + "]", sandbox)) fantasmi.push(sp + "/" + l + "/" + id);
  })));
  assert.equal(fantasmi.join(","), "", "test inesistenti: " + fantasmi.join(","));
});

prova("ogni test è assegnato allo sport in cui compare", () => {
  // una batteria che propone un test non previsto per quello sport metterebbe
  // in tabella una colonna che il filtro poi nasconde
  const strani = [];
  SPORT.forEach((sp) => batt2Tests(sp, "completa").forEach((id) => {
    const ok = vm.runInContext(
      "TMAP[" + JSON.stringify(id) + "].sports.indexOf(" + JSON.stringify(sp) + ")>=0 || " +
      "TMAP[" + JSON.stringify(id) + "].sports.indexOf('generale')>=0", sandbox);
    if (!ok) strani.push(sp + "/" + id);
  }));
  assert.equal(strani.join(","), "", "test fuori sport: " + strani.join(","));
});

/* ═══════════ 2. Le tre fasce di frequenza ═══════════ */

prova("il monitoraggio settimanale resta corto davvero", () => {
  SPORT.forEach((sp) => {
    const b = batt2(sp, "completa");
    const t = tierMinuti(b.sett, 17);
    assert.ok(t.min <= 15,
      sp + ": " + t.min + " min a settimana non li fa nessuno. Il senso del livello " +
      "settimanale e' che entri nel riscaldamento.");
  });
});

prova("le tre fasce non si sovrappongono a caso", () => {
  SPORT.forEach((sp) => {
    const b = batt2(sp, "completa");
    const doppi = b.sett.filter((x) => b.ciclo.indexOf(x) >= 0 || b.anno.indexOf(x) >= 0);
    assert.equal(doppi.join(","), "",
      sp + ": test presenti sia nel settimanale sia altrove: " + doppi.join(",") +
      " — se lo fai ogni settimana non ha senso rimetterlo nel baseline");
  });
});

prova("il tempo distingue il lavoro totale dal tempo a stazioni", () => {
  // sono due numeri diversi e confonderli fa saltare la programmazione:
  // 77 minuti di lavoro sono 26 minuti se giri a tre stazioni
  const t = tierMinuti(["cmjA", "sj", "cmj1lL", "cmj1lR"], 17);
  assert.ok(t.min > t.staz, "il tempo a stazioni deve essere minore del lavoro totale");
  assert.ok(Math.abs(t.staz - Math.round(t.min / 3)) <= 1, "tre stazioni, non un numero inventato");
  assert.ok(t.staz >= 1, "mai zero minuti");
});

prova("i test di squadra non entrano nel conto per atleta", () => {
  // lo Yo-Yo lo fanno tutte insieme: contarlo 17 volte darebbe un numero assurdo
  const con = tierMinuti(["cmj", "yoyo1"], 17);
  const senza = tierMinuti(["cmj"], 17);
  assert.equal(con.min, senza.min, "lo Yo-Yo non si moltiplica per il numero di atlete");
  assert.equal(con.squadra, true, "ma va segnalato che c'e' una prova di squadra");
  assert.equal(senza.squadra, false);
});

/* ═══════════ 3. A cosa serve, e cosa ci fai ═══════════ */

prova("i test del monitoraggio settimanale spiegano cosa decidi", () => {
  // sono quelli che guarda ogni settimana: se non sa cosa farne, non li usa
  const senza = [];
  SPORT.forEach((sp) => batt2(sp, "completa").sett.forEach((id) => {
    const u = usoOf(id);
    if (!u || !u.u) senza.push(sp + "/" + id);
  }));
  assert.equal(senza.join(","), "", "senza indicazione d'uso: " + senza.join(","));
});

prova("«a cosa serve» e «cosa ci fai» sono due cose diverse", () => {
  const u = usoOf("cmj");
  assert.ok(u && u.s && u.u);
  assert.notEqual(u.s, u.u);
  assert.match(u.u, /calo|alleggerire/i,
    "la seconda riga deve contenere una DECISIONE, non una definizione");
  // e non deve essere la guida: quella spiega come si esegue
  assert.ok(u.u.length < 300, "una riga, non un paragrafo");
});

prova("l'indicazione d'uso dice cosa fare, non cosa misurare", () => {
  const verbi = /riduci|aumenta|alleggeri|lavora|metti|scegli|usa|ferma|controlla|confronta|prescriv|decidi|guarda|rifai|insist/i;
  const ids = ["cmj", "eur", "dj", "rsiMod", "cmj1lAsym", "ankleDF", "shIR", "mas", "vbt"];
  const fiacchi = ids.filter((id) => { const u = usoOf(id); return !u || !verbi.test(u.u); });
  assert.equal(fiacchi.join(","), "",
    "queste righe descrivono invece di dire cosa fare: " + fiacchi.join(","));
});

/* ═══════════ 4. L'attrezzatura dichiarata prima ═══════════ */

prova("ogni livello dichiara il proprio costo di accesso", () => {
  LIV.forEach((k) => {
    const L = livInfo(k);
    assert.ok(L && L.l && L.d && L.costo, k + " non descritto");
    assert.ok(L.n >= 1 && L.n <= 3);
  });
  assert.notEqual(livInfo("campo").costo, livInfo("completa").costo);
  assert.match(livInfo("campo").costo, /nessuna spesa/i,
    "il primo livello deve dire chiaramente che non costa niente");
});

prova("l'attrezzatura di un test è dichiarata e coerente", () => {
  const rotti = [];
  SPORT.forEach((sp) => batt2Tests(sp, "completa").forEach((id) => {
    testEq(id).forEach((k) => {
      if (!vm.runInContext("!!EQ[" + JSON.stringify(k) + "]", sandbox)) rotti.push(id + "→" + k);
    });
  }));
  assert.equal(rotti.join(","), "", "attrezzatura inesistente: " + rotti.join(","));
});

prova("i salti richiedono il telefono, i massimali la sala", () => {
  // gli oggetti creati dentro la sandbox hanno un prototipo diverso:
  // deepEqual fallisce anche su valori identici, si confronta il contenuto
  assert.equal(testEq("cmj").join(","), "video");
  assert.ok(testEq("rmSquat").indexOf("sala") >= 0);
  assert.ok(testEq("vbt").indexOf("vbt") >= 0);
  assert.equal(testLevel("cmj"), 1, "un salto col telefono e' da campo");
  assert.equal(testLevel("rm35"), 2, "un massimale per ripetizioni serve la sala");
  assert.equal(testLevel("vbt"), 3, "la velocita' del bilanciere serve un encoder");
});

prova("esiste una sola implementazione della schermata di sessione", () => {
  const n = (html.match(/function openBatterySessionIds\(/g) || []).length;
  assert.equal(n, 1);
  const vecchia = html.match(/function openBatterySession\(sport, gi\)[\s\S]*?\n}/)[0];
  assert.match(vecchia, /openBatterySessionIds/,
    "due copie della stessa schermata si separano alla prima modifica");
  assert.ok(!/bsess-test/.test(vecchia), "la vecchia non deve ricostruire il modulo da sola");
});

prova("una sola definizione di batt2, non due che si sovrascrivono", () => {
  // ce n'erano due: vinceva la vecchia, e i livelli non erano incrementali
  const n = (html.match(/\nfunction batt2\(sport, liv\)\{/g) || []).length;
  assert.equal(n, 1, "trovate " + n + " definizioni");
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
