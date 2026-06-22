// /api/store  —  Backend privato di Iron Performance (Vercel Node runtime)
//
// - Il token Airtable vive SOLO qui, come variabile d'ambiente lato server.
// - L'accesso è protetto da una password (IP_PASSWORD): senza quella,
//   nessuno può leggere o scrivere i dati. Così li vedi solo tu.
//
// Variabili d'ambiente da impostare nel pannello Vercel:
//   AIRTABLE_TOKEN  -> Personal Access Token Airtable (scope read+write su 1 base)
//   AIRTABLE_BASE   -> es. applXXXXXXXXXXXXX
//   AIRTABLE_TABLE  -> id della tabella Iron Performance (es. tblXXXXXXXXXXXXX)
//   IP_PASSWORD     -> la password che scegli tu per entrare nell'app
//
// La tabella Airtable deve avere due colonne: "Email" (testo) e "Data" (testo lungo).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non permesso" });
  }

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE  = process.env.AIRTABLE_BASE;
  const TABLE = process.env.AIRTABLE_TABLE;
  const PW    = process.env.IP_PASSWORD;
  if (!TOKEN || !BASE || !TABLE || !PW) {
    return res.status(500).json({ error: "Backend non configurato (env mancanti)" });
  }

  const body = req.body || {};
  const { action, email, password, data } = body;

  // ── lucchetto ──
  if (!password || password !== PW) {
    return res.status(401).json({ error: "Password errata" });
  }
  if (!email) {
    return res.status(400).json({ error: "Email mancante" });
  }

  const em = String(email).trim().toLowerCase();
  const url = "https://api.airtable.com/v0/" + BASE + "/" + TABLE;
  const headers = { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" };
  const findUrl = url + "?filterByFormula=" + encodeURIComponent("LOWER({Email})='" + em + "'") + "&maxRecords=1";

  try {
    if (action === "load") {
      const r = await fetch(findUrl, { headers });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (j.error && j.error.message) || "Errore Airtable" });
      if (!j.records || !j.records.length) return res.status(200).json({ data: null });
      let d = null;
      try { d = JSON.parse(j.records[0].fields.Data || "null"); } catch (e) { d = null; }
      return res.status(200).json({ data: d });
    }

    if (action === "save") {
      const r = await fetch(findUrl, { headers });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (j.error && j.error.message) || "Errore Airtable" });
      const fields = { Email: em, Data: JSON.stringify(data || {}) };
      let rr;
      if (j.records && j.records.length) {
        rr = await fetch(url + "/" + j.records[0].id, { method: "PATCH", headers, body: JSON.stringify({ fields }) });
      } else {
        rr = await fetch(url, { method: "POST", headers, body: JSON.stringify({ fields }) });
      }
      const jj = await rr.json();
      if (!rr.ok) return res.status(rr.status).json({ error: (jj.error && jj.error.message) || "Errore salvataggio" });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Azione non valida" });
  } catch (e) {
    return res.status(502).json({ error: "Errore upstream: " + e.message });
  }
}
