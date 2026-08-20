# Trasloco da Airtable a Postgres

L'app che è online e quella nuova usano **due database diversi**. Non è un
aggiornamento, è un trasferimento. Per questo l'ordine dei passi non è
negoziabile.

## ⚠️ La regola

**Non fare "Push origin" finché non hai finito il PASSO 3.**

Vercel pubblica da solo appena ricevi un push. Se il codice nuovo arriva
online prima che il database esista, il sito smette di funzionare: si apre,
ma non riesci più a entrare.

I file sul tuo computer sono già pronti. Restano lì, buoni, finché non dici tu.

---

## PASSO 1 — Crea il database

1. Vai su **https://vercel.com** ed entra
2. Apri il progetto **iron-performance**
3. In alto clicca **Storage**
4. **Create Database** → scegli **Neon** (Postgres) → **Continue**
5. Nome: `iron-performance-db` · Regione: **Frankfurt** (la più vicina)
6. **Create**
7. Alla richiesta **Connect to Project**, scegli `iron-performance` e conferma

Vercel aggiunge da sola la variabile `POSTGRES_URL`. Non devi copiarla.

## PASSO 2 — Crea le tabelle

Il database adesso esiste ma è vuoto: non ha nemmeno le "caselle" dove
mettere le cose.

1. Sempre in **Storage**, apri il database appena creato
2. Cerca la scheda **Query** (oppure "SQL Editor" / "Open in Neon")
3. Apri il file **`schema.sql`** dalla cartella del progetto con il Blocco note
4. Selezionalo tutto (Ctrl+A), copialo (Ctrl+C)
5. Incollalo nella casella della query e clicca **Run**

Deve dire che è andato a buon fine. Se dice `already exists`, va bene lo stesso:
vuol dire che quella tabella c'era già.

## PASSO 3 — Le chiavi

Progetto → **Settings** → **Environment Variables**. Aggiungi queste, una per una,
lasciando spuntati tutti e tre gli ambienti (Production, Preview, Development):

| Nome | Valore |
|---|---|
| `IP_SIGNUP_CODE` | inventane uno lungo, es. `iron-2026-solo-io-xK9wq` |
| `IP_ALLOWED_ORIGIN` | `https://iron-performance.vercel.app` |
| `IP_APP_URL` | `https://iron-performance.vercel.app` |

**Segnati `IP_SIGNUP_CODE` da qualche parte.** Ti serve fra due minuti per creare
il tuo account, e senza quello nessuno può registrarsi — te compreso.

Le vecchie variabili (`AIRTABLE_TOKEN`, `RECOVERY_KEY`, `FORM_SECRET`...) puoi
lasciarle dove sono: il codice nuovo le ignora. Le toglierai quando sarai sicuro
di non voler più tornare indietro.

### Recupero password — leggi prima di saltarlo

Senza le chiavi di Resend, **se dimentichi la password non c'è modo di rientrare.**
Il link di recupero non parte proprio.

Sono cinque minuti:

1. Registrati su **https://resend.com** con `rizzofederico.pt@gmail.com`
2. **API Keys** → **Create API Key** → copia la chiave (inizia per `re_`)
3. Torna su Vercel e aggiungi:

| Nome | Valore |
|---|---|
| `RESEND_API_KEY` | la chiave `re_...` |
| `RESEND_FROM` | `Iron Performance <onboarding@resend.dev>` |

Senza un dominio verificato Resend consegna **solo** all'indirizzo con cui ti sei
registrato. Va benissimo: quello è il tuo, ed è l'unico account che deve poter
recuperare la password.

---

## PASSO 4 — Adesso sì, pubblica

1. Apri **GitHub Desktop**
2. In alto a sinistra, **Current repository** → scegli `iron-performance`
   (quello clonato, non l'altro)
3. Al centro vedi l'elenco delle modifiche. Cliccando un file vedi in verde
   quello che si aggiunge e in rosso quello che si toglie. **Guardale.**
4. In basso a sinistra, nella casella **Summary**, scrivi:
   `Backend Postgres, correzioni perdita dati, struttura progetto`
5. Clicca **Commit to main**
6. In alto clicca **Push origin**

Vercel pubblica da sola. Due minuti.

## PASSO 5 — Crea il tuo account

Il database è nuovo e vuoto: il vecchio account non esiste più. Ne serve uno nuovo.

1. Apri `https://iron-performance.vercel.app/`
2. Se vedi la vecchia schermata, ricarica con **Ctrl + Shift + R**
3. Clicca su **crea un account** (o "Primo accesso")
4. Compila:
   - **Codice di invito**: quello che hai messo in `IP_SIGNUP_CODE`
   - **Email**: `rizzofederico.pt@gmail.com`
   - **Password**: almeno **12 caratteri**. Scrivila da qualche parte adesso,
     prima di andare avanti.

## PASSO 6 — Rimetti dentro i tuoi dati

1. Nell'app: **menu** → **Impostazioni** → **⬆️ Importa backup**
2. Scegli `iron-performance-2026-08-19.json` da `Desktop\Iron Performance`
3. Leggi il riepilogo: deve dire **17 atleti, 3 squadre**
4. Conferma

## PASSO 7 — Verifica

- [ ] Vedi tutte e 3 le squadre
- [ ] Vedi tutti e 17 gli atleti
- [ ] Il pallino di sincronizzazione in alto è **verde**
- [ ] Esci e rientra con email e password: i dati sono ancora lì
- [ ] Menu → **Esporta backup**: scarica un file nuovo e conservalo

Se tutti e cinque i punti sono a posto, il trasloco è finito.

Poi sistema la squadra **"calcio"**, che risulta impostata come sport
*pallavolo*: da quel campo dipende quali test ti propone l'app.

---

## Se qualcosa va storto

Non toccare niente e scrivimi **a che passo sei** e **cosa vedi**.

Il vecchio codice non è perso: è nella storia del repository, e in GitHub Desktop
si torna indietro da **Repository → History**. E i tuoi dati sono in due posti
diversi: nel file JSON sul Desktop e ancora dentro Airtable, intatti.

## Da fare dopo, con calma

Nella cartella c'è `_da_eliminare/`: contiene il vecchio `store.js` che stava
nel posto sbagliato. Cancellala a mano quando tutto funziona.
