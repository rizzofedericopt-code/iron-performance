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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non permesso" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE  = process.env.AIRTABLE_BASE;
  const TABLE = process.env.AIRTABLE_TABLE;
  if (!TOKEN || !BASE || !TABLE) return res.status(500).json({ error: "Backend non configurato (env mancanti)" });

  const { action, email, password, newPassword, data } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email e password obbligatorie" });
  if (String(password).length < 4) return res.status(400).json({ error: "Password troppo corta (min 4 caratteri)" });

  const em = String(email).trim().toLowerCase();
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

    return res.status(400).json({ error: "Azione non valida" });
  } catch (e) {
    return res.status(e.http || 502).json({ error: "Errore: " + e.message });
  }
}
