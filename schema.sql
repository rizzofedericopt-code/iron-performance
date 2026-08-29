-- Iron Performance — schema del database
-- Ricostruito dalle query di api/store.js (il file citato nei commenti non esisteva).
-- Idempotente: si può rilanciare su un database già popolato senza rompere nulla.
--
-- Esecuzione: console SQL di Vercel Postgres / Neon, oppure
--   psql "$POSTGRES_URL" -f schema.sql

/* ─────────────── Account ─────────────── */
CREATE TABLE IF NOT EXISTS users (
  email          text PRIMARY KEY,
  pw_hash        text        NOT NULL,
  pw_changed_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

/* ─────────────── Dati dell'utente ───────────────
   Un solo blob JSON per coach. Scelta consapevole: veloce da costruire,
   ma non interrogabile e non condivisibile fra utenti. Vedi README. */
CREATE TABLE IF NOT EXISTS payloads (
  email       text PRIMARY KEY,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version     integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  bytes       integer     NOT NULL DEFAULT 2
);

/* ─────────────── Sessioni ───────────────
   Si conserva solo lo SHA-256 del token: chi legge il database
   non può usare le sessioni degli utenti. */
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  email       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS sessions_email_idx      ON sessions (email);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

/* ─────────────── Rate limiting ───────────────
   Una riga per chiave. Le chiavi sono namespacizzate:
     email:<addr>  ip:<addr>  forgot:email:<addr>  forgot:ip:<addr>  form:ip:<addr> */
CREATE TABLE IF NOT EXISTS login_attempts (
  key           text PRIMARY KEY,
  fails         integer     NOT NULL DEFAULT 0,
  first_fail    timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz
);
CREATE INDEX IF NOT EXISTS login_attempts_first_fail_idx ON login_attempts (first_fail);

/* ─────────────── Recupero password ───────────────
   Un solo link attivo per email (il codice cancella i precedenti). */
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text PRIMARY KEY,
  email       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_email_idx      ON password_resets (email);
CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx ON password_resets (expires_at);

/* ─────────────── Link anamnesi ───────────────
   Due tipi, distinti da kind:

     'athlete'  link personale monouso, generato per un atleta già in rosa.
                used_at valorizzato = consumato, non più riutilizzabile.

     'single'   —  (riservato)

     'team'     link di squadra, riutilizzabile: ogni atleta lo apre e crea
                da sé la propria scheda. Non si consuma al primo invio, si
                conta (uses) e si ferma al tetto (max_uses) o alla chiusura
                manuale (closed_at). athlete_id resta vuoto: l'atleta non
                esiste ancora nel momento in cui il link viene generato.

   pass_hash è lo sha256 di una parola d'ordine facoltativa: serve a rendere
   inutile un link inoltrato fuori dalla squadra. NULL = nessuna parola. */
CREATE TABLE IF NOT EXISTS form_links (
  token_hash    text PRIMARY KEY,
  coach_email   text        NOT NULL,
  athlete_id    text        NOT NULL,
  athlete_name  text,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS form_links_coach_idx      ON form_links (coach_email);
CREATE INDEX IF NOT EXISTS form_links_expires_at_idx ON form_links (expires_at);

/* Aggiunte per i link di squadra. Sono ALTER separate e idempotenti: su un
   database già in uso si lanciano così com'è, senza toccare i link esistenti,
   che restano 'athlete' per via del DEFAULT.
   athlete_id perde NOT NULL perché un link di squadra non ha un atleta. */
ALTER TABLE form_links ALTER COLUMN athlete_id DROP NOT NULL;
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'athlete';
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS team_id   text;
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS team_name text;
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS max_uses  integer;
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS uses      integer NOT NULL DEFAULT 0;
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS pass_hash text;

/* ─────────────── Registro accessi ───────────────
   Serve a dimostrare cosa è successo (art. 5.2 e 17 GDPR).
   ATTENZIONE: contiene email e IP, cioè dati personali. Va citato
   nell'informativa e va potato — vedi la sezione MANUTENZIONE in fondo. */
CREATE TABLE IF NOT EXISTS audit_log (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  email    text,
  action   text NOT NULL,
  outcome  text NOT NULL,
  ip       text,
  detail   text
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx    ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_email_idx ON audit_log (email, at DESC);


/* ═══════════════════════════════════════════════════════════════════
   MANUTENZIONE — da lanciare periodicamente.
   Nessuna di queste tabelle si pota da sola: senza questo, crescono
   per sempre. audit_log cresce di una riga per ogni salvataggio.
   ═══════════════════════════════════════════════════════════════════ */

-- Sessioni scadute
--   DELETE FROM sessions        WHERE expires_at < now();
-- Link di reset scaduti
--   DELETE FROM password_resets WHERE expires_at < now();
-- Link anamnesi scaduti o già usati da più di 30 giorni
--   DELETE FROM form_links      WHERE expires_at < now() - interval '30 days'
--                                  OR (used_at IS NOT NULL AND used_at < now() - interval '30 days')
--                                  OR (closed_at IS NOT NULL AND closed_at < now() - interval '30 days');
-- Contatori di rate limiting ormai freddi
--   DELETE FROM login_attempts  WHERE first_fail < now() - interval '1 day'
--                                AND (locked_until IS NULL OR locked_until < now());
-- Registro accessi oltre la conservazione dichiarata nell'informativa (esempio: 12 mesi)
--   DELETE FROM audit_log       WHERE at < now() - interval '12 months';
