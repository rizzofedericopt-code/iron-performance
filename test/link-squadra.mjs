// Test del modulo di squadra: un link solo, e le schede si creano da sole.
//
//   node test/link-squadra.mjs
//
// Il caso d'uso e' quello vero: quindici atlete in palestra, stesso wifi,
// stessa mezz'ora, un link solo mandato nel gruppo. Ogni cosa che qui viene
// controllata e' una cosa che in quella mezz'ora puo' rompersi in silenzio:
//
//   · il limite anti-abuso che conta anche le richieste riuscite e blocca la
//     decima ragazza perche' esce dallo stesso indirizzo delle prime nove;
//   · la seconda compilazione di chi non era sicura fosse partito, che crea
//     una scheda gemella invece di correggere la prima;
//   · la minorenne che si dichiara maggiorenne e produce un consenso che non
//     vale niente, senza che nessuno lo sappia mai;
//   · l'anamnesi appena arrivata che sparisce perche' il preparatore aveva
//     l'app aperta con una copia vecchia della stessa atleta.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const store = readFileSync(join(here, "..", "api", "store.js"), "utf8");
const schema = readFileSync(join(here, "..", "schema.sql"), "utf8");

let failed = 0;
const prova = (nome, fn) => {
  try { fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ═══════════ 1. Il limite orario ═══════════
   Il vecchio codice faceva noteFail(kI) su OGNI richiesta, riuscita o no, con
   un tetto di 20 all'ora per IP. Aprire il modulo e inviarlo sono due
   richieste: dieci ragazze dietro l'unico IP della palestra esaurivano il
   budget, e dalla decima in poi il modulo rispondeva "troppi tentativi". */

prova("il budget per IP non viene consumato da chi ha il link giusto", () => {
  const g = store.match(/async function loadFormLink[\s\S]*?\n}/);
  assert.ok(g, "loadFormLink deve esistere: e' la guardia comune ai due endpoint");
  const src = g[0];
  const primaDelLookup = src.slice(0, src.indexOf("SELECT coach_email"));
  // nella parte che precede la lettura del token, noteFail(kI) puo' comparire
  // solo per il token mancante
  const dopo = src.slice(src.indexOf("SELECT coach_email"));
  assert.ok(/link \|\| new Date\(link\.expires_at\) <= now\(\)[\s\S]{0,120}noteFail\(kI\)/.test(dopo),
    "l'IP va segnato quando il token e' inesistente o scaduto");
  assert.ok(!/noteFail\(kI\)/.test(dopo.slice(dopo.indexOf("kT"))),
    "dopo un token valido l'IP non deve piu' essere segnato");
  assert.ok(/noteFail\(kT\)/.test(dopo),
    "il traffico legittimo deve pesare sul link, non sull'indirizzo");
  assert.ok(primaDelLookup.includes("underLimit(kI"),
    "il lucchetto sull'IP va comunque controllato per primo");
});

prova("il budget del link cresce con le schede previste", () => {
  const f = store.match(/function tokBudget\(link\)[\s\S]*?\n}/);
  assert.ok(f, "tokBudget deve esistere");
  const sandbox = { FORM_TEAM_MAX_USES: 30, FORM_TEAM_MAX_USES_CAP: 60,
                    FORM_TOK_OVERHEAD: 30, FORM_TOK_PER_USE: 6, Math };
  vm.createContext(sandbox);
  vm.runInContext(f[0] + "; globalThis.__b = tokBudget;", sandbox);
  const b = sandbox.__b;
  const squadra = b({ kind: "team", max_uses: 18 });
  const personale = b({ kind: "athlete" });
  assert.ok(squadra >= 18 * 2 + 20,
    "diciotto atlete che aprono e inviano devono starci larghe: " + squadra);
  assert.ok(squadra > personale,
    "un link di squadra deve tollerare piu' traffico di uno personale");
  assert.ok(b({ kind: "team", max_uses: 9999 }) <= 30 + 60 * 6,
    "il tetto massimo deve restare limitato anche con un max_uses assurdo");
});

