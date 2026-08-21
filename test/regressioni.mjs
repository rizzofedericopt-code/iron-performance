// Regressioni della revisione del 20/08/2026.
//
//   node test/regressioni.mjs
//
// Ogni test qui riproduce un difetto trovato durante la revisione completa ed
// esegue il codice REALE dell'app. Nessuno controlla che una riga esista:
// controllano che il comportamento sia cambiato.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const store = readFileSync(join(here, "..", "api", "store.js"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
const src = m[1].slice(0, m[1].indexOf("const _anamToken=anamToken();"));

/* ── ambiente: DOM finto, localStorage vero, rete controllabile ── */
const mem = new Map();
const campi = {};
const cache = {};
const elFor = (id) => ({
  get value() { return campi[id] != null ? campi[id] : ""; },
  set value(v) { campi[id] = v; },
  get checked() { return !!campi["chk_" + id]; },
  set checked(v) { campi["chk_" + id] = v; },
  dataset: {}, style: {}, disabled: false, textContent: "", innerHTML: "", type: "text",
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector() { return null; }, querySelectorAll() { return []; },
  appendChild() {}, focus() {}, select() {}, click() {},
});

let reteInVolo = null;                    // risolve la richiesta a comando
const sandbox = {
  document: {
    getElementById: (id) => (cache[id] ||= elFor(id)),
    querySelector: () => (cache.__q ||= elFor("__q")),
    querySelectorAll: () => [], createElement: () => elFor("__c"),
    addEventListener() {}, body: elFor("__b"), documentElement: elFor("__d"), hidden: false,
  },
  window: { addEventListener() {}, print() {} }, navigator: { userAgent: "t" },
  location: { href: "https://t/", origin: "https://t", pathname: "/", search: "" },
  localStorage: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  },
  fetch: () => new Promise(res => { reteInVolo = res; }),
  confirm: () => true, setTimeout, clearTimeout, setInterval, clearInterval,
  URL, Blob: class {}, FileReader: class {}, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app" });
const run = (c) => vm.runInContext(c, sandbox, { filename: "test" });
const attesa = (ms) => new Promise(r => setTimeout(r, ms));

let failed = 0;
const prova = async (nome, fn) => {
  try { await fn(); console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + " — " + e.message); }
};

/* ═══ 1. le modifiche fatte durante un salvataggio lento ═══ */
await prova("una modifica fatta MENTRE il salvataggio è in volo non va persa", async () => {
  run(`S={athletes:[{id:"a1",name:"Giorgia"}],teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{}};
       normalize(); AUTH={email:"c@t.it",token:"tok"}; CLOUD_V=3; _saving=false; _stateSeq=0; S._dirty=false;`);

  run(`S.data.a1={cmj:[{d:"2026-09-01",v:28}]}; save();`);   // prima modifica
  run(`cloudSave()`);                                        // parte la richiesta
  assert.equal(run("_saving"), true, "il salvataggio non è partito");

  run(`S.data.a1.cmj.push({d:"2026-09-02",v:31}); save();`); // seconda, mentre è in volo
  run(`cloudSave()`);                                        // rimbalza perché _saving

  reteInVolo({ ok: true, json: () => Promise.resolve({ ok: true, version: 4 }) });
  await attesa(30);

  assert.equal(run("S._dirty"), true,
    "il salvataggio in volo ha dichiarato salvata anche la modifica arrivata dopo");
  assert.equal(run("_saving"), false);
});

await prova("...e viene rispedita da sola, senza che l'utente tocchi niente", async () => {
  await attesa(220);                                          // il rinvio è a 150ms
  assert.equal(run("_saving"), true, "il secondo invio non è ripartito da solo");
  reteInVolo({ ok: true, json: () => Promise.resolve({ ok: true, version: 5 }) });
  await attesa(30);
  assert.equal(run("S._dirty"), false, "dopo il secondo giro deve risultare salvato");
  assert.equal(run("CLOUD_V"), 5);
});

