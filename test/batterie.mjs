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
    /* La scappatoia «oppure e' taggato generale» faceva passare 16 coppie che
       la matrice poi nascondeva davvero: il filtro per sport confronta con lo
       sport ATTIVO, e «generale» non e' la pallavolo. Se una batteria propone
       un test a uno sport, quel test e' di quello sport — l'autorita' e' la
       batteria, e il tag si allinea a lei. */
    const ok = vm.runInContext(
      "TMAP[" + JSON.stringify(id) + "].sports.indexOf(" + JSON.stringify(sp) + ")>=0", sandbox);
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

/* ═══════════ Il MAT ═══════════
   Aggiungere un test a questo catalogo vuol dire registrarlo in SEI punti
   diversi: TESTS, l'icona, la guida, l'attrezzatura, «a cosa serve» e la
   durata. Dimenticarne uno non rompe niente: il test compare lo stesso e
   semplicemente non ha la guida, o conta 60 secondi a caso nel calcolo del
   tempo. Si scopre in palestra. */
/* `const` dentro un contesto vm non diventa una proprieta' del sandbox: le
   funzioni si leggono da sandbox, le costanti vanno chieste al contesto. */
const dentro = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const TESTS = dentro("TESTS");
const TMAP = dentro("TMAP"), PROTO = dentro("PROTO"), USO = dentro("USO"),
      TEST_EQ = dentro("TEST_EQ"), ICON = dentro("ICON"), BATT2 = dentro("BATT2");
const levelIdx = (t, sx, v) => dentro("levelIdx(TMAP." + t + ',"' + sx + '",' + v + ")");

prova("il MAT è registrato in tutti e sei i punti, non solo nell'elenco", () => {
  const t = TMAP.mat;
  assert.ok(t, "manca da TESTS");
  assert.equal(t.unit, "s");
  assert.equal(t.dir, -1, "un tempo più basso è migliore");
  assert.ok(PROTO.mat, "manca la guida: il test comparirebbe senza sapere come si esegue");
  assert.ok(USO.mat && USO.mat.s && USO.mat.u, "manca «a cosa serve / cosa decidi»");
  assert.ok(TEST_EQ.mat, "manca l'attrezzatura: finirebbe nel livello sbagliato");
  assert.ok(ICON.mat, "manca l'icona");
  assert.ok(html.indexOf("mat:120") > 0, "manca dalla tabella dei tempi: conterebbe 60 s a caso");
});

prova("il MAT si fa su campo, senza comprare niente", () => {
  assert.equal(testLevel("mat"), 1, "coni, metro e cronometro: livello campo");
  const eq = testEq("mat");
  ["crono", "coni", "metro"].forEach(k => assert.ok(eq.indexOf(k) >= 0, "manca " + k));
});

prova("la pallavolo aveva il 505 ma nessun test di spostamento laterale", () => {
  // il 505 è lineare: frena e riparte. In pallavolo si difende di lato.
  assert.ok(BATT2.pallavolo.campo.anno.indexOf("mat") >= 0, "il MAT deve stare nella batteria su campo");
  assert.ok(TMAP.mat.sports.indexOf("pallavolo") >= 0, "e il test deve essere assegnato alla pallavolo");
});

prova("le fasce seguono il verso giusto: più veloce = più in alto", () => {
  // con dir -1 le soglie vanno dalla più lenta alla più veloce, altrimenti
  // un tempo da elite finisce in «Base» e nessuno se ne accorge
  ["m", "f"].forEach(sx => {
    const th = TMAP.mat.lv[sx];
    assert.equal(th.length, 4, sx + ": servono quattro soglie");
    for (let i = 1; i < th.length; i++)
      assert.ok(th[i] < th[i - 1], sx + ": le soglie devono scendere, trovato " + th.join(","));
  });
  const L = (sx, v) => levelIdx("mat", sx, v);
  assert.ok(L("F", 6.4) > L("F", 7.3), "6,4 s deve valere più di 7,3 s");
  assert.ok(L("M", 5.4) > L("M", 6.3), "5,4 s deve valere più di 6,3 s");
  assert.equal(L("F", 8.5), 0, "molto lento = sotto base");
});