/* ═══════════ 2. Identita' e deduplica ═══════════ */

prova("nome, cognome e data di nascita fanno la chiave della persona", () => {
  const f = store.match(/const normPerson = [\s\S]*?\.trim\(\);/);
  assert.ok(f, "normPerson deve esistere");
  const sandbox = { String };
  vm.createContext(sandbox);
  vm.runInContext(f[0] + "; globalThis.__n = normPerson;", sandbox);
  const n = sandbox.__n;
  assert.equal(n("Giulia"), n("  giulia "), "spazi e maiuscole non fanno due persone");
  assert.equal(n("Nicolò"), n("nicolo"), "l'accento non fa due persone");
  assert.equal(n("De Luca"), n("de  luca"), "lo spazio doppio non fa due persone");
  assert.notEqual(n("Giulia"), n("Giulio"), "due nomi diversi restano diversi");
});

prova("una seconda compilazione ritrova la stessa atleta invece di duplicarla", () => {
  const blocco = store.match(/const chiave = normPerson\(nome\)[\s\S]*?\}\) \|\| null;/);
  assert.ok(blocco, "la ricerca dell'atleta gia' presente deve esserci");
  const src = blocco[0];
  assert.ok(/p\.formKey && String\(p\.formKey\) === chiave/.test(src),
    "il secondo invio dallo stesso modulo deve ritrovare la scheda per chiave esatta");
  assert.ok(/rovescio/.test(src),
    "«Rossi Giulia» e «Giulia Rossi» sono la stessa ragazza: va coperto anche l'ordine invertito");
  assert.ok(/String\(a\.team \|\| ""\) !== teamId/.test(src),
    "la deduplica deve restare dentro la squadra del link");
  assert.ok(/!p\.birth \|\| String\(p\.birth\) === nascita/.test(src),
    "due omonime con date di nascita diverse sono due persone diverse");
});

prova("l'atleta nasce solo al momento dell'invio", () => {
  // Se la scheda si creasse al primo passo, chi apre il modulo e si distrae
  // lascerebbe in rosa un'atleta vuota che sembra iscritta e non lo e'.
  assert.ok(/store\.athletes\.push\(ath\);\s*\n\s*creata = true;/.test(store),
    "l'inserimento deve avvenire dentro la transazione dell'invio");
  const info = store.match(/if \(action === "formInfo"\)[\s\S]*?\n    \}/);
  assert.ok(info, "formInfo deve esistere");
  assert.ok(!/athletes\.push/.test(info[0]),
    "aprire il modulo non deve creare niente");
});

prova("aprire il link non rivela la rosa della squadra", () => {
  const info = store.match(/if \(action === "formInfo"\)[\s\S]*?\n    \}/)[0];
  assert.ok(/kind === "team" \? null : link\.athlete_name/.test(info),
    "su un link di squadra non deve uscire nessun nome di atleta");
});

/* ═══════════ 3. Consenso ed eta' ═══════════ */

prova("l'eta' si calcola sul compleanno, non sull'anno", () => {
  const f = store.match(/function ageAt\(birthISO, at\)[\s\S]*?\n}/);
  assert.ok(f, "ageAt deve esistere");
  const sandbox = { Date, String, now: () => new Date(Date.UTC(2026, 7, 29)) };
  vm.createContext(sandbox);
  vm.runInContext(f[0] + "; globalThis.__a = ageAt;", sandbox);
  const a = sandbox.__a;
  const rif = new Date(Date.UTC(2026, 7, 29));      // 29 agosto 2026
  assert.equal(a("2008-08-28", rif), 18, "compleanno ieri: maggiorenne");
  assert.equal(a("2008-08-29", rif), 18, "compleanno oggi: maggiorenne oggi stesso");
  assert.equal(a("2008-08-30", rif), 17, "compleanno domani: ancora minorenne");
  assert.equal(a("2008-02-30", rif), null, "il 30 febbraio non e' una data");
  assert.equal(a("non una data", rif), null);
  assert.equal(a("", rif), null);
});

