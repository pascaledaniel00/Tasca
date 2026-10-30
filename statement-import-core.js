const DATE_KEYS = ['data', 'date', 'data operazione', 'data valuta', 'transaction date', 'booking date'];
const DESCRIPTION_KEYS = ['descrizione', 'description', 'causale', 'operazione', 'merchant', 'beneficiario', 'dettagli'];
const AMOUNT_KEYS = ['importo', 'amount', 'valore', 'totale'];
const DEBIT_KEYS = ['addebito', 'importo addebito', 'importi dare', 'uscite', 'debit', 'withdrawal', 'dare'];
const CREDIT_KEYS = ['accredito', 'importo accredito', 'importi avere', 'entrate', 'credit', 'deposit', 'avere'];
const TYPE_KEYS = ['tipo', 'type', 'transaction type'];
const normalizeKey = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const findValue = (row, keys) => {
  const entries = Object.entries(row || {});
  for (const key of keys) {
    const target = normalizeKey(key);
    const entry = entries.find(([name]) => normalizeKey(name) === target);
    if (entry && entry[1] !== '' && entry[1] != null) return entry[1];
  }
  return null;
};
export function parseStatementAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (value == null || value === '') return null;
  let text = String(value).trim().replace(/[€\s]/g, '').replace(/[−–]/g, '-');
  const negativeByParens = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '');
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  text = text.replace(/[^0-9.+-]/g, '');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((negativeByParens ? -Math.abs(parsed) : parsed) * 100) / 100;
}
export function parseStatementDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
  match = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? '20' + match[3] : match[3];
    const date = year + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  }
  return null;
}
const classify = (row, signedAmount, description) => {
  const explicit = normalizeKey(findValue(row, TYPE_KEYS));
  const text = normalizeKey(description);
  if (/trasferimento|giroconto|transfer between|own account/.test(text)) return 'transfer';
  if (/rimborso|storno|reversal|refund/.test(text)) return signedAmount < 0 ? 'expense' : 'refund';
  if (/^(income|entrata|accredito|credit|salary|stipendio)$/.test(explicit)) return 'income';
  if (/^(expense|uscita|addebito|debit|payment|pagamento)$/.test(explicit)) return 'expense';
  if (/^(transfer|trasferimento|giroconto)$/.test(explicit)) return 'transfer';
  if (/^(refund|rimborso|storno)$/.test(explicit)) return 'refund';
  return signedAmount < 0 ? 'expense' : 'income';
};
export function normalizeStatementRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const occurredOn = parseStatementDate(findValue(row, DATE_KEYS));
    const postedOn = parseStatementDate(findValue(row, ['data contabilizzazione', 'data registrazione', 'posting date', 'book date']));
    const description = String(findValue(row, DESCRIPTION_KEYS) ?? '').trim();
    const debit = parseStatementAmount(findValue(row, DEBIT_KEYS));
    const credit = parseStatementAmount(findValue(row, CREDIT_KEYS));
    const rawAmount = debit != null || credit != null
      ? (credit != null && credit !== 0 ? Math.abs(credit) : -Math.abs(debit || 0))
      : parseStatementAmount(findValue(row, AMOUNT_KEYS));
    const amount = rawAmount == null ? null : Math.abs(rawAmount);
    const type = rawAmount == null ? 'review' : classify(row, rawAmount, description);
    const valid = Boolean(occurredOn && description && amount != null && amount > 0);
    return {
      sourceRow: index + 2,
      occurred_on: occurredOn,
      posted_on: postedOn,
      description,
      amount,
      type: valid ? type : 'review',
      category: type === 'transfer' ? 'Trasferimento tra conti' : type === 'refund' ? 'Rimborso ricevuto' : 'Da verificare',
      status: valid ? 'needs_review' : 'invalid',
      notes: valid ? null : 'Data, descrizione o importo mancante/illeggibile',
      raw: row,
    };
  });
}
const normalizeDescription = (value) => normalizeKey(value).replace(/\b(card|carta|pos|pagamento|acquisto)\b/g, '').trim();
export function findStatementDuplicates(importRows, existingRows, options = {}) {
  const toleranceDays = Number.isInteger(options.toleranceDays) ? options.toleranceDays : 2;
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const seenInFile = [];
  return (Array.isArray(importRows) ? importRows : []).map((row) => {
    const description = normalizeDescription(row.description);
    const matchesExisting = existing.filter((tx) => {
      if (String(tx.type) !== String(row.type)) return false;
      if (Math.abs(Number(tx.amount) - Number(row.amount)) > 0.005) return false;
      const txDate = String(tx.occurred_on || '').slice(0, 10);
      const rowDate = String(row.occurred_on || '').slice(0, 10);
      if (!txDate || !rowDate) return false;
      const delta = Math.abs(Date.parse(txDate + 'T00:00:00Z') - Date.parse(rowDate + 'T00:00:00Z')) / 86400000;
      if (delta > toleranceDays) return false;
      const txDescription = normalizeDescription(tx.description);
      return description && txDescription && (description === txDescription || description.includes(txDescription) || txDescription.includes(description));
    });
    const matchesFile = seenInFile.find((prior) => {
      if (String(prior.type) !== String(row.type)) return false;
      if (Math.abs(Number(prior.amount) - Number(row.amount)) > 0.005) return false;
      const priorDate = String(prior.occurred_on || '').slice(0, 10);
      const rowDate = String(row.occurred_on || '').slice(0, 10);
      if (!priorDate || !rowDate) return false;
      const delta = Math.abs(Date.parse(priorDate + 'T00:00:00Z') - Date.parse(rowDate + 'T00:00:00Z')) / 86400000;
      if (delta > toleranceDays) return false;
      const priorDescription = normalizeDescription(prior.description);
      return description && priorDescription && (description === priorDescription || description.includes(priorDescription) || priorDescription.includes(description));
    });
    seenInFile.push(row);
    return {
      ...row,
      duplicate: matchesExisting.length > 0 || Boolean(matchesFile),
      duplicateOf: matchesExisting[0]?.id || matchesFile?.sourceRow || null,
      duplicateSource: matchesExisting.length ? 'existing' : matchesFile ? 'file' : null,
    };
  });
}
export function statementImportSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    ready: list.filter((row) => row.status === 'needs_review' && !row.duplicate).length,
    duplicates: list.filter((row) => row.duplicate).length,
    invalid: list.filter((row) => row.status === 'invalid').length,
    review: list.filter((row) => row.type === 'review').length,
    expenses: list.filter((row) => row.type === 'expense').reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    income: list.filter((row) => row.type === 'income').reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  };
}
