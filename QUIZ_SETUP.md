# Attivazione dei quiz di Tasca

La funzione è aggiunta al codice ma i progressi richiedono la migrazione Supabase.

1. Apri il progetto Supabase usato da Tasca e vai su **SQL Editor**.
2. Apri `supabase/migrations/20261028_quiz_attempts.sql` in questo repository.
3. Copia tutto il contenuto nel SQL Editor ed eseguilo una sola volta.
4. Attendi il deployment del sito GitHub Pages e pubblica separatamente `worker.js` su Cloudflare Workers: il repository non distribuisce automaticamente il Worker.
5. Accedi a Tasca, apri **Quiz** e completa una sessione di prova. Controlla che XP e storico restino visibili dopo un aggiornamento della pagina.

Se la migrazione non è stata applicata, i quiz verificati restano giocabili ma il salvataggio dei progressi mostra un errore; il resto di Tasca non viene bloccato.

## Dati e privacy

La generazione personalizzata invia al Worker soltanto l'argomento, la difficoltà e riepiloghi aggregati pertinenti per categoria; non invia le descrizioni delle singole transazioni. I progressi sono isolati tramite Row Level Security e non includono il testo delle risposte.

Gli XP sono ricompense motivazionali, non hanno valore monetario. I risultati vengono calcolati nell'app e la tabella applica vincoli e unicità per evitare duplicati accidentali.
