// /api/store  —  Backend privato di Iron Performance (Vercel Node runtime)
//
// Ogni account è una EMAIL con la SUA password personale.
// La password NON è salvata in chiaro: si conserva solo un hash (scrypt + salt).
// Il token Airtable vive solo qui, lato server.
//
// Variabili d'ambiente su Vercel:
//   AIRTABLE_TOKEN  -> Personal Access Token (read + write su 1 base)
//   AIRTABLE_BASE   -> id base (app...)
//   AIRTABLE_TABLE  -> id tabella (tbl...)
//   RECOVERY_KEY    -> chiave segreta per recuperare una password dimenticata
//                      (scegline una lunga e casuale; conoscila solo tu)
//   FORM_SECRET     -> chiave segreta per firmare i link anamnesi (lunga e casuale)
//                      Serve per la funzione "manda l'anamnesi da compilare".
//   (IP_PASSWORD non serve più: puoi eliminarla)
//
// La tabella Airtable deve avere TRE colonne: "Email" (testo), "Pass" (testo), "Data" (testo lungo).

import crypto from "crypto";

function hashWith(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString("hex");
}
function makeHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + hashWith(password, salt);
}
function verifyPw(password, stored) {
  if (!stored || stored.indexOf(":") < 0) return false;
  const [salt, hash] = stored.split(":");
  const test = hashWith(password, salt);
  const a = Buffer.from(test, "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Token firmato per il modulo anamnesi (HMAC, senza database) ──
// Contiene: e=email coach, a=id atleta, n=nome atleta, x=scadenza (ms).
function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlDecode(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); return Buffer.from(s, "base64").toString("utf8"); }
function signForm(obj, secret) {
  const p = b64url(JSON.stringify(obj));
  const sig = b64url(crypto.createHmac("sha256", secret).update(p).digest());
  return p + "." + sig;
}
function verifyForm(token, secret) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [p, sig] = token.split(".");
  const expect = b64url(crypto.createHmac("sha256", secret).update(p).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let o; try { o = JSON.parse(b64urlDecode(p)); } catch (e) { return null; }
  if (!o || !o.x || Date.now() > o.x) return null; // scaduto o malformato
  return o;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE  = process.env.AIRTABLE_BASE;
  const TABLE = process.env.AIRTABLE_TABLE;
  if (!TOKEN || !BASE || !TABLE) return res.status(500).json({ error: "Backend non configurato (env mancanti)" });

  const { action, email, password, newPassword, data, recoveryKey } = req.body || {};

  // Il reset NON richiede la vecchia password: serve la chiave di recupero.
  // Le azioni pubbliche del modulo anamnesi non usano email/password: usano un token firmato.
  const isReset = action === "reset";
  const isPublicForm = action === "formInfo" || action === "formSubmit";
  if (!isPublicForm) {
    if (!email) return res.status(400).json({ error: "Email obbligatoria" });
    if (!isReset) {
      if (!password) return res.status(400).json({ error: "Email e password obbligatorie" });
      if (String(password).length < 4) return res.status(400).json({ error: "Password troppo corta (min 4 caratteri)" });
    }
  }

  const em = isPublicForm ? "" : String(email).trim().toLowerCase();
  const url = "https://api.airtable.com/v0/" + BASE + "/" + TABLE;
  const headers = { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" };
  const findUrl = url + "?filterByFormula=" + encodeURIComponent("LOWER({Email})='" + em + "'") + "&maxRecords=1";

  async function findRecord() {
    const r = await fetch(findUrl, { headers });
    const j = await r.json();
    if (!r.ok) { const e = new Error((j.error && j.error.message) || "Errore Airtable"); e.http = r.status; throw e; }
    return (j.records && j.records[0]) || null;
  }
  function parseData(rec) { try { return JSON.parse(rec.fields.Data || "null"); } catch (e) { return null; } }

  try {
    // ── LOGIN / REGISTRAZIONE ──
    if (action === "login" || action === "load") {
      const rec = await findRecord();
      if (!rec) {
        // primo accesso con questa email → crea lo spazio personale
        const fields = { Email: em, Pass: makeHash(password), Data: "{}" };
        const rr = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields }) });
        const jj = await rr.json();
        if (!rr.ok) return res.status(rr.status).json({ error: (jj.error && jj.error.message) || "Errore creazione account" });
        return res.status(200).json({ data: null, created: true });
      }
      if (!rec.fields.Pass) {
        // record vecchio senza password → la imposti adesso (claim)
        await fetch(url + "/" + rec.id, { method: "PATCH", headers, body: JSON.stringify({ fields: { Pass: makeHash(password) } }) });
        return res.status(200).json({ data: parseData(rec), claimed: true });
      }
      if (!verifyPw(password, rec.fields.Pass)) return res.status(401).json({ error: "Email o password errate" });
      return res.status(200).json({ data: parseData(rec) });
    }

    // ── SALVATAGGIO ──
    if (action === "save") {
      const rec = await findRecord();
      if (!rec) return res.status(401).json({ error: "Account non trovato, rientra" });
      if (rec.fields.Pass && !verifyPw(password, rec.fields.Pass)) return res.status(401).json({ error: "Password errata" });
      const rr = await fetch(url + "/" + rec.id, { method: "PATCH", headers, body: JSON.stringify({ fields: { Data: JSON.stringify(data || {}) } }) });
      const jj = await rr.json();
      if (!rr.ok) return res.status(rr.status).json({ error: (jj.error && jj.error.message) || "Errore salvataggio" });
      return res.status(200).json({ ok: true });
    }

    // ── CAMBIO PASSWORD ──
    if (action === "changepass") {
      if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: "Nuova password troppo corta (min 4)" });
      const rec = await findRecord();
      if (!rec) return res.status(401).json({ error: "Account non trovato" });
      if (rec.fields.Pass && !verifyPw(password, rec.fields.Pass)) return res.status(401).json({ error: "Password attuale errata" });
      await fetch(url + "/" + rec.id, { method: "PATCH", headers, body: JSON.stringify({ fields: { Pass: makeHash(newPassword) } }) });
      return res.status(200).json({ ok: true });
    }

    // ── RECUPERO PASSWORD (chiave di recupero) ──
    // Non richiede la vecchia password. I DATI NON VENGONO TOCCATI:
    // sono legati all'email, non alla password.
    if (action === "reset") {
      const KEY = process.env.RECOVERY_KEY;
      if (!KEY) return res.status(500).json({ error: "Recupero non configurato: manca RECOVERY_KEY su Vercel" });
      if (!recoveryKey) return res.status(400).json({ error: "Chiave di recupero obbligatoria" });
      // confronto a tempo costante (evita di 'indovinare' la chiave misurando i tempi)
      const a = Buffer.from(String(recoveryKey));
      const b = Buffer.from(String(KEY));
      const okKey = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!okKey) {
        await new Promise(r => setTimeout(r, 1000)); // rallenta i tentativi a forza bruta
        return res.status(401).json({ error: "Chiave di recupero errata" });
      }
      if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: "Nuova password troppo corta (min 4)" });
      const rec = await findRecord();
      if (!rec) return res.status(404).json({ error: "Nessun account con questa email" });
      const rr = await fetch(url + "/" + rec.id, { method: "PATCH", headers, body: JSON.stringify({ fields: { Pass: makeHash(newPassword) } }) });
      const jj = await rr.json();
      if (!rr.ok) return res.status(rr.status).json({ error: (jj.error && jj.error.message) || "Errore reset" });
      return res.status(200).json({ ok: true });
    }

    // ── LINK ANAMNESI: genera un token firmato per un'atleta (richiede login coach) ──
    if (action === "formLink") {
      const SECRET = process.env.FORM_SECRET;
      if (!SECRET) return res.status(500).json({ error: "Link anamnesi non configurato: manca FORM_SECRET su Vercel" });
      const rec = await findRecord();
      if (!rec) return res.status(401).json({ error: "Account non trovato, rientra" });
      if (rec.fields.Pass && !verifyPw(password, rec.fields.Pass)) return res.status(401).json({ error: "Password errata" });
      const aid = req.body.athleteId, an = req.body.athleteName || "";
      if (!aid) return res.status(400).json({ error: "athleteId mancante" });
      const days = 21;
      const token = signForm({ e: em, a: String(aid), n: String(an).slice(0, 80), x: Date.now() + days * 86400000 }, SECRET);
      return res.status(200).json({ token, expiresDays: days });
    }

    // ── MODULO ANAMNESI (pubblico, a token): info per mostrare il form ──
    if (action === "formInfo") {
      const SECRET = process.env.FORM_SECRET;
      if (!SECRET) return res.status(500).json({ error: "Modulo non configurato" });
      const t = verifyForm(req.body.token, SECRET);
      if (!t) return res.status(401).json({ error: "Link non valido o scaduto" });
      return res.status(200).json({ athleteName: t.n || "" });
    }

    // ── MODULO ANAMNESI (pubblico, a token): invio dati ──
    // Scrive SOLO il profilo dell'atleta indicato dal token. Nient'altro viene toccato.
    if (action === "formSubmit") {
      const SECRET = process.env.FORM_SECRET;
      if (!SECRET) return res.status(500).json({ error: "Modulo non configurato" });
      const t = verifyForm(req.body.token, SECRET);
      if (!t) return res.status(401).json({ error: "Link non valido o scaduto" });
      const profile = req.body.profile;
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return res.status(400).json({ error: "Dati non validi" });
      if (JSON.stringify(profile).length > 20000) return res.status(413).json({ error: "Dati troppo grandi" });
      const cem = String(t.e).toLowerCase();
      const fUrl = url + "?filterByFormula=" + encodeURIComponent("LOWER({Email})='" + cem + "'") + "&maxRecords=1";
      const fr = await fetch(fUrl, { headers });
      const fj = await fr.json();
      if (!fr.ok) return res.status(502).json({ error: "Errore Airtable" });
      const rec = (fj.records && fj.records[0]) || null;
      if (!rec) return res.status(404).json({ error: "Account non trovato" });
      let store; try { store = JSON.parse(rec.fields.Data || "{}"); } catch (e) { store = {}; }
      if (!store || !Array.isArray(store.athletes)) return res.status(409).json({ error: "Dati non pronti: chiedi al coach di aprire l'app una volta" });
      const ath = store.athletes.find(x => String(x.id) === String(t.a));
      if (!ath) return res.status(404).json({ error: "Scheda non trovata (forse rimossa dal coach)" });
      // merge del solo profilo di QUESTO atleta
      ath.profile = Object.assign({}, ath.profile || {}, profile);
      ath.profile._submittedAt = new Date().toISOString().slice(0, 10);
      const rr = await fetch(url + "/" + rec.id, { method: "PATCH", headers, body: JSON.stringify({ fields: { Data: JSON.stringify(store) } }) });
      const jj = await rr.json();
      if (!rr.ok) return res.status(rr.status).json({ error: (jj.error && jj.error.message) || "Errore salvataggio" });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Azione non valida" });
  } catch (e) {
    return res.status(e.http || 502).json({ error: "Errore: " + e.message });
  }
}
