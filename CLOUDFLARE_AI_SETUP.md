# Attivazione dell'IA cloud di Tasca

Tasca usa Cloudflare Workers AI per due funzioni: commenti brevi sul ritmo di spesa e consigli seri basati sullo storico. Il modello configurato è `@cf/google/gemma-4-26b-a4b-it`. Il Worker verifica la sessione Supabase prima di eseguire una richiesta e non contiene chiavi privilegiate.

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

1. Apri `app.js` nel repository.
2. Cerca la riga `const AI_WORKER_URL = '';`.
3. Inserisci tra gli apici l'URL completo assegnato da Cloudflare, ad esempio `const AI_WORKER_URL = 'https://tasca-ai.<tuo-sottodominio>.workers.dev';` sostituendo il sottodominio con quello reale.
4. Salva la modifica su `main` e attendi la pubblicazione GitHub Pages.

L'URL del Worker non è una chiave segreta. L'accesso al servizio è comunque subordinato a una sessione valida di Tasca.

## 3. Test

- Accedi a Tasca da `https://pascaledaniel00.github.io/Tasca/`.
- Controlla il commento sotto il budget: con l'IA attiva viene generato in italiano sulla base del nome e dei numeri del mese.
- Apri **Consigli**: l'IA analizzerà i dati aggregati degli ultimi sei mesi disponibili e le ricorrenze attive.
- Usa **Rigenera consigli IA** per richiedere una nuova analisi.

## Piano gratuito e limiti

Workers AI include una quota gratuita giornaliera di Neurons; il limite può essere raggiunto e le richieste successive possono fallire fino al reset. Non viene aggiunta una fatturazione automatica superando la quota nel piano Free: Cloudflare richiede il passaggio al piano Workers Paid per continuare oltre i limiti previsti. Controlla sempre la pagina Pricing di Cloudflare prima di abilitare un piano a pagamento.

## Note di privacy e funzionamento

- Il Worker verifica il token di sessione tramite Supabase Auth.
- Vengono inviati al modello il nome visualizzato, i totali mensili aggregati, i totali per categoria, budget storici e ricorrenze attive; non vengono inviati email, password, token o descrizioni individuali dei movimenti.
- I calcoli finanziari restano nel codice; il modello scrive i commenti e interpreta i riepiloghi.
- Se l'IA non è configurata o il servizio non risponde, Tasca continua a mostrare il commento locale e i consigli statistici già presenti.
