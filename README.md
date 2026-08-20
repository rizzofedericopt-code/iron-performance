# Iron Performance

PWA per il monitoraggio dei test di squadra nel tempo. Frontend statico + una singola API serverless su Vercel, database Postgres.

---

## Struttura

```
index.html        l'intera applicazione (HTML + CSS + JS inline)
api/store.js      l'unica API. Un endpoint POST, azione nel body
schema.sql        schema del database. Da lanciare una volta
sw.js             service worker (shell offline)
manifest.json     manifest PWA
icons/            icone dell'app
vercel.json       header di sicurezza
.env.example      elenco delle variabili d'ambiente richieste
```

**`api/store.js` deve stare in `api/`.** A root non viene eseguito da Vercel: la
cartella `api/` è ciò che trasforma il file in una serverless function.

---

## Primo avvio

1. **Database.** Crea un Postgres (Vercel → Storage) e collegalo al progetto.
   Vercel imposta `POSTGRES_URL` da solo.
2. **Schema.** Lancia `schema.sql` nella console SQL del database. È idempotente:
   si può rilanciare senza rompere nulla.
3. **Variabili d'ambiente.** Copia le chiavi da `.env.example` in
   Vercel → Settings → Environment Variables.
4. **Email.** Verifica il dominio su [resend.com/domains](https://resend.com/domains).
   Finché non lo fai, Resend consegna solo all'indirizzo con cui ti sei registrato lì:
   il recupero password funzionerà solo per te.
5. **Deploy.** Collega il repo a Vercel. Da qui in poi ogni `git push` è un deploy.

### Sviluppo locale

```bash
npm install
npx vercel dev
```

---

## Come funziona

- **Un utente = un blob JSON.** Tutto lo stato (atleti, misure, anamnesi, readiness,
  carichi, screening, curve carico-velocità) sta in una riga della tabella `payloads`,
  colonna `jsonb`. Ogni salvataggio riscrive tutto.
- **Concorrenza ottimistica.** Il client dichiara su quale versione ha lavorato
  (`baseVersion`). Se il server è più avanti risponde 409 e il client fa il merge.
- **Offline.** Lo stato vive anche in `localStorage`. Senza rete l'app continua a
  funzionare e la coda di salvataggio si svuota al ritorno della connessione.
- **Identità.** Sempre dal token di sessione nell'header `Authorization`, mai dal
  corpo della richiesta. È l'invariante che regge tutta la sicurezza dell'API:
  non va mai infranta.

### Limiti noti dell'architettura

Il modello a blob JSON è una scelta consapevole per arrivare in produzione in fretta,
ma non consente: query sui dati, un secondo preparatore sugli stessi atleti, un accesso
in sola lettura per l'atleta o il medico, analisi aggregate. Il giorno in cui serve una
di queste cose, il backend si riscrive con un modello relazionale.

---

## Dati sanitari e minori

L'app tratta dati dell'art. 9 GDPR (salute) riferiti anche a minori.

Il codice mette in condizione di essere conformi; **non rende conformi da soli.**
Servono, fuori dal codice: informativa, consenso genitoriale tracciato e verificabile,
nomina del responsabile del trattamento (Vercel/Neon), registro dei trattamenti,
e una politica di conservazione dichiarata per `audit_log`.

Da tenere presente:

- I dati sono in `localStorage` **in chiaro**. Il blocco schermo a 15 minuti è
  riservatezza visiva, non cifratura: chi ha accesso fisico al dispositivo sbloccato
  può leggerli.
- Dopo `erase` l'email resta in `audit_log` come prova della cancellazione.
  È una scelta difendibile, ma va dichiarata nell'informativa.
- Le tabelle non si potano da sole. Vedi la sezione MANUTENZIONE di `schema.sql`.

---

## Stato del lavoro

Vedi `ROADMAP.md` per i bug aperti, le correzioni in corso e le funzioni pianificate.