prova("una minorenne non puo' prestare il consenso per se stessa", () => {
  assert.match(store, /eta\s*<\s*18\s*&&\s*consentRole\s*!==\s*"guardian"/,
    "il server deve rifiutare, non fidarsi di quello che dichiara il modulo");
  assert.ok(!/id="pfRole"/.test(html),
    "e la tendina che permetteva di dichiararsi maggiorenne non deve esistere piu'");
  assert.match(html, /ANAM_ROLE="guardian"/,
    "sotto i 18 il modulo deve chiedere il genitore da solo");
});

prova("il link di squadra esige data di nascita e sesso", () => {
  const blocco = store.match(/if \(kind === "team"\) \{[\s\S]*?profile\.birth = nascita;/);
  assert.ok(blocco, "la validazione dell'anagrafica deve esserci");
  const src = blocco[0];
  assert.ok(/if \(!sesso\)/.test(src),
    "i valori di riferimento dei test sono distinti per sesso: senza, non si profila");
  assert.ok(/if \(et == null\)/.test(src),
    "senza data di nascita non si sa chi deve firmare");
  assert.ok(/et < 5 \|\| et > 99/.test(src),
    "una data assurda va fermata qui, non a valle");
});

/* ═══════════ 4. Tetto, chiusura, parola d'ordine ═══════════ */

prova("il tetto di schede viene contato dentro la transazione", () => {
  const tx = store.match(/const linkQ = await client\.query\([\s\S]*?const payQ/);
  assert.ok(tx, "la rilettura del link in transazione deve esserci");
  assert.ok(/FOR UPDATE/.test(tx[0]),
    "senza FOR UPDATE due invii sull'ultimo posto passano entrambi");
  assert.ok(/teamLinkClosed\(link\)/.test(tx[0]),
    "il tetto va ricontrollato sulla riga bloccata, non sulla copia letta prima");
});

prova("un modulo chiuso o al tetto non accetta piu' niente", () => {
  const f = store.match(/function teamLinkClosed\(link\)[\s\S]*?\n}/);
  assert.ok(f, "teamLinkClosed deve esistere");
  const sandbox = { Number };
  vm.createContext(sandbox);
  vm.runInContext(f[0] + "; globalThis.__c = teamLinkClosed;", sandbox);
  const c = sandbox.__c;
  assert.equal(c({ uses: 3, max_uses: 18, closed_at: null }), null, "aperto e sotto il tetto");
  assert.ok(c({ uses: 18, max_uses: 18, closed_at: null }), "al tetto deve chiudersi");
  assert.ok(c({ uses: 19, max_uses: 18, closed_at: null }), "oltre il tetto, a maggior ragione");
  assert.ok(c({ uses: 0, max_uses: 18, closed_at: "2026-08-01" }), "chiuso a mano resta chiuso");
});

prova("generare un link nuovo chiude quello vecchio", () => {
  const a = store.match(/if \(action === "teamLink"\)[\s\S]*?return res\.status\(200\)/);
  assert.ok(a, "l'azione teamLink deve esistere");
  assert.ok(/UPDATE form_links SET closed_at = now\(\)[\s\S]{0,200}team_id = \$\{teamId\}/.test(a[0]),
    "altrimenti restano in giro link vecchi che nessuno ricorda di aver dato");
});

prova("la parola d'ordine non e' conservata in chiaro", () => {
  assert.ok(!/pass_hash.*\$\{pass\}[^)]*\)/.test(store),
    "in tabella deve finire l'impronta, non la parola");
  assert.match(store, /pass \? sha256\(normPerson\(pass\)\) : null/,
    "l'impronta si calcola sulla forma normalizzata: maiuscole e accenti non devono contare");
  const f = store.match(/function passOk\(plain, hash\)[\s\S]*?\n}/);
  assert.ok(f && /timingSafeEqual/.test(f[0]), "il confronto va fatto a tempo costante");
  assert.ok(f && /if \(!hash\) return true;/.test(f[0]),
    "senza parola d'ordine impostata il modulo deve restare aperto");
});

