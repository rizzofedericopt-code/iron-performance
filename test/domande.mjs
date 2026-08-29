// Le domande dell'anamnesi: niente doppioni, formulate per chi le legge.
//
//   node test/domande.mjs
//
// Le domande le compila una ragazza di sedici anni sul telefono, o sua madre.
// Ogni domanda ambigua produce una risposta sbagliata che sembra giusta — e
// su quella si programma. Il caso peggiore trovato: "Esperienza di
// allenamento" senza dire di quale allenamento. Una che gioca a pallavolo da
// sei anni e non ha mai toccato un bilanciere rispondeva "Esperto (5+ anni)".
//
// Questo file controlla cose che si possono controllare da sole: che nessuna
// domanda ne ripeta un'altra, che le chiavi non si scontrino, che le domande
// che senza spiegazione si compilano a caso ce l'abbiano. Il resto — se una
// frase e' scritta bene — lo decide chi la legge, non un test.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ── estrae le domande ── */
const blocco = html.match(/const PROFILE=\[([\s\S]*?)\n\];/);
assert.ok(blocco, "PROFILE non trovato");
const campi = [...blocco[1].matchAll(/\{k:"([A-Za-z0-9_]+)",?\s*\n?\s*l:"((?:[^"\\]|\\.)*)"/g)]
  .map((m) => ({ k: m[1], l: m[2].replace(/\\"/g, '"') }));
assert.ok(campi.length > 30, "estratte solo " + campi.length + " domande: la regex non regge piu'");

const sezioni = [...blocco[1].matchAll(/\{sec:"((?:[^"\\]|\\.)*)"\}/g)].map((m) => m[1]);

const norm = (s) => s.toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const parole = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

prova("nessuna chiave compare due volte", () => {
  const visti = {}, doppie = [];
  campi.forEach((c) => { if (visti[c.k]) doppie.push(c.k); visti[c.k] = 1; });
  assert.equal(doppie.join(","), "",
    "due campi con la stessa chiave: il secondo sovrascrive il primo — " + doppie.join(", "));
});

prova("nessuna domanda e' scritta identica a un'altra", () => {
  const visti = {}, doppie = [];
  campi.forEach((c) => { const n = norm(c.l); if (visti[n]) doppie.push(c.l); visti[n] = 1; });
  assert.equal(doppie.join(" | "), "", "domande identiche: " + doppie.join(" | "));
});

prova("nessuna coppia di domande chiede la stessa cosa con parole diverse", () => {
  // Somiglianza sul vocabolario: due domande che condividono quasi tutte le
  // parole significative stanno chiedendo la stessa cosa. E' un setaccio
  // grossolano, e va bene cosi': deve accorgersi dei casi evidenti, che sono
  // quelli che ci finiscono davvero dentro.
  const sospette = [];
  for (let i = 0; i < campi.length; i++) {
    for (let j = i + 1; j < campi.length; j++) {
      const a = parole(campi[i].l), b = parole(campi[j].l);
      if (a.size < 2 || b.size < 2) continue;
      let comuni = 0; a.forEach((w) => { if (b.has(w)) comuni++; });
      const sim = comuni / Math.min(a.size, b.size);
      if (sim >= 0.8) sospette.push(campi[i].l + "  ≈  " + campi[j].l);
    }
  }
  assert.equal(sospette.join(" | "), "", "possibili doppioni: " + sospette.join(" | "));
});

prova("infortuni e interventi non si sovrappongono piu'", () => {
  // Erano "Interventi chirurgici / ospedalizzazioni" e "Infortuni e operazioni
  // passate": la stessa operazione al ginocchio finiva in uno dei due a caso.
  const s = campi.find((c) => c.k === "surgeries").l;
  const i = campi.find((c) => c.k === "injuriesPast").l;
  assert.match(s, /NON legati a infortuni sportivi/,
    "il campo interventi deve dire esplicitamente cosa NON ci va");
  assert.ok(!/infortun/i.test(i) || /sportiv/i.test(i),
    "il campo infortuni deve dire di quali infortuni parla");
  assert.ok(!/operazion/i.test(i),
    "se chiede anche le operazioni si torna a sovrapporsi con interventi");
});

prova("la familiarita' cardiaca si chiede una volta sola", () => {
  // C'erano un campo libero "Familiarita' (cardiovascolare, metabolica...)" e
  // una spunta "Familiarita' per eventi cardiaci precoci". La spunta e' quella
  // che conta per lo screening; il campo libero ora copre il resto.
  const f = campi.find((c) => c.k === "familyHistory").l;
  const sc = campi.find((c) => c.k === "scFamily").l;
  assert.match(f, /escluso il cuore/i,
    "il campo libero deve escludere cio' che la spunta gia' chiede");
  assert.match(sc, /cuore|cardiac/i);
});

prova("l'esperienza dice di quale allenamento parla", () => {
  const e = campi.find((c) => c.k === "experience").l;
  assert.match(e, /palestra|sovraccarich/i,
    "era «Esperienza di allenamento»: chi gioca da sei anni rispondeva «Esperto» " +
    "anche senza aver mai toccato un bilanciere, e su quella risposta si sceglievano i carichi");
  const a = campi.find((c) => c.k === "sportYears").l;
  assert.ok(!/palestra|sovraccarich/i.test(a),
    "gli anni di sport e gli anni di palestra devono restare due domande distinte");
});

prova("il carico della squadra viene chiesto, non dedotto", () => {
  const t = campi.find((c) => c.k === "teamWeek");
  assert.ok(t, "senza gli allenamenti di squadra non si puo' dosare quello che si aggiunge");
  assert.match(t.l, /squadra/i);
  const d = campi.find((c) => c.k === "daysWeek");
  assert.match(d.l, /palestra/i, "l'altra domanda deve dire che parla della palestra");
});

prova("il lato dominante dice se e' braccio o gamba", () => {
  const d = campi.find((c) => c.k === "dominant").l;
  assert.match(d, /braccio|mano/i, "«Lato dominante» non diceva quale lato");
  const g = campi.find((c) => c.k === "takeoffLeg");
  assert.ok(g, "i test monolaterali confrontano i lati: serve sapere quale gamba stacca");
  assert.match(g.l, /gamba/i);
});

prova("la scala del dolore ha i suoi estremi dichiarati", () => {
  const p = campi.find((c) => c.k === "painLevel");
  assert.ok(p, "painLevel deve esistere");
  const h = blocco[1].match(/k:"painLevel"[\s\S]{0,400}?h:"((?:[^"\\]|\\.)*)"/);
  assert.ok(h, "senza gli estremi, «da 0 a 10» lo interpreta ognuno a modo suo");
  assert.match(h[1], /0 =/, "va detto cosa vale 0");
  assert.match(h[1], /10 =/, "e cosa vale 10");
});

prova("le domande che senza spiegazione si compilano a caso ce l'hanno", () => {
  // non tutte: solo quelle in cui l'esperienza dice che si sbaglia
  const servono = ["painLevel", "experience", "cycle", "growth", "surgeries",
                   "familyHistory", "painAreas", "daysWeek", "conditions", "equipment"];
  const senza = servono.filter((k) => {
    const m = blocco[1].match(new RegExp('k:"' + k + '"[\\s\\S]{0,500}?(?=\\{k:"|\\{sec:"|$)'));
    return !m || !/\bh:"/.test(m[0]);
  });
  assert.equal(senza.join(","), "", "manca la riga di spiegazione su: " + senza.join(", "));
});

prova("la domanda sul ciclo dice perche' viene chiesta", () => {
  // E' un dato sanitario, lo compila spesso una madre per una figlia
  // minorenne. Chiederlo senza dire a cosa serve e' il modo migliore per
  // farsi lasciare il campo vuoto, o per farsi chiudere la pagina in faccia.
  const m = blocco[1].match(/k:"cycle"[\s\S]{0,700}?h:"((?:[^"\\]|\\.)*)"/);
  assert.ok(m, "manca la spiegazione");
  assert.match(m[1], /perch/i, "deve spiegare il motivo");
  assert.match(m[1], /lascia vuoto|preferisci non/i,
    "e deve dire che si puo' non rispondere");
});

