# Tasca — verifica di prontezza per la beta

## Stato verificabile dal repository

- GitHub Actions esegue test Node, controlli sintattici e build Vite.
- Il frontend è configurato per GitHub Pages e il Worker è configurato in `wrangler.toml`.
- I quiz leggono l'archivio cumulativo; lo storico delle domande affrontate è per account.
- I risultati quiz richiedono `question_fingerprint` e vengono salvati in `quiz_attempts`.
- Le migrazioni versionate nel repository coprono le tabelle quiz, ma non documentano lo schema completo di `transactions`, `budgets`, `recurring_plans`, `spaces`, `space_members`, `expense_shares` e `settlements`.

## Bloccanti da verificare nell'ambiente Supabase reale

1. Verificare che tutte le tabelle usate dall'app esistano e abbiano colonne e vincoli coerenti con `app.js`.
2. Verificare le policy RLS di tutte le tabelle finanziarie e di condivisione con due account di prova: A non deve leggere né modificare i dati privati di B; entrambi possono accedere solo agli spazi condivisi di cui sono membri.
3. Verificare che le tre migrazioni quiz siano state eseguite nel progetto Supabase corretto.
4. Verificare nel Worker Cloudflare il binding `AI`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` e il secret `SUPABASE_SERVICE_ROLE_KEY`. La chiave service-role non deve essere inserita nel frontend o nel repository.
5. Verificare il deployment effettivo del Worker dopo ogni modifica a `worker.js`.

## Deploy Worker

Il workflow `.github/workflows/deploy-worker.yml` distribuisce il Worker quando cambiano `worker.js` o `wrangler.toml`, ma solo se sono configurati nei GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`: token con permessi sufficienti per distribuire Workers.
- `CLOUDFLARE_ACCOUNT_ID`: ID dell'account Cloudflare.

I secrets del Worker già impostati in Cloudflare devono rimanere configurati. Se i due secrets GitHub mancano, il workflow segnala che il deploy è stato saltato; un esito positivo del workflow non significa in quel caso che Cloudflare sia aggiornato.

## Checklist manuale prima della beta

- [ ] Registrazione, conferma email, login, logout e recupero password.
- [ ] Creazione, modifica e cancellazione di un movimento; ricaricare la pagina e verificare la persistenza.
- [ ] Verificare entrate, uscite, trasferimenti, rimborsi, date e stati previsti/da verificare.
- [ ] Verificare budget per mese e categoria, spese ricorrenti e cambi di mese.
- [ ] Testare accesso e isolamento dati con due account separati.
- [ ] Creare uno spazio condiviso, invitare un secondo account, registrare spese e quote e verificare i rimborsi.
- [ ] Avviare quiz in tutte e tre le difficoltà; controllare 12 domande e 2 per categoria.
- [ ] Rispondere a domande e verificare che `quiz_question_history` e `quiz_attempts` ricevano i record attesi.
- [ ] Ripetere il quiz: l'utente non deve ricevere domande già affrontate; un altro utente deve poterle ricevere.
- [ ] Provare offline, timeout, errore Supabase e indisponibilità IA; l'interfaccia deve mostrare errori chiari senza dichiarare dati sincronizzati quando sono solo locali.
- [ ] Eseguire la checklist su iPhone Safari e su desktop.
- [ ] Confermare che la build GitHub Pages e il deployment Cloudflare puntino ai commit previsti.

## Regola di rilascio

Non invitare tester esterni finché i controlli RLS e di isolamento degli spazi non sono stati eseguiti sul progetto reale. I test automatici del repository non possono certificare configurazioni e dati remoti non accessibili al workflow.
