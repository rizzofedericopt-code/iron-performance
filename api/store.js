// /api/store — Iron Performance
// Backend riscritto: account reali, hash scrypt, token di sessione,
// rate limiting, concorrenza ottimistica, cancellazione e registro accessi.
//
// Env richieste (pannello Vercel):
//   POSTGRES_URL          -> fornita da Vercel Postgres / Neon
//   IP_SIGNUP_CODE        -> codice di invito per creare un account
//   IP_ALLOWED_ORIGIN     -> es. https://ironperformance.vercel.app
//   RESEND_API_KEY        -> chiave API di resend.com (per il recupero password)
//   RESEND_FROM           -> es. "Iron Performance <no-reply@tuodominio.it>"
//                            (il dominio va verificato su resend.com/domains;
//                             finché non lo fai, Resend consente comunque
//                             l'invio verso l'email con cui ti sei registrato lì)
//   IP_APP_URL             -> es. https://ironperformance.vercel.app (per il link nell'email)
//
// Prima esecuzione: lancia schema.sql nella console del database.
//
// NOTA IMPORTANTE
// Questo endpoint tratta dati di cui all'art. 9 GDPR (salute), riferiti
// anche a minori. Prima di metterlo in produzione servono: informativa,
// consenso genitoriale tracciato, nomina del responsabile (Vercel/Neon)
// e registro dei trattamenti. Il codice ti mette in condizione di essere
// conforme; non ti rende conforme da solo.

import { sql, db } from "@vercel/postgres";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

/* Neon su Vercel registra la connessione con nomi diversi a seconda di come il
   database e' stato collegato: DATABASE_URL, POSTGRES_URL, POSTGRES_URL_NON_POOLING,
   DATABASE_URL_UNPOOLED. La libreria @vercel/postgres pero' cerca SOLO POSTGRES_URL:
   se il progetto ha l'una e non l'altra, ogni richiesta muore con un generico
   "Backend non configurato" e non c'e' modo di capire perche' dal messaggio.
   Qui accettiamo qualunque nome, preferendo la connessione con pool (piu' adatta
   a un ambiente serverless) e tenendo quella diretta come ripiego. */
if (!process.env.POSTGRES_URL) {
  process.env.POSTGRES_URL =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL_UNPOOLED ||
    "";
}

/* ─────────────── Parametri ─────────────── */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const MIN_PW = 12;                 // 4 caratteri erano indifendibili
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
// Vercel rifiuta il corpo della richiesta oltre ~4,5 MB PRIMA di eseguire
// questo codice: con 6 MB il messaggio gentile qui sotto non arrivava mai, e
// al client tornava un errore della piattaforma che non sa interpretare.
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const RESET_MINUTES = 30;          // finestra di validità del link
const RESET_MAX_PER_HOUR = 3;      // richieste "forgot" per email/IP
const FORM_LINK_HOURS = 48;        // scadenza del link personale
const FORM_TEAM_DAYS = 14;         // scadenza del link di squadra
const FORM_TEAM_MAX_USES = 30;     // tetto di invii predefinito su un link di squadra
const FORM_TEAM_MAX_USES_CAP = 60; // tetto massimo impostabile dal preparatore

// Il limite per IP vale SOLO per i tentativi con un token che non esiste o non
// è più valido: è lì per chi tira a indovinare, non per chi ha il link giusto.
// Contava anche le richieste riuscite, e questo bastava a rompere il caso più
// normale che ci sia — una squadra che compila il modulo tutta insieme in
// palestra, cioè quindici ragazze dietro un unico IP: dalla decima in poi il
// modulo rispondeva "troppi tentativi". Il traffico legittimo ora pesa su un
// budget legato al singolo link, non all'indirizzo da cui arriva.
const FORM_BAD_PER_HOUR = 20;      // token sbagliati tollerati per IP, in un'ora
const FORM_TOK_OVERHEAD = 30;      // richieste tollerate su un link, oltre agli invii previsti
const FORM_TOK_PER_USE = 6;        // ...e quante per ogni invio previsto (apre, ricarica, sbaglia, reinvia)
const FORM_PROFILE_MAX_BYTES = 20000;

/* ─────────────── Campi che il modulo anamnesi può scrivere ───────────────
   Elenco chiuso: tutto ciò che non è qui dentro viene scartato, anche se
   arriva nella richiesta. Corrisponde ai campi che l'atleta vede davvero nel
   modulo (l'array PROFILE di index.html, meno quelli riservati al preparatore).

   NON sono presenti, e non devono esserlo:
     medical, medicalExpiry  l'idoneità medica la stabilisce il preparatore
                             sulla base di un certificato, non chi compila
     notes                   note private del preparatore
     consent*                il consenso lo registra il server piu' sotto,
                             non lo dichiara il client

   Se aggiungi un campo a PROFILE in index.html e vuoi che l'atleta possa
   compilarlo, va aggiunto anche qui. Il test test/anamnesi.mjs confronta le
   due liste e fallisce se divergono: e' li' per non lasciare che si separino
   in silenzio.                                                             */
const FORM_ALLOWED_KEYS = [
  "birth", "dominant", "height", "weight", "role", "experience", "daysWeek",
  "seasonPhase", "sportYears", "prevSports", "goal", "equipment", "job",
  "sleepHours", "sleepQuality", "smoke", "alcohol", "stressLife", "cycle",
  "nutrition", "conditions", "surgeries", "familyHistory", "injuriesCurrent",
  "painLevel", "painContext", "injuriesPast", "recurrent", "painAreas",
  "orthoNotes", "scHeart", "scChest", "scDizzy", "scBreath", "scJoint",
  "scFamily", "scMedsHeart", "meds", "supplements", "allergies",
];

/* ─────────────── Utility ─────────────── */
const now = () => new Date();
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const normEmail = (e) => String(e || "").trim().toLowerCase();

/* Chiave di identità di una persona dentro una squadra: nome, cognome e data
   di nascita. Serve per il caso più frequente di tutti — "non sono sicura sia
   partito, lo rifaccio" — che senza questo genera una seconda scheda identica.
   Confronto tollerante: accenti, maiuscole, spazi doppi e punteggiatura non
   devono decidere se Giulia è una o due persone. L'ordine nome/cognome invece
   sì: si confrontano già separati, quindi non serve ordinarli. */
const normPerson = (s) => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 60);

/* Età compiuta alla data di riferimento. Usata per una sola decisione: se sotto
   i 18, il consenso non può prestarlo l'atleta. */
