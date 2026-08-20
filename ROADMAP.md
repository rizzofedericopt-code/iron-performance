# Roadmap

Stato al 19/08/2026. Ogni voce diventa un commit separato, così il `git log` racconta
perché una cosa è stata fatta e non solo che è stata fatta.

---

## Fase 0 — Mettere in sicurezza il progetto ✅

- [x] Struttura corretta: `api/store.js`, `icons/`, `schema.sql`, `package.json`, `vercel.json`
- [x] `schema.sql` ricostruito dalle query (non esisteva)
- [x] Header di sicurezza, incluso `Referrer-Policy: no-referrer`
      — i token di anamnesi e reset viaggiano nell'URL, senza questo header
      finiscono nel `Referer` verso terzi
- [x] Repo Git con commit di partenza
- [ ] **Da verificare: la versione online e questa cartella sono diverse.**
      Produzione ha `viewport ... maximum-scale=1, user-scalable=no`,
      qui c'è `viewport-fit=cover`. Prima del primo deploy va deciso quale vince.

## Fase 1 — I quattro bug che perdono dati in silenzio ✅

Nessuno di questi produce un errore. È il motivo per cui vengono prima di tutto il resto.
Ogni correzione ha un test verificato rosso sul codice precedente. `npm test` per rilanciarli.

- [x] **`sanitizeImport` scarta `screen` e `lv`** (`index.html`)
      L'export scrive tutto lo stato, l'import ne ricostruisce solo una parte:
      ripristinare un backup cancella tutte le valutazioni posturali e le curve
      carico-velocità, senza avviso.
- [x] **`save` non è atomico** (`api/store.js`)
      `SELECT version` e `UPDATE` in due query separate: due salvataggi concorrenti
      con la stessa `baseVersion` passano entrambi. Da unire in un solo
      `UPDATE ... WHERE version = $base` con controllo di `rowCount`.
- [x] **`baseVersion` mancante salta il controllo** (`api/store.js`)
      `Number.isFinite(base)` fa passare la richiesta se il campo manca o è `NaN`:
      sovrascrittura cieca. Da rendere obbligatorio.
- [x] **Tombstone solo per gli atleti** (`index.html`)
      `mergeState` filtra le squadre su `tomb["team:"+id]`, chiave che nessuno scrive.
      `delTeam`, `delMeasure`, `delCheckin`, `delLoad` non lasciano traccia:
      sul percorso di merge i dati cancellati tornano dal server.

### Trovati scrivendo i test (corretti insieme ai quattro sopra)

- [x] `mergeByDate` indicizzava per sola data: due curve carico-velocità
      registrate nello stesso giorno (es. Squat e Panca) si annullavano
      a vicenda al primo merge, ne sopravviveva una
- [x] Il 409 lato client faceva `(e.body.version) || CLOUD_V`, e `||` scarta
      lo zero: con versione 0 il client restava disallineato e rimbalzava
      in 409 all'infinito
- [x] La whitelist delle viste conteneva `fatigue`, nome abbandonato dopo la
      rinomina in `readiness`

## Fase 2 — Sicurezza e conformità

- [ ] **`@vercel/postgres` è deprecato.** npm avvisa che i database sono stati
      migrati a Neon come integrazione nativa. Va pianificato il passaggio
      a `@neondatabase/serverless` prima che il pacchetto smetta di funzionare.

- [ ] **Whitelist server-side dei campi in `formSubmit`.** Oggi il server accetta
      qualsiasi chiave: chi ha il link può scrivere `medical`, `medicalExpiry`, `notes`,
      cioè l'idoneità medica. Il filtro esiste solo nel browser.
- [ ] **Verifica dell'email allo signup.** Un'email sbagliata di una lettera crea un
      account irrecuperabile: il reset password va nel vuoto.
- [ ] **`clientIp` usa `x-vercel-forwarded-for`.** Oggi si fida del primo valore di
      `x-forwarded-for`, che il client può scrivere: rate limit per IP aggirabile.
- [ ] **Rate limit rivisti.** 20 chiamate/ora per IP e 2 chiamate per atleta:
      dietro il wifi di una società il modulo si blocca dopo 10 atleti.
      Stesso schema sul login: 8 tentativi falliti da un IP condiviso bloccano tutti.