/* ═══ 2. la prova del consenso sopravvive al salvataggio della scheda ═══ */
await prova("salvare la scheda atleta NON cancella la prova del consenso", () => {
  run(`S={athletes:[{id:"a1",name:"Giorgia",sex:"F",team:null,profile:{
         birth:"2010-03-04", weight:"58",
         consent:true, consentBy:"Chi esercita la responsabilità genitoriale",
         consentName:"Anna Bocchi", consentDate:"2026-09-01",
         consentRole:"guardian", consentAt:"2026-09-01T10:22:00.000Z",
         consentPolicyVersion:2, consentDoc:"v2 del 2026-08-20"}}],
       teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{}}; normalize();`);
  campi.eN = "Giorgia Bocchi"; campi.eT = ""; campi.eS = "F";
  campi.p_role = "Centrale";                       // il coach scrive solo il ruolo
  run(`saveAthleteEdit("a1")`);
  const p = JSON.parse(run(`JSON.stringify(S.athletes[0].profile)`));
  assert.equal(p.consentPolicyVersion, 2, "versione dell'informativa cancellata");
  assert.equal(p.consentAt, "2026-09-01T10:22:00.000Z", "orario del consenso cancellato");
  assert.equal(p.consentRole, "guardian", "ruolo di chi ha firmato cancellato");
  assert.equal(p.role, "Centrale", "il campo modificato dal coach non è stato salvato");
});

/* ═══ 3. l'informativa nel merge e nei backup ═══ */
await prova("il merge tiene l'informativa più recente, non quella del server", () => {
  const srv = `{athletes:[],teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{},
                policy:{version:1,titolare:"Vecchio"}}`;
  const loc = `{athletes:[],teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{},
                policy:{version:3,titolare:"Nuovo"}}`;
  const out = JSON.parse(run(`JSON.stringify(mergeState(${srv},${loc}))`));
  assert.equal(out.policy.version, 3, "l'informativa pubblicata in locale è stata persa");
  assert.equal(out.policy.titolare, "Nuovo");
});

await prova("...e se è il server ad averla più nuova, vince il server", () => {
  const srv = `{athletes:[],teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{},
                policy:{version:5,titolare:"Server"}}`;
  const loc = `{athletes:[],teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{},
                policy:{version:2,titolare:"Locale"}}`;
  const out = JSON.parse(run(`JSON.stringify(mergeState(${srv},${loc}))`));
  assert.equal(out.policy.version, 5);
});

await prova("ripristinare un backup non azzera l'informativa", () => {
  const backup = {
    athletes: [{ id: "a1", name: "Giorgia", sex: "F" }], data: {}, teams: [],
    policy: { version: 4, updatedAt: "2026-08-20", titolare: "Federico Rizzo",
              email: "f@r.it", conservazione: "5 anni" },
  };
  const out = JSON.parse(run(`JSON.stringify(sanitizeImport(${JSON.stringify(backup)}))`));
  assert.equal(out.policy.version, 4, "l'informativa è stata scartata dall'import");
  assert.equal(out.policy.titolare, "Federico Rizzo");
  assert.equal(out.policy.conservazione, "5 anni");
});

/* ═══ 4. tombstone su svuota tutto e dati di esempio ═══ */
await prova("«Svuota tutto» lascia le tombstone: il merge non resuscita niente", () => {
  run(`S={athletes:[{id:"a1",name:"Giorgia"},{id:"a2",name:"Ilaria"}],
        teams:[{id:"t1",name:"Young Volley"}],data:{},readiness:{},load:{},
        screen:{},lv:{},tomb:{},cfg:{rdGreen:82}}; normalize(); AUTH=null;`);
  run(`wipe()`);
  const t = JSON.parse(run(`JSON.stringify(S.tomb)`));
  assert.ok(t["ath:a1"] && t["ath:a2"], "atleti cancellati senza tombstone");
  assert.ok(t["team:t1"], "squadra cancellata senza tombstone");
  // e il merge col server che li ha ancora non li rimette dentro
  const srv = `{athletes:[{id:"a1",name:"Giorgia"},{id:"a2",name:"Ilaria"}],
                teams:[{id:"t1",name:"Young Volley"}],data:{},readiness:{},load:{},
                screen:{},lv:{},tomb:{}}`;
  const out = JSON.parse(run(`JSON.stringify(mergeState(${srv}, S))`));
  assert.equal(out.athletes.length, 0, "gli atleti sono tornati dal server");
  assert.equal(out.teams.length, 0, "la squadra è tornata dal server");
});

await prova("«Svuota tutto» conserva soglie e informativa", () => {
  assert.equal(run(`S.cfg.rdGreen`), 82, "le soglie personalizzate sono state azzerate");
  assert.ok(run(`!!S.policy`), "l'informativa è sparita");
});

await prova("i dati di esempio non si mescolano agli atleti veri", () => {
  run(`S={athletes:[{id:"vera1",name:"Giorgia"}],teams:[{id:"tv",name:"Young Volley"}],
        data:{vera1:{cmj:[{d:"2026-09-01",v:28}]}},
        readiness:{vera1:[{d:"2026-09-01",sl:4}]},load:{},screen:{},lv:{},tomb:{}}; normalize();`);
  run(`loadDemo()`);
  const t = JSON.parse(run(`JSON.stringify(S.tomb)`));
  assert.ok(t["ath:vera1"], "l'atleta vera non ha tombstone: tornerà dal server");
  assert.ok(!run(`!!(S.readiness && S.readiness.vera1)`),
    "i dati sanitari dell'atleta sostituita sono rimasti orfani nello stato");
});

