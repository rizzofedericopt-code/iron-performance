# Modulo di squadra — note tecniche

## Il passaggio SQL non serve più

Le colonne dei link di squadra le crea il server da solo, la prima volta che
una richiesta tocca `form_links` (`ensureLinkSchema` in `api/store.js`). È
idempotente e provata su un Postgres vero in `test/migrazione.mjs`: gira sulla
tabella vecchia, non tocca i link personali esistenti, e rilanciarla non azzera
le schede già raccolte.

Il motivo per cui non è più manuale: l'ordine era "prima il SQL, poi il push",
e sbagliarlo una volta sola rompeva il modulo anamnesi per **tutti**, compresi
i link personali già in mano alle atlete. Un passaggio manuale con quella
conseguenza non va lasciato a un passaggio manuale.

Se un giorno ricrei il database da zero, `schema.sql` è già allineato.

Le istruzioni per Federico sono in `DA-FARE-TU.md`.

---

## Passo 2 — il push

GitHub Desktop → Commit → Push, come sempre.

## Passo 3 — la prova, prima delle ragazze

1. Apri l'app, **Impostazioni → Gestisci squadre**
2. Sulla squadra giusta: **🔗 Modulo di squadra**
3. Genera il link e **copialo subito** (non è rileggibile dopo)
4. Aprilo **tu**, in una finestra anonima del browser
5. Compilalo con un nome finto e una data di nascita da minorenne:
   deve chiederti il nome del genitore da solo
6. Invia, e controlla che l'atleta finta compaia nella squadra con la
   scritta **nuova** accanto al nome
7. Cancellala

Se il passo 6 non funziona, fermati e scrivimi: non mandare il link a nessuno.

---

## Quello che devi sapere prima di mandarlo

**Il link non si rilegge.** In archivio c'è solo la sua impronta, non il link.
Se lo perdi ne generi un altro, e il vecchio si chiude da solo. È scomodo di
proposito: un link che si può ripescare è un link che può ripescare chiunque
entri nell'account.

**Il tetto di schede è la tua sicurezza.** Se metti 20 e la squadra è di 17,
al ventesimo invio il modulo si chiude da solo. Serve se il link finisce dove
non doveva.

**La parola d'ordine è facoltativa.** Se la usi, dilla a voce in palestra e
non scriverla nel messaggio insieme al link — altrimenti non serve a niente.
Maiuscole e accenti non contano.

**Chi firma lo decide la data di nascita, non chi compila.** Sotto i 18 anni
il modulo chiede il nome del genitore e il server rifiuta l'invio se prova a
firmare l'atleta. Sopra i 18, il contrario. Non devi ricordartene tu.

**L'email di avviso** arriva solo se `RESEND_API_KEY` e `RESEND_FROM` sono
configurate su Vercel — lo sono già per il recupero password. Contiene solo
nome e squadra. Se non arriva, il pallino **nuova** dentro l'app resta
l'avviso valido.
