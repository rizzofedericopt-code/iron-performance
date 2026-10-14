# Roadmap

Aggiornata il 14/10/2026, dopo il blocco «gestione della squadra» (presenze → calendario gare).

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

**1RM da una serie a ripetizioni** — sei equazioni invece di una: la mediana è la
stima, minimo e massimo sono l'intervallo, e l'intervallo si vede. Le ripetizioni
di riserva si dichiarano e si sommano (senza, la stima esce bassa del 3% per ogni
ripetizione lasciata). Sopra le 10 ripetizioni effettive non si salva. Mayhew è
esclusa: a una ripetizione restituisce il 109% del carico. Si inserisce dalla cella
della tabella oppure da **Registra test**, una colonna per tutta la squadra: carico,
ripetizioni e riserva per ogni atleta, con l'1RM che compare accanto mentre scrivi.

**Audit scientifico dei numeri** — passati in rassegna formule, fasce di
riferimento e soglie. Tre esiti.

*Errore vero:* lo **Squat Jump aveva le stesse identiche fasce del CMJ**, e si
contraddiceva con l'EUR — un'atleta «Buona» su entrambe le scale avrebbe avuto
CMJ = SJ, cioè indice elastico 1,00, che l'app legge come contributo elastico nullo.
Fasce SJ abbassate di circa il 9%, e un test permanente impedisce che tornino uguali.

*Soglia che era leggenda:* il **10% sull'asimmetria** era presentato come fisiologia.
Nasce da studi dei primi anni '90 che citavano il 15%, diventato 10% per citazione
successiva. Riscritto in tutte e tre le guide col criterio utilizzabile: un'asimmetria
conta quando **supera la variabilità della misura**, e quando persiste 4-6 settimane.

*Metodo contestato:* l'**ACWR** è implementato nella forma scollegata (quella
raccomandata), ma la «zona sicura» 0,8-1,3 non ha il supporto che la sua fama
suggerisce. Le soglie restano per far scattare uno sguardo, non una diagnosi, e ora
è scritto nel codice e nelle note.

*Verificate corrette:* potenza di Bosco, tempo di volo da altezza, errore tipico,
intervallo di confidenza della curva carico-velocità, le sei equazioni dell'1RM, le
soglie di velocità per esercizio, le fasce del MAT (unica fascia con fonte citata).
Le altre fasce ora dichiarano di essere riferimenti di lavoro su adulti, non
percentili pubblicati.

**Sotto il rumore non è successo niente** — ogni variazione era colorata: +0,4 cm sul
CMJ verde esattamente come +4 cm. Ma la variabilità di una misura ripetuta è di
quell'ordine: quel verde è lo strumento che respira, e inseguirlo porta a non credere
più ai colori in generale. Ora sotto la banda il delta è **grigio, «nel rumore»** — il
numero resta, sparisce la pretesa che significhi qualcosa. La banda viene dall'errore
che hai **misurato tu** su quel test, oppure da una percentuale di riserva del 5%
dichiarata come tale.

*Corretto il 13/10/2026:* la banda era l'errore tipico stesso. Sbagliato — una
variazione è la differenza fra due misure, e balla di TE·√2: con soglia = TE, il 48%
delle variazioni inesistenti usciva colorato. Ora la soglia è la differenza minima
rilevabile al 95%, **1,96·√2·TE ≈ 2,77·TE** (Weir 2005, J Strength Cond Res 19:231).
Tolto anche un ramo che usava il moltiplicatore CMJ (1,5) come se fossero centimetri.
Su peso e statura il 5% di riserva non si applica (8 cm di «rumore» su un metro).

**Misurare il proprio errore** (Impostazioni → 📏) — cinque atlete, due prove
ravvicinate, e l'app calcola l'errore tipico come deviazione standard delle differenze
diviso radice di due. Avvisa se supera il 10% (protocollo da sistemare) e se le seconde
prove sono sistematicamente migliori (effetto apprendimento: serve una prova in più di
riscaldamento). È l'unica soglia onesta, perché dipende dal tuo cronometro e dal tuo
campo, non da un manuale.

**Ordinare le atlete** — per nome, per età (le più giovani in cima) o nell'ordine in cui
le hai inserite. Chi non ha la data di nascita resta in fondo anche invertendo.

**La tabella si usa, non si subisce** — l'intestazione di una colonna conteneva sei
righe di testo in 96 pixel (categoria, nome, unità, verso, «carichi», «guida»): più
parole che dati. Ora mostra l'essenziale e **si tocca**, aprendo un posto solo con
tutto quello che puoi fare con quella colonna — ordina, metti in evidenza, gruppi di
carico, registra per tutta la squadra, guida.