- [ ] **Pulizia delle tabelle** (sessioni, reset, link, tentativi, audit).
      Nessuna si pota da sola; `audit_log` prende una riga per ogni salvataggio.
- [ ] **Informativa privacy vera** nel modulo pubblico. Oggi l'atleta conferma di aver
      letto un documento che non esiste e a cui non c'è link.
- [ ] **Consenso tracciato**: chi lo presta, quando, su quale versione dell'informativa.
      Oggi il server scrive `consentBy: "L'atleta (o chi ha compilato tramite il link)"`,
      che in caso di contestazione non prova nulla.

## Fase 3 — Rendere il codice modificabile

- [ ] Split di `index.html` (4.225 righe, 296 KB, JS inline) in moduli ES.
      Prerequisito pratico per tutto ciò che viene dopo: il motore di profilazione
      da solo è 600-800 righe.
- [ ] CSP stretta (via `vercel.json`) una volta rimosso il JS inline.

## Fase 4 — Screening quantitativo

Oggi squat, 1-leg squat, Y Balance e core stability sono `select` Pass/Fail.
Un pass/fail non ha trend, non ha gradiente e non può alimentare un profilo.

- [ ] Squat globale e 1-leg squat: punteggio 0-3 con compensi selezionabili
- [ ] Y Balance: reach in cm × 3 direzioni × 2 lati, con **composite %** calcolato
      (reach ÷ lunghezza arto) e asimmetria anteriore evidenziata sopra i 4 cm
- [ ] Core stability (bridge monolaterale, side plank abduttori/adduttori):
      tenuta in secondi + asimmetria destra/sinistra
- [ ] Nuovo campo antropometrico: lunghezza arto inferiore (SIAS-malleolo),
      necessaria al composite del Y Balance
- [ ] Migrazione dei dati Pass/Fail già raccolti, conservati come storico

## Fase 5 — Profilo Forza-Velocità (Samozino)

- [ ] Nuovi campi antropometrici: massa, **distanza di spinta h_PO**
- [ ] Protocollo CMJ con sovraccarichi (3-5 carichi), altezza per carico
- [ ] Calcolo di F₀, V₀, Pmax, Sfv e squilibrio F-V; alimenta il test `fvdef`
      che oggi è solo una casella compilata a mano
- [ ] **Indicatori di affidabilità visibili**: R² della regressione, ampiezza del range
      di carico, data dell'ultima misura. Lo squilibrio F-V ha una ripetibilità
      individuale discussa in letteratura (Lindberg et al. 2021): il numero va
      mostrato con la sua incertezza, non da solo.

## Fase 6 — Motore di profilazione

Collega dati che oggi vengono raccolti e mai riletti: `S.screen` e `S.lv` sono scritti
e riletti solo dalla schermata che li ha creati. Nessun calcolo li usa.

- [ ] Catena: forza relativa (da curva L-V) → gate → profilo balistico →
      indice di Bosco → DJ-RSI, EUR, asimmetrie → profilo dell'atleta
- [ ] Output: **profilo + evidenza + confidenza + 2-3 letture possibili.**
      Non una prescrizione. Ogni soglia dichiarata, modificabile e con la sua fonte.
- [ ] Gestione dei dati mancanti: la maggior parte degli atleti avrà 3 input su 8.
      Il motore deve dire cosa manca, non tacere o inventare.
- [ ] L'1RM stimato dalla curva L-V finisce nella serie storica del test,
      così sparisce il doppio inserimento
- [ ] Il profilo entra nella scheda stampata e nella vista Oggi

## Debito riconosciuto, non pianificato

- **Le soglie di livello (Base → Elite) ignorano l'età.** `levelIdx` usa solo il sesso:
  un quattordicenne e un venticinquenne vengono giudicati sulla stessa scala,
  e il giudizio finisce sulla scheda stampata.
- **L'ACWR è mostrato con un semaforo.** L'implementazione è corretta (finestra
  disaccoppiata, soglia minima di storico), ma la validità dell'ACWR come predittore
  di infortunio è stata largamente contestata (Impellizzeri et al., 2020-2021).
- **Il limite di payload è 6 MB, sopra il limite di body di Vercel (~4,5 MB):**
  il 413 gestito con un messaggio gentile non arriverà mai da noi.
- **`render()` ricostruisce l'intero DOM a ogni azione.** Regge oggi, non a 50 atleti
  × 60 test con sparkline SVG.