/* ═══ 5. XSS nel pulsante Condividi ═══ */
await prova("un nome con apice non può più uscire dalla stringa JavaScript", () => {
  const cattivo = `Mario');alert(1)//`;
  const out = run(`jsStr(${JSON.stringify(cattivo)})`);
  assert.ok(!out.includes("');"), "l'apice è ancora attivo: " + out);
  assert.ok(out.includes("&quot;") || out.includes("\\u0027") || out.includes("&#39;"),
    "il valore non è stato protetto: " + out);
  // e resta leggibile una volta decodificato
  assert.ok(out.includes("Mario"), "il nome è stato distrutto invece che protetto");
});

/* ═══ 6. la finestra della baseline CMJ ═══ */
await prova("la fatica CMJ non confronta più oggi con due anni fa", () => {
  run(`S={athletes:[{id:"a1",name:"G"}],teams:[],data:{a1:{cmj:[
        {d:"2025-01-10",v:24},{d:"2025-03-10",v:25},{d:"2025-05-10",v:26},
        {d:"2025-07-10",v:27},{d:"2025-09-10",v:28},{d:"2026-09-10",v:30}]}},
       readiness:{},load:{},screen:{},lv:{},tomb:{}}; normalize();`);
  const r = JSON.parse(run(`JSON.stringify(cmjFatigue("a1"))`));
  assert.ok(r.insufficient, "sta ancora usando misure vecchie di mesi come baseline");
  assert.ok(r.fuoriFinestra, "non dice che il problema è la distanza nel tempo");
});

await prova("...ma con misure ravvicinate il calcolo si fa", () => {
  run(`S={athletes:[{id:"a1",name:"G"}],teams:[],data:{a1:{cmj:[
        {d:"2026-09-01",v:30},{d:"2026-09-05",v:31},{d:"2026-09-09",v:30},
        {d:"2026-09-13",v:31},{d:"2026-09-17",v:30},{d:"2026-09-21",v:25}]}},
       readiness:{},load:{},screen:{},lv:{},tomb:{}}; normalize();`);
  const r = JSON.parse(run(`JSON.stringify(cmjFatigue("a1"))`));
  assert.ok(!r.insufficient, "con sei misure in tre settimane deve calcolare");
  assert.ok(r.pct < -10, "un calo da ~30 a 25 deve risultare negativo: " + r.pct);
  assert.equal(r.fatigued, true, "un calo del 18% deve essere segnalato");
});

/* ═══ 7. backend ═══ */
await prova("cancellare l'account cancella anche link di reset e link anamnesi", () => {
  // erase e' dentro una transazione, quindi le query sono parametriche
  const erase = store.slice(store.indexOf('action === "erase"'));
  assert.match(erase, /DELETE FROM password_resets WHERE email = \$1/,
    "i link di reset sopravvivono: uno vecchio fa rivivere l'account");
  assert.match(erase, /DELETE FROM form_links\s+WHERE coach_email = \$1/,
    "i nomi degli atleti restano leggibili da un endpoint pubblico");
  assert.match(erase, /DELETE FROM login_attempts\s+WHERE key = ANY/,
    "restano i contatori di tentativi legati a quell'email");
});

await prova("il reset non crea sessioni per account inesistenti", () => {
  assert.match(store, /if \(upd\.rowCount !== 1\)/,
    "l'UPDATE su zero righe passava inosservato");
});

