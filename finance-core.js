export function calculateDebtSummary(debts = [], payments = []) {
  return debts.map((debt) => {
    const linked = payments.filter((payment) => payment.debt_id === debt.id);
    const paid = linked.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const principalPaid = linked.reduce((sum, payment) => sum + Number(payment.principal_component || 0), 0);
    return {
      ...debt,
      paymentsCount: linked.length,
      paidTotal: Math.round(paid * 100) / 100,
      principalPaid: Math.round(principalPaid * 100) / 100,
      // Il residuo viene mostrato solo se inserito esplicitamente: non lo deduciamo dalle rate.
      principalRemaining: debt.principal_remaining == null ? null : Number(debt.principal_remaining),
    };
  });
}

export function calculateSavingsSummary(goals = [], movements = []) {
  return goals.map((goal) => {
    const linked = movements.filter((movement) => movement.goal_id === goal.id);
    const contributions = linked
      .filter((movement) => movement.movement_type === 'contribution')
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const withdrawals = linked
      .filter((movement) => movement.movement_type === 'withdrawal')
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const balance = Math.round((Number(goal.starting_balance || 0) + contributions - withdrawals) * 100) / 100;
    const target = Number(goal.target_amount || 0);
    return {
      ...goal,
      contributions: Math.round(contributions * 100) / 100,
      withdrawals: Math.round(withdrawals * 100) / 100,
      balance,
      remaining: Math.max(0, Math.round((target - balance) * 100) / 100),
      percent: target > 0 ? Math.min(100, Math.max(0, (balance / target) * 100)) : 0,
    };
  });
}

export function validateDebtInput(payload = {}) {
  if (!payload.space_id) return 'Seleziona uno spazio.';
  if (!String(payload.name || '').trim()) return 'Inserisci il nome del debito.';
  for (const field of ['original_principal','principal_remaining','installment_amount','interest_rate']) {
    if (payload[field] != null && payload[field] !== '' && (!Number.isFinite(Number(payload[field])) || Number(payload[field]) < 0))
      return 'Gli importi e il tasso devono essere numeri pari o superiori a zero.';
  }
  for (const field of ['installments_total','installments_remaining']) {
    if (payload[field] != null && payload[field] !== '' && (!Number.isInteger(Number(payload[field])) || Number(payload[field]) < 0))
      return 'Il numero di rate deve essere un intero pari o superiore a zero.';
  }
  if (!['active','paid','paused'].includes(payload.status || 'active')) return 'Stato del debito non valido.';
  return null;
}

export function validateSavingsGoalInput(payload = {}) {
  if (!payload.space_id) return 'Seleziona uno spazio.';
  if (!String(payload.name || '').trim()) return 'Inserisci il nome dell’obiettivo.';
  if (!Number.isFinite(Number(payload.target_amount)) || Number(payload.target_amount) <= 0)
    return 'L’importo obiettivo deve essere maggiore di zero.';
  if (!Number.isFinite(Number(payload.starting_balance || 0)) || Number(payload.starting_balance || 0) < 0)
    return 'Il saldo iniziale non può essere negativo.';
  return null;
}

export function validateFundMovement(payload = {}) {
  if (!payload.space_id || !payload.goal_id) return 'Obiettivo o spazio mancante.';
  if (!['contribution','withdrawal'].includes(payload.movement_type)) return 'Tipo di movimento non valido.';
  if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) return 'Inserisci un importo maggiore di zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.occurred_on || ''))) return 'Inserisci una data valida.';
  return null;
}

export const isConfirmedTransaction = (row) => !row?.status || row.status === 'confirmed';

const amountOf = (row) => {
  const amount = Number(row?.amount);
  return Number.isFinite(amount) ? amount : 0;
};