/* ═══════════ 5. Cosa il modulo NON puo' scrivere ═══════════ */

prova("nemmeno il modulo di squadra puo' toccare i campi del preparatore", () => {
  // La filtratura su FORM_ALLOWED_KEYS e' unica e sta prima della biforcazione
  // fra link personale e link di squadra: se un domani qualcuno duplicasse il
  // ramo, questo test lo direbbe.
  const i = store.indexOf("for (const k of FORM_ALLOWED_KEYS)");
  const j = store.indexOf('if (kind === "team") {', i);
  assert.ok(i > 0 && j > i,
    "l'elenco chiuso dei campi deve essere applicato prima di distinguere il tipo di link");
  const decl = store.match(/const FORM_ALLOWED_KEYS = \[[\s\S]*?\];/)[0];
  ["medical", "medicalExpiry", "notes"].forEach((k) => {
    assert.ok(!new RegExp('"' + k + '"').test(decl),
      k + " lo stabilisce il preparatore, non chi compila");
  });
});

prova("l'email di avviso non porta fuori dati sanitari", () => {
  const f = store.match(/async function sendNewSheetEmail[\s\S]*?\n}/);
  assert.ok(f, "sendNewSheetEmail deve esistere");
  const src = f[0];
  const vietati = ["profile", "meds", "allergies", "injuries", "conditions",
                   "painLevel", "surgeries", "consentName"];
  vietati.forEach((k) => {
    assert.ok(!src.includes(k),
      "l'email finisce in una casella di posta di terzi: " + k + " non deve entrarci");
  });
  assert.ok(/athleteName/.test(src) && /teamName/.test(src),
    "nome e squadra bastano perche' il preparatore sappia di chi si tratta");
});

prova("l'avviso parte dopo il commit, non dentro la transazione", () => {
  const i = store.indexOf('await client.query("COMMIT")');
  const j = store.indexOf("sendNewSheetEmail(avviso.to", i);
  const k = store.indexOf("client.release()", i);
  assert.ok(i > 0 && j > k,
    "una chiamata di rete lenta non deve tenere bloccata una riga in FOR UPDATE");
});

/* ═══════════ 6. Lo schema ═══════════ */

prova("lo schema regge un link senza atleta", () => {
  assert.match(schema, /ALTER TABLE form_links ALTER COLUMN athlete_id DROP NOT NULL/,
    "un link di squadra non ha un atleta: senza questo l'INSERT fallisce in produzione");
  ["kind", "team_id", "team_name", "max_uses", "uses", "closed_at", "pass_hash"].forEach((c) => {
    assert.ok(new RegExp("ADD COLUMN IF NOT EXISTS\\s+" + c + "\\b").test(schema),
      "manca la colonna " + c);
  });
  assert.match(schema, /kind\s+text NOT NULL DEFAULT 'athlete'/,
    "i link gia' esistenti devono restare personali");
});

/* ═══════════ 7. Il merge lato client ═══════════
   Questo e' il difetto piu' silenzioso dei sette. mergeState teneva la copia
   LOCALE dell'atleta per intero. Finche' le schede arrivavano una alla volta
   non si vedeva; con un link di squadra che ne raccoglie quindici in una sera,
   mentre il preparatore ha l'app aperta, al primo salvataggio in conflitto la
   sua copia vecchia — profilo vuoto — cancellava l'anamnesi appena arrivata.  */

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
const { mergeState } = sandbox;

