# Attivazione dell'IA cloud di Tasca

Tasca usa Cloudflare Workers AI per tre funzioni: promemoria brevi sul ritmo di spesa, consigli seri basati sullo storico e generazione di quiz finanziari. I promemoria e i quiz usano `@cf/zai-org/glm-4.7-flash`; i consigli approfonditi usano `@cf/google/gemma-4-26b-a4b-it`. Il Worker verifica la sessione Supabase prima di eseguire una richiesta e non contiene chiavi privilegiate.

## 1. Pubblicare il Worker su Cloudflare

1. Accedi a Cloudflare e apri **Workers & Pages**.
2. Crea un Worker collegato al repository GitHub `pascaledaniel00/Tasca`, usando la configurazione `wrangler.toml` nella radice del repository. Se la dashboard chiede un comando di deploy, usa `npx wrangler deploy`.
3. Verifica che la configurazione includa il binding AI già dichiarato in `wrangler.toml`:
   - binding: `AI`
4. Nelle impostazioni del Worker, aggiungi queste variabili/segreti:
   - `SUPABASE_URL` = `https://njgmlxyecjyreieqcpwk.supabase.co`
   - `SUPABASE_ANON_KEY` = la chiave pubblica/publishable già utilizzata da Tasca in `app.js` (inizia con `sb_publishable_`).
5. Pubblica il Worker. Cloudflare assegnerà un URL del tipo `https://tasca-ai.<tuo-sottodominio>.workers.dev`.

Non inserire mai una chiave `service_role` di Supabase nel Worker o nel browser. La chiave publishable/anon è quella pubblica del progetto.

## 2. Collegare Tasca al Worker

1. Verifica che `AI_WORKER_URL` in `app.js` corrisponda all'URL `workers.dev` assegnato al Worker.
2. Pubblica il Worker aggiornato da `worker.js` (per esempio con `npx wrangler deploy`, se Wrangler è già configurato) e attendi che Cloudflare confermi il deployment.
3. Se l'URL del Worker è cambiato, aggiorna `AI_WORKER_URL` in `app.js`, salva su `main` e attendi la pubblicazione GitHub Pages.

L'URL del Worker non è una chiave segreta. L'accesso al servizio è comunque subordinato a una sessione valida di Tasca.

## 3. Test

- Accedi a Tasca da `https://pascaledaniel00.github.io/Tasca/`.
- Controlla il commento sotto il budget: con l'IA attiva viene generato in italiano sulla base del nome e dei numeri del mese.
- Apri **Consigli**: l'IA analizzerà i dati aggregati degli ultimi sei mesi disponibili e le ricorrenze attive.
- Apri **Quiz** e avvia un percorso misto da 12 domande, 2 per categoria. Le domande devono provenire dall'archivio settimanale già preparato; non vengono generate durante la partita.
- Usa **Rigenera consigli IA** per richiedere una nuova analisi.

## Piano gratuito e limiti

Workers AI include una quota gratuita giornaliera di Neurons; il limite può essere raggiunto e le richieste successive possono fallire fino al reset. Non viene aggiunta una fatturazione automatica superando la quota nel piano Free: Cloudflare richiede il passaggio al piano Workers Paid per continuare oltre i limiti previsti. Controlla sempre la pagina Pricing di Cloudflare prima di abilitare un piano a pagamento.

## Note di privacy e funzionamento

- Il Worker verifica il token di sessione tramite Supabase Auth.
- Vengono inviati al modello il nome visualizzato, i totali mensili aggregati, i totali per categoria, budget storici e ricorrenze attive; non vengono inviati email, password, token o descrizioni individuali dei movimenti.
- I calcoli finanziari restano nel codice; il modello scrive i commenti e interpreta i riepiloghi.
- Se l'IA non è configurata o il servizio non risponde, Tasca continua a mostrare il commento locale e i consigli statistici già presenti; i quiz passano alle domande verificate.


## Archivio quiz settimanale (90 domande)

Ogni domenica alle 02:00 ora italiana, il Worker prepara 5 domande per ciascuna combinazione di 6 categorie e 3 livelli: 90 domande complessive. Ogni partita propone 12 domande casuali, due per categoria, tutte del livello selezionato.

La tabella `quiz_question_bank` contiene l'archivio settimanale; `quiz_question_history` conserva le domande già affrontate da ciascun account. Una domanda viene registrata quando l'utente risponde, correttamente o meno, e non viene più proposta a quello stesso account. Se in una categoria restano meno di due domande nuove, Tasca avvisa l'utente e non ripete le domande già viste.

Prima dell'attivazione:
1. Esegui `supabase/migrations/20261028_quiz_question_bank.sql` se non è già stata eseguita.
2. Esegui `supabase/migrations/20261029_quiz_question_history.sql` nel SQL Editor di Supabase.
3. In Cloudflare Workers, configura `SUPABASE_SERVICE_ROLE_KEY` come **secret** del Worker, mai nel codice o nel browser. Serve per accedere all'archivio privato e allo storico personale.
4. Pubblica il `worker.js` aggiornato su Cloudflare Workers.
5. Dopo il deployment, controlla i log del Worker e verifica che l'archivio della settimana corrente contenga domande per tutte le categorie e i livelli.

Il merge del codice su GitHub non esegue automaticamente la migrazione SQL e non distribuisce il Worker, salvo che tu abbia configurato separatamente questi deployment. Non attivare un piano a pagamento per risolvere eventuali limiti di quota.