prova("lo screening dice quando spuntare, senza gergo", () => {
  const sec = sezioni.find((x) => /screening/i.test(x));
  assert.ok(sec, "sezione screening non trovata");
  assert.ok(!/positivo/i.test(sec),
    "«segna cio' che e' positivo» si legge al contrario da chi non e' del mestiere");
  assert.match(sec, /SÌ|si\b/i, "va detto in che caso si spunta");
});

prova("nessuna domanda usa parole da referto", () => {
  // Le domande le legge chi non ha studiato: se una parola non la useresti
  // parlando con un genitore in palestra, non va nel modulo.
  const gergo = [/\bROM\b/, /\banamnesi patologica\b/i, /\bpre-?operatorio\b/i,
                 /\bospedalizzazion/i, /\bapofis/i, /\beziolog/i, /\bfamiliarità per\b/i];
  const brutte = [];
  campi.forEach((c) => gergo.forEach((g) => { if (g.test(c.l)) brutte.push(c.l); }));
  sezioni.forEach((x) => gergo.forEach((g) => { if (g.test(x)) brutte.push("[sezione] " + x); }));
  assert.equal(brutte.join(" | "), "", "termini da referto: " + brutte.join(" | "));
});

prova("le note del preparatore non sono chieste all'atleta", () => {
  const skip = html.match(/const skipKey=\{([^}]*)\}/);
  ["notes", "orthoNotes"].forEach((k) =>
    assert.match(skip[1], new RegExp(k + ":1"),
      k + " e' una nota del preparatore: nel modulo dell'atleta non ci va"));
});

prova("ogni domanda finisce in una sezione", () => {
  assert.ok(sezioni.length >= 6, "sezioni trovate: " + sezioni.length);
  const primoCampo = blocco[1].indexOf('{k:"');
  const primaSez = blocco[1].indexOf('{sec:"');
  assert.ok(primaSez < primoCampo,
    "la prima cosa deve essere un'intestazione, altrimenti le prime domande restano senza titolo");
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