function ageAt(birthISO, at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthISO || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const b = new Date(Date.UTC(y, mo - 1, d));
  if (b.getUTCFullYear() !== y || b.getUTCMonth() !== mo - 1 || b.getUTCDate() !== d) return null;
  const ref = at || now();
  let a = ref.getUTCFullYear() - y;
  const passato = (ref.getUTCMonth() + 1) > mo
    || ((ref.getUTCMonth() + 1) === mo && ref.getUTCDate() >= d);
  if (!passato) a -= 1;
  return a;
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

/* Si leggeva il PRIMO valore di x-forwarded-for, che e' proprio la parte che
   il client puo' scrivere: bastava un header diverso a ogni richiesta per
   avere una chiave di rate limiting vergine ogni volta.
   Su Vercel x-vercel-forwarded-for e' impostato dalla piattaforma e non e'
   falsificabile. Come ripiego si prende l'ULTIMO valore di x-forwarded-for,
   che e' quello aggiunto dal proxy piu' vicino a noi. */
function clientIp(req) {
  const uno = (v) => (Array.isArray(v) ? v[0] : String(v || "")).trim();
  const vercel = uno(req.headers["x-vercel-forwarded-for"]);
  if (vercel) return vercel.split(",").pop().trim();
  const real = uno(req.headers["x-real-ip"]);
  if (real) return real;
  const xff = uno(req.headers["x-forwarded-for"]);
  if (xff) return xff.split(",").pop().trim();
  return req.socket?.remoteAddress || "unknown";
}

/* Il confronto del codice di invito era `!==`, che esce al primo byte diverso
   e quindi perde tempo in modo proporzionale a quanti caratteri sono giusti.
   Altrove il file usa correttamente timingSafeEqual: qui no. */
function codeOk(dato, atteso) {
  const a = Buffer.from(String(dato || ""), "utf8");
  const b = Buffer.from(String(atteso || ""), "utf8");
  if (!b.length) return false;
  // lunghezze diverse: si confronta comunque, per non rivelare la lunghezza
  const pad = Buffer.alloc(Math.max(a.length, b.length));
  const pa = Buffer.alloc(pad.length); a.copy(pa);
  const pb = Buffer.alloc(pad.length); b.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && a.length === b.length;
}

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(pw, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString("base64"), dk.toString("base64")].join("$");
}

async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const want = Buffer.from(hashB64, "base64");
    const got = await scrypt(pw, salt, want.length, {
      N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(want, got);   // confronto a tempo costante
  } catch { return false; }
}

async function audit(email, action, outcome, ip, detail) {
  try {
    await sql`INSERT INTO audit_log (email, action, outcome, ip, detail)
              VALUES (${email || null}, ${action}, ${outcome}, ${ip},
                      ${detail ? String(detail).slice(0, 500) : null})`;
  } catch { /* il log non deve mai bloccare la richiesta */ }
}

/* ─────────────── Rate limiting ─────────────── */
async function isLocked(key) {
  const { rows } = await sql`SELECT locked_until FROM login_attempts WHERE key = ${key}`;
  const lu = rows[0]?.locked_until;
  return lu ? new Date(lu) > now() : false;
}

async function noteFail(key) {
  const lock = addDays(now(), LOCK_MINUTES / 1440);
  await sql`
    INSERT INTO login_attempts (key, fails, first_fail)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      fails = CASE WHEN login_attempts.first_fail < now() - interval '1 hour'
                   THEN 1 ELSE login_attempts.fails + 1 END,
      first_fail = CASE WHEN login_attempts.first_fail < now() - interval '1 hour'
                        THEN now() ELSE login_attempts.first_fail END,
      -- Il conteggio si azzera quando la finestra di un'ora e' scaduta, ma il
      -- blocco veniva deciso su login_attempts.fails + 1, cioe' sul valore
      -- VECCHIO: chi aveva sbagliato 8 volte ieri veniva bloccato oggi al
      -- primo errore. Qui si ripete la stessa espressione del conteggio.
      locked_until = CASE WHEN (CASE WHEN login_attempts.first_fail < now() - interval '1 hour'
                                     THEN 1 ELSE login_attempts.fails + 1 END) >= ${MAX_FAILS}
                          THEN ${lock.toISOString()}::timestamptz ELSE NULL END`;
}

const clearFails = (key) => sql`DELETE FROM login_attempts WHERE key = ${key}`;

/* Quante richieste tolleriamo su UN link, in un'ora. Un link personale è
   monouso e non ha motivo di essere aperto trenta volte; un link di squadra
   deve reggere l'intera rosa che compila nella stessa mezz'ora. */
function tokBudget(link) {
  const previsti = link && link.kind === "team"
    ? Math.min(Number(link.max_uses) || FORM_TEAM_MAX_USES, FORM_TEAM_MAX_USES_CAP)
    : 1;
  return FORM_TOK_OVERHEAD + previsti * FORM_TOK_PER_USE;
}

/* ─────────────── Migrazione dei link di squadra ───────────────
   Le colonne servono al codice qui sotto. La versione onesta sarebbe stata
   "lancia questo SQL prima di pubblicare", ed è quello che avevo scritto: ma
   è un ordine che si può sbagliare una volta sola e rompe il modulo anamnesi
   per tutti, compresi i link personali già in mano alle atlete. Un passaggio
   manuale con quella conseguenza non va lasciato a un passaggio manuale.

   Costo a regime: una query su information_schema alla prima richiesta di
   ogni istanza serverless, poi niente — l'esito resta in memoria. Le ALTER
   girano una volta sola nella vita del database e sono idempotenti, quindi
   due istanze che partono insieme non fanno danno.                          */
let _linkSchema = null;
async function ensureLinkSchema() {
  if (_linkSchema) return _linkSchema;
  _linkSchema = (async () => {
    const { rows } = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'form_links' AND column_name = 'kind' LIMIT 1`;
    if (rows.length) return true;
    await sql`ALTER TABLE form_links ALTER COLUMN athlete_id DROP NOT NULL`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'athlete'`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS team_id   text`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS team_name text`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS max_uses  integer`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS uses      integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS closed_at timestamptz`;
    await sql`ALTER TABLE form_links ADD COLUMN IF NOT EXISTS pass_hash text`;
    return true;
  })().catch((e) => {
    // Non si memorizza un fallimento: la richiesta dopo deve poter riprovare,
    // altrimenti un singolo intoppo di rete spegne i moduli fino al prossimo
    // riavvio dell'istanza.
    _linkSchema = null;
    throw e;
  });
  return _linkSchema;
}

/* Guardia comune ai due endpoint pubblici del modulo.
   L'ordine conta: prima il lucchetto sull'IP, che vale solo per chi arriva con
   un token inesistente o scaduto; poi, se il token è buono, un budget legato al
   link. Così una squadra intera dietro un solo IP non si autoblocca, e chi tira
   a indovinare token si blocca comunque dopo pochi tentativi.
   Restituisce { link } oppure { status, error }. */
async function loadFormLink(token, ip) {
  await ensureLinkSchema();
  const kI = "form:ip:" + ip;
  if (!(await underLimit(kI, FORM_BAD_PER_HOUR))) {
    return { status: 429, error: "Troppi tentativi da questa connessione. Riprova più tardi." };
  }
  if (!token) { await noteFail(kI); return { status: 400, error: "Link non valido" }; }

  const { rows } = await sql`
    SELECT coach_email, athlete_id, athlete_name, kind, team_id, team_name,
           max_uses, uses, closed_at, pass_hash, expires_at, used_at
    FROM form_links WHERE token_hash = ${sha256(token)}`;
  const link = rows[0];
  if (!link || new Date(link.expires_at) <= now()) {
    await noteFail(kI);
    return { status: 401, error: "Il link è scaduto o non è più valido." };
  }

  // Il contatore sul link usa la stessa tabella del login con una chiave
  // diversa. locked_until viene valorizzato anche qui, ma nessuno lo legge per
  // queste chiavi: la decisione la prende underLimit sul conteggio.
  const kT = "form:tok:" + sha256(token);
  if (!(await underLimit(kT, tokBudget(link)))) {
    return { status: 429, error: "Questo modulo ha ricevuto troppe richieste nell'ultima ora. Riprova fra poco." };
  }
  await noteFail(kT);
  return { link };
}