export function summarizeTransactions(rows = []) {
  const summary = rows.filter(isConfirmedTransaction).reduce(
    (totals, row) => {
      const amount = amountOf(row);
      if (row?.type === 'income' || row?.type === 'refund') totals.income += amount;
      else if (row?.type === 'expense') totals.expense += amount;
      else if (row?.type === 'transfer') totals.transfer += amount;
      return totals;
    },
    { income: 0, expense: 0, transfer: 0 }
  );
  return { ...summary, residual: summary.income - summary.expense };
}

const transactionMonth = (row) => String(row?.occurred_on || row?.date || '').slice(0, 7);
const monthKey = (value) => String(value || '').slice(0, 7);

export function monthlyTrend(rows = [], endMonth, count = 6) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('count deve essere positivo.');
  }
  const end = monthKey(endMonth);
  const match = /^(\d{4})-(\d{2})$/.exec(end);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new TypeError('endMonth deve avere formato YYYY-MM.');
  }
  const endDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const months = Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - count + 1 + index, 1)
    );
    return {
      month: date.toISOString().slice(0, 7),
      income: 0,
      expense: 0,
    };
  });
  const byMonth = new Map(months.map((month) => [month.month, month]));
  for (const row of rows) {
    if (!isConfirmedTransaction(row)) continue;
    const month = byMonth.get(transactionMonth(row));
    if (!month) continue;
    const amount = amountOf(row);
    if (row?.type === 'income' || row?.type === 'refund') month.income += amount;
    else if (row?.type === 'expense') month.expense += amount;
  }
  return months;
}

export function categoryBreakdown(rows = [], month, limit = 5) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit deve essere positivo.');
  }
  const totals = new Map();
  for (const row of rows) {
    if (!isConfirmedTransaction(row) || row?.type !== 'expense' || transactionMonth(row) !== monthKey(month)) continue;
    const category = String(row.category || 'Da verificare');
    totals.set(category, (totals.get(category) || 0) + amountOf(row));
  }
  const sorted = [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'it'));
  if (sorted.length <= limit) return sorted;
  const visible = sorted.slice(0, limit);
  const otherAmount = sorted.slice(limit).reduce((sum, item) => sum + item.amount, 0);
  if (otherAmount > 0) visible.push({ category: 'Altre categorie', amount: otherAmount });
  return visible;
}

export function budgetComparison(budgets = [], rows = [], month, limit = 4) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit deve essere positivo.');
  }
  return budgets
    .filter((budget) => monthKey(budget.month_start || budget.month) === monthKey(month))
    .map((budget) => {
      const cap = Number(budget.amount);
      const amount = Number.isFinite(cap) && cap > 0 ? cap : 0;
      const spent = rows.reduce((sum, row) => {
        if (
          isConfirmedTransaction(row) &&
          row?.type === 'expense' &&
          row.space_id === budget.space_id &&
          row.category === budget.category &&
          transactionMonth(row) === monthKey(month)
        ) {
          return sum + amountOf(row);
        }
        return sum;
      }, 0);
      return {
        category: String(budget.category || 'Da verificare'),
        amount,
        spent,
        remaining: amount - spent,
        percent: amount > 0 ? (spent / amount) * 100 : 0,
      };
    })
    .sort((a, b) => b.percent - a.percent || b.spent - a.spent)
    .slice(0, limit);
}

export function validateTransactionInput(payload = {}) {
  if (!payload.space_id) return 'Crea prima uno spazio personale nella sezione Spazi.';
  if (!['expense', 'income', 'transfer', 'refund'].includes(payload.type)) {
    return 'Seleziona un tipo di movimento valido.';
  }
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Inserisci un importo maggiore di zero.';
  if (!String(payload.description || '').trim())
    return 'Inserisci una descrizione per il movimento.';
  if (!String(payload.category || '').trim()) return 'Seleziona una categoria.';
  const date = String(payload.occurred_on || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Inserisci una data valida.';
  const parsedDate = new Date(date + 'T00:00:00.000Z');
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return 'Inserisci una data valida.';
  }
  return null;
}

