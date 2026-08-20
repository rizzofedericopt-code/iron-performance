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
const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
const RESET_MINUTES = 30;          // finestra di validità del link
const RESET_MAX_PER_HOUR = 3;      // richieste "forgot" per email/IP
const FORM_LINK_HOURS = 48;        // scadenza del link anamnesi
const FORM_MAX_PER_HOUR = 20;      // tentativi di lettura/invio pubblici, per IP
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

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

function clientIp(req) {
  const f = req.headers["x-forwarded-for"];
  return (Array.isArray(f) ? f[0] : String(f || "")).split(",")[0].trim() || "unknown";
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
      locked_until = CASE WHEN login_attempts.fails + 1 >= ${MAX_FAILS}
                          THEN ${lock.toISOString()}::timestamptz ELSE NULL END`;
}

const clearFails = (key) => sql`DELETE FROM login_attempts WHERE key = ${key}`;

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

  try {
    /* ── signup ── */
    if (action === "signup") {
      const email = normEmail(body.email);
      const pw = String(body.password || "");
      if (String(body.code || "") !== process.env.IP_SIGNUP_CODE) {
        await audit(email, "signup", "denied", ip, "codice invito errato");
        return res.status(403).json({ error: "Codice di invito non valido" });
      }
      if (!validEmail(email)) return res.status(400).json({ error: "Email non valida" });
      if (pw.length < MIN_PW) {
        return res.status(400).json({ error: `Password troppo corta (minimo ${MIN_PW} caratteri)` });
      }
      const exists = await sql`SELECT 1 FROM users WHERE email = ${email}`;
      if (exists.rows.length) return res.status(409).json({ error: "Account già esistente" });

      await sql`INSERT INTO users (email, pw_hash) VALUES (${email}, ${await hashPassword(pw)})`;
      await sql`INSERT INTO payloads (email, payload, bytes) VALUES (${email}, '{}'::jsonb, 2)`;
      const token = await createSession(email, req.headers["user-agent"]);
      await audit(email, "signup", "ok", ip);
      return res.status(200).json({ token, email, expiresInDays: SESSION_DAYS });
    }

    /* ── login ── */
    if (action === "login") {
      const email = normEmail(body.email);
      const pw = String(body.password || "");
      const kE = "email:" + email, kI = "ip:" + ip;

      if (await isLocked(kE) || await isLocked(kI)) {
        await audit(email, "login", "denied", ip, "bloccato");
        return res.status(429).json({ error: `Troppi tentativi. Riprova tra ${LOCK_MINUTES} minuti.` });
      }

      const { rows } = await sql`SELECT pw_hash FROM users WHERE email = ${email}`;
      // Se l'utente non esiste verifichiamo comunque un hash fittizio,
      // così il tempo di risposta non rivela quali email sono registrate.
      const stored = rows[0]?.pw_hash || (await hashPassword(crypto.randomUUID()));
      const ok = rows.length ? await verifyPassword(pw, stored) : false;

      if (!ok) {
        await noteFail(kE); await noteFail(kI);
        await audit(email, "login", "denied", ip);
        return res.status(401).json({ error: "Email o password non corretti" });
      }
      await clearFails(kE); await clearFails(kI);
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
      await sql`UPDATE users SET pw_hash = ${await hashPassword(newPw)}, pw_changed_at = now()
                WHERE email = ${email}`;
      await sql`DELETE FROM password_resets WHERE email = ${email}`;   // token monouso
      await sql`DELETE FROM sessions WHERE email = ${email}`;          // tutte le sessioni cadono
      await clearFails("email:" + email); await clearFails("ip:" + ip);
      const newToken = await createSession(email, req.headers["user-agent"]);
      await audit(email, "reset_confirm", "ok", ip);
      return res.status(200).json({ ok: true, token: newToken, email, expiresInDays: SESSION_DAYS });
    }

    /* ── formInfo: mostra il nome atleta al titolare del link (pubblico, no login) ── */
    if (action === "formInfo") {
      const token = String(body.token || "");
      const kI = "form:ip:" + ip;
      if (!(await underLimit(kI, FORM_MAX_PER_HOUR))) {
        return res.status(429).json({ error: "Troppi tentativi. Riprova più tardi." });
      }
      if (!token) return res.status(400).json({ error: "Link non valido" });
      await noteFail(kI);
      const { rows } = await sql`
        SELECT coach_email, athlete_name, used_at FROM form_links
        WHERE token_hash = ${sha256(token)} AND expires_at > now()`;
      if (!rows.length) return res.status(401).json({ error: "Il link è scaduto o non è più valido." });
      if (rows[0].used_at) return res.status(410).json({ error: "Questa scheda è già stata inviata. Chiedi un nuovo link al tuo preparatore." });

      // L'informativa viaggia insieme al modulo: chi compila deve poterla
      // leggere PRIMA di acconsentire, non dopo e non altrove. Senza questo,
      // la casella "ho letto l'informativa" è una dichiarazione su un
      // documento che non esiste — cioè un consenso che non prova nulla.
      const pol = await sql`SELECT payload -> 'policy' AS policy FROM payloads WHERE email = ${rows[0].coach_email}`;
      return res.status(200).json({
        athleteName: rows[0].athlete_name,
        policy: pol.rows[0]?.policy ?? null,
      });
    }

    /* ── formSubmit: consuma il link e scrive SOLO il profilo di quell'atleta ── */
    if (action === "formSubmit") {
      const token = String(body.token || "");
      const kI = "form:ip:" + ip;
      if (!(await underLimit(kI, FORM_MAX_PER_HOUR))) {
        return res.status(429).json({ error: "Troppi tentativi. Riprova più tardi." });
      }
      if (!token) return res.status(400).json({ error: "Link non valido" });
      await noteFail(kI);

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

      // Il link e il suo consumo stanno nella STESSA transazione del salvataggio:
      // due invii arrivati insieme non possono passare entrambi (FOR UPDATE blocca
      // il secondo finché il primo non ha finito, e a quel punto trova used_at valorizzato).
      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const linkQ = await client.query(
          `SELECT coach_email, athlete_id, expires_at, used_at FROM form_links
           WHERE token_hash = $1 FOR UPDATE`, [sha256(token)]);
        const link = linkQ.rows[0];
        if (!link || new Date(link.expires_at) <= now()) {
          await client.query("ROLLBACK");
          await audit(null, "formSubmit", "denied", ip, "link scaduto o inesistente");
          return res.status(401).json({ error: "Il link è scaduto o non è più valido." });
        }
        if (link.used_at) {
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
        const ath = store.athletes.find(a => String(a.id) === String(link.athlete_id));
        if (!ath) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Scheda non trovata: forse è stata rimossa." });
        }

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

        const consentBy = consentRole === "guardian"
          ? "Chi esercita la responsabilità genitoriale"
          : "L'atleta (maggiorenne)";

        // merge del solo profilo di QUESTO atleta — non tocca il resto dei dati
        ath.profile = Object.assign({}, ath.profile || {}, profile, {
          consent: true,
          consentBy,
          consentName: consentName || null,
          consentRole,
          consentDate: now().toISOString().slice(0, 10),
          consentAt: now().toISOString(),
          consentDoc: "v" + policy.version + (policy.updatedAt ? " del " + policy.updatedAt : ""),
          consentPolicyVersion: Number(policy.version),
        });

        const payloadStr = JSON.stringify(store);
        const nextV = Number(prow.version || 0) + 1;
        await client.query(
          `UPDATE payloads SET payload=$1::jsonb, version=$2, updated_at=now(), bytes=$3 WHERE email=$4`,
          [payloadStr, nextV, Buffer.byteLength(payloadStr, "utf8"), link.coach_email]);
        await client.query(`UPDATE form_links SET used_at = now() WHERE token_hash = $1`, [sha256(token)]);

        await client.query("COMMIT");
        // Il registro accessi è l'unica traccia in sola aggiunta che abbiamo:
        // se un domani qualcuno chiede "chi ha autorizzato e su cosa", la
        // risposta sta qui e non dentro un JSON che nel frattempo è cambiato.
        await audit(link.coach_email, "formSubmit", "ok", ip,
          "atleta " + link.athlete_id + " · consenso: " + consentBy +
          (consentName ? " (" + consentName + ")" : "") +
          " · informativa v" + policy.version);
        return res.status(200).json({ ok: true });
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (e2) {}
        throw e;
      } finally {
        client.release();
      }
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
        await noteFail("email:" + me.email);
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
      await sql`DELETE FROM payloads WHERE email = ${me.email}`;
      await sql`DELETE FROM sessions WHERE email = ${me.email}`;
      await sql`DELETE FROM users    WHERE email = ${me.email}`;
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