prova("le fasce sono ancorate ai valori dello studio, non inventate", () => {
  // Sassi et al. 2009: donne 7,27 ± 0,35 · uomini 6,27 ± 0,37.
  // La media dello studio deve cadere in mezzo alla scala, non agli estremi:
  // se la media di una popolazione normale esce «Elite» la scala è finta.
  assert.equal(levelIdx("mat", "F", 7.27), 2, "la media femminile deve stare in «Buono»");
  assert.equal(levelIdx("mat", "M", 6.27), 2, "la media maschile deve stare in «Buono»");
  const g = PROTO.mat;
  const testo = JSON.stringify(g);
  assert.ok(/7,27/.test(testo) && /6,27/.test(testo), "la guida deve citare i valori di riferimento");
  assert.ok(/Sassi/.test(testo), "e dire da dove vengono");
});

prova("la guida dà le distanze vere, non «un percorso a T»", () => {
  const testo = JSON.stringify(PROTO.mat);
  assert.ok(/5 m/.test(testo), "manca il tratto da 5 m");
  assert.ok(/2,5 m/.test(testo), "mancano i 2,5 m laterali — è ciò che distingue il MAT dal T-test");
  assert.ok(/20 m/.test(testo), "manca la distanza totale");
  assert.ok(/indietro/.test(testo), "manca il ritorno all'indietro");
  assert.ok(/incrocia i piedi/.test(testo), "manca la penalità che annulla più prove");
});

prova("la guida dice che MAT e T-test non si fanno tutti e due", () => {
  assert.ok(/T-test/.test(JSON.stringify(PROTO.mat)),
    "misurano la stessa qualità: va detto, o si fanno entrambi per sicurezza");
});

/* ═══════════ Niente buchi nel catalogo proposto ═══════════
   Finche' il controllo era «hai aggiunto la guida al test nuovo?» la risposta
   dipendeva da chi se lo ricordava. Un test puo' comparire in una batteria,
   finire nella seduta, essere misurato — e non avere la riga che dice cosa
   farne. Non si rompe niente: semplicemente quel numero resta li'.

   Questo controllo vale per i test che l'app PROPONE, non per tutto il
   catalogo: quelli di laboratorio e le voci di screening si raggiungono solo
   a mano, e chi ci arriva sa gia' cosa sta cercando. */
const inBatteria = (() => {
  const o = {};
  Object.keys(BATT2).forEach((sp) => LIV.forEach((l) =>
    ["sett", "ciclo", "anno"].forEach((t) =>
      ((BATT2[sp][l] || {})[t] || []).forEach((id) => { o[id] = 1; }))));
  return Object.keys(o);
})();

prova("ogni test che l'app propone sa spiegarsi", () => {
  assert.ok(inBatteria.length > 40, "lista sospetta: " + inBatteria.length);
  const buchi = [];
  inBatteria.forEach((id) => {
    if (!PROTO[id]) buchi.push(id + ": nessuna guida");
    if (!ICON[id]) buchi.push(id + ": nessuna icona");
    if (!TEST_EQ[id]) buchi.push(id + ": attrezzatura non dichiarata");
    const u = USO[id];
    if (!u || !u.s || !u.u) buchi.push(id + ": manca «a cosa serve / cosa decidi»");
  });
  assert.equal(buchi.join(" · "), "", "buchi nel catalogo: " + buchi.join(" · "));
});

prova("e la riga «cosa decidi» dice una decisione, su tutti", () => {
  // non solo sui nove di prima: se la regola vale, vale per tutti quelli
  // che finiranno davanti a Federico in palestra
  const verbi = /riduci|aumenta|alleggeri|lavora|metti|scegli|usa|ferma|controlla|confronta|prescriv|decidi|guarda|rifai|insist|separa|programma|associa|tieni|parti|passa|aggiungi|rivaluta/i;
  const fiacchi = inBatteria.filter((id) => { const u = USO[id]; return !u || !verbi.test(u.u); });
  assert.equal(fiacchi.join(","), "",
    "descrivono invece di dire cosa fare: " + fiacchi.join(","));
});