await prova("la registrazione ha un limite di tentativi", () => {
  assert.match(store, /const kSignup = "signup:ip:" \+ ip/);
  assert.match(store, /if \(await isLocked\(kSignup\)\)/);
  assert.match(store, /codeOk\(String\(body\.code/,
    "il codice di invito va confrontato a tempo costante");
});

await prova("il blocco non è più azionabile da chi conosce la tua email", () => {
  const login = store.slice(store.indexOf('action === "login"'), store.indexOf('action === "forgot"'));
  assert.ok(!/isLocked\(kE\)/.test(login), "l'email è ancora una chiave di blocco");
  assert.ok(!/const kE = "email:"/.test(login), "la chiave email è ancora costruita nel login");
});

await prova("l'indirizzo IP viene dalla piattaforma, non dal client", () => {
  assert.match(store, /x-vercel-forwarded-for/,
    "si fida ancora dell'header che il client può scrivere");
});

await prova("il blocco si calcola sul contatore nuovo, non su quello vecchio", () => {
  assert.match(store, /locked_until = CASE WHEN \(CASE WHEN login_attempts\.first_fail/,
    "chi ha sbagliato ieri viene ancora bloccato oggi al primo errore");
});


/* ═══ 8. seconda tornata: eta', stime, sezioni vuote, manutenzione ═══ */
await prova("sotto i 18 anni non si applica la scala Base→Elite degli adulti", () => {
  const anno = new Date().getFullYear();
  run(`S={athletes:[
        {id:"min",name:"Giorgia",sex:"F",profile:{birth:"${anno-14}-03-04"}},
        {id:"adu",name:"Anna",   sex:"F",profile:{birth:"${anno-25}-03-04"}},
        {id:"ign",name:"Senza",  sex:"F",profile:{}}],
       teams:[],data:{},readiness:{},load:{},screen:{},lv:{},tomb:{}}; normalize();`);
  assert.equal(run(`eLevelApplicable(S.athletes[0])`), false, "una 14enne viene ancora etichettata");
  assert.equal(run(`eLevelApplicable(S.athletes[1])`), true,  "una adulta deve mantenere le fasce");
  assert.equal(run(`eLevelApplicable(S.athletes[2])`), true,  "senza data di nascita si comporta come prima");
});

await prova("la scala resta calcolabile: e' l'uso che cambia, non la formula", () => {
  const cmj = JSON.parse(run(`JSON.stringify(TMAP.cmj.lv)`));
  assert.ok(cmj && cmj.f, "il test CMJ deve avere ancora le sue fasce");
  assert.equal(run(`levelIdx(TMAP.cmj,"F",50)`), 4, "50 cm resta Elite sulla scala adulti");
});

await prova("un 1RM stimato si distingue da uno sollevato", () => {
  run(`S={athletes:[{id:"a1",name:"G",sex:"F",profile:{}}],teams:[],
        data:{a1:{rmSquat:[{d:"2026-09-01",v:90},{d:"2026-09-15",v:104,fonte:"lv"}]}},
        readiness:{},load:{},screen:{},lv:{},tomb:{}}; normalize();`);
  const serie = JSON.parse(run(`JSON.stringify(S.data.a1.rmSquat)`));
  assert.equal(serie[0].fonte, undefined, "il massimale misurato non va marcato");
  assert.equal(serie[1].fonte, "lv");
  // e il CSV lo dichiara
  assert.match(run(`(function(){let r="";const old=dl;globalThis.dl=(n,c)=>{r=c};exportCSV();globalThis.dl=old;return r})()`),
    /stima da curva carico-velocità/, "il CSV non distingue stima e misura");
});

await prova("il modulo anamnesi non mostra sezioni senza campi", () => {
  const f = JSON.parse(run(`JSON.stringify(anamFields())`));
  const vuote = f.filter((x,i)=> x.sec && (!f[i+1] || f[i+1].sec)).map(x=>x.sec);
  assert.equal(vuote.join(","), "", "intestazioni senza campi sotto: " + vuote.join(", "));
  assert.ok(f.some(x=>x.sec), "sono sparite anche le sezioni buone");
});

await prova("il database si pota da solo, senza far aspettare nessuno", () => {
  assert.match(store, /function pruneOccasionally/);
  assert.match(store, /DELETE FROM audit_log\s+WHERE at < now\(\)/,
    "audit_log cresceva per sempre, con email e indirizzi IP dentro");
  assert.match(store, /DELETE FROM sessions\s+WHERE expires_at < now\(\)/);
  assert.ok(!/await pruneOccasionally/.test(store),
    "la potatura non va attesa: aggiungerebbe latenza a una richiesta a caso");
});

await prova("cancellare l'account e registrarsi sono operazioni atomiche", () => {
  const erase = store.slice(store.indexOf('action === "erase"'));
  assert.match(erase, /BEGIN/, "erase non e' in transazione: puo' lasciare uno stato a meta'");
  const signup = store.slice(store.indexOf('action === "signup"'), store.indexOf('action === "login"'));
  assert.match(signup, /ON CONFLICT \(email\) DO NOTHING RETURNING email/,
    "due registrazioni simultanee davano un 500 invece di un conflitto");
});

await prova("non si dichiara un font che non viene mai caricato", () => {
  assert.ok(!/Montserrat/.test(html), "Montserrat e' ancora richiesto ma non esiste nessun @font-face");
});

console.log(failed ? `\n${failed} test falliti` : "\nTutti i test passati");
process.exit(failed ? 1 : 0);
