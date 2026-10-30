import {
  budgetComparison,
  calculateParticipantBalances,
  categoryBreakdown,
  monthlyTrend,
  serializeFinanceCsv,
  settlementPlan,
  summarizeTransactions,
  validateRecurringPlanInput,
  validateTransactionInput,
} from './finance-core.js';
import {
  normalizeStatementRows,
  findStatementDuplicates,
  compareTransactionForDuplicate,
  statementImportSummary,
} from './statement-import-core.js?v=20261030-2';
import {
  calculateQuizXP,
  getQuizBadges,
  getQuizLevel,
  scoreQuiz,
  selectVerifiedQuestions,
  validateAIQuiz,
  QUIZ_CATEGORIES,
} from './quiz-core.js?v=20261029-2';

(() => {
  'use strict';

  /* CONFIGURAZIONE: usa solo la chiave pubblica Supabase (publishable/anon). */
  const SUPABASE_URL = 'https://njgmlxyecjyreieqcpwk.supabase.co';
  const SUPABASE_PUBLIC_KEY = 'sb_publishable_U6dgmohD5p7Z5jxcwHLZSg_MoR2cjz1';
  // URL pubblico del Worker Cloudflare. Inserire l'URL workers.dev dopo la pubblicazione.
  const AI_WORKER_URL = 'https://tasca.pascaledaniel00.workers.dev';

  const CATEGORIES = {
    expense: [
      'Casa e affitto',
      'Auto e assicurazione',
      'Carburante',
      'Parcheggi',
      'Manutenzione auto',
      'Parcheggi e manutenzione',
      'Alimentari e supermercato',
      'Bar, colazioni e snack',
      'Pranzi fuori casa',
      'Cene, aperitivi e ristoranti',
      'Trasporti pubblici e taxi',
      'Telefono e rate tecnologiche',
      'Abbonamenti e intrattenimento',
      'Shopping e cura personale',
      'Salute e farmacia',
      'Sport e tempo libero',
      'Regali, viaggi e vacanze',
      'Commissioni bancarie e finanziarie',
      'Rate e pagamenti dilazionati',
      'Altre spese personali',
      'Da verificare',
    ],
    income: ['Stipendio', 'Rimborso ricevuto', 'Regalo o entrata occasionale', 'Altre entrate'],
    transfer: ['Trasferimento tra conti'],
    refund: ['Rimborso ricevuto'],
  };
  const $ = (id) => document.getElementById(id);
  const eur = (n) =>
    new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(n) || 0);
  const today = () => new Date().toLocaleDateString('sv-SE');
  const monthNow = () => today().slice(0, 7);
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  const validConfig = () =>
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('INSERISCI') &&
    SUPABASE_PUBLIC_KEY &&
    !SUPABASE_PUBLIC_KEY.includes('INSERISCI');
  let db = null,
    user = null,
    page = 'home',
    transactions = [],
    budgets = [],
    recurring = [],
    spaces = [],
    editingTransaction = null,
    editingBudget = null,
    editingRecurring = null,
    selectedSpace = null,
    activeSpaceId = null,
    transactionSpaceId = null,
    toastTimer = null,
    quizAttempts = [],
    quizSchemaReady = false,
    quizQuestions = [],
    quizAnswers = {},
    quizIndex = 0,
    quizSource = 'verified',
    quizAttemptKey = null,
    quizSaving = false;
  let shortcutImportRunning = false,
    dataLoadSequence = 0,
    transactionSaving = false;
  let aiNudgeKey = '',
    aiNudgeText = '',
    aiNudgePending = false,
    aiAdviceKey = '',
    aiAdviceText = '',
    aiAdvicePending = false,
    aiChatMessages = [],
    aiChatPending = false;
  let goal = 40;
  try {
    goal = Math.max(0, Number(localStorage.getItem('tasca_monthly_goal') ?? 40));
  } catch {}

  // Mantiene in locale la sessione quiz per riprenderla anche dopo una navigazione o un refresh.
  // La chiave è separata per account, così non si mescolano sessioni di utenti diversi.
  function quizSessionStorageKey() {
    return user?.id ? 'tasca_quiz_session:' + user.id : null;
  }
  function clearQuizSession() {
    try {
      const key = quizSessionStorageKey();
      if (key) localStorage.removeItem(key);
    } catch {}
  }
  function persistQuizSession() {
    const key = quizSessionStorageKey();
    if (!key || !quizQuestions.length || quizIndex >= quizQuestions.length || quizSaving) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          userId: user.id,
          questions: quizQuestions,
          answers: quizAnswers,
          index: quizIndex,
          source: quizSource,
          attemptKey: quizAttemptKey,
          category: $('quizCategory')?.value || 'budget',
          difficulty: Number($('quizDifficulty')?.value) || 1,
          savedAt: Date.now(),
        })
      );
    } catch (error) {
      console.warn('Tasca: non riesco a salvare localmente la sessione quiz.', error);
    }
  }
  function restoreQuizSession() {
    const key = quizSessionStorageKey();
    if (!key || quizQuestions.length) return Boolean(quizQuestions.length);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (
        !saved ||
        saved.userId !== user?.id ||
        !Array.isArray(saved.questions) ||
        !saved.questions.length ||
        !Number.isInteger(saved.index) ||
        saved.index < 0 ||
        saved.index >= saved.questions.length ||
        !saved.answers ||
        typeof saved.answers !== 'object'
      )
        return false;
      quizQuestions = saved.questions;
      quizAnswers = saved.answers;
      quizIndex = saved.index;
      quizSource = saved.source === 'ai' ? 'ai' : 'verified';
      quizAttemptKey = typeof saved.attemptKey === 'string' ? saved.attemptKey : null;
      if ($('quizCategory') && saved.category) $('quizCategory').value = saved.category;
      if ($('quizDifficulty') && saved.difficulty)
        $('quizDifficulty').value = String(saved.difficulty);
      return true;
    } catch (error) {
      console.warn('Tasca: sessione quiz salvata non leggibile.', error);
      return false;
    }
  }
  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = $('themeColorMeta');
    const label = $('themeSettingLabel'),
      button = $('themeModeToggle');
    if (label) label.textContent = 'Tema attuale: ' + (dark ? 'scuro' : 'chiaro');
    if (button) button.textContent = dark ? 'Attiva modalità chiara' : 'Attiva modalità scura';
    if (meta) meta.content = dark ? '#121916' : '#173D32';
  }
  function initTheme() {
    let saved = 'light';
    try {
      saved = localStorage.getItem('tasca_theme') || 'light';
    } catch {}
    if (saved !== 'dark' && saved !== 'light') saved = 'light';
    applyTheme(saved);
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('tasca_theme', next);
    } catch {}
  }
  function notify(message, type = 'ok') {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    el.style.background = type === 'error' ? '#B84C43' : '#1E2924';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }
  function notice(message, type = '') {
    const el = $('globalNotice');
    el.textContent = message || '';
    el.className = 'notice' + (type ? ' ' + type : '');
  }
  function showAuthMessage(message, type = '') {
    const el = $('authNotice');
    el.textContent = message;
    el.className = 'notice' + (type ? ' ' + type : '');
  }
  function showPage(name) {
    page = name;
    document
      .querySelectorAll('.section')
      .forEach((x) => x.classList.toggle('active', x.id === 'page-' + name));
    document
      .querySelectorAll('[data-page]')
      .forEach((x) => x.classList.toggle('active', x.dataset.page === name));
    if (window.matchMedia('(max-width: 720px)').matches) {
      const dockTrack = $('mobileNavTrack');
      const targetPage = dockTrack?.querySelector(
        '.mobile-nav-page[data-nav-page="' +
          (['spaces', 'recurring', 'advice', 'settings'].includes(name) ? 'secondary' : 'primary') +
          '"]'
      );
      if (targetPage) dockTrack.scrollLeft = targetPage.offsetLeft;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'quiz') {
      if (quizQuestions.length && quizIndex < quizQuestions.length) renderQuizQuestion();
      else if (restoreQuizSession()) renderQuizQuestion();
      else renderQuizHome();
    }
  }
  function openModal(title, html) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modal').classList.add('open');
  }
  function closeModal(force = false) {
    if (transactionSaving && !force) return;
    $('modal').classList.remove('open');
    $('modalBody').innerHTML = '';
    closeAccountPopover();
  }
  function requestDuplicateDecision(existing, candidate, existingLabel = 'Movimento già registrato', candidateLabel = 'Nuovo movimento') {
    return new Promise((resolve) => {
      const details = (item) => `<div class="panel"><strong>${esc(item.description || 'Senza descrizione')}</strong><p class="muted tiny">${esc(fmtDate(txDate(item) || item.occurred_on))} · ${eur(item.amount)} · ${esc(item.payment_method || 'Metodo non specificato')}</p></div>`;
      openModal('Verifica possibile duplicato', `
        <p>Importo e data sono simili, ma non possiamo stabilire con certezza se si tratti dello stesso pagamento. Confronta i due movimenti:</p>
        <div class="formgrid"><div class="field"><label>${esc(existingLabel)}</label>${details(existing)}</div><div class="field"><label>${esc(candidateLabel)}</label>${details(candidate)}</div></div>
        <p class="muted tiny">La scelta “Tieni entrambi” registra due spese distinte. Se scegli una sola versione, Tasca conserva la tracciabilità della riconciliazione nelle note.</p>
        <div class="layout">
          <button class="btn full" type="button" data-duplicate-choice="keep-existing">Tieni il movimento già registrato</button>
          <button class="btn full" type="button" data-duplicate-choice="keep-candidate">Tieni il nuovo movimento</button>
          <button class="btn primary full" type="button" data-duplicate-choice="keep-both">Sono due spese diverse · tieni entrambi</button>
        </div>`);
      const body = $('modalBody');
      const finish = (choice) => {
        body?.querySelectorAll('[data-duplicate-choice]').forEach((button) => button.removeEventListener('click', button._duplicateHandler));
        closeModal(true);
        resolve(choice);
      };
      body?.querySelectorAll('[data-duplicate-choice]').forEach((button) => {
        button._duplicateHandler = () => finish(button.dataset.duplicateChoice);
        button.addEventListener('click', button._duplicateHandler);
      });
    });
  }
  async function updateTransactionFromDuplicate(existing, candidate, sourceLabel) {
    const previous = `Riconciliazione: mantenuta la versione ${sourceLabel}. Dati precedenti: ${existing.description || '—'} · ${txDate(existing)} · ${eur(existing.amount)} · ${existing.payment_method || 'metodo non specificato'}.`;
    const notes = [existing.notes, previous, candidate.notes].filter(Boolean).join(' · ').slice(0, 1000);
    const { error } = await db.from('transactions').update({
      description: String(candidate.description || existing.description).slice(0, 160),
      occurred_on: candidate.occurred_on || txDate(existing),
      payment_method: candidate.payment_method || existing.payment_method || null,
      notes,
    }).eq('id', existing.id).eq('space_id', existing.space_id);
    if (error) throw error;
  }
  function closeAccountPopover() {
    const p = $('accountPopover');
    if (p) {
      p.classList.remove('open');
      p.innerHTML = '';
    }
    $('accountBtn')?.setAttribute('aria-expanded', 'false');
  }
  function moneyInput(value = '') {
    return `<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${esc(value)}" placeholder="0,00">`;
  }
  function categoriesOptions(type, selected = '') {
    const list = CATEGORIES[type] || CATEGORIES.expense;
    return list
      .map(
        (c) => `<option ${c === selected ? 'selected' : ''} value="${esc(c)}">${esc(c)}</option>`
      )
      .join('');
  }
  function typeLabel(t) {
    return (
      {
        expense: 'Uscita',
        income: 'Entrata',
        transfer: 'Trasferimento',
        refund: 'Rimborso',
      }[t] || t
    );
  }
  function typeSign(t) {
    return t === 'income' || t === 'refund' ? '+' : t === 'transfer' ? '↔' : '−';
  }
  function txDate(t) {
    return t?.occurred_on || t?.date || '';
  }
  function budgetMonth(b) {
    return String(b.month_start || b.month || '').slice(0, 7);
  }
  function planDue(r) {
    return r.next_due_on || r.next_due || '';
  }
  function planActive(r) {
    return (r.status || (r.active ? 'active' : 'paused')) === 'active';
  }
  const ALL_SPACES = '__all_spaces__';
  function activeSpace() {
    return spaces.find((s) => s.id === activeSpaceId) || null;
  }
  function isAllSpaces() {
    return activeSpaceId === ALL_SPACES;
  }
  function requireSpecificSpace(action) {
    if (!isAllSpaces()) return true;
    notify('Per ' + action + ' seleziona prima uno spazio specifico.', 'error');
    return false;
  }
  function scopedTransactions() {
    return transactions.filter((t) => isAllSpaces() || t.space_id === activeSpaceId);
  }
  function scopedBudgets() {
    return budgets.filter((b) => isAllSpaces() || b.space_id === activeSpaceId);
  }
  function scopedRecurring() {
    return recurring.filter((r) => isAllSpaces() || r.space_id === activeSpaceId);
  }
  function renderSpaceSelector() {
    const select = $('activeSpaceSelect');
    if (!select) return;
    if (!spaces.length) {
      select.innerHTML = '<option value="">Nessuno spazio disponibile</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML =
      '<option value="' +
      ALL_SPACES +
      '">Tutti gli spazi</option>' +
      spaces
        .map(
          (s) =>
            '<option value="' +
            esc(s.id) +
            '">' +
            esc(s.name) +
            ' · ' +
            (s.space_type === 'personal'
              ? 'Personale'
              : s.space_type === 'trip'
                ? 'Progetto'
                : 'Condiviso') +
            '</option>'
        )
        .join('');
    if (activeSpaceId !== ALL_SPACES && !spaces.some((s) => s.id === activeSpaceId))
      activeSpaceId = (spaces.find((s) => s.space_type === 'personal') || spaces[0]).id;
    select.value = activeSpaceId || ALL_SPACES;
  }
  function monthRows(month) {
    return scopedTransactions().filter((t) => txDate(t).slice(0, 7) === month);
  }
  function monthSummary(month = monthNow()) {
    return summarizeTransactions(monthRows(month));
  }
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('it-IT');
  }
  function movementHtml(t, actions = false) {
    const positive = t.type === 'income' || t.type === 'refund';
    return `<div class="movement"><div class="movicon">${t.type === 'income' ? '↗' : t.type === 'transfer' ? '⇄' : t.type === 'refund' ? '↩' : '↘'}</div><div class="movinfo"><strong>${esc(t.description || t.category || typeLabel(t.type))}</strong><small>${esc(fmtDate(txDate(t)))} · ${esc(t.category || typeLabel(t.type))}${t.payment_method ? ' · ' + esc(t.payment_method) : ''}${t.status && t.status !== 'confirmed' ? ' · ' + esc(t.status === 'planned' ? 'Previsto' : 'Da verificare') : ''}</small></div><div class="amount ${positive ? 'income' : t.type === 'expense' ? 'expense' : ''}">${typeSign(t.type)} ${eur(t.amount)}</div>${actions ? `<div class="row-actions"><button class="btn small" data-edit-tx="${esc(t.id)}">Modifica</button><button class="btn small danger" data-delete-tx="${esc(t.id)}">Elimina</button></div>` : ''}</div>`;
  }
  function emptyHtml(title, body) {
    return `<div class="empty"><b>${esc(title)}</b>${esc(body)}</div>`;
  }
  function isConfirmedMovement(t) {
    return !t?.status || t.status === 'confirmed';
  }
  function monthBudgetSpend(b) {
    return transactions
      .filter(
        (t) =>
          isConfirmedMovement(t) &&
          t.space_id === b.space_id &&
          t.type === 'expense' &&
          txDate(t).slice(0, 7) === budgetMonth(b) &&
          t.category === b.category
      )
      .reduce((s, t) => s + Number(t.amount || 0), 0);
  }
  function isAIConfigured() {
    return (
      typeof AI_WORKER_URL === 'string' &&
      AI_WORKER_URL.startsWith('https://') &&
      !AI_WORKER_URL.includes('INSERISCI') &&
      !AI_WORKER_URL.includes('<')
    );
  }
  function getDisplayName() {
    const meta = (user && user.user_metadata) || {};
    return String(meta.full_name || meta.name || '').trim() || 'utente';
  }
  async function callTascaAI(task, data) {
    if (!isAIConfigured()) {
      throw new Error('Il servizio IA non è configurato: manca l’URL del Worker.');
    }
    if (!db || !user) {
      throw new Error('Non risulti autenticato. Esci da Tasca e accedi di nuovo.');
    }

    let sessionData;
    try {
      const sessionResult = await db.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      sessionData = sessionResult.data;
    } catch (error) {
      throw new Error('Non riesco a verificare la sessione. Prova a uscire e accedere di nuovo.');
    }

    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      throw new Error('La sessione di accesso è scaduta. Esci da Tasca e accedi di nuovo.');
    }

    const controller = new AbortController();
    // Mantiene una finestra ragionevole per la generazione; gli errori non-quota non attivano il fallback verificato.
    const timeoutMs = 45000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response;
      try {
        response = await fetch(AI_WORKER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + accessToken,
          },
          body: JSON.stringify({ task, data }),
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('La richiesta ha superato il limite di attesa. Riprova più tardi.');
        }
        throw new Error(
          'Non riesco a raggiungere il servizio IA. Verifica la connessione o l’indirizzo del Worker.'
        );
      }

      let result = {};
      try {
        result = await response.json();
      } catch {
        throw new Error(
          'Il Worker ha restituito una risposta non leggibile (HTTP ' + response.status + ').'
        );
      }

      if (!response.ok) {
        const details =
          typeof result.error === 'string' ? result.error : 'errore HTTP ' + response.status;
        const diagnostic =
          typeof result.diagnostic === 'string' ? ' Dettaglio: ' + result.diagnostic : '';
        const keys =
          typeof result.responseKeys === 'string' ? ' Campi ricevuti: ' + result.responseKeys : '';
        const error = new Error(details + diagnostic + keys);
        error.code = typeof result.code === 'string' ? result.code : '';
        throw error;
      }

      if (typeof result.text !== 'string' || !result.text.trim()) {
        throw new Error('Il Worker ha risposto, ma non ha restituito consigli testuali.');
      }

      return result.text.trim().slice(0, task === 'quiz' ? 9000 : 5000);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async function requestAINudge(data) {
    if (!isAIConfigured()) return null;
    const key = JSON.stringify(data);
    if (key === aiNudgeKey) return aiNudgeText || null;
    if (aiNudgePending) return null;
    aiNudgePending = true;
    aiNudgeKey = key;
    try {
      const text = await callTascaAI('nudge', data);
      if (text && aiNudgeKey === key) {
        aiNudgeText = text;
        return text;
      }
      return null;
    } catch (error) {
      console.warn('Tasca AI frase budget:', error.message);
      return null;
    } finally {
      aiNudgePending = false;
    }
  }
  function buildAdviceSnapshot() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const fromMonth = start.toLocaleDateString('sv-SE').slice(0, 7);
    const allRows = scopedTransactions().filter((t) => txDate(t).slice(0, 7) >= fromMonth);
    const rows = allRows.filter(isConfirmedMovement);
    const months = {};
    rows.forEach((t) => {
      const month = txDate(t).slice(0, 7);
      if (!months[month])
        months[month] = {
          month,
          income: 0,
          expenses: 0,
          categories: {},
          smallExpensesCount: 0,
          smallExpensesTotal: 0,
        };
      const m = months[month];
      const amount = Number(t.amount) || 0;
      if (t.type === 'income') m.income += amount;
      if (t.type === 'expense') {
        m.expenses += amount;
        const category = t.category || 'Da classificare';
        m.categories[category] = (m.categories[category] || 0) + amount;
        if (amount <= 5) {
          m.smallExpensesCount += 1;
          m.smallExpensesTotal += amount;
        }
      }
    });
    const compactMonths = Object.values(months)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => {
        const ranked = Object.entries(m.categories).sort((a, b) => b[1] - a[1]);
        const keep = ranked.slice(0, 8);
        const otherTotal = ranked.slice(8).reduce((sum, item) => sum + item[1], 0);
        return {
          month: m.month,
          income: Math.round(m.income * 100) / 100,
          expenses: Math.round(m.expenses * 100) / 100,
          categories: Object.fromEntries(
            keep
              .map(([name, amount]) => [name, Math.round(amount * 100) / 100])
              .concat(
                otherTotal > 0 ? [['Altre categorie', Math.round(otherTotal * 100) / 100]] : []
              )
          ),
          smallExpensesCount: m.smallExpensesCount,
          smallExpensesTotal: Math.round(m.smallExpensesTotal * 100) / 100,
        };
      });
    const historyBudgets = scopedBudgets()
      .filter((b) => budgetMonth(b) >= fromMonth && budgetMonth(b) <= monthNow())
      .map((b) => {
        const month = budgetMonth(b);
        const spent = rows
          .filter(
            (t) =>
              t.type === 'expense' && txDate(t).slice(0, 7) === month && t.category === b.category
          )
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        return {
          month,
          category: String(b.category || 'Da classificare').slice(0, 70),
          budget: Number(b.amount) || 0,
          spent,
        };
      })
      .slice(-80);
    return {
      displayName: getDisplayName(),
      currentMonth: monthNow(),
      goal,
      months: compactMonths,
      budgets: historyBudgets,
      recurring: scopedRecurring()
        .filter((r) => planActive(r))
        .map((r) => ({
          name: String(r.name || 'Ricorrenza').slice(0, 70),
          category: String(r.category || 'Da classificare').slice(0, 70),
          amount: Number(r.amount) || 0,
          cadence: r.cadence,
        }))
        .slice(0, 20),
      dataQualityFlags: {
        transactionsToVerify: allRows.filter((t) => t.status === 'verify').length,
        transactionsPlanned: allRows.filter((t) => t.status === 'planned').length,
        monthsOfHistoryAvailable: Object.keys(months).length,
      },
    };
  }
  async function requestAIAdvice(force = false) {
    if (!isAIConfigured()) return null;
    const snapshot = buildAdviceSnapshot();
    const key = JSON.stringify(snapshot);
    if (!force && key === aiAdviceKey) return aiAdviceText || null;
    if (aiAdvicePending) return null;
    aiAdvicePending = true;
    aiAdviceKey = key;
    aiAdviceText = 'Sto analizzando i dati disponibili e lo storico…';
    try {
      const text = await callTascaAI('advice', snapshot);
      if (text && aiAdviceKey === key) aiAdviceText = text;
      else if (aiAdviceKey === key)
        aiAdviceText = 'Il servizio IA non ha restituito consigli. Riprova tra poco.';
      renderAdvice();
      return text;
    } catch (error) {
      const message = error?.message || 'errore di connessione';
      console.warn('Tasca: richiesta dei consigli IA non riuscita:', message);
      if (aiAdviceKey === key) {
        aiAdviceText = 'Consigli IA non disponibili: ' + message;
      }
      renderAdvice();
      return null;
    } finally {
      aiAdvicePending = false;
    }
  }
  function renderHome() {
    const s = monthSummary();
    $('heroBalance').textContent = eur(s.residual);
    $('heroSubtitle').textContent =
      `${eur(s.income)} di entrate · ${eur(s.expense)} di uscite registrate a ${new Date().toLocaleDateString('it-IT', { month: 'long' })}.`;
    $('goalValue').textContent = eur(goal);
    $('goalCaption').textContent =
      s.residual >= goal
        ? `Obiettivo raggiunto: ${eur(s.residual - goal)} oltre il target`
        : `Mancano ${eur(goal - s.residual)} per raggiungere il target`;
    const p =
      goal === 0
        ? s.residual >= 0
          ? 100
          : 0
        : Math.max(0, Math.min(100, (s.residual / goal) * 100));
    $('goalProgress').style.width = p + '%';
    $('incomeTotal').textContent = eur(s.income);
    $('expenseTotal').textContent = eur(s.expense);
    $('monthResidual').textContent = eur(s.residual);
    $('residualCaption').textContent =
      s.residual >= goal ? 'Target raggiunto o superato' : 'Sotto il target mensile';
    const recent = [...scopedTransactions()]
      .sort((a, b) => txDate(b).localeCompare(txDate(a)))
      .slice(0, 5);
    $('recentMovements').innerHTML =
      recent.map((t) => movementHtml(t)).join('') ||
      emptyHtml('Nessun movimento ancora', 'Aggiungi la prima entrata o spesa.');
    const bs = scopedBudgets()
      .filter((b) => budgetMonth(b) === monthNow())
      .slice(0, 5);
    $('homeBudgets').innerHTML =
      bs
        .map((b) => {
          const spent = monthBudgetSpend(b),
            pct = Number(b.amount) > 0 ? (spent / Number(b.amount)) * 100 : 0;
          return `<div class="budgetrow"><div class="btop"><span>${esc(b.category)}</span><span>${eur(spent)} / ${eur(b.amount)}</span></div><div class="budgetbar"><span class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(100, pct)}%"></span></div></div>`;
        })
        .join('') ||
      emptyHtml('Nessun budget per questo mese', 'Crea un limite per una categoria di spesa.');
    const playful = $('homeBudgetNudge');
    if (playful) {
      const pressured = bs
        .map((b) => ({
          category: b.category,
          pct: Number(b.amount) > 0 ? (monthBudgetSpend(b) / Number(b.amount)) * 100 : 0,
        }))
        .sort((a, b) => b.pct - a.pct)[0];
      const day = new Date().getDate();
      const recentLargeExpenses = scopedTransactions()
        .filter((t) => isConfirmedMovement(t) && t.type === 'expense' && txDate(t).slice(0, 7) === monthNow())
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
        .slice(0, 3)
        .map((t) => ({
          description: String(t.description || t.category || 'Spesa').slice(0, 80),
          category: t.category || 'Da classificare',
          amount: Number(t.amount) || 0,
          date: txDate(t),
        }));
      const frequentItems = (() => {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 5, 1);
        const fromMonth = cutoff.toLocaleDateString('sv-SE').slice(0, 7);
        const grouped = new Map();
        scopedTransactions()
          .filter(
            (t) =>
              isConfirmedMovement(t) &&
              t.type === 'expense' &&
              txDate(t).slice(0, 7) >= fromMonth &&
              String(t.description || '').trim()
          )
          .forEach((t) => {
            const description = String(t.description).trim().replace(/\\s+/g, ' ');
            const key = description
              .normalize('NFD')
              .replace(/[\\u0300-\\u036f]/g, '')
              .toLocaleLowerCase('it-IT')
              .replace(/[^a-z0-9 ]/g, '')
              .trim();
            if (!key) return;
            const item = grouped.get(key) || {
              description: description.slice(0, 80),
              count: 0,
              total: 0,
              category: t.category || 'Da classificare',
            };
            item.count += 1;
            item.total += Number(t.amount) || 0;
            grouped.set(key, item);
          });
        return [...grouped.values()]
          .filter((item) => item.count >= 2)
          .sort((x, y) => y.count - x.count || y.total - x.total)
          .slice(0, 5)
          .map((item) => ({
            description: item.description,
            count: item.count,
            total: Math.round(item.total * 100) / 100,
            category: item.category,
          }));
      })();
      const exceptional = recentLargeExpenses.find((t) => t.amount >= 1000);
      let message =
        'Movimenti sotto controllo: continua a registrare anche le spese piccole, così il saldo racconta la situazione reale.';
      if (exceptional) {
        message =
          s.residual < 0
            ? `La spesa da ${eur(exceptional.amount)} per “${exceptional.description}” pesa sul mese: con il saldo in rosso, stop alle spese non essenziali.`
            : `La spesa da ${eur(exceptional.amount)} per “${exceptional.description}” è l’eccezione del mese: tienila presente prima di altre uscite.`;
      } else if (
        s.residual < 0 &&
        day >= new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - 3
      ) {
        message = `Saldo mensile in rosso a ${day} del mese: per questi ultimi giorni, niente spese non essenziali.`;
      } else if (pressured && pressured.pct >= 100) {
        message = `Budget “${pressured.category}” superato: congela le spese di questa categoria fino al prossimo mese.`;
      } else if (s.residual < goal) {
        message = `Il residuo è ${eur(s.residual)}: per raggiungere il tuo obiettivo di ${eur(goal)} mancano ${eur(goal - s.residual)}.`;
      } else if (pressured && pressured.pct >= 75) {
        message = `Attenzione al budget “${pressured.category}”: sei al ${Math.round(pressured.pct)}%. Valuta le prossime uscite prima di spendere.`;
      }
      playful.classList.add('is-loading');
      playful.setAttribute('aria-label', 'Generazione del promemoria IA in corso');
      playful.innerHTML = '<span class="nudge-loader" aria-hidden="true"></span>';
      requestAINudge({
        displayName: getDisplayName(),
        month: monthNow(),
        day,
        daysInMonth: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
        income: s.income,
        expense: s.expense,
        residual: s.residual,
        goal,
        daysLeft: Math.max(
          0,
          new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - day
        ),
        recentLargeExpenses,
        frequentItems,
        budgets: bs.map((b) => {
          const spent = monthBudgetSpend(b);
          const limit = Number(b.amount) || 0;
          return {
            category: b.category,
            limit,
            spent,
            percent: limit > 0 ? Math.round((spent / limit) * 100) : 0,
          };
        }),
      }).then((aiText) => {
        if (!playful) return;
        playful.classList.remove('is-loading');
        playful.removeAttribute('aria-label');
        playful.textContent = aiText || message;
      });
    }
    renderDashboardCharts();
  }
  function renderDashboardCharts() {
    const rows = scopedTransactions();
    const month = monthNow();
    const trend = monthlyTrend(rows, month, 6);
    const maxTrend = Math.max(1, ...trend.flatMap((item) => [item.income, item.expense]));

    $('spendingTrendChart').innerHTML = trend
      .map((item) => {
        const label = new Date(item.month + '-15T12:00:00').toLocaleDateString('it-IT', {
          month: 'short',
        });
        const incomeHeight = item.income > 0 ? Math.max(3, (item.income / maxTrend) * 100) : 0;
        const expenseHeight = item.expense > 0 ? Math.max(3, (item.expense / maxTrend) * 100) : 0;
        return `<div class="trend-month" aria-label="${esc(label)}: entrate ${eur(item.income)}, uscite ${eur(item.expense)}"><div class="trend-bars"><span class="trend-bar income" style="height:${incomeHeight}%"></span><span class="trend-bar expense" style="height:${expenseHeight}%"></span></div><span class="trend-label">${esc(label)}</span></div>`;
      })
      .join('');

    const categories = categoryBreakdown(rows, month, 5);
    const categoryTotal = categories.reduce((sum, item) => sum + item.amount, 0);
    const palette = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];
    let angle = 0;
    const segments = categories.map((item, index) => {
      const start = angle;
      angle += categoryTotal > 0 ? (item.amount / categoryTotal) * 360 : 0;
      return `var(${palette[index % palette.length]}) ${start}deg ${angle}deg`;
    });
    const donut = $('categoryDonut');
    donut.style.background =
      categoryTotal > 0 && segments.length
        ? `conic-gradient(${segments.join(', ')})`
        : 'var(--line)';
    donut.setAttribute(
      'aria-label',
      categoryTotal > 0
        ? 'Distribuzione delle uscite per categoria'
        : 'Nessuna uscita registrata nel mese'
    );
    $('categoryDonutTotal').textContent = eur(categoryTotal);
    $('categoryLegend').innerHTML =
      categories
        .map((item, index) => {
          const percent = categoryTotal > 0 ? (item.amount / categoryTotal) * 100 : 0;
          return `<div class="chart-legend-row"><span class="legend-dot" style="--dot-color:var(${palette[index % palette.length]})"></span><span class="legend-name">${esc(item.category)}</span><strong>${eur(item.amount)}</strong><small>${Math.round(percent)}%</small></div>`;
        })
        .join('') ||
      emptyHtml('Nessuna uscita', 'Le categorie compariranno dopo aver registrato le spese.');

    const comparisons = budgetComparison(scopedBudgets(), rows, month, 4);
    $('budgetComparisonChart').innerHTML =
      comparisons
        .map((item) => {
          const percent = Math.max(0, Math.min(100, item.percent));
          const status =
            item.remaining < 0
              ? 'Superato di ' + eur(Math.abs(item.remaining))
              : 'Residuo ' + eur(item.remaining);
          return `<div class="chart-budget-row"><div class="chart-budget-head"><span>${esc(item.category)}</span><strong>${eur(item.spent)} <small>/ ${eur(item.amount)}</small></strong></div><div class="budgetbar"><span class="${item.percent > 100 ? 'over' : ''}" style="width:${percent}%"></span></div><div class="chart-budget-foot ${item.remaining < 0 ? 'over-text' : ''}">${status} · ${Math.round(item.percent)}%</div></div>`;
        })
        .join('') ||
      emptyHtml('Nessun budget attivo', 'Crea un budget per confrontare limite e spesa.');
  }
  let statementImportRows = [];
  let statementImportDecisions = {};
  function renderStatementPreview() {
    const target = $('statementImportPreview');
    if (!target) return;
    const summary = statementImportSummary(statementImportRows);
    const rows = statementImportRows;
    const unresolved = rows.filter((row) => row.possibleDuplicate && !statementImportDecisions[row.sourceRow]).length;
    const ready = rows.filter((row) => row.status === 'needs_review' && !row.duplicate && (!row.possibleDuplicate || statementImportDecisions[row.sourceRow] === 'keep-both' || statementImportDecisions[row.sourceRow] === 'keep-candidate')).length;
    target.innerHTML = rows.length ? `
      <div class="notice tiny">Righe: ${summary.total} · Importabili: ${ready} · Duplicati probabili: ${summary.duplicates} · Corrispondenze da decidere: ${unresolved} · Righe incomplete: ${summary.invalid + summary.review}</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Riga</th><th>Data</th><th>Descrizione</th><th>Tipo</th><th>Importo</th><th>Esito</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${row.sourceRow}</td><td>${esc(row.occurred_on || '—')}</td><td>${esc(row.description || 'Descrizione mancante')}</td><td>${esc(row.type)}</td><td>${row.amount == null ? '—' : eur(row.amount)}</td><td>${row.duplicate ? 'Duplicato probabile · escluso' : row.possibleDuplicate ? (statementImportDecisions[row.sourceRow] ? 'Decisione: ' + esc(statementImportDecisions[row.sourceRow]) : 'Confronto da decidere') : row.status === 'invalid' ? 'Dati incompleti' : 'Da verificare'}</td></tr>`).join('')}
      </tbody></table></div>
      ${rows.filter((row) => row.possibleDuplicate).map((row) => {
        const match = row.duplicateSource === 'existing' ? transactions.find((tx) => tx.id === row.duplicateOf) : rows.find((item) => item.sourceRow === row.duplicateOf);
        const decision = statementImportDecisions[row.sourceRow];
        return `<div class="panel"><strong>Possibile corrispondenza · riga ${row.sourceRow}</strong><div class="formgrid"><div class="field"><label>${row.duplicateSource === 'existing' ? 'Movimento già registrato' : 'Movimento precedente nel file'}</label><p>${esc(match?.description || 'Movimento non disponibile')}</p><small class="muted">${esc(match ? fmtDate(txDate(match) || match.occurred_on) : '—')} · ${eur(match?.amount)} · ${esc(match?.payment_method || 'Metodo non specificato')}</small></div><div class="field"><label>Movimento da importare</label><p>${esc(row.description)}</p><small class="muted">${esc(fmtDate(row.occurred_on))} · ${eur(row.amount)} · Metodo: non indicato nell’estratto</small></div></div><div class="row"><button class="btn small" type="button" data-statement-decision="keep-existing" data-source-row="${row.sourceRow}">Tieni il precedente</button><button class="btn small" type="button" data-statement-decision="keep-candidate" data-source-row="${row.sourceRow}">Tieni quello bancario</button><button class="btn small primary" type="button" data-statement-decision="keep-both" data-source-row="${row.sourceRow}">Sono due spese · tieni entrambi</button></div>${decision ? '<p class="muted tiny">Scelta: ' + esc(decision) + '</p>' : '<p class="muted tiny">In attesa della tua scelta: nessuna nuova spesa verrà registrata.</p>'}</div>`;
      }).join('')}
      ${summary.total > 100 ? '<p class="muted tiny">Sono visualizzate tutte le righe del file.</p>' : ''}
      <button id="confirmStatementImport" class="btn primary" type="button" ${ready && !unresolved ? '' : 'disabled'}>Conferma importazione di ${ready} movimenti</button>
    ` : '';
    target.querySelectorAll('[data-statement-decision]').forEach((button) => button.addEventListener('click', () => {
      statementImportDecisions[button.dataset.sourceRow] = button.dataset.statementDecision;
      renderStatementPreview();
    }));
    const button = $('confirmStatementImport');
    if (button) button.addEventListener('click', importStatementRows);
  }
  async function previewStatementFile() {
    const file = $('statementFile')?.files?.[0];
    const status = $('statementImportStatus');
    statementImportRows = [];
    renderStatementPreview();
    if (!file) { if (status) status.textContent = 'Seleziona prima un file.'; return; }
    if (!window.XLSX) { if (status) status.textContent = 'Lettore Excel non disponibile. Riprova più tardi.'; return; }
    try {
      const bytes = await file.arrayBuffer();
      const workbook = window.XLSX.read(bytes, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      statementImportDecisions = {};
      statementImportRows = findStatementDuplicates(normalizeStatementRows(rawRows), scopedTransactions());
      if (status) status.textContent = `${file.name}: ${rawRows.length} righe lette dal primo foglio. Nessun dato è stato ancora salvato.`;
      renderStatementPreview();
    } catch (error) {
      if (status) status.textContent = 'Impossibile leggere il file: ' + (error.message || 'formato non riconosciuto');
    }
  }
  async function importStatementRows() {
    if (!db || !user || !statementImportRows.length) return;
    if (!requireSpecificSpace('importare un estratto conto')) return;
    const unresolved = statementImportRows.some((row) => row.possibleDuplicate && !statementImportDecisions[row.sourceRow]);
    if (unresolved) { notify('Decidi prima come riconciliare tutte le possibili corrispondenze.', 'error'); return; }
    const skippedFileRows = new Set();
    for (const row of statementImportRows.filter((item) => item.possibleDuplicate && item.duplicateSource === 'file')) {
      if (statementImportDecisions[row.sourceRow] === 'keep-candidate') skippedFileRows.add(row.duplicateOf);
    }
    const rows = statementImportRows.filter((row) => row.status === 'needs_review' && !row.duplicate && !skippedFileRows.has(row.sourceRow) && row.amount > 0 && row.occurred_on && row.description && (!row.possibleDuplicate || (row.duplicateSource === 'file' && ['keep-both', 'keep-candidate'].includes(statementImportDecisions[row.sourceRow])) || (row.duplicateSource === 'existing' && statementImportDecisions[row.sourceRow] === 'keep-both')));
    const updates = statementImportRows.filter((row) => row.possibleDuplicate && row.duplicateSource === 'existing' && statementImportDecisions[row.sourceRow] === 'keep-candidate');
    if (!rows.length && !updates.length) { notify('Non ci sono movimenti da importare o aggiornare.', 'error'); return; }
    if (!confirm(`Stai per importare ${rows.length} movimenti e riconciliare ${updates.length} corrispondenze nello spazio attivo. I nuovi movimenti saranno marcati “Da verificare”. Vuoi continuare?`)) return;
    try {
      for (const row of updates) {
        const existing = transactions.find((tx) => tx.id === row.duplicateOf);
        if (!existing) throw new Error('Non trovo più il movimento da riconciliare per la riga ' + row.sourceRow + '. Ricarica l’estratto conto.');
        await updateTransactionFromDuplicate(existing, { ...row, payment_method: existing.payment_method, notes: [row.notes, row.posted_on ? 'Data contabilizzazione: ' + row.posted_on : null, 'Importato da estratto conto · riga ' + row.sourceRow].filter(Boolean).join(' · ') }, 'bancaria');
      }
      const payload = rows.map((row) => ({
        space_id: activeSpaceId, type: row.type, amount: row.amount, currency: 'EUR',
        description: row.description.slice(0, 160), category: row.category, occurred_on: row.occurred_on,
        paid_by: user.id, created_by: user.id, payment_method: null, status: 'verify',
        notes: [row.notes, row.posted_on ? 'Data contabilizzazione: ' + row.posted_on : null, 'Importato da estratto conto · riga ' + row.sourceRow, row.possibleDuplicate ? 'Riconciliazione: scelta esplicita di mantenere anche questa voce.' : null].filter(Boolean).join(' · ').slice(0, 1000),
      }));
      if (payload.length) {
        const { error } = await db.from('transactions').insert(payload);
        if (error) throw error;
      }
      statementImportRows = []; statementImportDecisions = {};
      $('statementImportPreview').innerHTML = '';
      $('statementImportStatus').textContent = 'Importazione completata. I movimenti sono stati registrati come “Da verificare”; le riconciliazioni sono annotate.';
      $('statementFile').value = '';
      notify(rows.length + ' movimenti importati · ' + updates.length + ' riconciliati');
      await loadData();
    } catch (error) { notify(error.message || 'Errore durante l’importazione', 'error'); }
  }
  function renderTransactions() {
    const query = $('searchMovements').value.trim().toLowerCase(),
      type = $('filterType').value,
      month = $('filterMonth').value;
    const rows = [...scopedTransactions()]
      .filter(
        (t) =>
          (!query ||
            `${t.description} ${t.category} ${t.notes || ''}`.toLowerCase().includes(query)) &&
          (!type || t.type === type) &&
          (!month || txDate(t).slice(0, 7) === month)
      )
      .sort((a, b) => txDate(b).localeCompare(txDate(a)));
    $('transactionsList').innerHTML =
      rows.map((t) => movementHtml(t, true)).join('') ||
      emptyHtml('Nessun risultato', 'Modifica i filtri o aggiungi un movimento.');
  }
  function renderBudgets() {
    const month = $('budgetMonth').value || monthNow(),
      rows = scopedBudgets()
        .filter((b) => budgetMonth(b) === month)
        .sort((a, b) => a.category.localeCompare(b.category));
    $('budgetsList').innerHTML =
      rows
        .map((b) => {
          const spent = monthBudgetSpend(b),
            limit = Number(b.amount) || 0,
            pct = limit ? (spent / limit) * 100 : 0;
          return `<div class="budgetrow"><div class="btop"><strong>${esc(b.category)}</strong><span>${eur(spent)} / ${eur(limit)} · ${Math.round(pct)}%</span></div><div class="budgetbar"><span class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(100, pct)}%"></span></div><div class="btop muted u-mt-6"><span>${pct > 100 ? 'Superato' : 'Residuo'}</span><span>${eur(limit - spent)}</span></div><div class="row-actions"><button class="btn small" data-edit-budget="${esc(b.id)}">Modifica</button><button class="btn small danger" data-delete-budget="${esc(b.id)}">Elimina</button></div></div>`;
        })
        .join('') ||
      emptyHtml('Nessun budget per questo mese', 'Aggiungi un budget mensile per categoria.');
  }
  function renderRecurring() {
    $('recurringList').innerHTML =
      [...scopedRecurring()]
        .sort((a, b) => planDue(a).localeCompare(planDue(b)))
        .map(
          (r) =>
            `<div class="movement"><div class="movicon">↻</div><div class="movinfo"><strong>${esc(r.name)}</strong><small>${esc(r.category || 'Altra spesa')} · ${r.cadence === 'monthly' ? 'Mensile' : r.cadence === 'weekly' ? 'Settimanale' : r.cadence === 'yearly' ? 'Annuale' : 'Una tantum'} · Prossima scadenza: ${esc(fmtDate(planDue(r)))}${r.remaining_installments != null ? ' · Rate residue: ' + esc(r.remaining_installments) : ''}</small><small>${planActive(r) ? 'Attiva' : 'Sospesa'}</small></div><div class="amount expense">${eur(r.amount)}</div><div class="row-actions"><button class="btn small" data-edit-rec="${esc(r.id)}">Modifica</button><button class="btn small" data-toggle-rec="${esc(r.id)}">${planActive(r) ? 'Sospendi' : 'Riattiva'}</button><button class="btn small danger" data-delete-rec="${esc(r.id)}">Elimina</button></div></div>`
        )
        .join('') ||
      emptyHtml(
        'Nessuna ricorrenza registrata',
        'Aggiungi abbonamenti, rate e pagamenti previsti.'
      );
  }
  function formatAIAdvice(text) {
    const lines = String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    const html = [];
    let listType = '';

    const closeList = () => {
      if (listType) html.push(`</${listType}>`);
      listType = '';
    };
    const formatInline = (value) => esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        closeList();
        return;
      }

      const heading = line.match(/^#{1,3}\s+(.+)$/);
      const boldHeading = line.match(/^\*\*(.+)\*\*$/);
      const bullet = line.match(/^[-*•]\s+(.+)$/);
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);

      if (heading || boldHeading) {
        closeList();
        html.push(`<h4>${formatInline((heading || boldHeading)[1])}</h4>`);
      } else if (bullet || numbered) {
        const nextType = bullet ? 'ul' : 'ol';
        if (listType !== nextType) {
          closeList();
          listType = nextType;
          html.push(`<${listType}>`);
        }
        html.push(`<li>${formatInline((bullet || numbered)[1])}</li>`);
      } else {
        closeList();
        html.push(`<p>${formatInline(line)}</p>`);
      }
    });

    closeList();
    return html.join('');
  }

  function localQuizStorageKey() {
    return 'tasca_quiz_attempts_' + String(user?.id || 'guest');
  }

  function readLocalQuizAttempts() {
    try {
      const saved = JSON.parse(localStorage.getItem(localQuizStorageKey()) || '[]');
      return Array.isArray(saved)
        ? saved.filter((item) => item && item.id && item.user_id === user?.id)
        : [];
    } catch {
      return [];
    }
  }

  function writeLocalQuizAttempt(attempt) {
    const existing = readLocalQuizAttempts();
    if (existing.some((item) => item.attempt_key === attempt.attempt_key)) return existing;
    const next = [attempt, ...existing].slice(0, 200);
    localStorage.setItem(localQuizStorageKey(), JSON.stringify(next));
    return next;
  }

  async function loadQuizHistory() {
    if (!db || !user) return;
    try {
      const data = await fetchAllRows(() =>
        db
          .from('quiz_attempts')
          .select('*')
          .order('completed_at', { ascending: false })
          .order('id', { ascending: false })
      );
      quizSchemaReady = true;
      quizAttempts = [...data];
    } catch (error) {
      quizSchemaReady = false;
      quizAttempts = readLocalQuizAttempts();
      console.warn(
        'Tasca quiz: tabella non disponibile o policy non configurata:',
        error.message
      );
    }
    // Il caricamento asincrono dello storico non deve azzerare un quiz in corso.
    // Ripristina la sessione salvata se la pagina è stata ricaricata.
    if (page === 'quiz' && !quizSaving) {
      if (quizQuestions.length && quizIndex < quizQuestions.length) renderQuizQuestion();
      else if (restoreQuizSession()) renderQuizQuestion();
      else renderQuizHome();
    }
  }

  function quizTotals() {
    return quizAttempts.reduce(
      (totals, attempt) => ({
        xp: totals.xp + (Number(attempt.xp_earned) || 0),
        correct: totals.correct + (Number(attempt.correct_answers) || 0),
        questions: totals.questions + (Number(attempt.total_questions) || 0),
      }),
      { xp: 0, correct: 0, questions: 0 }
    );
  }

  function renderQuizHome() {
    const home = $('quizHome'),
      play = $('quizPlay'),
      result = $('quizResult');
    if (!home || !play || !result) return;
    home.classList.remove('hidden');
    play.classList.add('hidden');
    result.classList.add('hidden');
    if (!quizSchemaReady) {
      $('quizNotice').className = quizAttempts.length ? 'notice warn' : 'notice';
      $('quizNotice').textContent = quizAttempts.length
        ? 'Quiz attivi. I progressi sono salvati su questo dispositivo; per sincronizzarli tra dispositivi va completata la configurazione SQL in Supabase.'
        : 'Quiz pronti. Se il salvataggio cloud non è configurato, i risultati resteranno su questo dispositivo.';
    } else {
      $('quizNotice').className = 'notice';
      $('quizNotice').textContent = '';
    }
    const totals = quizTotals();
    const level = getQuizLevel(totals.xp);
    const next = [
      { level: 2, minXP: 100 },
      { level: 3, minXP: 250 },
      { level: 4, minXP: 500 },
      { level: 5, minXP: 900 },
    ].find((item) => totals.xp < item.minXP);
    const progress = next
      ? Math.min(100, Math.round(((totals.xp - level.minXP) / (next.minXP - level.minXP)) * 100))
      : 100;
    $('quizStats').innerHTML = [
      [
        'XP totali',
        totals.xp,
        next ? progress + '% verso il livello successivo' : 'Livello massimo raggiunto',
      ],
      [
        'Livello ' + level.level,
        level.title,
        next
          ? next.minXP - totals.xp + ' XP al prossimo livello'
          : 'Hai raggiunto il livello massimo',
      ],
      ['Quiz completati', quizAttempts.length, totals.questions + ' domande affrontate'],
    ]
      .map(
        ([label, value, note]) =>
          '<div class="stat"><span class="label">' +
          esc(label) +
          '</span><strong>' +
          esc(value) +
          '</strong><small>' +
          esc(note) +
          '</small></div>'
      )
      .join('');
    const badges = getQuizBadges(quizAttempts);
    $('quizBadges').innerHTML = badges.length
      ? badges
          .map(
            (badge) =>
              '<div class="quiz-badge"><span>' +
              badge.icon +
              '</span><strong>' +
              esc(badge.name) +
              '</strong><small>' +
              esc(badge.description) +
              '</small></div>'
          )
          .join('')
      : '<p class="muted tiny">Il primo badge ti aspetta: completa un quiz per sbloccarlo.</p>';
    const challengeItems = [
      {
        title: 'Prima missione',
        note: quizAttempts.length
          ? 'Completata: hai già iniziato il percorso.'
          : 'Completa il tuo primo quiz.',
        done: quizAttempts.length >= 1,
      },
      {
        title: 'Cinque sessioni',
        note: quizAttempts.length + ' di 5 quiz completati.',
        done: quizAttempts.length >= 5,
      },
      {
        title: 'Allenamento completo',
        note: totals.questions + ' di 25 domande affrontate.',
        done: totals.questions >= 25,
      },
      {
        title: 'Almeno 80% di precisione',
        note: totals.questions
          ? Math.round((totals.correct / totals.questions) * 100) +
            '% di risposte corrette nello storico.'
          : 'Completa le prime domande per misurare i progressi.',
        done: totals.questions > 0 && totals.correct / totals.questions >= 0.8,
      },
    ];
    $('quizChallenges').innerHTML = challengeItems
      .map(
        (item) =>
          '<div class="quiz-challenge ' +
          (item.done ? 'is-done' : '') +
          '"><span class="quiz-challenge-check">' +
          (item.done ? '✓' : '○') +
          '</span><div><strong>' +
          esc(item.title) +
          '</strong><small>' +
          esc(item.note) +
          '</small></div></div>'
      )
      .join('');
  }

  function buildQuizContext(category) {
    // Invia solo aggregati per categoria e mese: mai descrizioni, metodi di pagamento o righe grezze.
    if (isAllSpaces())
      return {
        personalizationAvailable: false,
        reason: 'Tutti gli spazi sono selezionati; usa esempi generici.',
      };
    const month = monthNow();
    const expenses = scopedTransactions().filter(
      (t) => t.type === 'expense' && txDate(t).slice(0, 7) === month
    );
    const totals = {};
    expenses.forEach((t) => {
      const key = t.category || 'Da classificare';
      totals[key] = (totals[key] || 0) + (Number(t.amount) || 0);
    });
    const topCategories = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, amount]) => ({ category: label, spentEUR: Math.round(amount / 5) * 5 }));
    const budgetSummary = scopedBudgets()
      .filter((b) => String(b.month_start || '').slice(0, 7) === month)
      .map((b) => {
        const spent = expenses
          .filter((t) => t.category === b.category)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        return {
          category: b.category,
          budgetEUR: Math.round((Number(b.amount) || 0) / 5) * 5,
          spentEUR: Math.round(spent / 5) * 5,
        };
      })
      .slice(0, 5);
    return {
      personalizationAvailable: topCategories.length > 0 || budgetSummary.length > 0,
      month,
      topCategories,
      budgetSummary,
      selectedTopic: category,
    };
  }

  function quizQuestionFingerprint(question) {
    return String(question?.question || '')
      .trim()
      .toLocaleLowerCase('it-IT')
      .replace(/\\s+/g, ' ')
      .slice(0, 240);
  }

  async function persistQuizAnswer(question, selectedValue) {
    if (!db || !user?.id) throw new Error('Sessione utente non disponibile.');
    const fingerprint = question?.fingerprint || quizQuestionFingerprint(question);
    if (!fingerprint) throw new Error('Identificativo della domanda mancante.');
    const { error } = await db.from('quiz_question_history').insert({
      user_id: user.id,
      question_fingerprint: fingerprint,
      category: question.category,
      difficulty: Number(question.difficulty) || 1,
      selected_value: String(selectedValue),
      is_correct: String(selectedValue) === String(question.correctValues?.[0]),
    });
    // Una risposta già registrata resta valida: il vincolo univoco impedisce duplicati.
    if (error && error.code !== '23505') throw error;
  }

  function renderQuizQuestion() {
    const q = quizQuestions[quizIndex];
    if (!q) return finishQuiz();
    persistQuizSession();
    $('quizHome').classList.add('hidden');
    $('quizResult').classList.add('hidden');
    const play = $('quizPlay');
    play.classList.remove('hidden');
    const progress = Math.round(((quizIndex + 1) / quizQuestions.length) * 100);
    const answer = quizAnswers[q.id];
    const isAnswered = answer !== undefined;
    const isCorrect = answer === q.correctValues[0];
    play.innerHTML =
      '<div class="quiz-question-head"><button id="quizExitBtn" class="btn small quiz-exit-btn" type="button">← Esci</button><div class="quiz-step-counter"><span class="quiz-step-number">' +
      String(quizIndex + 1).padStart(2, '0') +
      '</span><span class="quiz-step-copy"><strong>Domanda ' +
      (quizIndex + 1) +
      ' di ' +
      quizQuestions.length +
      '</strong><small>Un passo alla volta</small></span></div></div><div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      progress +
      '"><span style="width:' +
      progress +
      '%"></span></div><div class="quiz-question-meta"><span class="quiz-topic-pill">' +
      esc(
        (QUIZ_CATEGORIES.find((item) => item.id === q.category) || {}).label ||
          'Educazione finanziaria'
      ) +
      '</span><span class="quiz-source-pill">' +
      (quizSource === 'ai' ? '✦ Generata con IA' : '✓ Verificata') +
      '</span></div><div class="quiz-prompt-card"><div class="quiz-prompt-symbol" aria-hidden="true">?</div><div class="quiz-prompt-copy"><span class="quiz-prompt-label">Ragiona, poi scegli</span><h3 class="quiz-question-title">' +
      esc(q.question) +
      '</h3></div></div><div class="quiz-options-heading"><span>Scegli una risposta</span><small>4 opzioni · 1 corretta</small></div><div class="quiz-options">' +
      q.options
        .map(
          (option) =>
            '<button class="quiz-option ' +
            (isAnswered && option.value === answer ? (isCorrect ? 'is-correct' : 'is-wrong') : '') +
            '" type="button" data-quiz-answer="' +
            esc(option.value) +
            '" ' +
            (isAnswered ? 'disabled' : '') +
            '><span>' +
            esc(option.value) +
            '</span><strong>' +
            esc(option.label) +
            '</strong></button>'
        )
        .join('') +
      '</div>' +
      (isAnswered
        ? '<div class="quiz-feedback ' +
          (isCorrect ? 'is-correct' : 'is-wrong') +
          '"><strong>' +
          (isCorrect ? 'Esatto!' : 'Non proprio') +
          '</strong><p>' +
          esc(
            q.explanation ||
              q.options.find((option) => option.value === q.correctValues[0])?.feedback ||
              'Rivedi il concetto e riprova nel prossimo quiz.'
          ) +
          '</p>' +
          (!isCorrect
            ? '<small>Risposta corretta: ' +
              esc(
                (q.options.find((option) => option.value === q.correctValues[0]) || {}).label ||
                  q.correctValues[0]
              ) +
              '</small>'
            : '') +
          '</div><button id="quizNextBtn" class="btn primary full" type="button">' +
          (quizIndex + 1 === quizQuestions.length ? 'Vedi il risultato' : 'Prossima domanda') +
          '</button>'
        : '<div class="quiz-hint"><details><summary>Mostra un indizio</summary><p>' +
          esc(q.hint || 'Ragiona sulle condizioni indicate nella domanda.') +
          '</p></details></div>') +
      '<p class="muted tiny">Le risposte servono per imparare; non modificano i tuoi movimenti o il budget.</p>';
    play.querySelectorAll('[data-quiz-answer]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (quizAnswers[q.id] !== undefined) return;
        const selectedValue = button.dataset.quizAnswer;
        const answerButtons = [...play.querySelectorAll('[data-quiz-answer]')];
        answerButtons.forEach((item) => (item.disabled = true));
        const status = document.createElement('p');
        status.className = 'muted tiny';
        status.textContent = 'Salvo la risposta…';
        play.append(status);
        try {
          await persistQuizAnswer(q, selectedValue);
          quizAnswers[q.id] = selectedValue;
          renderQuizQuestion();
        } catch (error) {
          console.error('Tasca quiz: impossibile salvare la risposta:', error?.message || error);
          status.className = 'notice warn';
          status.textContent =
            'Non riesco a salvare questa risposta. Controlla la connessione e riprova: la domanda non verrà conteggiata finché non sarà registrata.';
          answerButtons.forEach((item) => (item.disabled = false));
        }
      })
    );
    $('quizNextBtn')?.addEventListener('click', () => {
      quizIndex += 1;
      if (quizIndex >= quizQuestions.length) finishQuiz();
      else renderQuizQuestion();
    });
    $('quizExitBtn')?.addEventListener('click', () => {
      clearQuizSession();
      quizQuestions = [];
      quizAnswers = {};
      quizIndex = 0;
      renderQuizHome();
    });
  }

  async function startQuiz() {
    const btn = $('startQuizBtn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Carico le domande…';
    try {
      const category = 'all';
      if ($('quizCategory')) $('quizCategory').value = 'all';
      const difficulty = Number($('quizDifficulty').value) || 1;
      if (!isAIConfigured()) {
        throw new Error('Il servizio Tasca non è configurato: verifica l’URL del Worker.');
      }

      // Le domande sono pre-generate e archiviate nel banco settimanale.
      // Qui non viene mai chiesta una nuova generazione al modello.
      const archived = await callTascaAI('quiz', { category, difficulty, count: 12 });
      const validated = validateAIQuiz(archived, { category, count: 12, diagnostic: true });
      if (!validated || validated.validationError) {
        throw new Error(
          validated?.validationError || 'Le domande archiviate non hanno superato i controlli.'
        );
      }

      quizQuestions = validated.questions;
      quizSource = 'ai';
      quizAnswers = {};
      quizIndex = 0;
      quizAttemptKey = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      $('quizNotice').className = 'notice';
      $('quizNotice').textContent = '';
      renderQuizQuestion();
    } catch (error) {
      console.warn('Tasca quiz: archivio settimanale non disponibile:', error?.message || error);
      $('quizNotice').className = 'notice warn';
      $('quizNotice').textContent =
        error?.code === 'QUIZ_BANK_NOT_READY'
          ? 'Le domande settimanali sono ancora in preparazione. Riprova più tardi.'
          : error?.code === 'QUIZ_QUESTIONS_EXHAUSTED'
            ? 'Hai già affrontato quasi tutte le domande nuove di questo livello. Scegli un altro livello per continuare senza ripetizioni.'
            : error?.code === 'QUIZ_BANK_READ_FAILED'
              ? 'Tasca non riesce a leggere l’archivio o lo storico quiz. Verifica la migrazione Supabase e il deployment del Worker.'
              : 'Non riesco a caricare le domande archiviate. Verifica la connessione e riprova.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Inizia il quiz';
    }
  }

  async function createQuizFingerprint(questions) {
    const canonical = questions
      .map((question) =>
        String(question.question || '')
          .normalize('NFKC')
          .trim()
          .toLocaleLowerCase('it-IT')
      )
      .sort()
      .join('\n');
    if (globalThis.crypto?.subtle) {
      try {
        const digest = await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonical)
        );
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('');
      } catch {}
    }
    let hash = 2166136261;
    for (let i = 0; i < canonical.length; i += 1)
      hash = Math.imul(hash ^ canonical.charCodeAt(i), 16777619);
    return 'fnv-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  async function finishQuiz() {
    if (quizSaving || !quizQuestions.length) return;
    clearQuizSession();
    quizSaving = true;
    const score = scoreQuiz(quizQuestions, quizAnswers);
    const xp = calculateQuizXP({
      correct: score.correct,
      total: score.total,
      firstCompletion: quizAttempts.length === 0,
    });
    const source = quizSource;
    const category = $('quizCategory').value;
    const difficulty = Number($('quizDifficulty').value) || 1;
    const payload = {
      user_id: user.id,
      attempt_key: quizAttemptKey,
      question_fingerprint: await createQuizFingerprint(quizQuestions),
      category,
      difficulty,
      correct_answers: score.correct,
      total_questions: score.total,
      percent: score.percent,
      xp_earned: xp,
      source,
    };
    const result = $('quizResult');
    $('quizHome').classList.add('hidden');
    $('quizPlay').classList.add('hidden');
    result.classList.remove('hidden');
    result.innerHTML =
      '<div class="quiz-result-icon">✦</div><div class="eyebrow">Sessione completata</div><h3>' +
      score.correct +
      ' su ' +
      score.total +
      ' risposte corrette</h3><p class="muted">' +
      score.percent +
      '% di precisione in questa sessione.</p><div class="quiz-earned"><strong>+' +
      xp +
      ' XP</strong><span>Hai completato una nuova sessione di apprendimento.</span></div><p class="muted tiny">Salvataggio dei progressi…</p>';
    try {
      const { data, error } = await db.from('quiz_attempts').insert(payload).select('*').single();
      if (error) {
        if (error.code === '23505')
          throw new Error(
            'Hai già completato questa combinazione di domande: scegli un altro percorso per guadagnare XP con nuovi contenuti.'
          );
        throw error;
      }
      quizAttempts.unshift(data);
      quizSchemaReady = true;
      const level = getQuizLevel(quizTotals().xp);
      const badges = getQuizBadges(quizAttempts);
      result.innerHTML =
        '<div class="quiz-result-icon">✦</div><div class="eyebrow">Sessione completata</div><h3>' +
        score.correct +
        ' su ' +
        score.total +
        ' risposte corrette</h3><p class="muted">' +
        score.percent +
        '% di precisione in questa sessione.</p><div class="quiz-earned"><strong>+' +
        xp +
        ' XP</strong><span>Livello ' +
        level.level +
        ' · ' +
        esc(level.title) +
        '</span></div><div class="quiz-result-review">' +
        score.details
          .map(
            (detail, index) =>
              '<div class="quiz-review-row"><span class="' +
              (detail.correct ? 'review-correct' : 'review-wrong') +
              '">' +
              (detail.correct ? '✓' : '×') +
              '</span><div><strong>' +
              esc(quizQuestions[index].question) +
              '</strong><small>' +
              (detail.correct
                ? 'Risposta corretta'
                : 'Risposta corretta: ' +
                  esc(
                    (
                      quizQuestions[index].options.find(
                        (option) => option.value === detail.correctValue
                      ) || {}
                    ).label || detail.correctValue
                  )) +
              '</small></div></div>'
          )
          .join('') +
        '</div><div class="quiz-result-badges">' +
        badges
          .slice(-3)
          .map(
            (badge) =>
              '<span class="quiz-result-badge">' + badge.icon + ' ' + esc(badge.name) + '</span>'
          )
          .join('') +
        '</div><button id="quizAgainBtn" class="btn primary full" type="button">Fai un altro quiz</button><button id="quizHomeBtn" class="btn full u-mt-8" type="button">Torna ai percorsi</button>';
      $('quizAgainBtn').addEventListener('click', () => {
        quizQuestions = [];
        quizAnswers = {};
        renderQuizHome();
        startQuiz();
      });
      $('quizHomeBtn').addEventListener('click', () => {
        quizQuestions = [];
        quizAnswers = {};
        renderQuizHome();
      });
    } catch (error) {
      const message = String(error?.message || 'errore di salvataggio');
      if (message.startsWith('Hai già completato questa combinazione')) {
        result.innerHTML +=
          '<div class="notice warn">' +
          esc(message) +
          '</div><button id="quizHomeBtn" class="btn full u-mt-8" type="button">Torna ai percorsi</button>';
      } else {
        const localAttempt = {
          id: 'local-' + quizAttemptKey,
          ...payload,
          user_id: user.id,
          completed_at: new Date().toISOString(),
          local_only: true,
        };
        try {
          writeLocalQuizAttempt(localAttempt);
          quizAttempts = readLocalQuizAttempts();
          quizSchemaReady = false;
          const level = getQuizLevel(quizTotals().xp);
          result.innerHTML =
            '<div class="quiz-result-icon">✦</div><div class="eyebrow">Sessione completata</div><h3>' +
            score.correct +
            ' su ' +
            score.total +
            ' risposte corrette</h3><p class="muted">' +
            score.percent +
            '% di precisione in questa sessione.</p><div class="quiz-earned"><strong>+' +
            xp +
            ' XP</strong><span>Livello ' +
            level.level +
            ' · ' +
            esc(level.title) +
            '</span></div><div class="notice warn">Progressi salvati su questo dispositivo. La sincronizzazione cloud richiede la configurazione della tabella quiz in Supabase.</div><div class="quiz-result-review">' +
            score.details
              .map(
                (detail, index) =>
                  '<div class="quiz-review-row"><span class="' +
                  (detail.correct ? 'review-correct' : 'review-wrong') +
                  '">' +
                  (detail.correct ? '✓' : '×') +
                  '</span><div><strong>' +
                  esc(quizQuestions[index].question) +
                  '</strong><small>' +
                  (detail.correct
                    ? 'Risposta corretta'
                    : 'Risposta corretta: ' +
                      esc(
                        (
                          quizQuestions[index].options.find(
                            (option) => option.value === detail.correctValue
                          ) || {}
                        ).label || detail.correctValue
                      )) +
                  '</small></div></div>'
              )
              .join('') +
            '</div><button id="quizAgainBtn" class="btn primary full" type="button">Fai un altro quiz</button><button id="quizHomeBtn" class="btn full u-mt-8" type="button">Torna ai percorsi</button>';
          $('quizAgainBtn').addEventListener('click', () => {
            quizQuestions = [];
            quizAnswers = {};
            renderQuizHome();
            startQuiz();
          });
        } catch (storageError) {
          result.innerHTML +=
            '<div class="notice error">Il risultato è calcolato ma il dispositivo non consente di salvare i progressi. Puoi comunque consultare le risposte qui sotto.</div>';
        }
      }
      $('quizHomeBtn')?.addEventListener('click', () => {
        quizQuestions = [];
        quizAnswers = {};
        renderQuizHome();
      });
    } finally {
      quizSaving = false;
    }
  }

  function loadAIChat() {
    aiChatMessages = [];
    try {
      const key = user?.id ? 'tasca_ai_chat:' + user.id : null;
      const saved = key ? JSON.parse(localStorage.getItem(key) || '[]') : [];
      if (Array.isArray(saved)) aiChatMessages = saved.slice(-20);
    } catch {}
    renderAIChat();
  }
  function saveAIChat() {
    if (!user?.id) return;
    try { localStorage.setItem('tasca_ai_chat:' + user.id, JSON.stringify(aiChatMessages.slice(-20))); } catch {}
  }
  function renderAIChat() {
    const host = $('aiChatMessages');
    if (!host) return;
    const rows = aiChatMessages.length ? aiChatMessages : [{ role: 'assistant', content: 'Ciao! Posso aiutarti con budget, rate, spese e fondo risparmio. Ogni modifica richiederà la tua conferma.' }];
    host.replaceChildren();
    rows.forEach((m) => {
      const bubble = document.createElement('div');
      bubble.className = 'ai-chat-bubble ' + (m.role === 'user' ? 'user' : 'assistant');
      bubble.textContent = String(m.content || '');
      host.appendChild(bubble);
    });
    host.scrollTop = host.scrollHeight;
  }
  async function sendAIChatMessage(event) {
    event.preventDefault();
    const input = $('aiChatInput');
    const message = String(input?.value || '').trim();
    if (!message || aiChatPending) return;
    if (!isAIConfigured() || !user) { notify('Accedi e verifica la configurazione del servizio IA.', 'error'); return; }
    aiChatMessages.push({ role: 'user', content: message });
    input.value = '';
    aiChatPending = true;
    const send = $('aiChatSend');
    if (send) send.disabled = true;
    aiChatMessages.push({ role: 'assistant', content: 'Sto analizzando i dati di Tasca…' });
    renderAIChat();
    try {
      const snapshot = buildAdviceSnapshot();
      const recent = scopedTransactions()
        .slice()
        .sort((x, y) => String(txDate(y)).localeCompare(String(txDate(x))))
        .slice(0, 100)
        .map((t) => ({
          date: txDate(t),
          type: t.type,
          amount: Number(t.amount) || 0,
          category: t.category || 'Da classificare',
          description: String(t.description || t.name || '').slice(0, 100),
          paymentMethod: t.payment_method || null,
          status: t.status || 'confirmed',
          notes: String(t.notes || '').slice(0, 160),
        }));
      const plans = scopedRecurring().filter(planActive).slice(0, 30).map((p) => ({ name: p.name, amount: Number(p.amount) || 0, category: p.category, cadence: p.cadence, next_due_on: p.next_due_on, remaining_installments: p.remaining_installments }));
      const context = { currentSpace: activeSpace()?.name || 'Spazio non selezionato', financialSnapshot: snapshot, recentTransactions: recent, activeRecurring: plans, conversation: aiChatMessages.slice(-11).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) })) };
      const answer = await callTascaAI('chat', context);
      aiChatMessages[aiChatMessages.length - 1] = { role: 'assistant', content: answer || 'Non ho ricevuto una risposta utilizzabile.' };
      saveAIChat();
    } catch (error) {
      aiChatMessages[aiChatMessages.length - 1] = { role: 'assistant', content: 'Servizio non disponibile: ' + (error.message || 'errore imprevisto') };
    } finally {
      aiChatPending = false;
      if (send) send.disabled = false;
      renderAIChat();
      input?.focus();
    }
  }
  function renderAdvice() {
    const s = monthSummary(),
      rows = monthRows(monthNow()).filter((t) => t.type === 'expense'),
      cats = {};
    rows.forEach(
      (t) =>
        (cats[t.category || 'Da classificare'] =
          (cats[t.category || 'Da classificare'] || 0) + Number(t.amount || 0))
    );
    const top = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const small = rows.filter((t) => Number(t.amount) <= 5),
      smallSum = small.reduce((a, t) => a + Number(t.amount || 0), 0);
    const cards = [];
    cards.push([
      'Il tuo residuo',
      s.residual >= goal
        ? 'Obiettivo raggiunto o superato'
        : `Per arrivare a ${eur(goal)} di residuo servono altri ${eur(goal - s.residual)}.`,
      s.residual >= goal ? 'ok' : 'warn',
    ]);
    cards.push([
      'Piccole spese',
      small.length
        ? `${small.length} spese da massimo 5 € per un totale di ${eur(smallSum)} questo mese.`
        : 'Non risultano spese fino a 5 € nel mese corrente.',
      'ok',
    ]);
    cards.push([
      'Categorie principali',
      top.length
        ? top.map(([c, n]) => `${c}: ${eur(n)}`).join(' · ')
        : 'Registra alcune spese per individuare le categorie più costose.',
      'ok',
    ]);
    cards.push([
      'Qualità dei dati',
      scopedTransactions().some((t) => t.status === 'verify' || t.status === 'planned')
        ? `Movimenti esclusi dai totali confermati: ${scopedTransactions().filter((t) => t.status === 'verify').length} da verificare e ${scopedTransactions().filter((t) => t.status === 'planned').length} previsti. Controllali per aggiornare i totali.`
        : 'Controlla periodicamente il registro rispetto all’estratto conto.',
      'warn',
    ]);
    cards.push([
      'Consigli IA personalizzati',
      aiAdviceText ||
        (isAIConfigured()
          ? 'Sto preparando un’analisi dello storico…'
          : 'La funzione si attiverà dopo aver pubblicato il Worker cloud gratuito e collegato il suo URL.'),
      'ai',
    ]);
    $('adviceList').innerHTML = cards
      .map(([title, body, kind]) => {
        const isAIAdvice = kind === 'ai';
        const content = isAIAdvice ? formatAIAdvice(body) : `<p class="muted">${esc(body)}</p>`;
        return `<div class="panel advice-card${isAIAdvice ? ' advice-ai-card' : ''}"><h3>${esc(title)}</h3><div class="${isAIAdvice ? 'ai-advice-content' : 'advice-card-content'}">${content}</div></div>`;
      })
      .join('');
    if (isAIConfigured() && !aiAdvicePending && !aiAdviceText) requestAIAdvice();
  }
  function renderSpaces() {
    $('spacesList').innerHTML =
      spaces
        .map((s) => {
          const kind =
            s.space_type === 'personal' ? 'personal' : s.space_type === 'trip' ? 'trip' : 'shared';
          const label =
            kind === 'personal' ? 'Personale' : kind === 'trip' ? 'Progetto' : 'Condiviso';
          const symbol = kind === 'personal' ? '●' : kind === 'trip' ? '◇' : '●';
          return `<div class="space-card ${kind}"><div class="movicon ${kind}">${symbol}</div><div class="movinfo"><strong>${esc(s.name)}</strong><div><span class="space-type ${kind}">${label}</span></div><small>Creato ${esc(fmtDate((s.created_at || '').slice(0, 10)))}</small></div><div class="space-buttons"><button class="btn small" data-open-space="${esc(s.id)}">Apri</button><button class="btn small danger" data-delete-space="${esc(s.id)}" type="button">Elimina</button></div></div>`;
        })
        .join('') ||
      emptyHtml(
        'Nessuno spazio disponibile',
        'Crea uno spazio personale o condiviso per iniziare.'
      );
  }
  function renderAll() {
    renderSpaceSelector();
    renderHome();
    renderTransactions();
    renderBudgets();
    renderRecurring();
    renderAdvice();
    renderSpaces();
  }
  function restoreRememberedEmail() {
    try {
      const saved = localStorage.getItem('tasca_remembered_email') || '';
      if (saved && $('authEmail')) {
        $('authEmail').value = saved;
        $('rememberLogin').checked = true;
      }
    } catch {}
  }
  function saveRememberedEmail(email) {
    try {
      if ($('rememberLogin')?.checked) localStorage.setItem('tasca_remembered_email', email);
      else localStorage.removeItem('tasca_remembered_email');
    } catch {}
  }
  function showAuth(mode) {
    const signup = mode === 'signup',
      reset = mode === 'reset';
    $('authPassword').type = 'password';
    $('togglePassword').setAttribute('aria-label', 'Mostra password');
    $('togglePassword').setAttribute('title', 'Mostra password');
    $('togglePassword').setAttribute('aria-pressed', 'false');
    $('authTitle').textContent = signup
      ? 'Crea il tuo account'
      : reset
        ? 'Recupera la password'
        : 'Bentornato';
    $('authSubtitle').textContent = signup
      ? 'Registrati per salvare i tuoi movimenti in modo sicuro.'
      : reset
        ? 'Ti invieremo le istruzioni per reimpostare la password.'
        : 'Accedi per sincronizzare le tue finanze.';
    $('authPassword').classList.toggle('hidden', reset);
    $('authPassword').required = !reset;
    $('authPassword').autocomplete = signup || reset ? 'new-password' : 'current-password';
    $('signupNameFields').classList.toggle('hidden', !signup);
    $('authFirstName').required = signup;
    $('authLastName').required = signup;
    $('authEmailConfirmWrap').classList.toggle('hidden', !signup);
    $('authEmailConfirm').required = signup;
    $('signupBirthDateWrap').classList.toggle('hidden', !signup);
    $('authBirthDate').required = signup;
    $('authConfirmWrap').classList.toggle('hidden', !signup);
    $('authConfirm').required = signup;
    $('rememberLogin')
      .closest('.remember-login')
      .classList.toggle('hidden', signup || reset);
    $('authEmail').autocomplete = signup || reset ? 'email' : 'username';
    $('authSubmit').textContent = signup ? 'Crea account' : reset ? 'Invia istruzioni' : 'Accedi';
    $('showSignup').classList.toggle('hidden', signup);
    $('showReset').classList.toggle('hidden', reset);
    $('authForm').dataset.mode = mode;
    showAuthMessage('');
  }
  async function authSubmit(e) {
    e.preventDefault();
    if (!db) {
      showAuthMessage('Configura prima URL e chiave pubblica Supabase nel codice.', 'error');
      return;
    }
    const mode = $('authForm').dataset.mode,
      email = $('authEmail').value.trim(),
      password = $('authPassword').value;
    if (mode === 'login') saveRememberedEmail(email);
    try {
      $('authSubmit').disabled = true;
      if (mode === 'signup') {
        const firstName = $('authFirstName').value.trim();
        const lastName = $('authLastName').value.trim();
        const emailConfirm = $('authEmailConfirm').value.trim().toLowerCase();
        const birthDate = $('authBirthDate').value;
        if (!firstName || !lastName) throw new Error('Inserisci nome e cognome.');
        if (email.toLowerCase() !== emailConfirm) throw new Error('Le email non coincidono.');
        if (password !== $('authConfirm').value) throw new Error('Le password non coincidono.');
        if (!birthDate) throw new Error('Inserisci la data di nascita.');
        if (birthDate > today()) throw new Error('La data di nascita non può essere futura.');
        const { error } = await db.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: location.origin + location.pathname,
            data: {
              first_name: firstName,
              last_name: lastName,
              full_name: firstName + ' ' + lastName,
              date_of_birth: birthDate,
              onboarding_completed: false,
            },
          },
        });
        if (error) throw error;
        $('authForm').reset();
        showAuth('login');
        showAuthMessage(
          'Registrazione inviata. Controlla la tua email e conferma l’indirizzo per attivare l’account.'
        );
      } else if (mode === 'reset') {
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + location.pathname,
        });
        if (error) throw error;
        showAuthMessage('Se l’indirizzo è registrato, riceverai le istruzioni via email.');
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      showAuthMessage(err.message || 'Operazione non riuscita.', 'error');
    } finally {
      $('authSubmit').disabled = false;
    }
  }

  const onboardingSteps = [
    {
      title: 'Benvenuto in Tasca',
      body: "Tasca ti aiuta a tenere sotto controllo entrate, spese e obiettivi. Questa guida ti accompagna nelle schermate principali: puoi saltarla e iniziare a usare l'app.",
    },
    {
      title: 'Home: il quadro generale',
      body: 'La Home mostra entrate, uscite e residuo del mese, andamento delle spese e riepilogo dei budget. Il residuo è un calcolo sui movimenti registrati, non il saldo bancario aggiornato in automatico.',
    },
    {
      title: 'Movimenti: registra tutto',
      body: 'Aggiungi ogni entrata, spesa, trasferimento o rimborso con data, importo, categoria e descrizione. Inserisci anche le piccole spese: sono utili per avere un quadro fedele.',
    },
    {
      title: 'Budget: controlla i limiti',
      body: 'Crea un budget mensile per categoria e confronta quanto hai speso con il limite impostato. Il residuo e la percentuale utilizzata si aggiornano in base ai movimenti salvati.',
    },
    {
      title: 'Rate e ricorrenze',
      body: 'Registra abbonamenti, rate e scadenze per ricordarti importi e date. Sono promemoria: Tasca non addebita automaticamente denaro e non verifica i pagamenti sul conto.',
    },
    {
      title: 'Consigli con Tasca AI',
      body: 'L’IA può elaborare riepiloghi pertinenti del budget e delle spese per offrire suggerimenti. I risultati possono essere imprecisi: usali come supporto, non come consulenza finanziaria. Tasca non è collegata automaticamente alla banca.',
    },
    {
      title: 'Quiz di benessere finanziario',
      body: 'Scegli un argomento e una difficoltà per allenarti con domande, spiegazioni e progressi. I quiz servono per imparare e non modificano il registro dei movimenti.',
    },
    {
      title: 'Spazi personali e condivisi',
      body: 'Usa gli spazi per separare le tue finanze personali da quelle condivise o da un progetto. Inviti, membri e ripartizione delle spese funzionano solo quando la relativa configurazione è attiva.',
    },
    {
      title: 'Comando Rapido e impostazioni',
      body: 'Il Comando Rapido può aiutarti a preparare una registrazione da Wallet tramite la scorciatoia configurata; controlla sempre i dati prima di salvarli. Nelle Impostazioni puoi gestire preferenze e dati. L’IA non riceve password o dati di accesso bancari.',
    },
  ];
  let onboardingIndex = 0;
  let onboardingOpen = false;
  function renderOnboardingStep() {
    const step = onboardingSteps[onboardingIndex];
    $('onboardingTitle').textContent = step.title;
    $('onboardingBody').textContent = step.body;
    $('onboardingProgress').textContent =
      'Guida ' + (onboardingIndex + 1) + ' di ' + onboardingSteps.length;
    $('onboardingPrev').disabled = onboardingIndex === 0;
    $('onboardingNext').textContent =
      onboardingIndex === onboardingSteps.length - 1 ? 'Completa' : 'Avanti';
    $('onboardingDots').innerHTML = onboardingSteps
      .map(
        (_, i) =>
          '<span class="onboarding-dot' + (i === onboardingIndex ? ' active' : '') + '"></span>'
      )
      .join('');
  }
  function openOnboarding() {
    if (!user || user.user_metadata?.onboarding_completed !== false || onboardingOpen) return;
    onboardingIndex = 0;
    onboardingOpen = true;
    renderOnboardingStep();
    $('onboardingOverlay').classList.remove('hidden');
  }
  async function finishOnboarding() {
    $('onboardingOverlay').classList.add('hidden');
    onboardingOpen = false;
    if (!db || !user) return;
    try {
      const { data, error } = await db.auth.updateUser({ data: { onboarding_completed: true } });
      if (error) throw error;
      if (data?.user) user = data.user;
    } catch (error) {
      notify(
        'La guida è stata chiusa, ma non sono riuscito a salvare la preferenza. Potrebbe ricomparire al prossimo accesso.',
        'error'
      );
    }
  }
  function maybeShowOnboarding() {
    if (user?.user_metadata?.onboarding_completed === false) openOnboarding();
  }
  function showApp() {
    $('authScreen').classList.add('hidden');
    $('appScreen').classList.remove('hidden');
    $('mobileNav').classList.remove('hidden');
    loadAIChat();
    maybeShowOnboarding();
  }
  function showLogin() {
    clearQuizSession();
    dataLoadSequence += 1;
    user = null;
    aiChatMessages = [];
    renderAIChat();
    transactions = [];
    budgets = [];
    recurring = [];
    spaces = [];
    quizAttempts = [];
    quizSchemaReady = false;
    activeSpaceId = null;
    selectedSpace = null;
    transactionSpaceId = null;
    editingTransaction = null;
    closeModal(true);
    notice('');
    $('appScreen').classList.add('hidden');
    $('mobileNav').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
  }
  async function fetchAllRows(queryFactory, pageSize = 1000) {
    if (!Number.isInteger(pageSize) || pageSize < 1)
      throw new RangeError('pageSize deve essere un intero positivo.');
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
      if (error) throw error;
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }

  async function loadData() {
    if (!db || !user) return;
    const requestId = ++dataLoadSequence;
    const requestUserId = user.id;
    notice('Aggiornamento dei dati…');
    try {
      const [tx, bg, rc, sp] = await Promise.all([
        fetchAllRows(() =>
          db.from('transactions').select('*').order('occurred_on', { ascending: false }).order('id', { ascending: false })
        ),
        fetchAllRows(() =>
          db.from('budgets').select('*').order('month_start', { ascending: false }).order('id', { ascending: false })
        ),
        fetchAllRows(() =>
          db.from('recurring_plans').select('*').order('next_due_on', { ascending: true }).order('id', { ascending: true })
        ),
        fetchAllRows(() => db.from('spaces').select('*').order('created_at', { ascending: false }).order('id', { ascending: false })),
      ]);
      if (requestId !== dataLoadSequence || user?.id !== requestUserId) return;
      transactions = tx;
      budgets = bg;
      recurring = rc;
      spaces = sp;
      aiNudgeKey = '';
      aiNudgeText = '';
      aiAdviceKey = '';
      aiAdviceText = '';
      if (activeSpaceId !== ALL_SPACES && !spaces.some((space) => space.id === activeSpaceId)) {
        activeSpaceId =
          (spaces.find((space) => space.space_type === 'personal') || spaces[0] || {}).id || null;
      }
      renderAll();
      await loadQuizHistory();
      if (requestId !== dataLoadSequence || user?.id !== requestUserId) return;
      notice('');
      await processShortcutImport();
    } catch (err) {
      if (requestId !== dataLoadSequence || user?.id !== requestUserId) return;
      notice(
        `Non riesco a caricare tutti i dati: ${err.message}. Verifica che le tabelle e le policy SQL siano state create.`,
        'error'
      );
    }
  }
  function openTransactionForm(t = null, defaultType = 'expense', spaceId = null) {
    editingTransaction = t;
    transactionSpaceId = t?.space_id || spaceId || activeSpaceId || null;
    const type = t?.type || defaultType;
    openModal(
      t ? 'Modifica movimento' : 'Nuovo movimento',
      `<form id="txForm"><div class="formgrid">
 <div class="field"><label>Tipo</label><select name="type" id="txType"><option value="expense" ${type === 'expense' ? 'selected' : ''}>Uscita</option><option value="income" ${type === 'income' ? 'selected' : ''}>Entrata</option><option value="transfer" ${type === 'transfer' ? 'selected' : ''}>Trasferimento</option><option value="refund" ${type === 'refund' ? 'selected' : ''}>Rimborso</option></select></div>
 <div class="field"><label>Importo (€)</label>${moneyInput(t?.amount ?? '')}</div>
 <div class="field full"><label>Descrizione</label><input name="description" required maxlength="160" value="${esc(t?.description || '')}" placeholder="Es. spesa supermercato"></div>
 <div class="field"><label>Categoria</label><select name="category" id="txCategory">${categoriesOptions(type, t?.category || '')}</select></div>
 <div class="field"><label>Data operazione</label><input name="date" type="date" required value="${esc(txDate(t) || today())}"></div>
 <div class="field"><label>Metodo di pagamento</label><select name="payment_method"><option value="">Non specificato</option>${['Carta', 'Apple Pay', 'Contanti', 'Bonifico', 'PayPal', 'Addebito diretto', 'Altro'].map((x) => `<option ${t?.payment_method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
 <div class="field"><label>Stato</label><select name="status"><option value="confirmed" ${!t || t.status === 'confirmed' ? 'selected' : ''}>Confermato</option><option value="planned" ${t?.status === 'planned' ? 'selected' : ''}>Previsto</option><option value="verify" ${t?.status === 'verify' ? 'selected' : ''}>Da verificare</option></select></div>
 <div class="field full"><label>Note (facoltative)</label><textarea name="notes" maxlength="1000">${esc(t?.notes || '')}</textarea></div>
 </div><div class="notice warn tiny">La data è quella dell’operazione. Non è una conferma bancaria automatica.</div><button class="btn primary full" type="submit">${t ? 'Salva modifiche' : 'Registra movimento'}</button></form>`
    );
    $('txType').addEventListener('change', (e) => {
      $('txCategory').innerHTML = categoriesOptions(e.target.value);
    });
    $('txForm').addEventListener('submit', saveTransaction);
  }
  async function saveTransaction(e) {
    e.preventDefault();
    if (!db || !user || transactionSaving) return;
    const f = new FormData(e.target),
      spaceId =
        transactionSpaceId || activeSpaceId || spaces.find((s) => s.space_type === 'personal')?.id,
      isEditing = Boolean(editingTransaction),
      editingId = editingTransaction?.id,
      savedSpaceId = transactionSpaceId,
      payload = {
        space_id: spaceId,
        type: f.get('type'),
        amount: Number(f.get('amount')),
        currency: 'EUR',
        description: String(f.get('description')).trim(),
        category: f.get('category'),
        occurred_on: f.get('date'),
        paid_by: user.id,
        created_by: user.id,
        payment_method: f.get('payment_method') || null,
        status: f.get('status'),
        notes: f.get('notes') || null,
      };
    const validationError = validateTransactionInput(payload);
    if (validationError) {
      notify(validationError, 'error');
      return;
    }

    transactionSaving = true;
    const submitButton = e.submitter || e.target.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const q = isEditing
        ? db.from('transactions').update(payload).eq('id', editingId)
        : db.from('transactions').insert(payload);
      const { error } = await q;
      if (error) throw error;
      transactionSpaceId = null;
      editingTransaction = null;
      closeModal(true);
      notify(isEditing ? 'Movimento aggiornato' : 'Movimento registrato');
      await loadData();
      if (savedSpaceId && selectedSpace?.id === savedSpaceId) await openSpace(savedSpaceId);
    } catch (err) {
      notify(err.message || 'Errore nel salvataggio', 'error');
    } finally {
      transactionSaving = false;
      if (submitButton) submitButton.disabled = false;
    }
  }
  async function deleteTransaction(id) {
    if (!confirm('Vuoi eliminare questo movimento? Questa operazione non si può annullare.'))
      return;
    const { error } = await db.from('transactions').delete().eq('id', id);
    if (error) {
      notify(error.message, 'error');
      return;
    }
    notify('Movimento eliminato');
    await loadData();
  }
  function openBudgetForm(b = null) {
    editingBudget = b;
    const month = $('budgetMonth').value || monthNow();
    openModal(
      b ? 'Modifica budget' : 'Nuovo budget',
      `<form id="budgetForm"><div class="formgrid">
 <div class="field full"><label>Categoria</label><select name="category" required>${[
   ...CATEGORIES.expense,
   ...new Set(budgets.map((x) => x.category)),
 ]
   .filter((x, i, a) => a.indexOf(x) === i)
   .map((c) => `<option ${b?.category === c ? 'selected' : ''}>${esc(c)}</option>`)
   .join('')}</select></div>
 <div class="field"><label>Limite mensile (€)</label>${moneyInput(b?.amount ?? '')}</div><div class="field"><label>Mese</label><input name="month" type="month" required value="${esc(budgetMonth(b) || month)}"></div>
 </div><button class="btn primary full u-mt-14" type="submit">Salva budget</button></form>`
    );
    $('budgetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        payload = {
          space_id:
            b?.space_id || activeSpaceId || spaces.find((s) => s.space_type === 'personal')?.id,
          category: f.get('category'),
          amount: Number(f.get('amount')),
          month_start: f.get('month') + '-01',
        };
      try {
        if (!payload.space_id)
          throw new Error('Crea prima uno spazio personale nella sezione Spazi.');
        if (!(payload.amount > 0)) throw new Error('Il limite deve essere maggiore di zero.');
        const same = budgets.find(
          (x) =>
            x.space_id === payload.space_id &&
            x.category === payload.category &&
            budgetMonth(x) === f.get('month') &&
            x.id !== b?.id
        );
        if (same) throw new Error('Esiste già un budget per questa categoria e questo mese.');
        const q = b
          ? db.from('budgets').update(payload).eq('id', b.id)
          : db.from('budgets').insert(payload);
        const { error } = await q;
        if (error) throw error;
        closeModal();
        notify('Budget salvato');
        await loadData();
      } catch (err) {
        notify(err.message, 'error');
      }
    });
  }
  async function deleteBudget(id) {
    if (!confirm('Eliminare questo budget?')) return;
    const { error } = await db.from('budgets').delete().eq('id', id);
    if (error) {
      notify(error.message, 'error');
      return;
    }
    await loadData();
    notify('Budget eliminato');
  }
  function openRecurringForm(r = null) {
    editingRecurring = r;
    openModal(
      r ? 'Modifica ricorrenza' : 'Nuova rata o ricorrenza',
      `<form id="recForm"><div class="formgrid">
 <div class="field full"><label>Nome</label><input name="name" required maxlength="120" value="${esc(r?.name || '')}" placeholder="Es. rata telefono, NOW"></div>
 <div class="field"><label>Importo (€)</label>${moneyInput(r?.amount ?? '')}</div>
 <div class="field"><label>Categoria</label><select name="category">${categoriesOptions('expense', r?.category || 'Abbonamenti e intrattenimento')}</select></div>
 <div class="field"><label>Frequenza</label><select name="interval"><option value="monthly" ${!r || r.cadence === 'monthly' ? 'selected' : ''}>Mensile</option><option value="weekly" ${r?.cadence === 'weekly' ? 'selected' : ''}>Settimanale</option><option value="yearly" ${r?.cadence === 'yearly' ? 'selected' : ''}>Annuale</option><option value="once" ${r?.cadence === 'once' ? 'selected' : ''}>Una tantum</option></select></div>
 <div class="field"><label>Prossima scadenza</label><input name="next_due" type="date" value="${esc(planDue(r) || today())}" required></div>
 <div class="field"><label>Rate residue (facoltativo)</label><input name="installments_remaining" type="number" min="0" step="1" value="${esc(r?.remaining_installments ?? '')}"></div>
 <div class="field"><label>Metodo di pagamento</label><select name="payment_method"><option value="">Non specificato</option>${['Carta', 'Apple Pay', 'Contanti', 'Bonifico', 'PayPal', 'Addebito diretto', 'Altro'].map((x) => `<option ${r?.payment_method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
 <div class="field full"><label><input type="checkbox" name="active" ${!r || planActive(r) ? 'checked' : ''} class="u-width-auto"> Ricorrenza attiva</label></div>
 </div><button class="btn primary full u-mt-14" type="submit">Salva</button></form>`
    );
    $('recForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        rem = f.get('installments_remaining');
      const payload = {
        space_id:
          r?.space_id || activeSpaceId || spaces.find((s) => s.space_type === 'personal')?.id,
        name: String(f.get('name')).trim(),
        amount: Number(f.get('amount')),
        category: f.get('category'),
        cadence: f.get('interval'),
        next_due_on: f.get('next_due'),
        remaining_installments: rem === '' || rem === null ? null : Number(rem),
        payment_method: f.get('payment_method') || null,
        status: f.has('active') ? 'active' : 'paused',
        plan_type: 'recurring',
        created_on: today(),
        client_id: r?.client_id || null,
      };
      const validationError = validateRecurringPlanInput(payload);
      try {
        if (validationError) throw new Error(validationError);
        const q = r
          ? db.from('recurring_plans').update(payload).eq('id', r.id)
          : db.from('recurring_plans').insert(payload);
        const { error } = await q;
        if (error) throw error;
        closeModal();
        notify('Ricorrenza salvata');
        await loadData();
      } catch (err) {
        notify(err.message, 'error');
      }
    });
  }
  async function updateRecurring(id, changes) {
    const { error } = await db.from('recurring_plans').update(changes).eq('id', id);
    if (error) {
      notify(error.message, 'error');
      return;
    }
    await loadData();
    notify('Ricorrenza aggiornata');
  }
  async function deleteRecurring(id) {
    if (!confirm('Eliminare questa ricorrenza?')) return;
    const { error } = await db.from('recurring_plans').delete().eq('id', id);
    if (error) {
      notify(error.message, 'error');
      return;
    }
    await loadData();
    notify('Ricorrenza eliminata');
  }
  function openGoalForm() {
    openModal(
      'Obiettivo mensile',
      `<form id="goalForm"><div class="field"><label>Residuo minimo desiderato a fine mese (€)</label>${moneyInput(goal)}</div><p class="muted tiny">È il residuo obiettivo, non una spesa aggiuntiva né un trasferimento automatico.</p><button class="btn primary full" type="submit">Salva obiettivo</button></form>`
    );
    $('goalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Number(new FormData(e.target).get('amount'));
      if (n < 0 || !Number.isFinite(n)) {
        notify('Importo non valido', 'error');
        return;
      }
      goal = n;
      try {
        localStorage.setItem('tasca_monthly_goal', String(goal));
      } catch {}
      closeModal();
      renderHome();
      notify('Obiettivo aggiornato su questo dispositivo');
    });
  }
  function openSpaceForm(initialType = 'personal') {
    openModal(
      'Crea spazio',
      `<form id="spaceForm"><div class="field"><label>Nome dello spazio</label><input name="name" maxlength="100" required placeholder="Es. Budget personale, Casa, Regali di Natale, Vacanza"></div><div class="field u-my-16"><label>Tipo di spazio</label><select name="space_type" id="spaceTypeSelect"><option value="personal" ${initialType === 'personal' ? 'selected' : ''}>Personale</option><option value="shared" ${initialType === 'shared' ? 'selected' : ''}>Condiviso</option><option value="trip" ${initialType === 'trip' ? 'selected' : ''}>Progetto</option></select></div><section id="inviteBeforeCreate" class="invite-step" hidden><h3 class="u-mb-6">Invita una persona (facoltativo)</h3><p class="tiny muted u-mb-12">Puoi creare lo spazio anche da solo e invitare altre persone in seguito.</p><div class="field"><label for="initialInviteEmail">Email della persona (facoltativa)</label><input id="initialInviteEmail" name="invite_email" type="email" maxlength="320" placeholder="nome@esempio.it"></div></section><div class="space-form-actions"><button class="btn primary full" type="submit">Crea spazio</button></div></form>`
    );
    const typeSelect = $('spaceTypeSelect'),
      inviteBox = $('inviteBeforeCreate'),
      inviteEmail = $('initialInviteEmail');
    function updateInviteField() {
      inviteBox.hidden = typeSelect.value === 'personal';
    }
    typeSelect.addEventListener('change', updateInviteField);
    updateInviteField();
    $('spaceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        name = String(f.get('name')).trim(),
        spaceType = String(f.get('space_type')),
        email = String(f.get('invite_email') || '').trim();
      if (email && !inviteEmail.checkValidity()) {
        inviteEmail.reportValidity();
        return;
      }
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Creo lo spazio…';
      try {
        const { data, error } = await db.rpc('create_space_with_owner', {
          _name: name,
          _space_type: spaceType,
          _currency: 'EUR',
        });
        if (error) throw error;
        if (!data) throw new Error('La funzione non ha restituito lo spazio creato.');
        const created = Array.isArray(data) ? data[0] : data;
        closeModal();
        await loadData();
        if (spaceType !== 'personal' && email) {
          try {
            const { data: d, error: ie } = await db.rpc('create_space_invitation', {
              p_space_id: created.id,
              p_invited_email: email,
            });
            if (ie) throw ie;
            const inv = Array.isArray(d) ? d[0] : d;
            if (!inv?.invite_token) throw new Error('Token non restituito.');
            const u = new URL(location.href);
            u.searchParams.set('invite', inv.invite_token);
            const link = u.toString();
            openModal(
              'Spazio creato · Invito pronto',
              `<div class="notice"><strong>${esc(name)}</strong> è stato creato. Invia il link a ${esc(email)}. Scade il ${esc(new Date(inv.expires_at).toLocaleString('it-IT'))}.</div><div class="field"><label for="newInviteLink">Link d’invito</label><input id="newInviteLink" readonly value="${esc(link)}" class="invite-link-input"></div><button class="btn terra full" id="copyNewInviteLink" type="button">Copia link d’invito</button><button class="btn full u-mt-8" id="finishInvite" type="button">Vai allo spazio</button>`
            );
            $('copyNewInviteLink').addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(link);
                notify('Link copiato');
              } catch {
                $('newInviteLink').select();
                notify('Seleziona e copia il link', 'error');
              }
            });
            $('finishInvite').addEventListener('click', () => {
              closeModal();
              const sp = spaces.find((x) => x.id === created.id);
              if (sp) openSpace(sp.id);
            });
          } catch (err) {
            notify('Spazio creato, invito non generato: ' + (err.message || ''), 'error');
          }
        } else {
          notify('Spazio creato');
          const sp = spaces.find((x) => x.id === created.id);
          if (sp) openSpace(sp.id);
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Crea spazio';
        notify('Spazio non creato: ' + (err.message || 'errore'), 'error');
      }
    });
  }
  function deleteSpace(id) {
    const s = spaces.find((x) => x.id === id);
    if (!s) return;
    if (s.owner_id !== user?.id) {
      notify('Solo il proprietario può eliminare questo spazio.', 'error');
      return;
    }
    openModal(
      'Elimina spazio',
      `<div class="notice u-mb-14"><strong>Attenzione: operazione irreversibile</strong><p class="u-mt-7">Lo spazio “${esc(s.name)}” e tutti i dati collegati verranno eliminati. Procedi solo quando hai concluso eventuali rimborsi e non ti servono più i dati.</p></div><label class="u-flex-option"><input id="confirmDeleteSpaceCheck" type="checkbox" class="u-checkbox"><span>Confermo di voler eliminare definitivamente questo spazio e i suoi dati.</span></label><div class="space-form-actions u-flex-end"><button class="btn" type="button" data-cancel-delete-space>Annulla</button><button class="btn danger" type="button" data-confirm-delete-space="${esc(s.id)}" disabled>Elimina definitivamente</button></div>`
    );
    const check = $('confirmDeleteSpaceCheck');
    const button = $('modalBody').querySelector('[data-confirm-delete-space]');
    check.addEventListener('change', () => {
      button.disabled = !check.checked;
    });
  }
  async function performDeleteSpace(id) {
    const s = spaces.find((x) => x.id === id);
    if (!s) return;
    if (s.owner_id !== user?.id) {
      notify('Solo il proprietario può eliminare questo spazio.', 'error');
      closeModal();
      return;
    }
    const button = $('modalBody').querySelector('[data-confirm-delete-space]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Eliminazione…';
    }
    try {
      const { data, error } = await db.rpc('delete_space_with_owner', {
        p_space_id: id,
      });
      if (error) throw error;
      if (data === false) throw new Error('Il database non ha confermato l’eliminazione.');
      closeModal();
      if (selectedSpace?.id === id) {
        selectedSpace = null;
        $('spaceDetail').innerHTML = '';
      }
      await loadData();
      notify('Spazio eliminato');
    } catch (err) {
      if (button) {
        button.disabled = false;
        button.textContent = 'Riprova eliminazione';
      }
      notify('Spazio non eliminato: ' + (err.message || 'errore del database'), 'error');
    }
  }
  async function saveSettlement(spaceId, payment, bulk = false) {
    const ok = confirm(
      (bulk
        ? 'Confermi che TUTTI questi rimborsi sono già stati pagati?'
        : 'Confermi che questo rimborso è già stato pagato?') +
        '\n\n' +
        (bulk
          ? payment
              .map((p) => p.from_user_id + ' → ' + p.to_user_id + ': ' + eur(p.amount))
              .join('\n')
          : payment.from_user_id + ' → ' + payment.to_user_id + ': ' + eur(payment.amount)) +
        '\n\nSaranno registrati nello storico.'
    );
    if (!ok) return;
    const rows = (bulk ? payment : [payment]).map((p) => ({
      space_id: spaceId,
      from_user_id: p.from_user_id,
      to_user_id: p.to_user_id,
      amount: p.amount,
      paid_on: today(),
      created_by: user.id,
      notes: bulk ? 'Rimborso confermato in blocco da Tasca' : 'Rimborso confermato da Tasca',
    }));
    try {
      const { error } = await db.from('settlements').insert(rows);
      if (error) throw error;
      notify(bulk ? 'Rimborsi registrati' : 'Rimborso registrato');
      await openSpace(spaceId);
    } catch (err) {
      notify('Rimborso non registrato: ' + (err.message || 'errore database'), 'error');
    }
  }
  async function openSpace(id) {
    const space = spaces.find((item) => item.id === id);
    if (!space) return;
    selectedSpace = space;
    activeSpaceId = id;
    renderSpaceSelector();
    renderHome();
    renderTransactions();
    renderBudgets();
    renderRecurring();
    renderAdvice();

    let rows,
      shares = [],
      settlements,
      members;
    try {
      [rows, settlements, members] = await Promise.all([
        fetchAllRows(() =>
          db
            .from('transactions')
            .select('*')
            .eq('space_id', id)
            .order('occurred_on', { ascending: false })
            .order('id', { ascending: false })
        ),
        fetchAllRows(() =>
          db
            .from('settlements')
            .select('*')
            .eq('space_id', id)
            .order('paid_on', { ascending: false })
            .order('id', { ascending: false })
        ),
        fetchAllRows(() =>
          db
            .from('space_members')
            .select('user_id,role')
            .eq('space_id', id)
            .order('user_id', { ascending: true })
        ),
      ]);
      const transactionIds = rows.map((transaction) => transaction.id);
      for (let offset = 0; offset < transactionIds.length; offset += 100) {
        const batchIds = transactionIds.slice(offset, offset + 100);
        const batchShares = await fetchAllRows(() =>
          db
            .from('expense_shares')
            .select('transaction_id,user_id,share_amount')
            .in('transaction_id', batchIds)
            .order('transaction_id', { ascending: true })
            .order('user_id', { ascending: true })
        );
        shares.push(...batchShares);
      }
    } catch (err) {
      notify(
        'Non riesco a caricare spese e rimborsi: ' + (err.message || 'errore database'),
        'error'
      );
      return;
    }
    const shared = space.space_type !== 'personal',
      canInvite = space.owner_id === user?.id && shared;
    const memberIds = [
      ...new Set([...members.map((member) => member.user_id), space.owner_id].filter(Boolean)),
    ];
    const labels = (id) => (id === user?.id ? 'Tu' : 'Partecipante ' + String(id).slice(0, 8));
    const eligibleExpenses = rows.filter(
      (transaction) => transaction.type === 'expense' && transaction.status === 'confirmed'
    );
    const sharesByTransaction = new Map();
    shares.forEach((share) => {
      const transactionShares = sharesByTransaction.get(share.transaction_id) || [];
      transactionShares.push(share);
      sharesByTransaction.set(share.transaction_id, transactionShares);
    });
    const missingShares = eligibleExpenses.filter(
      (transaction) => !sharesByTransaction.has(transaction.id)
    );
    const balances = calculateParticipantBalances(memberIds, eligibleExpenses, shares, settlements);
    const plan = settlementPlan(balances),
      blocked = missingShares.length > 0;
    const planHtml = shared
      ? '<div class="panel u-my-14"><h3>Saldo tra partecipanti</h3><p class="tiny muted">Il saldo considera le spese confermate, le quote registrate e i rimborsi già salvati.</p>' +
        balances
          .map(
            (b) =>
              '<div class="movement"><div class="movinfo"><strong>' +
              esc(labels(b.user_id)) +
              '</strong><small>' +
              esc(String(b.user_id)) +
              '</small></div><div class="amount ' +
              (b.balance >= 0 ? 'income' : 'expense') +
              '">' +
              (b.balance >= 0 ? '+ ' : '− ') +
              eur(Math.abs(b.balance)) +
              '</div></div>'
          )
          .join('') +
        (blocked
          ? '<div class="notice warn">Ci sono ' +
            missingShares.length +
            ' spese confermate senza quote registrate. Per evitare rimborsi errati, completa prima la ripartizione delle spese.</div>'
          : '') +
        '<h3 class="u-mt-14">Rimborsi da effettuare</h3>' +
        (plan.length
          ? plan
              .map(
                (p, i) =>
                  '<div class="movement"><div class="movinfo"><strong>' +
                  esc(labels(p.from_user_id)) +
                  ' → ' +
                  esc(labels(p.to_user_id)) +
                  '</strong><small>' +
                  eur(p.amount) +
                  '</small></div><button class="btn small" data-confirm-settlement="' +
                  i +
                  '" ' +
                  (blocked ? 'disabled' : '') +
                  '>Conferma rimborso</button></div>'
              )
              .join('')
          : '<p class="tiny muted">Non risultano rimborsi da effettuare.</p>') +
        '<button class="btn terra full" id="confirmAllSettlements" ' +
        (!plan.length || blocked ? 'disabled' : '') +
        '>Conferma tutti i rimborsi</button><p class="tiny muted">Conferma solo pagamenti realmente effettuati. I rimborsi registrati non verranno riproposti.</p></div>'
      : '';
    $('spaceDetail').innerHTML =
      '<h3>' +
      esc(space.name) +
      '</h3><p class="tiny muted">' +
      (space.space_type === 'personal'
        ? 'Spazio personale'
        : space.space_type === 'trip'
          ? 'Spazio progetto'
          : 'Spazio condiviso') +
      '</p>' +
      '<button class="btn primary full u-space-action" id="addSpaceMovementTop" data-add-space-movement data-space-id="' +
      esc(id) +
      '">＋ Registra una spesa in questo spazio</button>' +
      (canInvite
        ? '<div class="notice">Invita una persona tramite email. Il link è valido 7 giorni ed è utilizzabile solo dall’account con quell’indirizzo.</div><form id="inviteForm" class="formgrid"><div class="field"><label for="inviteEmail">Email della persona</label><input id="inviteEmail" name="email" type="email" maxlength="320" required placeholder="nome@esempio.it"></div><div class="field u-justify-end"><button class="btn primary" type="submit">Crea link d’invito</button></div></form><div id="inviteResult"></div>'
        : '') +
      planHtml +
      '<h3 class="u-mt-18">Movimenti dello spazio</h3><div>' +
      rows.map((t) => movementHtml(t)).join('') +
      '</div><h3 class="u-mt-18">Rimborsi registrati</h3>' +
      (settlements
        .map(
          (x) =>
            '<div class="movement"><div class="movinfo"><strong>' +
            esc(labels(x.from_user_id)) +
            ' → ' +
            esc(labels(x.to_user_id)) +
            '</strong><small>' +
            esc(fmtDate(x.paid_on)) +
            '</small></div><div class="amount">' +
            eur(x.amount) +
            '</div></div>'
        )
        .join('') ||
        emptyHtml('Nessun rimborso registrato', 'I rimborsi confermati compariranno qui.')) +
      '<p class="tiny muted">I nomi dei partecipanti non sono disponibili nelle tabelle attuali; per ora vengono mostrati identificativi abbreviati.</p>';
    document
      .querySelectorAll('[data-confirm-settlement]')
      .forEach((b) =>
        b.addEventListener('click', () =>
          saveSettlement(id, plan[Number(b.dataset.confirmSettlement)])
        )
      );
    const all = $('confirmAllSettlements');
    if (all) all.addEventListener('click', () => saveSettlement(id, plan, true));
    const form = $('inviteForm');
    if (form)
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('inviteEmail').value.trim(),
          result = $('inviteResult');
        result.innerHTML = '<p class="tiny muted">Creo l’invito…</p>';
        try {
          const { data, error } = await db.rpc('create_space_invitation', {
            p_space_id: id,
            p_invited_email: email,
          });
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          if (!row?.invite_token) throw new Error('Il database non ha restituito il token.');
          const url = new URL(location.href);
          url.searchParams.set('invite', row.invite_token);
          const link = url.toString();
          result.innerHTML =
            '<div class="notice"><strong>Invito creato</strong><p class="tiny">Scade: ' +
            esc(new Date(row.expires_at).toLocaleString('it-IT')) +
            '</p><input id="inviteLink" readonly value="' +
            esc(link) +
            '" class="invite-link-input-compact"><button class="btn small u-mt-8" id="copyInviteLink" type="button">Copia link</button><p class="tiny muted">Condividi il link solo con ' +
            esc(email) +
            '. Il token viene mostrato solo ora.</p></div>';
          $('copyInviteLink').addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(link);
              notify('Link copiato');
            } catch {
              $('inviteLink').select();
              notify('Seleziona e copia il link', 'error');
            }
          });
        } catch (err) {
          result.innerHTML =
            '<div class="notice error">' +
            esc(err.message || 'Non riesco a creare l’invito.') +
            '</div>';
        }
      });
    notify('Spazio aperto');
  }

  function exportPersonalData() {
    if (!user) {
      notify('Accedi per esportare i dati.', 'error');
      return;
    }
    const csv = serializeFinanceCsv([
      { name: 'movimenti', rows: transactions },
      { name: 'budget', rows: budgets },
      { name: 'ricorrenze', rows: recurring },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasca-esportazione-' + today() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify('Esportazione CSV avviata.');
  }

  function openAccountSettings() {
    if (!user) {
      notify('Accedi per gestire il tuo account.', 'error');
      return;
    }
    const meta = user.user_metadata || {};
    const displayName = meta.full_name || meta.name || '';
    const created = user.created_at
      ? new Date(user.created_at).toLocaleDateString('it-IT')
      : 'Non disponibile';
    $('accountPopover').innerHTML =
      `<div class="account-popover-head"><strong>Account e impostazioni</strong><button class="account-popover-close" id="accountPopoverClose" type="button" aria-label="Chiudi">×</button></div><div class="account-settings">
  <div class="account-profile-head"><div class="account-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"></circle><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"></path></svg></div><div><strong>${esc(displayName || 'Il tuo account')}</strong><div class="muted tiny">${esc(user.email || 'Email non disponibile')}</div></div></div>
  <section class="account-setting-section"><h3>Anagrafica</h3><form id="profileSettingsForm"><div class="field"><label for="profileDisplayName">Nome visualizzato</label><input id="profileDisplayName" name="display_name" maxlength="80" value="${esc(displayName)}" placeholder="Come vuoi essere chiamato"></div><button class="btn primary full u-mt-10" type="submit">Salva anagrafica</button></form></section>
  <section class="account-setting-section"><h3>Email di accesso</h3><p class="muted tiny">Email attuale: ${esc(user.email || 'Non disponibile')}. Per sicurezza, Supabase potrebbe chiederti di confermare il nuovo indirizzo via email.</p><form id="accountEmailForm"><div class="field"><label for="accountNewEmail">Nuovo indirizzo email</label><input id="accountNewEmail" name="email" type="email" required maxlength="320" placeholder="nuova@email.it"></div><button class="btn full u-mt-10" type="submit">Richiedi modifica email</button></form></section>
  <section class="account-setting-section"><h3>Password</h3><form id="accountPasswordForm"><div class="field"><label for="accountNewPassword">Nuova password</label><input id="accountNewPassword" name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Almeno 8 caratteri"></div><div class="field u-mt-10"><label for="accountConfirmPassword">Conferma nuova password</label><input id="accountConfirmPassword" name="confirm_password" type="password" required minlength="8" autocomplete="new-password" placeholder="Ripeti la nuova password"></div><button class="btn full u-mt-10" type="submit">Aggiorna password</button></form></section>
  <section class="account-setting-section"><h3>Preferenze e dati</h3><div class="account-setting-actions"><button id="accountGoalBtn" class="btn" type="button">Obiettivo di risparmio</button><span class="muted tiny">Account creato il ${esc(created)}</span></div><p class="muted tiny">Le preferenze dell'obiettivo sono salvate su questo dispositivo. Le impostazioni di sicurezza sono gestite da Supabase.</p></section>
  <section class="account-setting-section"><h3>Dati e privacy</h3><p class="muted tiny">Scarica una copia dei movimenti, dei budget e delle ricorrenze attualmente caricati in Tasca. Il file include i campi disponibili nel tuo account.</p><div class="account-setting-actions"><button id="accountExportBtn" class="btn" type="button">Esporta dati in CSV</button><span class="muted tiny">Il file viene creato sul tuo dispositivo.</span></div></section>
  <section class="account-logout"><button id="accountLogoutBtn" class="btn danger full" type="button">Esci dall'account</button></section>
 </div>`;
    $('accountPopover').classList.add('open');
    $('accountBtn').setAttribute('aria-expanded', 'true');
    $('accountPopoverClose').addEventListener('click', closeAccountPopover);
    $('profileSettingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = String(new FormData(e.target).get('display_name') || '').trim();
      try {
        const { data, error } = await db.auth.updateUser({
          data: { ...((user && user.user_metadata) || {}), full_name: name },
        });
        if (error) throw error;
        user = data.user || user;
        notify('Anagrafica aggiornata');
        openAccountSettings();
      } catch (err) {
        notify(err.message || 'Non riesco ad aggiornare l’anagrafica.', 'error');
      }
    });
    $('accountEmailForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = String(new FormData(e.target).get('email') || '').trim();
      if (email.toLowerCase() === String(user.email || '').toLowerCase()) {
        notify('Inserisci un indirizzo email diverso da quello attuale.', 'error');
        return;
      }
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const { error } = await db.auth.updateUser({ email });
        if (error) throw error;
        notify('Richiesta inviata: controlla la posta per confermare il nuovo indirizzo.');
        e.target.reset();
      } catch (err) {
        notify(err.message || 'Non riesco a modificare l’email.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
    $('accountPasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target),
        password = String(f.get('password') || ''),
        confirmPassword = String(f.get('confirm_password') || '');
      if (password.length < 8) {
        notify('La password deve contenere almeno 8 caratteri.', 'error');
        return;
      }
      if (password !== confirmPassword) {
        notify('Le password non coincidono.', 'error');
        return;
      }
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        notify('Password aggiornata correttamente.');
        e.target.reset();
      } catch (err) {
        notify(err.message || 'Non riesco ad aggiornare la password.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
    $('accountGoalBtn').addEventListener('click', () => {
      closeModal();
      openGoalForm();
    });
    $('accountExportBtn').addEventListener('click', exportPersonalData);
    $('accountLogoutBtn').addEventListener('click', async () => {
      if (!confirm('Vuoi uscire dal tuo account Tasca?')) return;
      try {
        const { error } = await db.auth.signOut();
        if (error) throw error;
        closeModal();
        showLogin();
        notify('Sei uscito da Tasca.');
      } catch (err) {
        notify(err.message || 'Non riesco a terminare la sessione.', 'error');
      }
    });
  }

  function initSidebarReordering() {
    const nav = $('desktopNav');
    if (!nav) return;
    const storageKey = 'tasca_sidebar_order_v1';
    const getItems = () => Array.from(nav.querySelectorAll(':scope > button[data-page]'));
    const saveOrder = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(getItems().map((b) => b.dataset.page)));
      } catch {}
    };
    const applySavedOrder = () => {
      let order = [];
      try {
        order = JSON.parse(localStorage.getItem(storageKey) || '[]');
      } catch {}
      if (!Array.isArray(order)) order = [];
      const buttons = new Map(getItems().map((b) => [b.dataset.page, b]));
      order.forEach((key) => {
        const button = buttons.get(key);
        if (button) {
          nav.appendChild(button);
          buttons.delete(key);
        }
      });
      buttons.forEach((button) => nav.appendChild(button));
    };
    applySavedOrder();
    let dragged = null;
    getItems().forEach((button) => {
      button.draggable = true;
      button.title = (button.title ? button.title + ' · ' : '') + 'Trascina per riordinare';
      button.setAttribute('aria-grabbed', 'false');
      button.addEventListener('dragstart', (event) => {
        dragged = button;
        button.classList.add('dragging');
        button.setAttribute('aria-grabbed', 'true');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', button.dataset.page);
        }
      });
      button.addEventListener('dragover', (event) => {
        if (!dragged || dragged === button) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const rect = button.getBoundingClientRect();
        const insertAfter = event.clientY > rect.top + rect.height / 2;
        if (insertAfter) {
          if (button.nextElementSibling !== dragged)
            nav.insertBefore(dragged, button.nextElementSibling);
        } else if (button !== dragged.nextElementSibling) nav.insertBefore(dragged, button);
      });
      button.addEventListener('drop', (event) => {
        event.preventDefault();
        saveOrder();
      });
      button.addEventListener('dragend', () => {
        if (dragged) {
          dragged.classList.remove('dragging');
          dragged.setAttribute('aria-grabbed', 'false');
        }
        dragged = null;
        saveOrder();
      });
      button.addEventListener('keydown', (event) => {
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          const sibling =
            event.key === 'ArrowUp' ? button.previousElementSibling : button.nextElementSibling;
          if (sibling && sibling.matches('button[data-page]')) {
            if (event.key === 'ArrowUp') nav.insertBefore(button, sibling);
            else nav.insertBefore(sibling, button);
            saveOrder();
            button.focus();
          }
        }
      });
    });
  }

  function initNavigation() {
    initSidebarReordering();
    $('startQuizBtn')?.addEventListener('click', startQuiz);
    $('themeModeToggle').addEventListener('click', toggleTheme);
    $('settingsGoalBtn').addEventListener('click', openGoalForm);
    $('settingsExportBtn').addEventListener('click', exportPersonalData);
    $('settingsAccountBtn').addEventListener('click', () => {
      closeAccountPopover();
      openAccountSettings();
    });
    $('homeLogoBtn').addEventListener('click', () => showPage('home'));
    $('accountBtn').addEventListener('click', () => {
      if ($('accountPopover').classList.contains('open')) closeAccountPopover();
      else openAccountSettings();
    });
    const menuBtn = $('mobileMenuBtn'),
      nav = $('desktopNav'),
      backdrop = $('navBackdrop');
    function closeSideNav() {
      nav.classList.remove('open');
      backdrop.classList.remove('open');
      document.body.classList.remove('menu-open');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Apri tutte le funzioni');
      menuBtn.textContent = '☰';
    }
    function toggleSideNav() {
      const opening = !nav.classList.contains('open');
      nav.classList.toggle('open', opening);
      backdrop.classList.toggle('open', opening);
      document.body.classList.toggle('menu-open', opening);
      menuBtn.setAttribute('aria-expanded', String(opening));
      menuBtn.setAttribute('aria-label', opening ? 'Chiudi tutte le funzioni' : 'Apri tutte le funzioni');
      menuBtn.textContent = opening ? '✕' : '☰';
    }
    menuBtn.addEventListener('click', toggleSideNav);
    const mobileNavTrack = $('mobileNavTrack');
    const mobileNavDots = Array.from(document.querySelectorAll('.mobile-nav-pagination span'));
    function syncMobileNavDots() {
      if (!mobileNavTrack) return;
      const pageIndex = mobileNavTrack.scrollLeft >= mobileNavTrack.clientWidth / 2 ? 1 : 0;
      mobileNavDots.forEach((dot, index) => dot.classList.toggle('active', index === pageIndex));
    }
    mobileNavTrack?.addEventListener('scroll', syncMobileNavDots, { passive: true });
    syncMobileNavDots();
    let mobileNavTouchStartX = null;
    let mobileNavTouchStartAt = 0;
    let suppressMobileNavClick = false;
    let mobileNavClickTimer = 0;
    mobileNavTrack?.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length !== 1) {
          mobileNavTouchStartX = null;
          return;
        }
        mobileNavTouchStartX = event.touches[0].clientX;
        mobileNavTouchStartAt = performance.now();
      },
      { passive: true }
    );
    mobileNavTrack?.addEventListener(
      'touchend',
      (event) => {
        if (mobileNavTouchStartX === null || !event.changedTouches.length) return;
        const deltaX = event.changedTouches[0].clientX - mobileNavTouchStartX;
        const elapsed = performance.now() - mobileNavTouchStartAt;
        mobileNavTouchStartX = null;
        if (Math.abs(deltaX) < 26 && !(Math.abs(deltaX) >= 14 && elapsed < 180)) return;
        const currentPage = mobileNavTrack.scrollLeft >= mobileNavTrack.clientWidth / 2 ? 1 : 0;
        const targetPageName = deltaX < 0 ? 'secondary' : 'primary';
        const targetPage = mobileNavTrack.querySelector(
          '.mobile-nav-page[data-nav-page="' + targetPageName + '"]'
        );
        const targetIndex = targetPageName === 'secondary' ? 1 : 0;
        if (!targetPage || targetIndex === currentPage) return;
        suppressMobileNavClick = true;
        window.clearTimeout(mobileNavClickTimer);
        mobileNavClickTimer = window.setTimeout(() => {
          suppressMobileNavClick = false;
        }, 450);
        mobileNavTrack.scrollLeft = targetPage.offsetLeft;
      },
      { passive: true }
    );
    mobileNavTrack?.addEventListener('touchcancel', () => {
      mobileNavTouchStartX = null;
    });
    mobileNavTrack?.addEventListener(
      'click',
      (event) => {
        if (!suppressMobileNavClick) return;
        suppressMobileNavClick = false;
        window.clearTimeout(mobileNavClickTimer);
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
    backdrop.addEventListener('click', closeSideNav);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSideNav();
    });
    document.addEventListener('click', (e) => {
      if ($('accountPopover').classList.contains('open') && !e.target.closest('.account-menu-wrap'))
        closeAccountPopover();
    });
    $('shortcutInfoBtn').addEventListener('click', () =>
      openModal(
        'Scorciatoia Wallet',
        `<div class="account-settings"><p>Apri il link qui sotto sul tuo iPhone per aggiungere il comando rapido.</p><p><a class="btn primary full" href="https://www.icloud.com/shortcuts/424d5b7c67394fa7ae48db1a09e56031" target="_blank" rel="noopener noreferrer">Aggiungi Comando Rapido</a></p><p class="muted tiny">Dopo l’installazione, eseguilo dall’app Comandi e verifica i dati prima di confermare il salvataggio in Tasca.</p><button class="btn full" id="shortcutCloseInfo" type="button">Chiudi</button></div>`
      )
    );
    document.querySelectorAll('[data-page]').forEach((b) =>
      b.addEventListener('click', () => {
        showPage(b.dataset.page);
        closeSideNav();
      })
    );
    document
      .querySelectorAll('[data-goto]')
      .forEach((b) => b.addEventListener('click', () => showPage(b.dataset.goto)));
    $('quickExpense').addEventListener('click', () => {
      if (requireSpecificSpace('registrare un movimento'))
        openTransactionForm(null, 'expense', activeSpaceId);
    });
    $('quickIncome').addEventListener('click', () => {
      if (requireSpecificSpace('registrare un movimento'))
        openTransactionForm(null, 'income', activeSpaceId);
    });
    $('newTransactionBtn').addEventListener('click', () => {
      if (requireSpecificSpace('registrare un movimento'))
        openTransactionForm(null, 'expense', activeSpaceId);
    });
    $('newBudgetBtn').addEventListener('click', () => {
      if (requireSpecificSpace('creare un budget')) openBudgetForm();
    });
    $('newRecurringBtn').addEventListener('click', () => {
      if (requireSpecificSpace('creare una ricorrenza')) openRecurringForm();
    });
    $('newSpaceBtn').addEventListener('click', () => openSpaceForm());
    $('homeCreatePersonalSpace').addEventListener('click', () => openSpaceForm('personal'));
    $('homeCreateSharedSpace').addEventListener('click', () => openSpaceForm('shared'));
    $('homeCreateProjectSpace').addEventListener('click', () => openSpaceForm('trip'));
    $('editGoalBtn').addEventListener('click', openGoalForm);
    $('activeSpaceSelect').addEventListener('change', (e) => {
      activeSpaceId = e.target.value || null;
      renderAll();
      const current = activeSpace();
      notify(
        isAllSpaces()
          ? 'Visualizzazione di tutti gli spazi'
          : current
            ? 'Spazio attivo: ' + current.name
            : 'Seleziona uno spazio'
      );
    });
    $('searchMovements').addEventListener('input', renderTransactions);
    $('filterType').addEventListener('change', renderTransactions);
    $('filterMonth').addEventListener('change', renderTransactions);
    $('previewStatementBtn')?.addEventListener('click', previewStatementFile);
    $('statementFile')?.addEventListener('change', () => {
      statementImportRows = [];
      $('statementImportPreview').innerHTML = '';
      $('statementImportStatus').textContent = 'File selezionato. Premi “Analizza file” per visualizzare le righe.';
    });
    $('budgetMonth').addEventListener('change', renderBudgets);
    $('refreshBtn').addEventListener('click', loadData);
    $('aiChatForm')?.addEventListener('submit', sendAIChatMessage);
    $('modalClose').addEventListener('click', closeModal);
    $('modalBody').addEventListener('click', (e) => {
      if (e.target.closest('#shortcutCloseInfo')) closeModal();
    });
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal')) closeModal();
    });
    $('togglePassword').addEventListener('click', () => {
      const input = $('authPassword'),
        show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('togglePassword').setAttribute(
        'aria-label',
        show ? 'Nascondi password' : 'Mostra password'
      );
      $('togglePassword').setAttribute('title', show ? 'Nascondi password' : 'Mostra password');
      $('togglePassword').setAttribute('aria-pressed', String(show));
    });
    $('showSignup').addEventListener('click', () => showAuth('signup'));
    $('showReset').addEventListener('click', () => showAuth('reset'));
    $('authForm').addEventListener('submit', authSubmit);
    $('onboardingPrev').addEventListener('click', () => {
      if (onboardingIndex > 0) {
        onboardingIndex -= 1;
        renderOnboardingStep();
      }
    });
    $('onboardingNext').addEventListener('click', () => {
      if (onboardingIndex < onboardingSteps.length - 1) {
        onboardingIndex += 1;
        renderOnboardingStep();
      } else {
        finishOnboarding();
      }
    });
    $('onboardingSkip').addEventListener('click', finishOnboarding);
    document.addEventListener('click', (e) => {
      const addSpaceMovement = e.target.closest('[data-add-space-movement]');
      if (addSpaceMovement) {
        e.preventDefault();
        const spaceId = addSpaceMovement.dataset.spaceId;
        if (!spaceId || !spaces.some((space) => space.id === spaceId)) {
          notify(
            'Non riesco a identificare lo spazio per questa spesa. Riapri lo spazio e riprova.',
            'error'
          );
          return;
        }
        try {
          openTransactionForm(null, 'expense', spaceId);
        } catch (err) {
          notify('Errore apertura spesa: ' + (err.message || err), 'error');
        }
        return;
      }
      const b = e.target.closest('[data-edit-tx]');
      if (b) {
        const t = transactions.find((x) => x.id === b.dataset.editTx);
        if (t) openTransactionForm(t);
        return;
      }
      const d = e.target.closest('[data-delete-tx]');
      if (d) {
        deleteTransaction(d.dataset.deleteTx);
        return;
      }
      const eb = e.target.closest('[data-edit-budget]');
      if (eb) {
        const b = budgets.find((x) => x.id === eb.dataset.editBudget);
        if (b) openBudgetForm(b);
        return;
      }
      const dbtn = e.target.closest('[data-delete-budget]');
      if (dbtn) {
        deleteBudget(dbtn.dataset.deleteBudget);
        return;
      }
      const er = e.target.closest('[data-edit-rec]');
      if (er) {
        const r = recurring.find((x) => x.id === er.dataset.editRec);
        if (r) openRecurringForm(r);
        return;
      }
      const tr = e.target.closest('[data-toggle-rec]');
      if (tr) {
        const r = recurring.find((x) => x.id === tr.dataset.toggleRec);
        if (r)
          updateRecurring(r.id, {
            status: planActive(r) ? 'paused' : 'active',
          });
        return;
      }
      const dr = e.target.closest('[data-delete-rec]');
      if (dr) {
        deleteRecurring(dr.dataset.deleteRec);
        return;
      }
      const cancelDelete = e.target.closest('[data-cancel-delete-space]');
      if (cancelDelete) {
        closeModal();
        return;
      }
      const confirmDelete = e.target.closest('[data-confirm-delete-space]');
      if (confirmDelete) {
        performDeleteSpace(confirmDelete.dataset.confirmDeleteSpace);
        return;
      }
      const ds = e.target.closest('[data-delete-space]');
      if (ds) {
        deleteSpace(ds.dataset.deleteSpace);
        return;
      }
      const addSpaceExpense = e.target.closest('#addSpaceMovementTop');
      if (addSpaceExpense) {
        if (!selectedSpace) {
          notify('Apri prima uno spazio.', 'error');
          return;
        }
        openTransactionForm(null, 'expense', selectedSpace.id);
        return;
      }
      const os = e.target.closest('[data-open-space]');
      if (os) {
        openSpace(os.dataset.openSpace);
      }
    });
  }
  async function handlePendingInvite() {
    const url = new URL(location.href);
    const token = url.searchParams.get('invite');
    if (!token || !user) return;
    url.searchParams.delete('invite');
    history.replaceState({}, '', url.toString());
    try {
      const { data, error } = await db.rpc('accept_space_invitation', {
        p_token: token,
      });
      if (error) throw error;
      notify('Invito accettato: sei entrato nello spazio.');
      await loadData();
      if (data) showPage('spaces');
    } catch (err) {
      notify('Invito non accettato: ' + (err.message || 'link non valido o scaduto'), 'error');
    }
  }

  function clearShortcutParams() {
    const url = new URL(location.href);
    [
      'finanze',
      'amount',
      'description',
      'merchant',
      'date',
      'category',
      'method',
      'type',
      'space',
    ].forEach((k) => url.searchParams.delete(k));
    history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
  async function processShortcutImport() {
    if (shortcutImportRunning || !db || !user || !spaces.length) return;
    const params = new URLSearchParams(location.search);
    if (params.get('finanze') !== 'add') return;
    const amount = Number(String(params.get('amount') || '').replace(',', '.'));
    const description = String(params.get('description') || params.get('merchant') || '')
      .trim()
      .slice(0, 160);
    const date = params.get('date') || today();
    const method = params.get('method') || 'Apple Pay';
    const rawCategory = String(params.get('category') || 'Da verificare').trim();
    const type = ['expense', 'income', 'transfer', 'refund'].includes(params.get('type'))
      ? params.get('type')
      : 'expense';
    // Compatibilità con le etichette del menu nel Comando Rapido iOS.
    // URLSearchParams decodifica già gli spazi e i caratteri percent-encoded.
    const normalizeCategory = (value) =>
      String(value || '')
        .trim()
        .toLocaleLowerCase('it-IT')
        .replace(/\s+/g, ' ');
    const shortcutCategoryAliases = {
      spesa: 'Alimentari e supermercato',
      altro: 'Altre spese personali',
      'parcheggi e manutenzione': 'Parcheggi e manutenzione',
      'altre spese personali': 'Altre spese personali',
    };
    const normalizedRawCategory = normalizeCategory(rawCategory);
    const canonicalCategory = (CATEGORIES[type] || CATEGORIES.expense).find(
      (item) => normalizeCategory(item) === normalizedRawCategory
    );
    const category =
      shortcutCategoryAliases[normalizedRawCategory] || canonicalCategory || 'Da verificare';
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !description ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      notify(
        'Dati del Comando Rapido incompleti o non validi. Controlla importo, esercente e data.',
        'error'
      );
      return;
    }
    // Il Comando Rapido può passare space=personal/personale oppure space=shared/condiviso.
    // Se il parametro manca, manteniamo la selezione tradizionale tra tutti gli spazi.
    const requestedSpace = normalizeCategory(params.get('space'));
    const requestedSpaceType = ['personal', 'personale'].includes(requestedSpace)
      ? 'personal'
      : ['shared', 'condiviso'].includes(requestedSpace)
        ? 'shared'
        : ['trip', 'viaggio', 'progetto/viaggio'].includes(requestedSpace)
          ? 'trip'
          : null;
    if (requestedSpace && !requestedSpaceType) {
      notify('Spazio del Comando Rapido non riconosciuto. Usa Personale o Condiviso.', 'error');
      clearShortcutParams();
      return;
    }
    const eligibleSpaces = requestedSpaceType
      ? spaces.filter((space) => space.space_type === requestedSpaceType)
      : spaces;
    if (requestedSpaceType && eligibleSpaces.length === 0) {
      notify(
        requestedSpaceType === 'personal'
          ? 'Non hai uno spazio personale disponibile per questa registrazione.'
          : requestedSpaceType === 'shared'
            ? 'Non hai uno spazio condiviso disponibile per questa registrazione.'
            : 'Non hai uno spazio progetto/viaggio disponibile per questa registrazione.',
        'error'
      );
      clearShortcutParams();
      return;
    }
    let targetSpace = eligibleSpaces.length === 1 ? eligibleSpaces[0] : null;
    if (!targetSpace) {
      const spaceChoices = eligibleSpaces
        .map((space, index) => {
          const kind =
            space.space_type === 'personal'
              ? 'Personale'
              : space.space_type === 'trip'
                ? 'Progetto/viaggio'
                : 'Condiviso';
          return index + 1 + '. ' + space.name + ' (' + kind + ')';
        })
        .join('\n');
      const choice = window.prompt(
        'Dove vuoi registrare questa spesa?\n\n' +
          spaceChoices +
          '\n\nInserisci il numero dello spazio. Premi Annulla per non registrare.'
      );
      if (choice === null) {
        notify('Importazione annullata: non è stato salvato alcun movimento.');
        clearShortcutParams();
        return;
      }
      const selectedIndex = Number(choice.trim()) - 1;
      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= eligibleSpaces.length
      ) {
        notify('Numero dello spazio non valido. Riapri il collegamento e riprova.', 'error');
        return;
      }
      targetSpace = eligibleSpaces[selectedIndex];
    }
    const matchingTransactions = transactions.filter((t) => t.space_id === targetSpace.id);
    const duplicateCandidate = { type, amount, occurred_on: date, description };
    const duplicateMatches = matchingTransactions
      .map((t) => ({ transaction: t, confidence: compareTransactionForDuplicate(duplicateCandidate, t) }))
      .filter((match) => match.confidence !== 'none')
      .sort((a, b) => (a.confidence === 'strong' ? 0 : 1) - (b.confidence === 'strong' ? 0 : 1));
    const duplicateMatch = duplicateMatches[0];
    if (duplicateMatch?.confidence === 'strong') {
      notify(
        'Pagamento non importato: una registrazione corrispondente è già presente in Tasca.',
        'error'
      );
      clearShortcutParams();
      return;
    }
    let duplicateDecision = null;
    if (duplicateMatch?.confidence === 'possible') {
      duplicateDecision = await requestDuplicateDecision(
        duplicateMatch.transaction,
        { description, amount, occurred_on: date, payment_method: method },
        'Movimento già presente',
        'Nuovo movimento Wallet'
      );
      if (!duplicateDecision) { clearShortcutParams(); return; }
      if (duplicateDecision === 'keep-existing') {
        clearShortcutParams();
        notify('Mantenuto il movimento già registrato: nessun doppione creato.');
        return;
      }
    }
    shortcutImportRunning = true;
    try {
      const accepted = confirm(
        'Registrare in Tasca questo pagamento?\n\n' +
          description +
          '\n' +
          eur(amount) +
          '\nData: ' +
          date +
          '\nMetodo: ' +
          method +
          '\nCategoria: ' +
          category +
          '\nSpazio: ' +
          targetSpace.name
      );
      if (!accepted) {
        clearShortcutParams();
        notify('Importazione annullata.');
        return;
      }
      const payload = {
        space_id: targetSpace.id,
        type,
        amount,
        currency: 'EUR',
        description,
        category,
        occurred_on: date,
        paid_by: user.id,
        created_by: user.id,
        payment_method: method,
        status: 'confirmed',
        notes:
          category === 'Da verificare'
            ? 'Importato dal Comando Rapido: categoria da verificare.'
            : 'Importato dal Comando Rapido.',
      };
      if (duplicateDecision === 'keep-candidate') {
        const existing = duplicateMatch.transaction;
        await updateTransactionFromDuplicate(existing, { ...payload, occurred_on: date }, 'Wallet');
        clearShortcutParams();
        notify('Movimento riconciliato: mantenuta la versione Wallet, con traccia dei dati precedenti.');
      } else {
        const { error } = await db.from('transactions').insert(payload);
        if (error) throw error;
        clearShortcutParams();
        notify(duplicateDecision === 'keep-both' ? 'Registrato: confermato che sono due spese distinte.' : 'Pagamento importato da Comando Rapido.');
      }
      await loadData();
    } catch (err) {
      notify(
        'Importazione non riuscita: ' +
          (err.message || 'errore sconosciuto') +
          '. Il link è stato mantenuto per riprovare.',
        'error'
      );
    } finally {
      shortcutImportRunning = false;
    }
  }

  async function start() {
    initTheme();
    restoreRememberedEmail();
    $('authBirthDate').max = today();
    $('budgetMonth').value = monthNow();
    $('filterMonth').value = monthNow();
    initNavigation();
    $('refreshAIAdviceBtn')?.addEventListener('click', () => {
      if (!isAIConfigured()) {
        notify('Prima collega l’URL del Worker Cloudflare nel file app.js.', 'warn');
        return;
      }
      aiAdviceText = 'Sto aggiornando i consigli sullo storico…';
      renderAdvice();
      requestAIAdvice(true);
    });
    if (!validConfig() || !window.supabase) {
      showAuthMessage(
        'Prima di accedere, inserisci URL e chiave pubblica del progetto Supabase nel codice.',
        'warn'
      );
      return;
    }
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    db.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const userChanged = user?.id !== session.user.id;
        user = session.user;
        showApp();
        if (event !== 'INITIAL_SESSION' && (event === 'SIGNED_IN' || userChanged)) loadData();
        if (event === 'SIGNED_IN') handlePendingInvite();
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        showLogin();
      }
    });
    const { data, error } = await db.auth.getSession();
    if (error) {
      showAuthMessage(error.message, 'error');
      return;
    }
    if (data.session?.user) {
      user = data.session.user;
      showApp();
      await loadData();
      await handlePendingInvite();
    } else {
      showLogin();
      if (new URL(location.href).searchParams.has('invite'))
        showAuthMessage('Accedi con l’email destinataria dell’invito; poi potrai accettarlo.');
    }
  }
  start();
})();
