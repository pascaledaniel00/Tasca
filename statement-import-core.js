const DATE_KEYS = ['data operazione', 'data movimento', 'data transazione', 'transaction date', 'operation date', 'date', 'data', 'data contabile', 'booking date', 'book date'];
const DESCRIPTION_KEYS = ['descrizione', 'description', 'causale', 'causale abi', 'descrizione operazione', 'descrizione movimento', 'dettaglio', 'dettagli', 'operazione', 'merchant', 'beneficiario', 'esercente', 'payee', 'name', 'nome', 'transaction details', 'narrative', 'memo', 'note'];
const AMOUNT_KEYS = ['importo', 'amount', 'valore', 'totale', 'transaction amount', 'sum', 'betrag', 'importe'];
const DEBIT_KEYS = ['addebito', 'importo addebito', 'importi dare', 'uscite', 'debit', 'withdrawal', 'dare', 'debit amount', 'money out', 'paid out', 'outgoing', 'spese', 'importo dare', 'uscita'];
const CREDIT_KEYS = ['accredito', 'importo accredito', 'importi avere', 'entrate', 'credit', 'deposit', 'avere', 'credit amount', 'money in', 'paid in', 'incoming', 'importo avere', 'entrata'];
const TYPE_KEYS = ['tipo', 'type', 'transaction type'];
const FIELD_ALIASES = {
  date: ['data operazione', 'data movimento', 'data transazione', 'transaction date', 'operation date', 'date', 'data', 'data contabile', 'booking date', 'book date'],
  posted: ['data contabilizzazione', 'data registrazione', 'data contabile', 'booking date', 'posting date', 'book date', 'data valuta'],
  description: ['descrizione', 'description', 'causale', 'causale abi', 'descrizione operazione', 'descrizione movimento', 'dettaglio', 'dettagli', 'operazione', 'merchant', 'beneficiario', 'esercente', 'payee', 'name', 'nome', 'transaction details', 'narrative', 'memo', 'note'],
  amount: ['importo', 'amount', 'valore', 'totale', 'transaction amount', 'sum', 'betrag', 'importe'],
  debit: ['addebito', 'importo addebito', 'importi dare', 'dare', 'uscite', 'debit', 'withdrawal', 'debit amount', 'money out', 'paid out', 'outgoing', 'spese', 'importo dare', 'uscita'],
  credit: ['accredito', 'importo accredito', 'importi avere', 'avere', 'entrate', 'credit', 'deposit', 'credit amount', 'money in', 'paid in', 'incoming', 'importo avere', 'entrata'],
  type: ['tipo', 'type', 'transaction type', 'tipologia', 'causale'],
};
const FIELD_PATTERNS = {
  date: /^(data|date|booking|transaction|operation|value date|valuta|contabile)/,
  description: /(descr|description|causal|causale|merchant|beneficiar|payee|narrative|memo|dettagl|esercente|name|note)/,
  amount: /^(importo|amount|valore|total|totale|sum|betrag|importe)/,
  debit: /(dare|debit|addeb|uscit|withdraw|money out|paid out|outgoing)/,
  credit: /(avere|credit|accred|entr|deposit|money in|paid in|incoming)/,
};
export function detectStatementColumns(headers = []) {
  const normalized = headers.map((header) => normalizeKey(header));
  const find = (field) => {
    const aliases = FIELD_ALIASES[field] || [];
    let index = normalized.findIndex((header) => aliases.some((alias) => header === normalizeKey(alias)));
    if (index < 0 && FIELD_PATTERNS[field]) index = normalized.findIndex((header) => FIELD_PATTERNS[field].test(header));
    return index < 0 ? null : String(headers[index]);
  };
  const mapping = { date: find('date'), posted: find('posted'), description: find('description'),
    amount: find('amount'), debit: find('debit'), credit: find('credit'), type: find('type') };
  const hasAmount = Boolean(mapping.amount || mapping.debit || mapping.credit);
  const score = Number(Boolean(mapping.date)) + Number(Boolean(mapping.description)) + Number(hasAmount);
  return { mapping, score, ready: score === 3, missing: [!mapping.date && 'data', !mapping.description && 'descrizione', !hasAmount && 'importo'].filter(Boolean) };
}
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
  if (match) {
    const date = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
    const parsed = new Date(date + 'T00:00:00.000Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
  }
  match = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? '20' + match[3] : match[3];
    const date = year + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
    const parsed = new Date(date + 'T00:00:00.000Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
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
export function normalizeStatementRows(rows, columnMapping = null) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const get = (field, keys) => columnMapping?.[field] ? row?.[columnMapping[field]] : findValue(row, keys);\n    const occurredOn = parseStatementDate(get('date', DATE_KEYS));
    const postedOn = parseStatementDate(get('posted', ['data contabilizzazione', 'data registrazione', 'posting date', 'book date']));
    const description = String(get('description', DESCRIPTION_KEYS) ?? '').trim();
    const debit = parseStatementAmount(get('debit', DEBIT_KEYS));
    const credit = parseStatementAmount(get('credit', CREDIT_KEYS));
    const rawAmount = debit != null || credit != null
      ? (credit != null && credit !== 0 ? Math.abs(credit) : -Math.abs(debit || 0))
      : parseStatementAmount(get('amount', AMOUNT_KEYS));
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
const normalizeDescription = (value) => normalizeKey(value)
  .replace(/\\b(card|carta|pos|pagamento|acquisto|apple pay|applepay|contactless|visa|mastercard|debit|credit)\\b/g, ' ')
  .replace(/\\b\\d{4,}\\b/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();
const merchantTokens = (value) => normalizeDescription(value)
  .split(' ')
  .filter((token) => token.length >= 3 && !['the', 'del', 'della', 'delle', 'dei', 'per', 'store', 'shop'].includes(token));
const dayDistance = (a, b) => {
  const left = String(a || '').slice(0, 10);
  const right = String(b || '').slice(0, 10);
  if (!left || !right) return Infinity;
  const leftTime = Date.parse(left + 'T00:00:00Z');
  const rightTime = Date.parse(right + 'T00:00:00Z');
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Infinity;
  return Math.abs(leftTime - rightTime) / 86400000;
};
export function compareTransactionForDuplicate(candidate, existing, options = {}) {
  const toleranceDays = Number.isInteger(options.toleranceDays) ? options.toleranceDays : 2;
  if (!candidate || !existing || String(candidate.type) !== String(existing.type)) return 'none';
  if (Math.abs(Number(candidate.amount) - Number(existing.amount)) > 0.005) return 'none';
  if (dayDistance(candidate.occurred_on, existing.occurred_on) > toleranceDays) return 'none';
  const a = merchantTokens(candidate.description);
  const b = merchantTokens(existing.description);
  if (!a.length || !b.length) return 'possible';
  const overlap = a.filter((token) => b.includes(token)).length;
  const ratio = overlap / Math.min(a.length, b.length);
  return overlap > 0 && ratio >= 0.5 ? 'strong' : 'possible';
}
export function findStatementDuplicates(importRows, existingRows, options = {}) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const seenInFile = [];
  return (Array.isArray(importRows) ? importRows : []).map((row) => {
    const existingMatches = existing
      .map((tx) => ({ tx, confidence: compareTransactionForDuplicate(row, tx, options) }))
      .filter((match) => match.confidence !== 'none')
      .sort((a, b) => (a.confidence === 'strong' ? 0 : 1) - (b.confidence === 'strong' ? 0 : 1));
    const fileMatch = seenInFile
      .map((prior) => ({ prior, confidence: compareTransactionForDuplicate(row, prior, options) }))
      .find((match) => match.confidence !== 'none');
    const match = existingMatches[0] || fileMatch;
    seenInFile.push(row);
    return {
      ...row,
      duplicate: match?.confidence === 'strong',
      possibleDuplicate: match?.confidence === 'possible',
      duplicateConfidence: match?.confidence || null,
      duplicateOf: match?.tx?.id || match?.prior?.sourceRow || null,
      duplicateSource: existingMatches.length ? 'existing' : fileMatch ? 'file' : null,
    };
  });
}
export function statementImportSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    ready: list.filter((row) => row.status === 'needs_review' && !row.duplicate).length,
    duplicates: list.filter((row) => row.duplicate).length,
    possibleDuplicates: list.filter((row) => row.possibleDuplicate).length,
    invalid: list.filter((row) => row.status === 'invalid').length,
    review: list.filter((row) => row.type === 'review').length,
    expenses: list.filter((row) => row.type === 'expense').reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    income: list.filter((row) => row.type === 'income').reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  };
}