**Ordinare le righe** — per un test (i migliori in cima, e su un tempo l'ordine si
rovescia da solo) o per nome. Chi non ha il dato resta in fondo anche invertendo:
una cella vuota non è un risultato scarso.

**Test in evidenza** — fino a sei per squadra, restano le prime colonne. Con
quarantasette test, «a sinistra» è l'unica posizione che si trova senza cercare.

**L'età del dato nella cella** — un 42 cm di marzo e uno di ottobre erano identici a
schermo. Ora sotto il numero c'è «7 mesi», in arancione oltre i quattro.

**Troppo o troppo poco: tre riferimenti, e si sa sempre quale** — ogni cella ha un
segno colorato che dice come sta andando quel valore. La parte che conta non è il
colore, è la **forma**: ● pieno = fascia di riferimento da popolazione, ◍ anello =
posizione nella squadra, ◆ rombo = rispetto alla sua media. Le fasce adulte restano
spente sugli under 18 — scrivere «sotto Base» a una quindicenne con una tabella di
universitari è il modo migliore per farle credere una cosa falsa — ma ora al loro
posto c'è un riferimento onesto invece del vuoto: con sei o più compagne misurate, la
posizione nel gruppo; altrimenti il confronto con le sue misure precedenti. Sotto
quelle soglie non si dice niente, perché un quartile su tre persone è aria fritta.

**Unità di misura sugli esercizi tuoi** — erano bloccati sui kg. Ora scegli
kg / rip / s / cm / m / % / AU, e con l'unità arriva la **direzione**: su un tempo da
abbassare «più basso è meglio», altrimenti il colore del delta esce rovesciato e un
peggioramento si colora di verde. Solo le colonne in kg entrano nella stima da
ripetizioni e nei gruppi di carico: un plank non ha un massimale.

**Esercizi tuoi: una colonna ciascuno** — «xRM→1RM» era una colonna sola per tutti
gli esercizi: leg press, affondi e pulley finivano insieme, e l'andamento nel tempo
diventava una linea che saliva e scendeva a seconda di cosa avevi fatto quel giorno.
Ora scegli l'esercizio e ogni esercizio è una colonna sua, con il suo andamento, i
suoi gruppi di carico e la stima da ripetizioni. Eredita guida, icona e attrezzatura
da xRM→1RM, quindi non serve riscrivere niente. Le voci vengono iniettate nel
catalogo all'avvio: tutto il resto dell'app non sa nemmeno che sono personalizzate,
e nessuna schermata deve ricordarsi di guardare in un secondo elenco. Si gestiscono
da Impostazioni → Esercizi tuoi, che prima di cancellarne uno dice quante misure
porta via.

**xRM→1RM accetta la serie, non il risultato** — era l'unica colonna di massimale
senza la strada «Da ripetizioni», proprio quella il cui senso è non fare il
massimale: dovevi fare il conto a mano con una formula sola e scrivere il numero
finale. Ora inserisci carico, ripetizioni e riserva, e il calcolo lo fa l'app con
sei formule e l'intervallo. È la colonna per gli esercizi che non hanno una colonna
propria: per squat, panca, stacco e trazioni usa le loro, dove la stima alimenta
anche i gruppi di carico.

**Box squat** — colonna propria, non quella dello squat libero: con la stessa
atleta i due massimali sono numeri diversi, e mescolarli darebbe un andamento che
sale e scende con l'altezza del box invece che con la sua forza. L'altezza del box
è parte del test e va annotata.

**16 test che le batterie proponevano e la tabella nascondeva** — il filtro per
sport confronta col campionato attivo, e il tag «generale» non è la pallavolo:
3-5RM, xRM→1RM, trazioni e push-up massimi comparivano nella batteria e poi non
avevano una colonna. Tag allineati alle batterie, e il controllo automatico non
accetta più la scappatoia che li faceva passare.

**La batteria della squadra sopravvive al ripristino** — `tests` (quali colonne
vuoi vedere per quella squadra) veniva scritta dall'export e buttata via
dall'import: tornavi da un backup e ti ritrovavi tutte le colonne del catalogo al
posto delle tue. Stesso difetto che aveva già cancellato screening, curve e
origine dei dati. E il contatore in barra ora dice «Test · 22 **di 42**»: con una
batteria personalizzata un test nuovo del catalogo non compare, e quel numero da
solo sembrava completo.

**Niente buchi nel catalogo** — i 54 test che l'app propone nelle batterie hanno
tutti guida, icona, attrezzatura dichiarata e la riga «cosa decidi col numero».
Prima ne mancavano 27: test che finivano nella seduta, venivano misurati, e poi
lasciavano un numero senza istruzioni. Un controllo automatico ora impedisce che
se ne aggiunga uno a metà. Le guide satellite (i tre numeri di un profilo
forza-velocità escono da una prova sola) dichiarano il loro riferimento e lo
mostrano come bottone, invece di dire «vedi la guida di…» e lasciarti cercare.
Il test di Bosco è stato riportato al livello «su campo»: l'app lo calcola dalle
altezze dei salti, il telefono basta, la pedana era una spesa inventata.