prova("la guida non è un titolo vuoto: dice cosa misura e come si esegue", () => {
  const magri = [];
  inBatteria.forEach((id) => {
    const g = PROTO[id]; if (!g) return;
    if (!g.what || g.what.length < 60) magri.push(id + " (cosa misura)");
    const derivato = TMAP[id] && TMAP[id].derived;
    /* Una guida puo' essere il SATELLITE di un'altra — i tre numeri di un
       profilo forza-velocita' escono tutti dalla stessa prova, e ripetere il
       protocollo tre volte e' il modo migliore perche' le tre copie si
       separino. In quel caso deve dichiararlo con `vedi`, e il bersaglio deve
       essere completo: «sta scritto altrove» vale solo se altrove c'e'. */
    const sat = g.vedi && PROTO[g.vedi] && PROTO[g.vedi].steps && PROTO[g.vedi].steps.length >= 2;
    if (g.vedi && !PROTO[g.vedi]) magri.push(id + " (rimanda a una guida che non esiste: " + g.vedi + ")");
    if (!derivato && !sat && (!g.steps || g.steps.length < 2)) magri.push(id + " (come si esegue)");
    if (!g.interpret || !g.interpret.length) magri.push(id + " (come interpretare)");
  });
  assert.equal(magri.join(" · "), "", "guide senza contenuto: " + magri.join(" · "));
});

prova("il Bosco si fa col telefono, non serve la pedana", () => {
  // l'app ricava la potenza dalle altezze: dichiarare la pedana lo spingeva
  // fra i test da laboratorio e lo rendeva irraggiungibile senza motivo
  ["bosco15", "bosco30", "bosco60"].forEach((id) => {
    assert.equal(testLevel(id), 1, id + " deve restare alla portata di un telefono");
    assert.ok(testEq(id).indexOf("video") >= 0, id + ": serve il telefono");
  });
});

prova("il box squat ha una colonna sua, non quella dello squat", () => {
  // con la stessa atleta i due massimali sono numeri diversi: mescolarli darebbe
  // un andamento che sale e scende per l'altezza del box, non per la sua forza
  assert.ok(TMAP.rmBox, "manca il test");
  assert.notEqual(TMAP.rmBox.id, TMAP.rmSquat.id);
  const ex = dentro('LV_EX.filter(e=>e.n==="Box squat")[0]');
  assert.ok(ex, "manca dall'elenco degli esercizi");
  assert.equal(ex.test, "rmBox", "il box squat non deve scrivere nella colonna dello squat");
  assert.ok(PROTO.rmBox && USO.rmBox && ICON.rmBox && TEST_EQ.rmBox, "registrato a metà");
  assert.ok(/altezza del box/i.test(JSON.stringify(PROTO.rmBox)),
    "l'altezza del box è parte del test: va detto");
});

prova("xRM→1RM accetta la serie, non solo il risultato", () => {
  // era l'unica colonna di massimale senza la strada «da ripetizioni», ed è
  // proprio quella il cui senso è non fare il massimale
  const lista = dentro("rmTestList().map(e=>e.test)");
  assert.ok(lista.indexOf("pred") >= 0, "pred deve poter ricevere carico e ripetizioni");
  assert.ok(dentro('rmTestEx("pred")'), "serve un'etichetta di esercizio");
  assert.ok(/Da ripetizioni/.test(JSON.stringify(PROTO.pred)),
    "la guida deve dire dove si inseriscono carico e ripetizioni");
});

/* ═══════════ Audit: i numeri devono reggere, non solo girare ═══════════ */

prova("lo squat jump non può avere le stesse fasce del CMJ", () => {
  /* Se le fasce fossero identiche, un'atleta "Buona" su entrambe avrebbe
     CMJ = SJ, cioè EUR 1,00 — che l'app legge come contributo elastico nullo.
     Le due misure si darebbero torto da sole. */
  ["m", "f"].forEach(sx => {
    const cmj = TMAP.cmj.lv[sx], sj = TMAP.sj.lv[sx];
    assert.notEqual(sj.join(","), cmj.join(","), sx + ": fasce identiche");
    for (let i = 0; i < cmj.length; i++)
      assert.ok(sj[i] < cmj[i], sx + ": lo SJ deve stare sotto il CMJ a pari livello (" + sj[i] + " vs " + cmj[i] + ")");
    // e non troppo sotto: il contributo elastico è nell'ordine del 5-15%
    const rap = sj.map((v, i) => v / cmj[i]);
    rap.forEach(r => assert.ok(r > 0.82 && r < 0.96, "rapporto SJ/CMJ fuori range: " + r.toFixed(3)));
  });
});