const vuoto = { teams: [{ id: "t1", name: "Young Volley" }], athletes: [], data: {},
                readiness: {}, load: {}, screen: {}, lv: {}, tomb: {} };
const clone = (o) => JSON.parse(JSON.stringify(o));

prova("una scheda arrivata dal modulo non viene cancellata dalla copia aperta sul portatile", () => {
  // sul server: Giulia ha compilato alle 18:40
  const server = clone(vuoto);
  server.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1",
    profile: { birth: "2006-04-11", allergies: "polline", consent: true,
               viaForm: true, formAt: "2026-08-29T18:40:00.000Z", formNew: true } }];
  // sul portatile del preparatore: la stessa atleta, com'era alle 18:00
  const locale = clone(vuoto);
  locale.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1", profile: {} }];

  const out = mergeState(server, locale);
  const a = out.athletes.find((x) => x.id === "a1");
  assert.equal(a.profile.allergies, "polline", "l'anamnesi non deve sparire");
  assert.equal(a.profile.consent, true, "ne' la prova del consenso");
  assert.equal(a.profile.formAt, "2026-08-29T18:40:00.000Z");
});

prova("le note del preparatore sopravvivono alla scheda che arriva", () => {
  const server = clone(vuoto);
  server.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1",
    profile: { allergies: "polline", formAt: "2026-08-29T18:40:00.000Z" } }];
  const locale = clone(vuoto);
  locale.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1",
    profile: { notes: "da rivedere la caviglia", medical: "idonea", medicalExpiry: "2027-01-31" } }];

  const a = mergeState(server, locale).athletes.find((x) => x.id === "a1");
  assert.equal(a.profile.allergies, "polline", "la scheda nuova arriva");
  assert.equal(a.profile.notes, "da rivedere la caviglia", "e le note restano del preparatore");
  assert.equal(a.profile.medical, "idonea", "l'idoneita' medica non la scrive il modulo");
  assert.equal(a.profile.medicalExpiry, "2027-01-31");
});

prova("una correzione fatta a mano dopo la scheda non viene riportata indietro", () => {
  // stesso formAt da entrambe le parti: il preparatore ha gia' visto la scheda
  // e ha corretto il peso a mano. La sua correzione e' la piu' recente.
  const t = "2026-08-29T18:40:00.000Z";
  const server = clone(vuoto);
  server.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1",
    profile: { weight: "58", formAt: t } }];
  const locale = clone(vuoto);
  locale.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1",
    profile: { weight: "61", formAt: t, formNew: false } }];

  const a = mergeState(server, locale).athletes.find((x) => x.id === "a1");
  assert.equal(a.profile.weight, "61", "a parita' di scheda vince la correzione locale");
  assert.equal(a.profile.formNew, false, "e il pallino resta spento");
});

prova("un'atleta creata dal modulo compare anche se il portatile non la conosce", () => {
  const server = clone(vuoto);
  server.athletes = [{ id: "fXk9nQ2LpZ", name: "Sara Neri", sex: "F", team: "t1",
    profile: { viaForm: true, formAt: "2026-08-29T19:02:00.000Z", formNew: true } }];
  const locale = clone(vuoto);

  const out = mergeState(server, locale);
  assert.equal(out.athletes.length, 1, "l'atleta nuova deve arrivare sul portatile");
  assert.equal(out.athletes[0].name, "Sara Neri");
});

prova("un'atleta cancellata dal preparatore non torna dal modulo", () => {
  const server = clone(vuoto);
  server.athletes = [{ id: "a1", name: "Giulia Rossi", sex: "F", team: "t1",
    profile: { formAt: "2026-08-29T18:40:00.000Z" } }];
  const locale = clone(vuoto);
  locale.tomb = { "ath:a1": "2026-08-29T20:00:00.000Z" };

  const out = mergeState(server, locale);
  assert.equal(out.athletes.length, 0, "la tombstone deve continuare a valere");
});

console.log(failed ? "\n" + failed + " test falliti" : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