**MAT — Modified Agility T-test** — il test di agilità che alla pallavolo mancava.
Stesso percorso a T del T-test ma su 20 m invece di 36,6: restano i quattro cambi di
direzione e sparisce il tratto lineare che faceva pesare la velocità più dell'agilità.
Si fa con coni, metro e cronometro, quindi sta nel livello «su campo». Fasce ancorate
a Sassi et al. 2009 (donne 7,27 ± 0,35 s · uomini 6,27 ± 0,37 s) e dichiarate nella
guida per quello che sono: adulti, non élite, non giovanili. MAT e T-test misurano la
stessa cosa: se ne fa uno.

**«no» è una risposta, non un dato** — i campi clinici dell'anamnesi sono a testo
libero e l'allarme si accendeva se dentro c'era qualsiasi cosa. Un'atleta sana non
lascia vuoto: scrive «no». Risultato visto sul campo: sedici triangoli rossi su
sedici atlete, e un allarme acceso su tutte è un allarme che smetti di guardare.
Ora si riconosce solo una negazione breve e secca, confrontata per intero: «nessuno»
è vuoto, «nessuno adesso ma l'anno scorso il ginocchio» resta acceso. Nel dubbio
accende. Le risposte delle atlete non vengono mai riscritte.

**Gruppi di carico** — finestra a parte, nessun effetto sulla tabella. Si apre
cliccando l'intestazione della colonna di un massimale (dove la si cerca), oltre che
dal menu o dalla cella. Atlete in ordine di 1RM (dal più leggero, così
sul bilanciere i dischi si aggiungono e basta), percentuale a scelta, carico
arrotondato a quello che si può davvero caricare e scomposto in dischi. I gruppi
automatici si tagliano dove la lista ha i salti veri, non ogni tre nomi; quelli a
mano li componi tu spuntando i nomi, con la media che si vede prima di confermare,
e **restano salvati per squadra e per esercizio** — la settimana dopo ritrovi gli
stessi gruppi con i carichi ricalcolati. Sotto ogni nome la percentuale che le
tocca davvero: la soglia d'allarme non è simmetrica, perché andare leggeri costa
uno stimolo e andare pesanti costa una tecnica.

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

**Modulo di squadra** — un link solo per tutta la squadra, al posto di quindici
link personali mandati uno per uno. Chi lo apre scrive nome, cognome, sesso e
data di nascita e la scheda nasce **all'invio**, non all'apertura. Con tetto di
schede, chiusura manuale, parola d'ordine facoltativa, deduplica su
nome+cognome+data e avviso via email che contiene solo nome e squadra.
Vedi `MIGRAZIONE-modulo-squadra.md`: **prima il SQL, poi il push.**

**Tre difetti trovati preparando il modulo di squadra**, tutti invisibili finché
le schede arrivavano una alla volta:

- *Il limite anti-abuso contava anche le richieste riuscite* — 20 all'ora per
  indirizzo IP, e aprire il modulo più inviarlo fa due richieste. Una squadra
  che compila insieme in palestra è un solo IP: dalla decima ragazza in poi il
  modulo rispondeva «troppi tentativi». Ora il budget per IP lo consumano solo
  i token sbagliati; il traffico legittimo pesa sul singolo link.
- *Il merge teneva la copia locale dell'intero atleta* — con l'app aperta sul
  portatile, al primo salvataggio in conflitto la copia vecchia sovrascriveva
  l'anamnesi appena arrivata. Senza errore. Ora vince la scheda con `formAt`
  più recente, tranne i campi che il modulo non può scrivere.
- *Chi presta il consenso era una tendina* — «sono l'atleta e sono maggiorenne»
  la sceglieva anche una sedicenne. Ora lo decide la data di nascita, e il
  server rifiuta la combinazione sbagliata.

---

## ✅ Fatto — ottobre 2026: gestione della squadra

**Presenze** (Oggi → + Appello) — tre stati: presente, ridotto, assente. Chiudere
l'appello scrive una riga per ogni atleta, così la frequenza ha un denominatore vero.
I gruppi di carico e «Registra test» escludono solo chi è segnata assente (un appello
lasciato a metà non svuota la palestra). Frequenza nella scheda, accanto alla mediana
della squadra — nessuna soglia «buona frequenza», perché non ne esiste una fondata.
Il motivo dell'assenza non si scrive: su una minorenne sarebbe un dato sanitario.