const xmlValue = (block, tag) => {
  const match = block.match(new RegExp('<(?:[\\w.-]+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?' + tag + '>', 'i'));
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : '';
};
const decodeOfxDate = (value) => {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : null;
};
/** Parses common bank interchange formats (OFX/QFX, QIF, MT940 and CAMT.053 XML). */
export function parseStatementText(text, filename = '') {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  const ext = String(filename).split('.').pop().toLowerCase();
  const rows = [];
  if (/^OFXHEADER:|<OFX[\s>]/i.test(source) || ['ofx', 'qfx'].includes(ext)) {
    const blocks = source.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
    for (const block of blocks) rows.push({
      'Data operazione': decodeOfxDate(block.match(/<DTPOSTED>([^<]+)/i)?.[1]),
      'Data valuta': decodeOfxDate(block.match(/<DTUSER>([^<]+)/i)?.[1]),
      Descrizione: block.match(/<NAME>([^<]+)/i)?.[1] || block.match(/<MEMO>([^<]+)/i)?.[1] || 'Movimento OFX',
      Importo: block.match(/<TRNAMT>([^<]+)/i)?.[1] || '',
      Tipo: block.match(/<TRNTYPE>([^<]+)/i)?.[1] || '',
      Riferimento: block.match(/<FITID>([^<]+)/i)?.[1] || '',
    });
    return { format: 'OFX/QFX', rows };
  }
  if (ext === 'qif' || /^!Type:/im.test(source)) {
    const records = source.split('^');
    for (const record of records) {
      if (!record.trim()) continue;
      const value = (code) => record.match(new RegExp('^' + code + '(.+)$', 'm'))?.[1]?.trim() || '';
      rows.push({ Data: value('D'), Descrizione: value('P') || value('M') || value('L'), Importo: value('T'), Tipo: 'QIF' });
    }
    return { format: 'QIF', rows };
  }
  if (ext === 'sta' || ext === 'mt940' || /:20:|:61:/m.test(source)) {
    const blocks = source.split(/(?=:61:)/);
    for (const block of blocks) {
      const line = block.match(/^:61:(.+)$/m)?.[1];
      if (!line) continue;
      const match = line.match(/^(\d{6})(?:\d{4})?([CD])(?:R?)([0-9,]+)(?:N[^A-Z])?(.*)$/);
      if (!match) continue;
      const description = (block.match(/^:86:([\s\S]*?)(?=^:\d{2}:|$)/m)?.[1] || match[4] || 'Movimento MT940').replace(/\r?\n/g, ' ').trim();
      const yy = Number(match[1].slice(0, 2));
      rows.push({ Data: String(2000 + yy) + '-' + match[1].slice(2, 4) + '-' + match[1].slice(4, 6),
        Descrizione: description, Importo: (match[2] === 'D' ? '-' : '') + match[3].replace(',', '.'), Tipo: 'MT940' });
    }
    return { format: 'MT940', rows };
  }
  if (ext === 'xml' || /<Document[\s>]/i.test(source)) {
    const entries = source.match(/<(?:[\w.-]+:)?Ntry(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?Ntry>/gi) || [];
    for (const block of entries) {
      const amount = xmlValue(block, 'Amt');
      const direction = xmlValue(block, 'CdtDbtInd');
      const date = xmlValue(block, 'BookgDt') || xmlValue(block, 'ValDt');
      const dateValue = date.match(/<Dt>([^<]+)/i)?.[1] || date;
      const name = xmlValue(block, 'Nm');
      const remittance = xmlValue(block, 'Ustrd') || xmlValue(block, 'AddtlNtryInf');
      rows.push({ 'Data contabile': dateValue, Descrizione: [name, remittance].filter(Boolean).join(' · ') || 'Movimento CAMT.053',
        Importo: (direction === 'DBIT' ? '-' : '') + amount, Tipo: direction });
    }
    return { format: 'CAMT.053 XML', rows };
  }
  return { format: 'testo non riconosciuto', rows: [] };
}