prova("le fasce coerenti producono un EUR plausibile, non 1,00", () => {
  // una ragazza "Ottima" su entrambi deve avere un indice elastico credibile
  const cmj = TMAP.cmj.lv.f[2], sj = TMAP.sj.lv.f[2];
  const eur = cmj / sj;
  assert.ok(eur > 1.05 && eur < 1.2, "EUR atteso fra 1,05 e 1,20, ottenuto " + eur.toFixed(3));
});

prova("tutte le fasce salgono (o scendono) nella direzione giusta", () => {
  const rotte = [];
  TESTS.filter(t => t.lv).forEach(t => {
    ["m", "f"].forEach(sx => {
      const th = t.lv[sx]; if (!th) return;
      for (let i = 1; i < th.length; i++) {
        const ok = t.dir < 0 ? th[i] < th[i - 1] : th[i] > th[i - 1];
        if (!ok) rotte.push(t.id + "/" + sx);
      }
    });
  });
  assert.equal(rotte.join(","), "", "soglie nell'ordine sbagliato: " + rotte.join(","));
});

prova("dove c'è una soglia femminile, non è uguale a quella maschile per sbaglio", () => {
  // uguali si può, ma solo dove ha senso (mobilità articolare, non forza)
  const uguali = TESTS.filter(t => t.lv && t.lv.m && t.lv.f &&
    t.lv.m.join(",") === t.lv.f.join(",")).map(t => t.id);
  assert.equal(uguali.join(","), "ankleDF",
    "fasce identiche fra i sessi dove non dovrebbero esserlo: " + uguali.join(","));
});

prova("la soglia del 10% sull'asimmetria non è più presentata come fisiologia", () => {
  /* Nasce da studi anni '90 che citavano il 15%, diventato 10% per citazione
     successiva (Bishop). Il criterio utilizzabile è Exell: conta quando supera
     la variabilità della misura. */
  ["cmjAsym", "cmj1lAsym", "dj1lAsym"].forEach(id => {
    const g = JSON.stringify(PROTO[id] || {});
    assert.ok(!/è (in )?genere(ralmente)? (considerata )?fisiologic/i.test(g),
      id + ": presenta ancora il 10% come fisiologia");
    assert.ok(/variabilità della misura/i.test(g),
      id + ": deve indicare il criterio vero (confronto con la variabilità)");
  });
});

prova("l'ACWR dichiara di essere nella forma scollegata e non vende la «zona sicura»", () => {
  // la variante accoppiata condivide dati fra numeratore e denominatore
  assert.match(html, /forma\s*\n?\s*SCOLLEGATA/,
    "va dichiarato quale delle due varianti è implementata");
  assert.match(html, /«zona sicura» 0,8-1,3 non ha il supporto/,
    "la fascia 0,8-1,3 non ha l'evidenza che la sua fama suggerisce: va scritto");
});

prova("le fasce dichiarano di non essere percentili pubblicati", () => {
  assert.match(html, /riferimenti di lavoro su adulti<\/b>, non percentili pubblicati/,
    "da quando guidano un pallino colorato hanno più autorità di quella che meritano");
});

prova("le formule che si possono verificare, tornano", () => {
  const boscoPower = sandbox.boscoPower;
  /* Bosco 1983: P = g²·Tv·Tt / (4·n·(Tt − Tv)).
     Controllo con numeri scelti perché il conto si possa rifare a mano:
     g²=96.2361, Tv=7.5, Tt=15, n=30 → 96.2361·7.5·15 / (4·30·7.5) = 12.03 */
  const p = boscoPower(15, 30, 7.5);
  assert.ok(Math.abs(p - 12.03) < 0.01, "Bosco: atteso ~12,03 W/kg, ottenuto " + p);
  // tempo di volo da un'altezza: h = g·t²/8  →  t = √(8h/g). Da 0,30 m → 0,4947 s
  const t = Math.sqrt(8 * 0.30 / 9.81);
  assert.ok(Math.abs(t - 0.4947) < 0.001);
  // e il giro completo: da quell'altezza il Bosco deve tornare allo stesso numero
  assert.ok(boscoPower(15, 30, t * 30) > 0);
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
