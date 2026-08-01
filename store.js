// /api/store — Iron Performance
// Backend riscritto: account reali, hash scrypt, token di sessione,
// rate limiting, concorrenza ottimistica, cancellazione e registro accessi.
//
// Env richieste (pannello Vercel):
//   POSTGRES_URL          -> fornita da Vercel Postgres / Neon
//   IP_SIGNUP_CODE        -> codice di invito per creare un account
//   IP_ALLOWED_ORIGIN     -> es. https://ironperformance.vercel.app
//
// Prima esecuzione: lancia schema.sql nella console del database.
//
// NOTA IMPORTANTE
// Questo endpoint tratta dati di cui all'art. 9 GDPR (salute), riferiti
// anche a minori. Prima di metterlo in produzione servono: informativa,
// consenso genitoriale tracciato, nomina del responsabile (Vercel/Neon)
// e registro dei trattamenti. Il codice ti mette in condizione di essere
// conforme; non ti rende conforme da solo.

import { sql } from "@vercel/postgres";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

/* ─────────────── Parametri ─────────────── */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const MIN_PW = 12;                 // 4 caratteri erano indifendibili
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;

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

      const base = Number(body.baseVersion);
      const cur = await sql`SELECT version FROM payloads WHERE email = ${me.email}`;
      const curV = cur.rows.length ? Number(cur.rows[0].version) : 0;

      // Il client dice su quale versione ha lavorato. Se nel frattempo un
      // altro dispositivo ha salvato, non sovrascriviamo: restituiamo 409
      // con lo stato attuale e lasciamo che il client faccia il merge.
      if (Number.isFinite(base) && base !== curV) {
        const srv = await sql`SELECT payload, version FROM payloads WHERE email = ${me.email}`;
        await audit(me.email, "save", "denied", ip, `conflitto ${base}!=${curV}`);
        return res.status(409).json({
          error: "Conflitto di versione",
          serverData: srv.rows[0]?.payload ?? null,
          version: curV,
        });
      }

      const next = curV + 1;
      await sql`
        INSERT INTO payloads (email, payload, version, updated_at, bytes)
        VALUES (${me.email}, ${JSON.stringify(data)}::jsonb, ${next}, now(), ${bytes})
        ON CONFLICT (email) DO UPDATE
          SET payload = EXCLUDED.payload, version = EXCLUDED.version,
              updated_at = now(), bytes = EXCLUDED.bytes`;
      await audit(me.email, "save", "ok", ip, `v${next} · ${bytes}B`);
      return res.status(200).json({ ok: true, version: next });
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