**Cosa è cambiato** (Andamento, menu colonna, Impostazioni) — per ogni test e ogni
atleta: migliorata, nel rumore, calata, col verdetto della soglia qui sopra. Cali in
cima. Accanto: le sedute fatte fra i due test, se una delle due misure è una stima,
e se mesi di crescita spiegano parte del cambiamento. Indici (asimmetrie, decrementi)
senza verdetto: «+50%» da 4 a 6 non vuol dire niente (Bishop et al. 2021).

**Peso e statura nel tempo** — due colonne che non hanno verso: niente colori,
pallini, record o classifiche. Il peso non compare in tabella finché non lo scegli
nella batteria; non si può ordinare la squadra per peso. Scheda e tabella restano
allineate nei due versi. Ne nascono:
- **forza relativa** (Squat, Stacco, Panca, Hip thrust ÷ peso misurato entro 90
  giorni); in squadra il confronto usa la scala allometrica kg/peso^0,67 (Jaric
  et al. 2005), perché il rapporto semplice favorisce le più leggere;
- **velocità di crescita** (cm/anno) nella scheda, solo con due misure ad almeno
  sei mesi, accanto alla mediana di squadra.

**Scheda di seduta** (Oggi) — fino a 4 esercizi, gli stessi gruppi per tutta la seduta.
Di default i gruppi si formano su tutti gli esercizi insieme (media dei massimali
normalizzati sulla mediana di squadra). Per ogni esercizio: chi lavora fuori
percentuale e chi, alla sua percentuale effettiva, non chiude le ripetizioni scritte.

**Gruppi di carico a mano, più liberi** — dentro il gruppo anche chi non ha il
massimale (fuori dalla media, «carico non verificato» scritto ogni volta); carico
scritto a mano (vale solo per la percentuale per cui l'hai deciso); note di gruppo.
Note e carichi seguono il loro gruppo anche quando un altro si scioglie.

**Promemoria** (Oggi → Da misurare) — test scaduti rispetto alla frequenza della
batteria dello sport, chi manca dall'ultima sessione, test in batteria mai usati.

**Profilo prestazioni** (scheda atleta → 📊 Profilo) — il foglio da consegnare: solo
prestazioni, verdetto per test, ruolo, presenze, crescita, note. **Niente dati
sanitari**: la cartella con l'anamnesi resta un'altra cosa (🖨 Cartella). Peso e
posizione fra le compagne solo se li scegli.

**Ruoli** — il testo libero («banda», «Schiacc.») riportato al ruolo dell'elenco;
tabella raggruppata per ruolo; confronto fra ruoli con la mediana solo da tre
atlete in su.

**Calendario gare** (Impostazioni) — MD-n in Oggi, avviso sui carichi ≥80% a due
giorni dalla gara (un avviso, non un blocco).

**Controllo d'insieme** (`test/completo.mjs`) — uno stato con tutto dentro deve
sopravvivere a backup, ripristino e sincronizzazione. Se compare una chiave nuova
nello stato e il test non la conosce, fallisce: è il difetto più ripetuto del
progetto, ora ha una rete.

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
- [ ] Split di `index.html` in moduli, quando il file diventerà ingestibile.

---

## ⬜ Da fare — Federico

Vedi `DA-FARE-TU.md` e `COSA-PROVARE.md` per questo rilascio. In sintesi:

- [ ] **Push** di tutto il blocco di ottobre (un solo commit)
- [ ] **Backup** subito dopo: l'unico è del 19 agosto
- [ ] **Misurare l'errore** di CMJ e sprint 10 m (8-10 atlete, due prove ravvicinate):
      finché manca, ogni verdetto si appoggia sul 5% di riserva
- [ ] Scrivere il **ruolo** di ciascuna nella scheda
- [ ] **Compilare l'informativa** — Impostazioni → Informativa privacy
- [ ] **Farla leggere a chi se ne intende** prima del primo link a una famiglia
- [ ] **Esportare il backup PRIMA di cancellare le 17 atlete** — non per i dati,
      per l'elenco dei nomi: senza, non sai chi non ha ancora compilato
- [ ] **Aprire tu il link di squadra** e compilarlo con un nome finto, prima di
      mandarlo a chiunque
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
- **Le tolleranze del promemoria** (una settimana sul settimanale, due sul ciclo,
  due mesi sulla stagione) sono una scelta, non un dato. Da tarare sull'uso vero.
- **L'avviso carichi-gara** (≥80% a ≤2 giorni) è la prudenza più comune, non una
  soglia dimostrata con un numero di ore.
- **Un appello al giorno, non una per seduta**: due allenamenti nello stesso giorno
  contano come uno. Cambiarlo richiede una chiave nuova e una migrazione.
- **Il carico «a mano» non si arrotonda ai dischi**: se scrivi 46, resta 46.
