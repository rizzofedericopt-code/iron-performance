# Roadmap

Aggiornata il 20/08/2026, dopo la revisione completa.

---

## ✅ Fatto

**Il progetto è al sicuro** — repo Git collegato a Vercel, ogni versione è un punto
di ritorno, `schema.sql` ricostruito, header di sicurezza, documentazione e test
esclusi dal sito pubblico.

**Trasloco da Airtable a Postgres** — la riscrittura ferma sul desktop da settimane
è online. La versione precedente teneva la password in chiaro nel browser.

**Consenso dimostrabile** — informativa vera e versionata mostrata dentro il modulo,
ruolo e nome di chi firma, data e versione stabilite dal server, evento in `audit_log`,
campi del preparatore chiusi lato server.

**Rete di sicurezza** — copia automatica prima di ogni operazione distruttiva,
`Impostazioni → Annulla un'operazione`. Era stata persa nella riscrittura.

**Layout desktop** — navigazione a colonna, contenuto a tutta larghezza, barra in
alto su una riga, scheda atleta a fisarmonica, una sola strada per registrare i test.

**Curva carico-velocità** — soglia di velocità per esercizio (usare 0,30 m/s su
panca e stacco sottostimava l'1RM del 14-16%), indicatore di quanto è lunga
l'estrapolazione, stima che entra nello storico marcata come tale.

**Indice di Bosco dal telefono** — le altezze bastano, `t = √(8h/g)`. Simulato:
±2-5% di errore contro il ±35% di un profilo estrapolato con lo stesso strumento.

**Revisione completa** — 23 difetti corretti, ognuno con un test verificato rosso
sul codice precedente. Fra i più seri: salvataggi persi sul wifi lento, menu ⋯ che
non si apriva (cancellazione account irraggiungibile), scheda atleta che cancellava
la prova del consenso, XSS nel pulsante Condividi, registrazione tagliata sui
telefoni piccoli, caselle di consenso deformate, PDF troncato a una pagina.

**Metodo** — la fatica CMJ ha una finestra di 42 giorni (prima confrontava oggi con
misure di venti mesi prima); sotto i 18 anni non si applica la scala Base→Elite,
che è tarata su popolazione adulta.

---

## ⬜ Da fare — codice

### Prossimo passo naturale
- [ ] **Motore di profilazione** sulla catena che regge con gli strumenti attuali:
      forza relativa (curva L-V) → cancelletto 1,5× → EUR → DJ-RSI → asimmetrie →
      indice di Bosco → profilo. Output: **profilo + evidenza + confidenza + letture
      possibili**, non una prescrizione. Ogni soglia dichiarata e modificabile.
      Va costruito su dati veri, non su ipotesi: servono le prime misurazioni.

### Quando ci sarà una pedana a contatto
- [ ] **Profilo F-V balistico (Samozino)** — F₀, V₀, Pmax, squilibrio F-V da SJ con
      sovraccarichi. Serve la distanza di spinta h_PO, misurata una volta per atleta.
      Con il telefono la pendenza F-V balla del ±35% anche col protocollo migliore:
      non ci si prescrive sopra. Con la pedana scende al ±12% e ha senso.

### Screening quantitativo
- [ ] Squat e 1-leg squat a punteggio 0-3 con i compensi selezionabili
- [ ] Y Balance in cm × 3 direzioni × 2 lati, con composite % e asimmetria anteriore
- [ ] Core stability in secondi, con asimmetria destra/sinistra
- [ ] Nuovo campo: lunghezza arto inferiore (serve al composite dello Y Balance)

### Infrastruttura
- [ ] **`@vercel/postgres` è deprecato.** Passaggio a `@neondatabase/serverless`
      da pianificare con calma, non sotto scadenza.
- [ ] **Verifica dell'email alla registrazione** — un'email sbagliata di una lettera
      crea un account da cui non si rientra.
- [ ] **Rate limit del modulo anamnesi** — 20 chiamate/ora per IP e 2 per atleta:
      dietro il wifi di una società il modulo si blocca dopo dieci ragazze.
- [ ] Split di `index.html` in moduli, quando il file diventerà ingestibile.

---

## ⬜ Da fare — Federico

- [ ] **Compilare l'informativa** — Impostazioni → Informativa privacy
- [ ] **Farla leggere a chi se ne intende** prima del primo link a una famiglia
- [ ] **Un link di prova a te stesso**, per vedere cosa arriva davvero
- [ ] **Registrare i primi test veri**
- [ ] Sistemare la squadra "calcio", impostata come sport *pallavolo*
- [ ] Cancellare `_da_eliminare/` e la vecchia `Desktop\Iron Performance`
- [ ] Segnarti **il momento in cui ti innervosisci** durante la prima seduta:
      vale più di qualsiasi nostra ipotesi sul design

---

## Debito riconosciuto, non pianificato

- **L'ACWR è mostrato con un semaforo.** L'implementazione è corretta (finestra
  disaccoppiata, soglia minima di storico), ma la sua validità come predittore di
  infortunio è largamente contestata (Impellizzeri et al., 2020-2021).
- **Non esistono normative per fascia d'età** nel catalogo test. Sotto i 18 anni
  l'etichetta di livello è sospesa: è la scelta onesta, non una soluzione.
  Il punto in cui agganciare normative federali è `eLevelApplicable`.
- **`render()` ricostruisce tutto il DOM a ogni azione.** Regge oggi, non a 50 atleti.
- **`ageFrom` sbaglia di un giorno a ovest di Greenwich.** In Italia è corretta.
