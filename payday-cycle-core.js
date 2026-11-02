const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

function parseDate(value) {
  const text = String(value || '');
  if (!DATE_RE.test(text)) return null;
  const date = new Date(text + 'T00:00:00.000Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = parseDate(value);
  if (!date) throw new TypeError('La data deve avere formato YYYY-MM-DD.');
  return iso(new Date(date.getTime() + days * DAY_MS));
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Builds variable-length financial cycles from actual salary credits.
 * A cycle starts on the effective payday and ends the day before the next
 * effective payday. Planned paydays are never treated as received income.
 */
export function buildPaydayCycles(transactions = [], options = {}) {
  const paydays = [...new Set(
    (Array.isArray(transactions) ? transactions : [])
      .filter((row) => row?.type === 'income' && (row.status == null || row.status === 'confirmed'))
      .filter((row) => options.incomeMatcher ? options.incomeMatcher(row) : /stipendio|salary|payroll/i.test([row.description, row.category].filter(Boolean).join(' ')))
      .map((row) => String(row.occurred_on || row.date || ''))
      .filter((date) => parseDate(date))
  )].sort();

  const cycles = paydays.map((start, index) => {
    const nextStart = paydays[index + 1] || null;
    const end = nextStart ? addDays(nextStart, -1) : options.asOf && parseDate(options.asOf) ? String(options.asOf) : null;
    return {
      start,
      end,
      nextPayday: nextStart,
      isOpen: !nextStart,
      days: end ? Math.round((parseDate(end) - parseDate(start)) / DAY_MS) + 1 : null,
    };
  });

  // A date entered in settings is only a forecast: it must never close a cycle.
  // The next cycle starts exclusively when the next confirmed salary is registered.
  const latest = cycles[cycles.length - 1];
  if (latest && !latest.nextPayday && options.nextPayday && parseDate(options.nextPayday) &&
      options.nextPayday > latest.start) {
    latest.expectedNextPayday = options.nextPayday;
  }
  return cycles;
}

/** Returns the cycle containing a date, or null when no received payday anchors it. */
export function findPaydayCycle(date, cycles = []) {
  if (!parseDate(date)) return null;
  return cycles.find((cycle) => cycle.start <= date && (!cycle.end || date <= cycle.end)) || null;
}

/**
 * Summarizes a single cycle from the canonical transaction register.
 * Only confirmed entries count; transfers are excluded from income/expenses.
 */
export function summarizePaydayCycle(cycle, transactions = [], options = {}) {
  if (!cycle?.start || !parseDate(cycle.start)) throw new TypeError('Ciclo finanziario non valido.');
  const end = cycle.end && parseDate(cycle.end) ? cycle.end : options.asOf;
  const rows = (Array.isArray(transactions) ? transactions : []).filter((row) => {
    const date = String(row?.occurred_on || row?.date || '');
    return parseDate(date) && date >= cycle.start && (!end || date <= end) &&
      (row.status == null || row.status === 'confirmed');
  });
  const income = rows.filter((row) => row.type === 'income' || row.type === 'refund')
    .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
  const expenses = rows.filter((row) => row.type === 'expense')
    .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
  const transfers = rows.filter((row) => row.type === 'transfer')
    .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
  const openingBalance = Number(options.openingBalance || 0);
  return {
    ...cycle,
    end: end || null,
    openingBalance: roundMoney(openingBalance),
    income: roundMoney(income),
    expenses: roundMoney(expenses),
    transfers: roundMoney(transfers),
    residual: roundMoney(income - expenses),
    projectedClosingBalance: roundMoney(openingBalance + income - expenses),
    transactionCount: rows.length,
  };
}

/** Calendar-month and payday-cycle views reference the same rows, never copies. */
export function groupTransactionsByPeriod(transactions = [], cycles = []) {
  return (Array.isArray(transactions) ? transactions : []).map((row) => {
    const date = String(row?.occurred_on || row?.date || '');
    const cycle = findPaydayCycle(date, cycles);
    return {
      transaction: row,
      calendarMonth: parseDate(date) ? date.slice(0, 7) : null,
      paydayCycleStart: cycle?.start || null,
    };
  });
}

/** Applies monthly category limits to the full salary cycle containing the budget month. */
export function paydayCycleBudgetComparison(budgets = [], transactions = [], cycle) {
  if (!cycle?.start || !parseDate(cycle.start)) return [];
  const rows = Array.isArray(transactions) ? transactions : [];
  return (Array.isArray(budgets) ? budgets : [])
    .filter((budget) => String(budget.month_start || budget.month || '').slice(0, 7) === cycle.start.slice(0, 7))
    .map((budget) => {
      const amount = Number(budget.amount);
      const limit = Number.isFinite(amount) && amount > 0 ? roundMoney(amount) : 0;
      const spentCents = rows.reduce((sum, row) => {
        const date = String(row?.occurred_on || row?.date || '');
        if (row?.space_id !== budget.space_id || row?.type !== 'expense' ||
            (row.status != null && row.status !== 'confirmed') ||
            row?.category !== budget.category || !parseDate(date) ||
            date < cycle.start || (cycle.end && date > cycle.end)) return sum;
        return sum + Math.round(Math.abs(Number(row.amount) || 0) * 100);
      }, 0);
      const spent = spentCents / 100;
      return { id: budget.id, space_id: budget.space_id, category: String(budget.category || 'Da verificare'),
        amount: limit, spent, remaining: roundMoney(limit - spent),
        percent: limit > 0 ? roundMoney((spent / limit) * 100) : 0 };
    }).sort((a, b) => b.percent - a.percent || b.spent - a.spent);
}
