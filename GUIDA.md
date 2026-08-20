# Guida passo passo

Scritta per essere seguita senza sapere niente di programmazione.
Non serve il terminale. Non serve scrivere comandi.

Obiettivo di questa guida: **portare il codice online in modo che ogni modifica
sia reversibile.** Nient'altro. Le funzioni nuove vengono dopo, e saranno facili
proprio perché avrai fatto questo.

Tempo: circa 30 minuti. Se qualcosa non torna, fermati e chiedi.

---

## Prima di tutto: la regola di sicurezza

**Non cancellare la cartella `Desktop\Iron Performance` finché non arrivi alla fine
del PASSO 6 e vedi che tutto funziona.** È la tua copia di riserva. Se qualcosa va
storto, quella cartella ti riporta esattamente a dove sei oggi.

---

## PASSO 1 — Scopri quale versione è online

Ci vogliono due minuti e toglie un dubbio che altrimenti torna sempre.

1. Apri **Chrome**.
2. Vai su `https://iron-performance.vercel.app/`
3. Clic destro su un punto vuoto della pagina → **Visualizza sorgente pagina**
   (in inglese: *View page source*).
4. Si apre una pagina piena di codice. Premi **Ctrl + F** (si apre una casella di ricerca).
5. Scrivi: `viewport-fit`

**Cosa vedi?**

- **Non trova niente** ("0 risultati", oppure nessuna evidenziazione)
  → Online c'è la versione vecchia. Il file sul tuo desktop è più recente.
  **Questo è il caso che ci aspettiamo. Vai avanti tranquillo.**

- **Lo trova** (una riga si evidenzia)
  → Fermati e scrivimelo. Vuol dire che online c'è qualcosa che non ho.
  Non andare avanti: rischieremmo di cancellare del lavoro.

---

## PASSO 2 — Estrai lo zip

1. Vai in `Desktop\Iron Performance`
2. Clic destro su `iron-performance.zip` → **Estrai tutto...**
3. Nella casella del percorso, cancella quello che c'è e scrivi:
   `C:\Users\feder\Desktop`
4. Clicca **Estrai**.

Ora sul Desktop hai **due** cartelle:

- `Iron Performance` ← la tua vecchia, non toccarla
- `iron-performance` ← quella nuova, ci lavoreremo qui

---

## PASSO 3 — Installa GitHub Desktop

GitHub Desktop è un programma con i pulsanti. Fa la stessa cosa dei comandi
da terminale, ma clicchi invece di scrivere.

1. Vai su **https://desktop.github.com**
2. Clicca **Download for Windows**
3. Apri il file scaricato e installa (avanti, avanti, fine)
4. All'apertura ti chiede di entrare con un account GitHub:
   - Se non ce l'hai, clicca **Create your free account** e registrati
     (email, nome utente, password — gratis)
   - Se ce l'hai, entra

---

## PASSO 4 — Metti la cartella dentro GitHub Desktop

1. In GitHub Desktop: menu **File** → **Add local repository...**
2. Clicca **Choose...** e seleziona la cartella `C:\Users\feder\Desktop\iron-performance`
3. Clicca **Add repository**

Dovresti vedere in alto a sinistra il nome `iron-performance`, e al centro la scritta
*"No local changes"* — significa che è tutto già salvato. È giusto così: il lavoro
fatto finora è già dentro.

**Se invece dice "This directory does not appear to be a Git repository"**, hai
selezionato la cartella sbagliata (probabilmente quella vecchia, con lo spazio nel nome).
Riprova scegliendo `iron-performance`, tutto minuscolo e con il trattino.

---

## PASSO 5 — Pubblica su GitHub

1. In alto trovi un pulsante blu **Publish repository**. Cliccalo.
2. Si apre una finestra:
   - **Name**: lascia `iron-performance`
   - **Keep this code private**: ✅ **deve essere spuntato.**
     Non è un dettaglio: nel repo ci finisce codice che gestisce dati sanitari.
3. Clicca **Publish repository**.

Aspetta qualche secondo. Da questo momento il tuo codice ha una storia:
ogni modifica futura sarà annullabile.

---

## PASSO 6 — Collega Vercel al repo

Da qui in poi, per mandare online una modifica basterà un clic.

1. Vai su **https://vercel.com** ed entra.
2. Trova il progetto **iron-performance** e aprilo.

   **Se non lo trovi:** in alto a sinistra c'è un selettore di account
   (il tuo nome / "Federico's projects"). Prova a cambiarlo: il progetto
   potrebbe stare sull'account personale invece che sul team. Se proprio non
   compare da nessuna parte, scrivimelo prima di andare avanti.

3. **Settings** (in alto) → **Git** (nel menu a sinistra)
4. Clicca **Connect Git Repository** → **GitHub** → autorizza se te lo chiede
5. Scegli `iron-performance` dalla lista

### Poi controlla le variabili d'ambiente

Sempre in **Settings** → **Environment Variables**. Devono esserci tutte queste:

| Nome | Cosa contiene |
|---|---|
| `POSTGRES_URL` | la mette Vercel da sola quando colleghi il database |
| `IP_SIGNUP_CODE` | il codice di invito per creare account |
| `IP_ALLOWED_ORIGIN` | `https://iron-performance.vercel.app` |
| `IP_APP_URL` | `https://iron-performance.vercel.app` |
| `RESEND_API_KEY` | la chiave di resend.com |
| `RESEND_FROM` | l'indirizzo da cui partono le email |

Se ce ne sono già, **non toccarle**. Se ne manca qualcuna, quella funzione
(es. il recupero password) semplicemente non funzionerà.

### Fai partire il deploy

**Deployments** (in alto) → sul deploy più recente clicca i tre puntini `...`
→ **Redeploy**.

Aspetta due minuti.

---

## PASSO 7 — Verifica che sia andata

Apri `https://iron-performance.vercel.app/` e controlla, in ordine:

- [ ] La pagina di login si apre
- [ ] Riesci a entrare con la tua email e password
- [ ] Vedi i tuoi atleti e i tuoi dati
- [ ] Il pallino di sincronizzazione in alto è verde (non rosso)
- [ ] Apri un atleta, controlla che l'anagrafica ci sia
- [ ] Menu → **Esporta backup**: scarica un file `.json` e conservalo

**Se qualcosa non va:** in GitHub Desktop, menu **Repository** → **History**.
Vedi tutte le versioni. Si torna indietro a qualsiasi punto. Niente è perso.

---

## Da qui in avanti: come funzionerà

Ogni volta che ti mando delle modifiche:

1. Sostituisci i file nella cartella `iron-performance`
2. Apri GitHub Desktop: vedrai in verde e rosso **esattamente cosa cambia**
3. Scrivi due parole nella casella in basso a sinistra (es. "correzioni sicurezza")
4. Clicca **Commit to main**, poi **Push origin** in alto
5. Vercel pubblica da solo in due minuti

E se una modifica ti crea problemi, torni indietro dalla **History**.
È tutto qui.

---

## Cosa NON devi fare

- ❌ Non modificare file direttamente dal sito di Vercel
- ❌ Non tenere due cartelle diverse in cui lavori
  (è così che sono nate le due versioni diverse di oggi)
- ❌ Non pubblicare il repo come pubblico
- ❌ Non mettere password o chiavi dentro i file del progetto:
  vanno solo nelle Environment Variables di Vercel

---

## Se ti blocchi

Scrivimi **a quale passo sei** e **cosa vedi sullo schermo** — anche solo
il testo dell'errore. Non provare a sistemare da solo tentando cose a caso:
è il modo più rapido per rompere qualcosa che adesso funziona.