export function calculateParticipantBalances(
  memberIds = [],
  expenses = [],
  shares = [],
  settlements = []
) {
  const balances = new Map(memberIds.map((userId) => [userId, 0]));
  for (const expense of expenses) {
    if (expense?.type !== 'expense' || expense?.status !== 'confirmed') continue;
    const amount = amountOf(expense);
    if (balances.has(expense.paid_by))
      balances.set(expense.paid_by, balances.get(expense.paid_by) + amount);
  }
  const eligibleExpenseIds = new Set(
    expenses
      .filter((expense) => expense?.type === 'expense' && expense?.status === 'confirmed')
      .map((expense) => expense.id)
  );
  for (const share of shares) {
    if (!eligibleExpenseIds.has(share.transaction_id) || !balances.has(share.user_id)) continue;
    balances.set(
      share.user_id,
      balances.get(share.user_id) - amountOf({ amount: share.share_amount })
    );
  }
  for (const settlement of settlements) {
    const amount = amountOf(settlement);
    if (balances.has(settlement.from_user_id)) {
      balances.set(settlement.from_user_id, balances.get(settlement.from_user_id) - amount);
    }
    if (balances.has(settlement.to_user_id)) {
      balances.set(settlement.to_user_id, balances.get(settlement.to_user_id) + amount);
    }
  }
  return memberIds.map((user_id) => ({
    user_id,
    balance: Math.round((balances.get(user_id) || 0) * 100) / 100,
  }));
}

export function settlementPlan(balances = []) {
  const debtors = balances
    .filter((item) => Number(item.balance) < -0.005)
    .map((item) => ({ user_id: item.user_id, amount: -Number(item.balance) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((item) => Number(item.balance) > 0.005)
    .map((item) => ({ user_id: item.user_id, amount: Number(item.balance) }))
    .sort((a, b) => b.amount - a.amount);
  const plan = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.round(Math.min(debtors[i].amount, creditors[j].amount) * 100) / 100;
    if (amount > 0) {
      plan.push({
        from_user_id: debtors[i].user_id,
        to_user_id: creditors[j].user_id,
        amount,
      });
    }
    debtors[i].amount = Math.round((debtors[i].amount - amount) * 100) / 100;
    creditors[j].amount = Math.round((creditors[j].amount - amount) * 100) / 100;
    if (debtors[i].amount < 0.005) i++;
    if (creditors[j].amount < 0.005) j++;
  }
  return plan;
}

export function serializeFinanceCsv(groups = []) {
  const validGroups = groups.filter((group) => group && Array.isArray(group.rows));
  const fields = [
    ...new Set([
      'tipo_record',
      ...validGroups.flatMap((group) => group.rows.flatMap((row) => Object.keys(row || {}))),
    ]),
  ];
  const cell = (value) => {
    const text =
      value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [fields.map(cell).join(';')];
  for (const group of validGroups) {
    for (const row of group.rows) {
      lines.push(
        fields.map((field) => cell(field === 'tipo_record' ? group.name : row?.[field])).join(';')
      );
    }
  }
  return '\uFEFF' + lines.join('\r\n');
}

export function validateRecurringPlanInput(payload = {}) {
  if (!payload.space_id) return 'Crea prima uno spazio personale nella sezione Spazi.';
  if (!String(payload.name || '').trim()) return 'Inserisci un nome per la ricorrenza.';
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Inserisci un importo maggiore di zero.';
  if (!['monthly', 'weekly', 'yearly', 'once'].includes(payload.cadence)) {
    return 'Seleziona una frequenza valida.';
  }
  const date = String(payload.next_due_on || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Inserisci una data di scadenza valida.';
  const parsedDate = new Date(date + 'T00:00:00.000Z');
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return 'Inserisci una data di scadenza valida.';
  }
  if (
    payload.remaining_installments != null &&
    payload.remaining_installments !== '' &&
    (!Number.isInteger(Number(payload.remaining_installments)) ||
      Number(payload.remaining_installments) < 0)
  ) {
    return 'Le rate residue devono essere un numero intero pari o superiore a zero.';
  }
  return null;
}
