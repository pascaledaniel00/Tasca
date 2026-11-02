import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatementAmount,
  parseStatementDate,
  normalizeStatementRows,
  findStatementDuplicates,
  compareTransactionForDuplicate,
  statementImportSummary,
} from '../statement-import-core.js';

test('parses Italian and international currency formats', () => {
  assert.equal(parseStatementAmount('1.234,56 €'), 1234.56);
  assert.equal(parseStatementAmount('-12,50'), -12.5);
  assert.equal(parseStatementAmount('(9.99)'), -9.99);
});

test('rejects impossible calendar dates instead of normalizing them', () => {
  assert.equal(parseStatementDate('30/02/2026'), null);
  assert.equal(parseStatementDate('2026-02-30'), null);
  assert.equal(parseStatementDate('31/10/2026'), '2026-10-31');
});

test('parses Italian dates and Excel serial dates', () => {
  assert.equal(parseStatementDate('30/10/2026'), '2026-10-30');
  assert.equal(parseStatementDate('2026-10-30'), '2026-10-30');
  assert.equal(parseStatementDate(46325), '2026-10-30');
});

test('retains incomplete rows and separates transfers', () => {
  const rows = normalizeStatementRows([
    { Data: '30/10/2026', Descrizione: 'Giroconto conto personale', Importo: '-100,00' },
    { Data: '', Descrizione: 'Riga incompleta', Importo: '-2,00' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'transfer');
  assert.equal(rows[1].status, 'invalid');
});

test('flags likely duplicates without deleting source rows', () => {
  const [row] = normalizeStatementRows([
    { Data: '30/10/2026', Descrizione: 'Supermercato', Importo: '-12,50' },
  ]);
  const result = findStatementDuplicates([row], [
    { id: 7, type: 'expense', amount: 12.5, occurred_on: '2026-10-29', description: 'Supermercato' },
  ]);
  assert.equal(result[0].duplicate, true);
  assert.equal(result[0].duplicateOf, 7);
  assert.equal(statementImportSummary(result).duplicates, 1);
});


test('flags duplicates repeated inside the same statement file', () => {
  const rows = normalizeStatementRows([
    { Data: '30/10/2026', Descrizione: 'Pagamento supermercato', Importo: '-12,50' },
    { Data: '30/10/2026', Descrizione: 'Pagamento supermercato', Importo: '-12,50' },
  ]);
  const result = findStatementDuplicates(rows, []);
  assert.equal(result[0].duplicate, false);
  assert.equal(result[1].duplicate, true);
  assert.equal(result[1].duplicateSource, 'file');
  assert.equal(result[1].duplicateOf, 2);
});

test('preserves the calendar date of Date objects in local time', () => {
  const value = new Date(2026, 9, 30, 0, 15);
  assert.equal(parseStatementDate(value), '2026-10-30');
});

test('matches Wallet merchant against bank Apple Pay descriptor', () => {
  const wallet = { type: 'expense', amount: 18.4, occurred_on: '2026-10-30', description: 'Esselunga' };
  const bank = { type: 'expense', amount: 18.4, occurred_on: '2026-11-01', description: 'APPLE PAY *ESSELUNGA MILANO' };
  assert.equal(compareTransactionForDuplicate(bank, wallet), 'strong');
  const [imported] = findStatementDuplicates([bank], [wallet]);
  assert.equal(imported.duplicate, true);
  assert.equal(imported.duplicateConfidence, 'strong');
});

test('flags same amount and nearby date with unrelated descriptor for manual review', () => {
  const wallet = { type: 'expense', amount: 18.4, occurred_on: '2026-10-30', description: 'Bar Centrale' };
  const bank = { type: 'expense', amount: 18.4, occurred_on: '2026-10-31', description: 'PAGAMENTO POS 004812' };
  assert.equal(compareTransactionForDuplicate(bank, wallet), 'possible');
  const [imported] = findStatementDuplicates([bank], [wallet]);
  assert.equal(imported.duplicate, false);
  assert.equal(imported.possibleDuplicate, true);
  assert.equal(statementImportSummary([imported]).possibleDuplicates, 1);
});


test('does not match transactions with invalid dates', () => {
  const invalid = { type: 'expense', amount: 10, occurred_on: 'not-a-date', description: 'Negozio' };
  const valid = { type: 'expense', amount: 10, occurred_on: '2026-10-30', description: 'Negozio' };
  assert.equal(compareTransactionForDuplicate(invalid, valid), 'none');
});

test('detects common Italian and international bank column names', async () => {
  const { detectStatementColumns } = await import('../statement-import-core.js');
  const detected = detectStatementColumns(['Data contabile', 'Data valuta', 'Descrizione causale', 'Importi dare', 'Importi avere', 'Saldo']);
  assert.equal(detected.ready, true);
  assert.equal(detected.mapping.date, 'Data contabile');
  assert.equal(detected.mapping.description, 'Descrizione causale');
  assert.equal(detected.mapping.debit, 'Importi dare');
  assert.equal(detected.mapping.credit, 'Importi avere');
});

test('parses OFX/QFX and QIF bank interchange formats', async () => {
  const { parseStatementText } = await import('../statement-import-core.js');
  const ofx = parseStatementText('OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261030120000<TRNAMT>-12.50<NAME>SUPERMARKET</STMTTRN></BANKTRANLIST></OFX>', 'export.ofx');
  assert.equal(ofx.format, 'OFX/QFX');
  assert.equal(ofx.rows.length, 1);
  assert.equal(ofx.rows[0].Importo, '-12.50');
  const qif = parseStatementText('!Type:Bank\nD30/10/2026\nT-9,50\nPSUPERMARKET\n^', 'export.qif');
  assert.equal(qif.format, 'QIF');
  assert.equal(qif.rows[0].Importo, '-9,50');
});

test('parses MT940 and CAMT.053 XML exports', async () => {
  const { parseStatementText } = await import('../statement-import-core.js');
  const mt = parseStatementText(':20:STATEMENT\n:61:261030D12,50NTRF\n:86:SHOP PAYMENT', 'export.mt940');
  assert.equal(mt.format, 'MT940');
  assert.equal(mt.rows[0].Importo, '-12.50');
  const xml = parseStatementText('<Document><Ntry><Amt Ccy="EUR">15.20</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-30</Dt></BookgDt><AddtlNtryInf>Salary</AddtlNtryInf></Ntry></Document>', 'export.xml');
  assert.equal(xml.format, 'CAMT.053 XML');
  assert.equal(xml.rows[0].Importo, '15.20');
});