/* Un link di squadra è aperto finché non scade, non viene chiuso a mano e non
   raggiunge il tetto di schede. Le tre condizioni danno messaggi diversi
   perché chi le incontra deve capire se aspettare o chiamare il preparatore. */
function teamLinkClosed(link) {
  if (link.closed_at) return "Il modulo di questa squadra è stato chiuso dal preparatore.";
  if (link.max_uses != null && Number(link.uses || 0) >= Number(link.max_uses)) {
    return "Il modulo ha già raccolto tutte le schede previste. Avvisa il tuo preparatore.";
  }
  return null;
}

function passOk(plain, hash) {
  if (!hash) return true;
  const a = Buffer.from(sha256(normPerson(plain)), "utf8");
  const b = Buffer.from(String(hash), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Un id che non può collidere con quelli generati dal browser (7 caratteri da
   Math.random) né con quelli già presenti, e che passa il controllo idOk del
   client: /^[A-Za-z0-9_-]{1,40}$/. */
function newAthleteId(store) {
  const usati = new Set((store.athletes || []).map((a) => String(a && a.id)));
  for (let i = 0; i < 50; i++) {
    const id = "f" + crypto.randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
    if (id.length >= 8 && !usati.has(id)) return id;
  }
  return "f" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

// Riusa la stessa tabella di rate limiting del login, con chiavi separate,
// invece di introdurre un secondo meccanismo da mantenere allineato.
async function underLimit(key, max) {
  const { rows } = await sql`SELECT fails, first_fail FROM login_attempts WHERE key = ${key}`;
  if (!rows.length) return true;
  const fresh = new Date(rows[0].first_fail) > new Date(now().getTime() - 3600000);
  return !fresh || rows[0].fails < max;
}

/* ─────────────── Email (Resend) ─────────────── */
async function sendResetEmail(email, token) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const appUrl = process.env.IP_APP_URL;
  if (!key || !from || !appUrl) {
    throw new Error("Invio email non configurato (RESEND_API_KEY / RESEND_FROM / IP_APP_URL)");
  }
  const link = appUrl.replace(/\/$/, "") + "/?reset=" + encodeURIComponent(token);
  const html = `
    <p>Hai chiesto di reimpostare la password di Iron Performance.</p>
    <p><a href="${link}">Scegli una nuova password</a></p>
    <p>Il link scade tra ${RESET_MINUTES} minuti e funziona una sola volta.</p>
    <p>Se non sei stato tu, ignora questa email: la password attuale resta valida.</p>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [email], subject: "Reimposta la tua password — Iron Performance", html,
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error("Invio email fallito: " + (j.message || r.status));
  }
}

/* Avviso al preparatore quando arriva una scheda.

   NEL MESSAGGIO CI VANNO SOLO NOME E SQUADRA. Nient'altro, mai.
   L'email esce dall'applicazione e finisce in una casella di posta che è di
   qualcun altro: tutto ciò che ci scriviamo dentro è materialmente fuori dal
   controllo del titolare. Che Giulia giochi in una squadra non è un dato
   sanitario; quello che ha scritto nel modulo lo è, e resta dentro l'app.

   L'invio non deve mai far fallire la richiesta: la scheda è già salvata e in
   transazione chiusa quando arriviamo qui. Se l'email non parte, il pallino
   dentro l'app resta l'avviso buono. */
async function sendNewSheetEmail(coachEmail, athleteName, teamName, aggiornata) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return;
  const appUrl = String(process.env.IP_APP_URL || "").replace(/\/$/, "");
  const esc = (s) => String(s || "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const che = aggiornata ? "aggiornato la sua scheda" : "compilato la scheda";
  const html = `
    <p><b>${esc(athleteName)}</b> ha ${che}${teamName ? " — " + esc(teamName) : ""}.</p>
    ${appUrl ? `<p><a href="${appUrl}">Apri Iron Performance</a></p>` : ""}
    <p style="color:#6C757D;font-size:13px">Questo avviso contiene solo nome e squadra:
    i dati della scheda restano nell'applicazione.</p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [coachEmail],
        subject: (aggiornata ? "Scheda aggiornata: " : "Nuova scheda: ") + athleteName,
        html,
      }),
    });
  } catch { /* l'avviso non è la cosa importante: il dato è già salvato */ }
}

/* ─────────────── Sessioni ─────────────── */
async function createSession(email, ua) {
  const token = crypto.randomBytes(32).toString("base64url");
  await sql`INSERT INTO sessions (token_hash, email, expires_at, user_agent)
            VALUES (${sha256(token)}, ${email},
                    ${addDays(now(), SESSION_DAYS).toISOString()},
                    ${String(ua || "").slice(0, 200)})`;
  return token;
}

// L'identità viene SEMPRE dal token, mai dal corpo della richiesta.
// È questa riga che elimina "leggo i dati di chiunque scrivendo la sua email".
async function sessionUser(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { rows } = await sql`
    SELECT email FROM sessions
    WHERE token_hash = ${sha256(token)} AND expires_at > now()`;
  if (!rows.length) return null;
  sql`UPDATE sessions SET last_seen = now() WHERE token_hash = ${sha256(token)}`.catch(() => {});
  return { email: rows[0].email, token };
}

/* ─────────────── Manutenzione ───────────────
   Nessuna tabella si potava da sola: le istruzioni in schema.sql erano
   commenti, e audit_log prende una riga per OGNI salvataggio. La tabella che
   contiene email e indirizzi IP cresceva senza fine — il contrario esatto
   della minimizzazione dichiarata nell'informativa.

   Non c'e' un cron, quindi la potatura viaggia in coda a una richiesta ogni
   tanto: non viene attesa (nessuna latenza per l'utente) e se fallisce non
   succede niente. Il giorno in cui aggiungerai un Vercel Cron, questa funzione
   e' gia' quella da chiamare. */
const PRUNE_ODDS = 0.02;                 // ~1 richiesta su 50
const AUDIT_KEEP_MONTHS = 12;            // dichiaralo nell'informativa
function pruneOccasionally() {
  if (Math.random() >= PRUNE_ODDS) return;
  (async () => {
    try {
      await sql`DELETE FROM sessions        WHERE expires_at < now()`;
      await sql`DELETE FROM password_resets WHERE expires_at < now()`;
      await sql`DELETE FROM form_links      WHERE expires_at < now() - interval '30 days'
                                               OR (used_at IS NOT NULL AND used_at < now() - interval '30 days')`;
      await sql`DELETE FROM login_attempts  WHERE first_fail < now() - interval '1 day'
                                              AND (locked_until IS NULL OR locked_until < now())`;
      await sql`DELETE FROM audit_log       WHERE at < now() - interval '1 month' * ${AUDIT_KEEP_MONTHS}`;
    } catch { /* la manutenzione non deve mai disturbare una richiesta */ }
  })();
}

