const amountOf = (row) => {
  const amount = Number(row?.amount);
  return Number.isFinite(amount) ? amount : 0;
};

export function summarizeTransactions(rows = []) {
  const summary = rows.reduce(
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
    if (row?.type !== 'expense' || transactionMonth(row) !== monthKey(month)) continue;
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
