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

(() => {
  'use strict';

  /* CONFIGURAZIONE: usa solo la chiave pubblica Supabase (publishable/anon). */
  const SUPABASE_URL = 'https://njgmlxyecjyreieqcpwk.supabase.co';
  const SUPABASE_PUBLIC_KEY = 'sb_publishable_U6dgmohD5p7Z5jxcwHLZSg_MoR2cjz1';

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
    toastTimer = null;
  let shortcutImportRunning = false,
    dataLoadSequence = 0,
    transactionSaving = false;
  let goal = 40;
  try {
    goal = Math.max(0, Number(localStorage.getItem('tasca_monthly_goal') ?? 40));
  } catch {}
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
  function monthBudgetSpend(b) {
    return transactions
      .filter(
        (t) =>
          t.space_id === b.space_id &&
          t.type === 'expense' &&
          txDate(t).slice(0, 7) === budgetMonth(b) &&
          t.category === b.category
      )
      .reduce((s, t) => s + Number(t.amount || 0), 0);
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
      scopedTransactions().some((t) => t.status === 'verify')
        ? 'Ci sono movimenti da verificare: controlla importi e categorie.'
        : 'Controlla periodicamente il registro rispetto all’estratto conto.',
      'warn',
    ]);
    $('adviceList').innerHTML = cards
      .map(
        ([title, body, kind]) =>
          `<div class="panel"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p></div>`
      )
      .join('');
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
    $('authConfirmWrap').classList.toggle('hidden', !signup);
    $('authConfirm').required = signup;
    $('authSubmit').textContent = signup ? 'Registrati' : reset ? 'Invia istruzioni' : 'Accedi';
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
    try {
      $('authSubmit').disabled = true;
      if (mode === 'signup') {
        if (password !== $('authConfirm').value) throw new Error('Le password non coincidono.');
        const { error } = await db.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        showAuthMessage(
          'Registrazione inviata. Se la conferma email è attiva, controlla la posta prima di accedere.'
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
  function showApp() {
    $('authScreen').classList.add('hidden');
    $('appScreen').classList.remove('hidden');
    $('mobileNav').classList.remove('hidden');
  }
  function showLogin() {
    dataLoadSequence += 1;
    user = null;
    transactions = [];
    budgets = [];
    recurring = [];
    spaces = [];
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
          db.from('transactions').select('*').order('occurred_on', { ascending: false })
        ),
        fetchAllRows(() =>
          db.from('budgets').select('*').order('month_start', { ascending: false })
        ),
        fetchAllRows(() =>
          db.from('recurring_plans').select('*').order('next_due_on', { ascending: true })
        ),
        fetchAllRows(() => db.from('spaces').select('*').order('created_at', { ascending: false })),
      ]);
      if (requestId !== dataLoadSequence || user?.id !== requestUserId) return;
      transactions = tx;
      budgets = bg;
      recurring = rc;
      spaces = sp;
      if (activeSpaceId !== ALL_SPACES && !spaces.some((space) => space.id === activeSpaceId)) {
        activeSpaceId =
          (spaces.find((space) => space.space_type === 'personal') || spaces[0] || {}).id || null;
      }
      renderAll();
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
        ),
        fetchAllRows(() =>
          db
            .from('settlements')
            .select('*')
            .eq('space_id', id)
            .order('paid_on', { ascending: false })
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
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Apri menu');
      menuBtn.textContent = '☰';
    }
    function toggleSideNav() {
      const opening = !nav.classList.contains('open');
      nav.classList.toggle('open', opening);
      backdrop.classList.toggle('open', opening);
      menuBtn.setAttribute('aria-expanded', String(opening));
      menuBtn.setAttribute('aria-label', opening ? 'Chiudi menu' : 'Apri menu');
      menuBtn.textContent = opening ? '✕' : '☰';
    }
    menuBtn.addEventListener('click', toggleSideNav);
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
        'Comando Rapido per iPhone',
        `<div class="account-settings"><p>Il link d’installazione verrà aggiunto qui dopo la verifica completa del flusso su iPhone.</p><p class="muted tiny">La versione finale dovrà essere testata almeno su apertura del link, passaggio dei dati, scelta dello spazio, gestione dei duplicati e conferma del salvataggio. Fino ad allora il download resta disattivato.</p><button class="btn primary full" id="shortcutCloseInfo" type="button">Ho capito</button></div>`
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
    $('budgetMonth').addEventListener('change', renderBudgets);
    $('refreshBtn').addEventListener('click', loadData);
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
    ['finanze', 'amount', 'description', 'merchant', 'date', 'category', 'method', 'type'].forEach(
      (k) => url.searchParams.delete(k)
    );
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
    let targetSpace = spaces.length === 1 ? spaces[0] : null;
    if (!targetSpace) {
      const spaceChoices = spaces
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
      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= spaces.length) {
        notify('Numero dello spazio non valido. Riapri il collegamento e riprova.', 'error');
        return;
      }
      targetSpace = spaces[selectedIndex];
    }
    const normalized = (s) =>
      String(s || '')
        .trim()
        .toLocaleLowerCase('it-IT')
        .replace(/\s+/g, ' ');
    const duplicate = transactions.some(
      (t) =>
        t.space_id === targetSpace.id &&
        txDate(t) === date &&
        Math.round(Number(t.amount) * 100) === Math.round(amount * 100) &&
        normalized(t.description) === normalized(description)
    );
    if (duplicate) {
      notify(
        'Possibile duplicato: questo importo e questo esercente risultano già registrati nella stessa data.',
        'error'
      );
      clearShortcutParams();
      return;
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
      const { error } = await db.from('transactions').insert(payload);
      if (error) throw error;
      clearShortcutParams();
      notify('Pagamento importato da Comando Rapido.');
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
    $('budgetMonth').value = monthNow();
    $('filterMonth').value = monthNow();
    initNavigation();
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