/* ─────────────── Handler ─────────────── */
export default async function handler(req, res) {
  const origin = process.env.IP_ALLOWED_ORIGIN;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });
  if (!process.env.POSTGRES_URL) return res.status(500).json({ error: "Backend non configurato" });

  const ip = clientIp(req);
  const body = req.body || {};
  const action = String(body.action || "");
  pruneOccasionally();

  try {
    /* ── signup ── */
    if (action === "signup") {
      const email = normEmail(body.email);
      const pw = String(body.password || "");

      // Era l'unica azione senza alcun limite: login, forgot, formInfo e
      // formSubmit ce l'hanno tutte. Il codice di invito e' una stringa
      // digitata a mano, quindi corta: senza limite si prova a raffica.
      const kSignup = "signup:ip:" + ip;
      if (await isLocked(kSignup)) {
        await audit(email, "signup", "denied", ip, "bloccato");
        return res.status(429).json({ error: `Troppi tentativi. Riprova tra ${LOCK_MINUTES} minuti.` });
      }
      if (!codeOk(String(body.code || ""), process.env.IP_SIGNUP_CODE)) {
        await noteFail(kSignup);
        await audit(email, "signup", "denied", ip, "codice invito errato");
        return res.status(403).json({ error: "Codice di invito non valido" });
      }
      if (!validEmail(email)) return res.status(400).json({ error: "Email non valida" });
      if (pw.length < MIN_PW) {
        return res.status(400).json({ error: `Password troppo corta (minimo ${MIN_PW} caratteri)` });
      }
      // Prima era SELECT-poi-INSERT (due registrazioni simultanee finivano in un
      // 500 per chiave duplicata) e i due INSERT non erano legati: se il secondo
      // falliva restava un account senza riga dati, e al tentativo successivo
      // l'utente leggeva "Account gia' esistente" senza capire perche'.
      const hash = await hashPassword(pw);
      const cl = await db.connect();
      try {
        await cl.query("BEGIN");
        const ins = await cl.query(
          `INSERT INTO users (email, pw_hash) VALUES ($1,$2)
           ON CONFLICT (email) DO NOTHING RETURNING email`, [email, hash]);
        if (ins.rowCount !== 1) {
          await cl.query("ROLLBACK");
          return res.status(409).json({ error: "Account già esistente" });
        }
        await cl.query(
          `INSERT INTO payloads (email, payload, bytes) VALUES ($1,'{}'::jsonb,2)
           ON CONFLICT (email) DO NOTHING`, [email]);
        await cl.query("COMMIT");
      } catch (e) {
        try { await cl.query("ROLLBACK"); } catch (e2) {}
        throw e;
      } finally { cl.release(); }
      const token = await createSession(email, req.headers["user-agent"]);
      await audit(email, "signup", "ok", ip);
      return res.status(200).json({ token, email, expiresInDays: SESSION_DAYS });
    }

    /* ── login ── */
    if (action === "login") {
      const email = normEmail(body.email);
      const pw = String(body.password || "");
      const kI = "ip:" + ip;

      // Il blocco era anche sulla chiave "email:", che sta nel corpo della
      // richiesta ed e' quindi scelta da chi la manda: otto richieste ogni
      // quindici minuti — uno script banale — e il titolare dell'account
      // restava fuori per sempre, senza che il suo IP c'entrasse nulla.
      // Ora si blocca solo per origine. Contro un attacco distribuito resta
      // scrypt su una password di almeno 12 caratteri, che e' la difesa vera.
      if (await isLocked(kI)) {
        await audit(email, "login", "denied", ip, "bloccato");
        return res.status(429).json({ error: `Troppi tentativi. Riprova tra ${LOCK_MINUTES} minuti.` });
      }

      const { rows } = await sql`SELECT pw_hash FROM users WHERE email = ${email}`;
      // Se l'utente non esiste verifichiamo comunque un hash fittizio,
      // così il tempo di risposta non rivela quali email sono registrate.
      const stored = rows[0]?.pw_hash || (await hashPassword(crypto.randomUUID()));
      const ok = rows.length ? await verifyPassword(pw, stored) : false;

      if (!ok) {
        await noteFail(kI);
        await audit(email, "login", "denied", ip);
        return res.status(401).json({ error: "Email o password non corretti" });
      }
      await clearFails(kI);
      const token = await createSession(email, req.headers["user-agent"]);
      await audit(email, "login", "ok", ip);
      return res.status(200).json({ token, email, expiresInDays: SESSION_DAYS });
    }

    /* ── forgot: richiesta di reset ── */
    if (action === "forgot") {
      const email = normEmail(body.email);
      const kE = "forgot:email:" + email, kI = "forgot:ip:" + ip;

      // Risposta identica in ogni caso: non deve rivelare se l'email esiste.
      const generic = { ok: true, message: "Se l'indirizzo è registrato, riceverai un'email a breve." };

      if (!validEmail(email)) return res.status(200).json(generic);
      if (!(await underLimit(kE, RESET_MAX_PER_HOUR)) || !(await underLimit(kI, RESET_MAX_PER_HOUR * 4))) {
        await audit(email, "forgot", "denied", ip, "rate limit");
        return res.status(200).json(generic);   // stesso messaggio: niente enumerazione
      }
      await noteFail(kE); await noteFail(kI);   // riusato come contatore, non come blocco account

      const { rows } = await sql`SELECT 1 FROM users WHERE email = ${email}`;
      if (rows.length) {
        const token = crypto.randomBytes(32).toString("base64url");
        await sql`DELETE FROM password_resets WHERE email = ${email}`;   // un solo link attivo
        await sql`INSERT INTO password_resets (token_hash, email, expires_at)
                  VALUES (${sha256(token)}, ${email}, ${addDays(now(), RESET_MINUTES / 1440).toISOString()})`;
        try {
          await sendResetEmail(email, token);
          await audit(email, "forgot", "ok", ip);
        } catch (e) {
          await audit(email, "forgot", "error", ip, e.message);
          // Non esporre al client se l'invio è fallito: rivelerebbe che l'account esiste.
        }
      } else {
        await audit(email, "forgot", "ok", ip, "email non registrata");
      }
      return res.status(200).json(generic);
    }

    /* ── reset_confirm: consuma il token e imposta la nuova password ── */
    if (action === "reset_confirm") {
      // il reset ripulisce i blocchi per origine: chi ha appena dimostrato di
      // controllare la casella email non deve restare chiuso fuori

      const token = String(body.token || "");
      const newPw = String(body.newPassword || "");
      if (!token) return res.status(400).json({ error: "Link non valido" });
      if (newPw.length < MIN_PW) {
        return res.status(400).json({ error: `Password troppo corta (minimo ${MIN_PW} caratteri)` });
      }
      const { rows } = await sql`
        SELECT email FROM password_resets
        WHERE token_hash = ${sha256(token)} AND expires_at > now()`;
      if (!rows.length) {
        await audit(null, "reset_confirm", "denied", ip, "token scaduto o non valido");
        return res.status(400).json({ error: "Il link è scaduto o non è più valido. Richiedine uno nuovo." });
      }
      const email = rows[0].email;
      // Se l'account nel frattempo e' stato cancellato, questo UPDATE tocca
      // zero righe: senza il controllo si proseguiva a creare una sessione
      // valida per un utente che non esiste piu'.
      const upd = await sql`UPDATE users SET pw_hash = ${await hashPassword(newPw)}, pw_changed_at = now()
                            WHERE email = ${email}`;
      if (upd.rowCount !== 1) {
        await sql`DELETE FROM password_resets WHERE email = ${email}`;
        await audit(email, "reset_confirm", "denied", ip, "account inesistente");
        return res.status(400).json({ error: "Il link non è più valido." });
      }
      await sql`DELETE FROM password_resets WHERE email = ${email}`;   // token monouso
      await sql`DELETE FROM sessions WHERE email = ${email}`;          // tutte le sessioni cadono
      await clearFails("ip:" + ip);
      const newToken = await createSession(email, req.headers["user-agent"]);
      await audit(email, "reset_confirm", "ok", ip);
      return res.status(200).json({ ok: true, token: newToken, email, expiresInDays: SESSION_DAYS });
    }

    /* ── formInfo: cosa mostrare a chi apre il link (pubblico, no login) ── */
    if (action === "formInfo") {
      const g = await loadFormLink(String(body.token || ""), ip);
      if (g.error) return res.status(g.status).json({ error: g.error });
      const link = g.link;

      if (link.kind === "team") {
        const chiuso = teamLinkClosed(link);
        if (chiuso) return res.status(410).json({ error: chiuso });
      } else if (link.used_at) {
        return res.status(410).json({ error: "Questa scheda è già stata inviata. Chiedi un nuovo link al tuo preparatore." });
      }

      // L'informativa viaggia insieme al modulo: chi compila deve poterla
      // leggere PRIMA di acconsentire, non dopo e non altrove. Senza questo,
      // la casella "ho letto l'informativa" è una dichiarazione su un
      // documento che non esiste — cioè un consenso che non prova nulla.
      const pol = await sql`SELECT payload -> 'policy' AS policy FROM payloads WHERE email = ${link.coach_email}`;
      return res.status(200).json({
        kind: link.kind,
        // Su un link di squadra non esce NESSUN nome: l'elenco della rosa non
        // deve poter essere letto da chi si limita ad aprire il link.
        athleteName: link.kind === "team" ? null : link.athlete_name,
        teamName: link.team_name || null,
        needPass: !!link.pass_hash,
        policy: pol.rows[0]?.policy ?? null,
      });
    }

    /* ── formSubmit: scrive la scheda ──────────────────────────────────────
       Due strade, stesso endpoint:
         link personale  aggiorna il profilo dell'atleta indicato dal link
         link di squadra crea (o ritrova) l'atleta a partire da nome, cognome
                         e data di nascita, e poi ne scrive il profilo         */

    if (action === "formSubmit") {
      const token = String(body.token || "");
      const g0 = await loadFormLink(token, ip);
      if (g0.error) return res.status(g0.status).json({ error: g0.error });
      const kind = g0.link.kind;

      if (kind === "team" && !passOk(body.pass, g0.link.pass_hash)) {
        await audit(g0.link.coach_email, "formSubmit", "denied", ip, "parola d'ordine errata");
        return res.status(401).json({ error: "Parola d'ordine non corretta. Chiedila al tuo preparatore." });
      }

      const raw = body.profile;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return res.status(400).json({ error: "Dati non validi" });
      }
      if (Buffer.byteLength(JSON.stringify(raw), "utf8") > FORM_PROFILE_MAX_BYTES) {
        return res.status(413).json({ error: "Dati troppo grandi" });
      }

      // Prima si accettava QUALSIASI chiave arrivasse. Il modulo nel browser
      // nascondeva idoneità medica, scadenza del certificato e note del
      // preparatore — ma nascondere un campo non è impedirne la scrittura:
      // bastava una richiesta scritta a mano per sovrascriverli.
      // La regola vera sta qui, e i campi del preparatore restano suoi.
      const profile = {};
      for (const k of FORM_ALLOWED_KEYS) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) profile[k] = raw[k];
      }

      // Il consenso non è una casella spuntata: è chi lo presta, quando, e su
      // quale versione dell'informativa. Ruolo e nome arrivano dal modulo;
      // data e versione le stabilisce il server, perché sono le due cose che
      // in una contestazione non devono dipendere da ciò che dice il client.
      // Identità: obbligatoria sul link di squadra, dove l'atleta non esiste
      // ancora e queste tre informazioni sono l'unica cosa che la distingue.
      let nome = "", cognome = "", sesso = "", nascita = "";
      if (kind === "team") {
        const a = (body.athlete && typeof body.athlete === "object") ? body.athlete : {};
        nome = cleanName(a.first);
        cognome = cleanName(a.last);
        sesso = a.sex === "F" ? "F" : a.sex === "M" ? "M" : "";
        nascita = String(a.birth || "").slice(0, 10);
        if (normPerson(nome).length < 2) return res.status(400).json({ error: "Scrivi il tuo nome." });
        if (normPerson(cognome).length < 2) return res.status(400).json({ error: "Scrivi il tuo cognome." });
        if (!sesso) return res.status(400).json({ error: "Indica il sesso: i valori di riferimento dei test sono distinti." });
        const et = ageAt(nascita);
        if (et == null) return res.status(400).json({ error: "Controlla la data di nascita." });
        if (et < 5 || et > 99) return res.status(400).json({ error: "La data di nascita non sembra corretta." });
        profile.birth = nascita;   // la data resta anche nel profilo, dov'è sempre stata
      } else {
        nascita = String(profile.birth || "").slice(0, 10);
      }

      const consentRole = String(body.consentRole || "");
      const consentName = String(body.consentName || "").trim().slice(0, 120);
      if (consentRole !== "athlete" && consentRole !== "guardian") {
        return res.status(400).json({ error: "Indica chi presta il consenso." });
      }
      if (body.policyRead !== true || body.consentHealth !== true) {
        return res.status(400).json({ error: "Servono entrambe le conferme: informativa letta e consenso al trattamento." });
      }
      if (consentRole === "guardian" && consentName.length < 3) {
        return res.status(400).json({ error: "Serve il nome di chi esercita la responsabilità genitoriale." });
      }

      // Chi può prestare il consenso non è una scelta: lo decide l'età.
      // Prima era una tendina, e una ragazza di sedici anni che sceglieva
      // "sono maggiorenne" produceva un consenso invalido senza che nessuno
      // se ne accorgesse — né lei, né il preparatore, né il server.
      // Quando la data di nascita c'è, la tendina non serve più: è il server a
      // decidere, e il modulo si limita a mostrare la parte giusta.
      const eta = ageAt(nascita);
      if (eta != null) {
        if (eta < 18 && consentRole !== "guardian") {
          return res.status(400).json({
            error: "Per un minorenne il consenso lo presta chi esercita la responsabilità genitoriale.",
          });
        }
        if (eta >= 18 && consentRole !== "athlete") {
          return res.status(400).json({
            error: "Per una persona maggiorenne il consenso ai dati sanitari lo presta l'interessato.",
          });
        }
      }

      // Il link e il suo consumo stanno nella STESSA transazione del salvataggio:
      // due invii arrivati insieme non possono passare entrambi (FOR UPDATE blocca
      // il secondo finché il primo non ha finito, e a quel punto trova used_at valorizzato).
      const client = await db.connect();
      let avviso = null;   // email da mandare DOPO il commit, mai dentro
      try {
        await client.query("BEGIN");

        const linkQ = await client.query(
          `SELECT coach_email, athlete_id, kind, team_id, team_name,
                  max_uses, uses, closed_at, expires_at, used_at
           FROM form_links WHERE token_hash = $1 FOR UPDATE`, [sha256(token)]);
        const link = linkQ.rows[0];
        if (!link || new Date(link.expires_at) <= now()) {
          await client.query("ROLLBACK");
          await audit(null, "formSubmit", "denied", ip, "link scaduto o inesistente");
          return res.status(401).json({ error: "Il link è scaduto o non è più valido." });
        }
        const diSquadra = link.kind === "team";
        if (diSquadra) {
          // Riletto DENTRO la transazione e con FOR UPDATE: il tetto va contato
          // qui, non sulla copia letta prima, altrimenti due invii simultanei
          // all'ultimo posto disponibile passano entrambi.
          const chiuso = teamLinkClosed(link);
          if (chiuso) { await client.query("ROLLBACK"); return res.status(410).json({ error: chiuso }); }
        } else if (link.used_at) {
          await client.query("ROLLBACK");
          return res.status(410).json({ error: "Questa scheda è già stata inviata. Chiedi un nuovo link al tuo preparatore." });
        }

        const payQ = await client.query(
          `SELECT payload, version FROM payloads WHERE email = $1 FOR UPDATE`, [link.coach_email]);
        const prow = payQ.rows[0];
        if (!prow || !prow.payload || !Array.isArray(prow.payload.athletes)) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "Dati non pronti: chiedi al preparatore di aprire l'app una volta." });
        }
        const store = prow.payload;

        // Senza informativa configurata non si raccoglie niente. È il punto in
        // cui il trattamento avrebbe una base giuridica solo dichiarata: meglio
        // rifiutare l'invio che archiviare dati sanitari di un minore con un
        // consenso che rimanda a un documento inesistente.
        const policy = store.policy || null;
        if (!policy || !Number(policy.version) || !String(policy.titolare || "").trim()) {
          await client.query("ROLLBACK");
          await audit(link.coach_email, "formSubmit", "denied", ip, "informativa non configurata");
          return res.status(409).json({
            error: "Il preparatore non ha ancora pubblicato l'informativa privacy. Avvisalo: il modulo non può essere inviato finché non lo fa.",
          });
        }

        let ath = null, creata = false;
        const nomeCompleto = nome + " " + cognome;

        if (diSquadra) {
          const teamId = String(link.team_id || "");
          if (!(store.teams || []).some(t => t && String(t.id) === teamId)) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "La squadra non esiste più. Avvisa il tuo preparatore." });
          }

          // Ritrovare la stessa persona invece di crearne una seconda.
          // formKey è la corrispondenza esatta (stesso modulo, secondo invio);
          // il confronto sul nome copre chi era già in rosa perché inserita a
          // mano dal preparatore, e accetta l'ordine invertito perché "Rossi
          // Giulia" e "Giulia Rossi" sono la stessa ragazza.
          const chiave = normPerson(nome) + "|" + normPerson(cognome) + "|" + nascita;
          const dritto = normPerson(nomeCompleto);
          const rovescio = normPerson(cognome + " " + nome);
          ath = store.athletes.find(a => {
            if (!a || String(a.team || "") !== teamId) return false;
            const p = a.profile || {};
            if (p.formKey && String(p.formKey) === chiave) return true;
            const n = normPerson(a.name);
            if (n !== dritto && n !== rovescio) return false;
            // stesso nome ma data di nascita diversa e nota: due persone diverse
            return !p.birth || String(p.birth) === nascita;
          }) || null;

          if (!ath) {
            if ((store.athletes || []).length >= 500) {
              await client.query("ROLLBACK");
              return res.status(409).json({ error: "L'archivio del preparatore è pieno. Avvisalo." });
            }
            ath = { id: newAthleteId(store), name: nomeCompleto, sex: sesso, team: teamId, profile: {} };
            store.athletes.push(ath);
            creata = true;
          } else {
            // seconda compilazione: il nome resta quello che l'atleta scrive oggi
            ath.name = nomeCompleto;
            ath.sex = sesso;
          }
          profile.formKey = chiave;
        } else {
          ath = store.athletes.find(a => String(a.id) === String(link.athlete_id)) || null;
          if (!ath) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Scheda non trovata: forse è stata rimossa." });
          }
        }

        const consentBy = consentRole === "guardian"
          ? "Chi esercita la responsabilità genitoriale"
          : "L'atleta (maggiorenne)";

        // merge del solo profilo di QUESTO atleta — non tocca il resto dei dati.
        // viaForm/formAt/formNew stanno DENTRO profile e non a fianco perché
        // sanitizeImport ricostruisce l'atleta da un elenco chiuso di campi
        // (id, name, sex, team, profile): qualunque campo nuovo messo accanto
        // sparirebbe in silenzio al primo ripristino di un backup. Il profilo
        // invece conserva le chiavi che non conosce.
        // formAt serve anche al client per capire, in fase di merge, che il
        // server ha una scheda che quel dispositivo non ha mai visto.
        ath.profile = Object.assign({}, ath.profile || {}, profile, {
          consent: true,
          consentBy,
          consentName: consentName || null,
          consentRole,
          consentDate: now().toISOString().slice(0, 10),
          consentAt: now().toISOString(),
          consentDoc: "v" + policy.version + (policy.updatedAt ? " del " + policy.updatedAt : ""),
          consentPolicyVersion: Number(policy.version),
          // Da dove viene questo consenso. È l'unica differenza che conta:
          // "form" vuol dire che data, versione e ruolo li ha stabiliti il
          // server e che esiste una riga nel registro accessi. Un consenso
          // importato da un foglio di calcolo dice le stesse cose, ma le dice
          // il preparatore, e senza questo campo i due sono indistinguibili.
          consentSource: "form",
          viaForm: diSquadra ? true : !!(ath.profile || {}).viaForm,
          formAt: now().toISOString(),
          formNew: true,
        });

        const payloadStr = JSON.stringify(store);
        if (Buffer.byteLength(payloadStr, "utf8") > MAX_PAYLOAD_BYTES) {
          await client.query("ROLLBACK");
          return res.status(413).json({ error: "L'archivio del preparatore è pieno. Avvisalo." });
        }
        const nextV = Number(prow.version || 0) + 1;
        await client.query(
          `UPDATE payloads SET payload=$1::jsonb, version=$2, updated_at=now(), bytes=$3 WHERE email=$4`,
          [payloadStr, nextV, Buffer.byteLength(payloadStr, "utf8"), link.coach_email]);

        if (diSquadra) {
          await client.query(
            `UPDATE form_links SET uses = uses + 1, used_at = now() WHERE token_hash = $1`, [sha256(token)]);
        } else {
          await client.query(`UPDATE form_links SET used_at = now() WHERE token_hash = $1`, [sha256(token)]);
        }

        await client.query("COMMIT");
        avviso = { to: link.coach_email, name: ath.name, team: link.team_name, aggiornata: !creata };

        // Il registro accessi è l'unica traccia in sola aggiunta che abbiamo:
        // se un domani qualcuno chiede "chi ha autorizzato e su cosa", la
        // risposta sta qui e non dentro un JSON che nel frattempo è cambiato.
        await audit(link.coach_email, "formSubmit", "ok", ip,
          (diSquadra ? (creata ? "atleta creata dal modulo " : "atleta aggiornata dal modulo ") : "atleta ") + ath.id +
          (diSquadra ? " · squadra " + link.team_id : "") +
          " · consenso: " + consentBy +
          (consentName ? " (" + consentName + ")" : "") +
          " · informativa v" + policy.version);
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (e2) {}
        throw e;
      } finally {
        client.release();
      }

      // Fuori dalla transazione e fuori dal try: una chiamata di rete lenta a
      // Resend non deve tenere aperta una riga bloccata dal FOR UPDATE.
      if (avviso) await sendNewSheetEmail(avviso.to, avviso.name, avviso.team, avviso.aggiornata);
      return res.status(200).json({ ok: true });
    }

    /* ── da qui in poi serve una sessione valida ── */
    const me = await sessionUser(req);
    if (!me) return res.status(401).json({ error: "Sessione scaduta" });

    /* ── load ── */
    if (action === "load") {
      const { rows } = await sql`
        SELECT payload, version, updated_at FROM payloads WHERE email = ${me.email}`;
      await audit(me.email, "load", "ok", ip);
      if (!rows.length) return res.status(200).json({ data: null, version: 0 });
      return res.status(200).json({
        data: rows[0].payload,
        version: Number(rows[0].version),
        updatedAt: rows[0].updated_at,
      });
    }

    /* ── save (concorrenza ottimistica) ── */
    if (action === "save") {
      const data = body.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return res.status(400).json({ error: "Payload non valido" });
      }
      const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (bytes > MAX_PAYLOAD_BYTES) {
        await audit(me.email, "save", "error", ip, "payload " + bytes);
        return res.status(413).json({ error: "Dati troppo grandi per un singolo salvataggio" });
      }

      // baseVersion è OBBLIGATORIO. Prima il controllo era
      // `if (Number.isFinite(base) && base !== curV)`: se il campo mancava,
      // arrivava null, o arrivava una stringa non numerica, il controllo si
      // saltava del tutto e il salvataggio passava sovrascrivendo tutto.
      // Un client vecchio rimasto in cache su un tablet bastava a cancellare
      // il lavoro dell'altro dispositivo, in silenzio.
      const base = Number(body.baseVersion);
      if (!Number.isFinite(base) || base < 0) {
        await audit(me.email, "save", "denied", ip, "baseVersion mancante o non valida");
        return res.status(400).json({ error: "baseVersion obbligatoria" });
      }

      // Un solo statement: il confronto di versione e la scrittura avvengono
      // nella stessa operazione atomica. Prima erano due query separate
      // (SELECT version, poi UPDATE) e fra le due non c'era niente: due
      // salvataggi concorrenti con la stessa baseVersion leggevano lo stesso
      // valore, passavano entrambi il controllo, e il secondo sovrascriveva
      // il primo — cioè esattamente il conflitto che questo codice esiste
      // per impedire. Il modello corretto era già in formSubmit, che usa
      // una transazione con SELECT ... FOR UPDATE.
      const upd = await sql`
        UPDATE payloads
           SET payload = ${JSON.stringify(data)}::jsonb,
               version = version + 1,
               updated_at = now(),
               bytes = ${bytes}
         WHERE email = ${me.email} AND version = ${base}
        RETURNING version`;

      if (upd.rowCount === 1) {
        const next = Number(upd.rows[0].version);
        await audit(me.email, "save", "ok", ip, `v${next} · ${bytes}B`);
        return res.status(200).json({ ok: true, version: next });
      }

      // Nessuna riga aggiornata: o la versione non corrisponde, o la riga
      // non esiste ancora. Sono due casi diversi e vanno distinti.
      const cur = await sql`SELECT payload, version FROM payloads WHERE email = ${me.email}`;

      if (!cur.rows.length) {
        // Primo salvataggio: la riga viene creata solo se base === 0, così
        // due dispositivi che partono insieme non si sovrascrivono a vicenda.
        if (base !== 0) {
          await audit(me.email, "save", "denied", ip, `riga assente, base ${base}`);
          return res.status(409).json({ error: "Conflitto di versione", serverData: null, version: 0 });
        }
        const ins = await sql`
          INSERT INTO payloads (email, payload, version, updated_at, bytes)
          VALUES (${me.email}, ${JSON.stringify(data)}::jsonb, 1, now(), ${bytes})
          ON CONFLICT (email) DO NOTHING
          RETURNING version`;
        if (ins.rowCount === 1) {
          await audit(me.email, "save", "ok", ip, `v1 · ${bytes}B (prima scrittura)`);
          return res.status(200).json({ ok: true, version: 1 });
        }
        // Qualcun altro ha inserito la riga nel frattempo: è un conflitto.
        const race = await sql`SELECT payload, version FROM payloads WHERE email = ${me.email}`;
        await audit(me.email, "save", "denied", ip, "corsa sulla prima scrittura");
        return res.status(409).json({
          error: "Conflitto di versione",
          serverData: race.rows[0]?.payload ?? null,
          version: Number(race.rows[0]?.version ?? 0),
        });
      }

      const curV = Number(cur.rows[0].version);
      await audit(me.email, "save", "denied", ip, `conflitto ${base}!=${curV}`);
      return res.status(409).json({
        error: "Conflitto di versione",
        serverData: cur.rows[0].payload ?? null,
        version: curV,
      });
    }

    /* ── changepass (ora esiste davvero) ── */
    if (action === "changepass") {
      const oldPw = String(body.oldPassword || "");
      const newPw = String(body.newPassword || "");
      if (newPw.length < MIN_PW) {
        return res.status(400).json({ error: `Password troppo corta (minimo ${MIN_PW} caratteri)` });
      }
      const { rows } = await sql`SELECT pw_hash FROM users WHERE email = ${me.email}`;
      if (!rows.length || !(await verifyPassword(oldPw, rows[0].pw_hash))) {
        // Prima faceva noteFail("email:"+...), che bloccava il LOGIN: sbagliare
        // 8 volte la vecchia password dalle impostazioni chiudeva fuori
        // dall'app chi era gia' dentro, senza spiegare perche'.
        await noteFail("changepass:ip:" + ip);
        await audit(me.email, "changepass", "denied", ip);
        return res.status(401).json({ error: "Password attuale errata" });
      }
      await sql`UPDATE users SET pw_hash = ${await hashPassword(newPw)}, pw_changed_at = now()
                WHERE email = ${me.email}`;
      // Cambio password = tutte le altre sessioni cadono.
      await sql`DELETE FROM sessions WHERE email = ${me.email} AND token_hash <> ${sha256(me.token)}`;
      await audit(me.email, "changepass", "ok", ip);
      return res.status(200).json({ ok: true });
    }

    /* ── logout / logout_all ── */
    if (action === "logout") {
      await sql`DELETE FROM sessions WHERE token_hash = ${sha256(me.token)}`;
      await audit(me.email, "logout", "ok", ip);
      return res.status(200).json({ ok: true });
    }
    if (action === "logout_all") {
      await sql`DELETE FROM sessions WHERE email = ${me.email}`;
      await audit(me.email, "logout_all", "ok", ip);
      return res.status(200).json({ ok: true });
    }

    /* ── sessions: quali dispositivi sono collegati ── */
    if (action === "sessions") {
      const { rows } = await sql`
        SELECT created_at, last_seen, expires_at, user_agent,
               (token_hash = ${sha256(me.token)}) AS current
        FROM sessions WHERE email = ${me.email} ORDER BY last_seen DESC`;
      return res.status(200).json({ sessions: rows });
    }

    /* ── formLink: genera un link anamnesi monouso per un atleta ── */
    if (action === "formLink") {
      await ensureLinkSchema();
      const aid = String(body.athleteId || "");
      const aname = String(body.athleteName || "").slice(0, 80);
      if (!aid) return res.status(400).json({ error: "athleteId mancante" });
      const token = crypto.randomBytes(24).toString("base64url");
      await sql`INSERT INTO form_links (token_hash, coach_email, athlete_id, athlete_name, expires_at)
                VALUES (${sha256(token)}, ${me.email}, ${aid}, ${aname},
                        ${addDays(now(), FORM_LINK_HOURS / 24).toISOString()})`;
      await audit(me.email, "formLink", "ok", ip, "atleta " + aid);
      return res.status(200).json({ token, expiresHours: FORM_LINK_HOURS });
    }

    /* ── teamLink: un link solo per tutta la squadra ───────────────────────
       Chi lo apre non trova una rosa da scegliere: scrive i propri dati e
       crea la propria scheda. Il link vive giorni, non ore, perché va mandato
       una volta sola in un gruppo e deve reggere chi compila la sera dopo. */
    if (action === "teamLink") {
      await ensureLinkSchema();
      const teamId = String(body.teamId || "");
      const teamName = cleanName(body.teamName).slice(0, 80);
      if (!teamId) return res.status(400).json({ error: "Squadra mancante" });

      let maxUses = Math.round(Number(body.maxUses));
      if (!isFinite(maxUses) || maxUses < 1) maxUses = FORM_TEAM_MAX_USES;
      maxUses = Math.min(maxUses, FORM_TEAM_MAX_USES_CAP);

      let days = Math.round(Number(body.days));
      if (!isFinite(days) || days < 1) days = FORM_TEAM_DAYS;
      days = Math.min(days, 60);

      const pass = String(body.pass || "").trim();
      if (pass && normPerson(pass).length < 3) {
        return res.status(400).json({ error: "La parola d'ordine è troppo corta: almeno 3 caratteri." });
      }

      // Un solo link aperto per squadra. Generarne uno nuovo chiude il vecchio:
      // altrimenti restano in circolazione link che nessuno ricorda di aver dato
      // e che continuano a creare schede.
      await sql`UPDATE form_links SET closed_at = now()
                WHERE coach_email = ${me.email} AND kind = 'team'
                  AND team_id = ${teamId} AND closed_at IS NULL`;

      const token = crypto.randomBytes(24).toString("base64url");
      await sql`INSERT INTO form_links
                  (token_hash, coach_email, athlete_id, kind, team_id, team_name,
                   max_uses, expires_at, pass_hash)
                VALUES (${sha256(token)}, ${me.email}, NULL, 'team', ${teamId}, ${teamName},
                        ${maxUses}, ${addDays(now(), days).toISOString()},
                        ${pass ? sha256(normPerson(pass)) : null})`;
      await audit(me.email, "teamLink", "ok", ip,
        "squadra " + teamId + " · tetto " + maxUses + " · " + days + " giorni" +
        (pass ? " · con parola d'ordine" : ""));
      return res.status(200).json({ token, maxUses, days, hasPass: !!pass });
    }

    /* ── teamLinks: stato dei moduli aperti ──────────────────────────────
       Il token NON è qui e non può esserci: in tabella c'è solo il suo hash.
       Se il preparatore perde il link, ne genera un altro — e il vecchio si
       chiude da solo. È scomodo di proposito. */
    if (action === "teamLinks") {
      await ensureLinkSchema();
      const { rows } = await sql`
        SELECT team_id, team_name, max_uses, uses, expires_at, created_at,
               (pass_hash IS NOT NULL) AS has_pass
        FROM form_links
        WHERE coach_email = ${me.email} AND kind = 'team'
          AND closed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`;
      return res.status(200).json({ links: rows });
    }

    /* ── closeTeamLink: il preparatore chiude il modulo quando ha finito ── */
    if (action === "closeTeamLink") {
      await ensureLinkSchema();
      const teamId = String(body.teamId || "");
      if (!teamId) return res.status(400).json({ error: "Squadra mancante" });
      const r = await sql`UPDATE form_links SET closed_at = now()
                          WHERE coach_email = ${me.email} AND kind = 'team'
                            AND team_id = ${teamId} AND closed_at IS NULL`;
      await audit(me.email, "closeTeamLink", "ok", ip, "squadra " + teamId);
      return res.status(200).json({ ok: true, closed: r.rowCount || 0 });
    }

    /* ── export: art. 15 e 20 GDPR ── */
    if (action === "export") {
      const { rows } = await sql`SELECT payload, updated_at FROM payloads WHERE email = ${me.email}`;
      await audit(me.email, "export", "ok", ip);
      return res.status(200).json({
        email: me.email,
        exportedAt: now().toISOString(),
        updatedAt: rows[0]?.updated_at ?? null,
        data: rows[0]?.payload ?? null,
      });
    }

    /* ── erase: art. 17 GDPR, cancellazione reale ── */
    if (action === "erase") {
      if (String(body.confirm || "") !== me.email) {
        return res.status(400).json({ error: "Conferma non corrispondente" });
      }
      const pw = String(body.password || "");
      const { rows } = await sql`SELECT pw_hash FROM users WHERE email = ${me.email}`;
      if (!rows.length || !(await verifyPassword(pw, rows[0].pw_hash))) {
        await audit(me.email, "erase", "denied", ip);
        return res.status(401).json({ error: "Password errata" });
      }
      // Prima restavano fuori due tabelle, e non era un dettaglio:
      //  · password_resets — un link di recupero ancora valido, aperto DOPO la
      //    cancellazione, trovava la riga, aggiornava zero utenti senza che
      //    nessuno controllasse, e creava comunque una sessione buona: da li'
      //    il primo salvataggio ricreava i dati. L'account cancellato tornava.
      //  · form_links — contiene athlete_name, cioe' nome e cognome di atleti
      //    spesso minorenni, e l'endpoint pubblico formInfo continuava a
      //    restituirli a chiunque avesse il link.
      // Sei DELETE separati: se la funzione cade a meta' (timeout, connessione)
      // resta uno stato indeterminato — dati cancellati e account vivo, o il
      // contrario. Per un'operazione che devi poter DIMOSTRARE non va bene.
      const cl = await db.connect();
      try {
        await cl.query("BEGIN");
        await cl.query(`DELETE FROM payloads        WHERE email = $1`, [me.email]);
        await cl.query(`DELETE FROM sessions        WHERE email = $1`, [me.email]);
        await cl.query(`DELETE FROM password_resets WHERE email = $1`, [me.email]);
        await cl.query(`DELETE FROM form_links      WHERE coach_email = $1`, [me.email]);
        await cl.query(`DELETE FROM login_attempts  WHERE key = ANY($1)`,
                       [["email:" + me.email, "forgot:email:" + me.email]]);
        await cl.query(`DELETE FROM users           WHERE email = $1`, [me.email]);
        await cl.query("COMMIT");
      } catch (e) {
        try { await cl.query("ROLLBACK"); } catch (e2) {}
        throw e;
      } finally { cl.release(); }
      // Nel registro resta l'evento, non i dati: serve a provare la cancellazione.
      await audit(me.email, "erase", "ok", ip, "account e dati cancellati");
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Azione non valida" });

  } catch (e) {
    await audit(null, action || "?", "error", ip, e.message);
    // Nessun dettaglio interno verso il client.
    return res.status(500).json({ error: "Errore del server" });
  }
}
