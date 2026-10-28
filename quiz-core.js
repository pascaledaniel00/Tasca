export const QUIZ_CATEGORIES = [
  { id: 'budget', label: 'Budget personale', description: 'Entrate, uscite e residuo' },
  { id: 'saving', label: 'Risparmio', description: 'Obiettivi e fondo di emergenza' },
  { id: 'debt', label: 'Rate e debiti', description: 'Impegni, costi e scadenze' },
  { id: 'spending', label: 'Spese quotidiane', description: 'Piccoli acquisti e abbonamenti' },
  { id: 'banking', label: 'Banche e pagamenti', description: 'Interessi e commissioni' },
  { id: 'economy', label: 'Economia di base', description: 'Inflazione e potere d’acquisto' },
];
export const VERIFIED_QUESTIONS = [
  { id:'budget-1', category:'budget', difficulty:1, question:'Hai 1.000 € di entrate e 760 € di uscite nel mese. Qual è il residuo prima di eventuali altri movimenti?', options:[{value:'A',label:'240 €'},{value:'B',label:'260 €'},{value:'C',label:'760 €'},{value:'D',label:'1.760 €'}], correctValues:['A'], explanation:'1.000 € meno 760 € di uscite lascia un residuo di 240 €.', hint:'Sottrai le uscite dalle entrate.' },
  { id:'budget-2', category:'budget', difficulty:1, question:'A cosa serve un budget per categoria?', options:[{value:'A',label:'A garantire che non ci saranno imprevisti'},{value:'B',label:'A stabilire un limite di spesa pianificato'},{value:'C',label:'A sostituire il saldo del conto'},{value:'D',label:'A registrare soltanto le spese grandi'}], correctValues:['B'], explanation:'Il budget assegna un limite pianificato a una categoria; non elimina gli imprevisti né sostituisce il saldo reale.', hint:'Pensa al budget come a un limite deciso prima di spendere.' },
  { id:'saving-1', category:'saving', difficulty:1, question:'Qual è una funzione tipica del fondo di emergenza?', options:[{value:'A',label:'Pagare esclusivamente gli acquisti desiderati'},{value:'B',label:'Sostituire tutte le entrate future'},{value:'C',label:'Affrontare spese impreviste essenziali'},{value:'D',label:'Garantire rendimenti elevati'}], correctValues:['C'], explanation:'Un fondo di emergenza aiuta ad affrontare spese impreviste senza ricorrere subito a nuovo debito.', hint:'Considera quale riserva può aiutare quando capita qualcosa di inatteso.' },
  { id:'saving-2', category:'saving', difficulty:2, question:'Vuoi creare un fondo da 600 € in 12 mesi, partendo da zero. Quanto dovresti accantonare ogni mese, senza considerare interessi?', options:[{value:'A',label:'25 €'},{value:'B',label:'40 €'},{value:'C',label:'50 €'},{value:'D',label:'60 €'}], correctValues:['C'], explanation:'600 € diviso 12 mesi equivale a 50 € al mese.', hint:'Dividi l’obiettivo per il numero di mesi disponibili.' },
  { id:'debt-1', category:'debt', difficulty:1, question:'Prima di accettare un acquisto a rate, quale controllo è più utile?', options:[{value:'A',label:'Guardare solo l’importo della prima rata'},{value:'B',label:'Verificare costo totale, condizioni e scadenze'},{value:'C',label:'Ignorare le rate già attive'},{value:'D',label:'Considerare la rata come un’entrata'}], correctValues:['B'], explanation:'Il costo totale e le condizioni mostrano l’impegno complessivo, mentre le scadenze aiutano a pianificare la liquidità.', hint:'Valuta l’intero impegno, non soltanto il pagamento mensile.' },
  { id:'debt-2', category:'debt', difficulty:2, question:'Hai tre rate mensili da 20 €, 35 € e 15 €. Quanto devi prevedere in totale per quel mese?', options:[{value:'A',label:'50 €'},{value:'B',label:'60 €'},{value:'C',label:'65 €'},{value:'D',label:'70 €'}], correctValues:['D'], explanation:'20 € + 35 € + 15 € = 70 €.', hint:'Somma tutti gli impegni mensili, senza contarne nessuno due volte.' },
  { id:'spending-1', category:'spending', difficulty:1, question:'Un acquisto ricorrente costa 3 € al giorno. Quanto costa in 30 giorni se lo fai ogni giorno?', options:[{value:'A',label:'30 €'},{value:'B',label:'60 €'},{value:'C',label:'90 €'},{value:'D',label:'120 €'}], correctValues:['C'], explanation:'3 € al giorno per 30 giorni equivale a 90 €.', hint:'Moltiplica il costo giornaliero per il numero di giorni.' },
  { id:'spending-2', category:'spending', difficulty:2, question:'Due abbonamenti costano 9 € e 14 € al mese. Qual è il costo totale in un anno se restano attivi tutti i 12 mesi?', options:[{value:'A',label:'23 €'},{value:'B',label:'138 €'},{value:'C',label:'252 €'},{value:'D',label:'276 €'}], correctValues:['D'], explanation:'I due abbonamenti costano 23 € al mese; 23 € × 12 = 276 €.', hint:'Prima somma i costi mensili, poi moltiplica per 12.' },
  { id:'banking-1', category:'banking', difficulty:1, question:'Che cosa rappresenta una commissione bancaria?', options:[{value:'A',label:'Un costo applicato per un servizio o un’operazione'},{value:'B',label:'Un rimborso garantito'},{value:'C',label:'Un interesse sempre positivo per il cliente'},{value:'D',label:'Un trasferimento tra i tuoi conti che aumenta il patrimonio'}], correctValues:['A'], explanation:'Una commissione è un costo associato a un servizio o a un’operazione, secondo le condizioni applicate.', hint:'Pensa a un importo addebitato per svolgere un’operazione.' },
  { id:'banking-2', category:'banking', difficulty:2, question:'Un deposito di 500 € matura un interesse semplice annuo del 2%, senza imposte né altri costi. Quanto interesse produce in un anno?', options:[{value:'A',label:'2 €'},{value:'B',label:'10 €'},{value:'C',label:'20 €'},{value:'D',label:'100 €'}], correctValues:['B'], explanation:'Il 2% di 500 € è 10 €. Il calcolo è illustrativo e non implica che un prodotto reale offra quel tasso.', hint:'Calcola il due per cento dell’importo iniziale.' },
  { id:'economy-1', category:'economy', difficulty:1, question:'Se i prezzi aumentano e il tuo reddito resta uguale, che cosa può succedere al potere d’acquisto?', options:[{value:'A',label:'Aumenta sempre'},{value:'B',label:'Resta sempre identico'},{value:'C',label:'Può diminuire'},{value:'D',label:'Diventa indipendente dai prezzi'}], correctValues:['C'], explanation:'Se i prezzi aumentano mentre il reddito nominale resta uguale, con lo stesso reddito puoi acquistare meno beni o servizi.', hint:'Chiediti quanti beni puoi comprare con la stessa somma.' },
  { id:'economy-2', category:'economy', difficulty:2, question:'Con un interesse composto, gli interessi maturati possono a loro volta generare interessi nei periodi successivi.', options:[{value:'A',label:'Vero'},{value:'B',label:'Falso'},{value:'C',label:'Solo se il capitale diminuisce'},{value:'D',label:'Solo quando non esistono costi'}], correctValues:['A'], explanation:'Nell’interesse composto gli interessi maturati si aggiungono al capitale su cui possono maturare interessi futuri, secondo le condizioni applicate.', hint:'Pensa a un capitale che cresce includendo anche gli interessi precedenti.' },
];
export function selectVerifiedQuestions({ category = 'all', count = 5, difficulty = 1, excludeIds = [] } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new RangeError('Il quiz deve contenere da 1 a 10 domande.');
  const excluded = new Set(excludeIds);
  let pool = VERIFIED_QUESTIONS.filter((q) => (category === 'all' || q.category === category) && q.difficulty <= difficulty + 1 && !excluded.has(q.id));
  if (pool.length < count) {
    const preferred = pool;
    const other = VERIFIED_QUESTIONS.filter((q) => !preferred.some((item) => item.id === q.id) && !excluded.has(q.id));
    pool = [...preferred, ...other];
  }
  if (pool.length < count) pool = VERIFIED_QUESTIONS;
  const daySeed = Math.floor(Date.now() / 86400000) % Math.max(pool.length, 1);
  pool = [...pool.slice(daySeed), ...pool.slice(0, daySeed)];
  return pool.slice(0, count).map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) }));
}
export function validateAIQuiz(value, { category = 'all', count = 5 } = {}) {
  let data = value;
  if (typeof data === 'string') {
    let cleaned = data
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    try {
      data = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try { data = JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
    }
  }
  if (Array.isArray(data)) data = { questions: data };
  if (!data || !Array.isArray(data.questions) || data.questions.length !== count) return null;
  const allowed = new Set(QUIZ_CATEGORIES.map((item) => item.id));
  const seen = new Set();
  const questions = [];
  for (const raw of data.questions) {
    if (!raw || typeof raw !== 'object') return null;
    const q = { ...raw };
    // Compatibilità con varianti comuni del formato prodotto dai modelli.
    if (typeof q.question !== 'string') q.question = q.text || q.prompt || '';
    if (!q.category && category !== 'all') q.category = category;
    if (!q.category && category === 'all') q.category = 'budget';
    if (!allowed.has(q.category) || (category !== 'all' && q.category !== category)) return null;
    if (typeof q.question !== 'string' || q.question.trim().length < 12 || q.question.length > 500) return null;
    if (!Array.isArray(q.options)) return null;
    q.options = q.options.map((option, index) => {
      if (typeof option === 'string') return { value: String.fromCharCode(65 + index), label: option };
      if (!option || typeof option !== 'object') return null;
      const label = option.label ?? option.text ?? option.content;
      const value = option.value ?? option.id ?? option.key ?? String.fromCharCode(65 + index);
      return typeof label === 'string' ? { value: String(value), label: label.trim() } : null;
    });
    if (q.options.length !== 4 || q.options.some((option) => !option || !option.label || option.label.length > 160)) return null;
    const optionValues = new Set(q.options.map((option) => option.value));
    if (optionValues.size !== 4) return null;
    let correct = q.correctValues;
    if (!Array.isArray(correct)) {
      const answer = q.correctValue ?? q.correctAnswer ?? q.correct_answer ?? q.answer ?? q.correctOption;
      if (answer !== undefined && answer !== null) {
        const answerText = String(typeof answer === 'object' ? answer.value ?? answer.label ?? '' : answer).trim();
        const byValue = q.options.find((option) => option.value === answerText);
        const byLabel = q.options.find((option) => option.label.toLocaleLowerCase('it-IT') === answerText.toLocaleLowerCase('it-IT'));
        const byLetter = q.options.find((option, index) => String.fromCharCode(65 + index) === answerText.toUpperCase());
        correct = [(byValue || byLabel || byLetter)?.value || ''];
      }
    }
    if (!Array.isArray(correct) || correct.length !== 1 || !optionValues.has(String(correct[0]))) return null;
    q.correctValues = [String(correct[0])];
    if (typeof q.explanation !== 'string') q.explanation = q.explanationText || q.rationale || '';
    if (typeof q.hint !== 'string') q.hint = q.indice || q.clue || '';
    if (q.explanation.trim().length < 8 || !q.hint.trim()) return null;
    const signature = q.question.trim().toLocaleLowerCase('it-IT');
    if (seen.has(signature)) return null;
    seen.add(signature);
    questions.push(q);
  }
  return { questions: questions.map((q, i) => ({ ...q, id: 'ai-' + i + '-' + Date.now(), difficulty: Number(q.difficulty) || 1 })) };
}
export function scoreQuiz(questions, answers) {
  const details = questions.map((question) => ({ id: question.id, correct: answers[question.id] === question.correctValues[0], selected: answers[question.id] ?? null, correctValue: question.correctValues[0] }));
  const correct = details.filter((item) => item.correct).length;
  return { correct, total: questions.length, percent: questions.length ? Math.round((correct / questions.length) * 100) : 0, details };
}
export function calculateQuizXP({ correct, total, firstCompletion = true, streakBonus = 0 } = {}) {
  const safeTotal = Math.max(0, Math.floor(total || 0));
  const safeCorrect = Math.max(0, Math.min(Number.isFinite(correct) ? Math.floor(correct) : 0, safeTotal));
  return Math.max(0, safeCorrect * 10 + (firstCompletion && safeTotal > 0 ? 10 : 0) + Math.max(0, Math.min(20, Math.floor(streakBonus || 0))));
}
export function getQuizLevel(xp) {
  const safeXP = Math.max(0, Number(xp) || 0);
  const levels = [{ level: 1, title: 'Curioso', minXP: 0 }, { level: 2, title: 'Esploratore', minXP: 100 }, { level: 3, title: 'Consapevole', minXP: 250 }, { level: 4, title: 'Stratega', minXP: 500 }, { level: 5, title: 'Maestro del budget', minXP: 900 }];
  return [...levels].reverse().find((item) => safeXP >= item.minXP) || levels[0];
}
export function getQuizBadges(attempts) {
  const completed = attempts.length;
  const correct = attempts.reduce((sum, item) => sum + (Number(item.correct_answers) || 0), 0);
  const questions = attempts.reduce((sum, item) => sum + (Number(item.total_questions) || 0), 0);
  const badges = [];
  if (completed >= 1) badges.push({ id:'first-quiz', name:'Primo passo', description:'Hai completato il primo quiz.', icon:'🌱' });
  if (completed >= 5) badges.push({ id:'five-quizzes', name:'Costanza', description:'Hai completato cinque quiz.', icon:'🔥' });
  if (questions >= 25) badges.push({ id:'twenty-five-questions', name:'Curiosità', description:'Hai affrontato 25 domande.', icon:'📚' });
  if (questions > 0 && correct / questions >= 0.8) badges.push({ id:'accuracy-80', name:'Occhio allenato', description:'Almeno l’80% di risposte corrette nello storico.', icon:'🎯' });
  if (completed >= 10) badges.push({ id:'ten-quizzes', name:'Inarrestabile', description:'Hai completato dieci quiz.', icon:'🏆' });
  return badges;
}
