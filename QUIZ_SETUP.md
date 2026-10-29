# Attivazione dei quiz di Tasca

Il sistema quiz usa un archivio settimanale e registra ogni domanda affrontata per account.

## Migrazioni Supabase

1. Apri il progetto Supabase usato da Tasca e vai su **SQL Editor**.
2. Se non è già stata eseguita, esegui `supabase/migrations/20261028_quiz_question_bank.sql` per creare l'archivio privato.
3. Esegui `supabase/migrations/20261028_quiz_attempts.sql` se non è già stata eseguita.
4. Esegui `supabase/migrations/20261029_quiz_question_history.sql` per registrare permanentemente le risposte e abilitare sessioni da 12 domande.

## Worker e interfaccia

1. Pubblica separatamente `worker.js` su Cloudflare Workers: il repository non distribuisce automaticamente il Worker, a meno che non sia stato configurato un deployment dedicato.
2. Verifica che il Worker abbia il binding AI, `SUPABASE_URL`, `SUPABASE_ANON_KEY` e il secret `SUPABASE_SERVICE_ROLE_KEY`.
3. Attendi il deployment GitHub Pages e accedi a Tasca.
4. Apri **Quiz** e prova una sessione. Devono apparire 12 domande, due per ciascuna delle sei categorie, nel livello scelto.
5. Rispondi a una domanda, poi verifica che la riga corrispondente sia presente in `quiz_question_history`. La stessa domanda non deve essere proposta allo stesso account nelle sessioni successive.
6. Prova a cambiare pagina e a riprendere la sessione; le risposte già registrate devono restare conteggiate.

Se una categoria non ha più almeno due domande nuove per il livello selezionato, Tasca mostra un avviso e non riutilizza domande già affrontate. L'archivio settimanale viene generato in background; non è prevista generazione IA durante la partita.

## Dati e privacy

Le risposte sono associate all'ID dell'account Supabase e protette da Row Level Security. La tabella conserva l'identificativo normalizzato della domanda, categoria, livello, risposta selezionata, esito e data della risposta. Non contiene password o token. Gli XP sono ricompense motivazionali, non hanno valore monetario.
