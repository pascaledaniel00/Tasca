import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatementAmount,
  parseStatementDate,
  normalizeStatementRows,
  findStatementDuplicates,
  statementImportSummary,
} from '../statement-import-core.js';

test('parses Italian and international currency formats', () => {
  assert.equal(parseStatementAmount('1.234,56 €'), 1234.56);
  assert.equal(parseStatementAmount('-12,50'), -12.5);
  assert.equal(parseStatementAmount('(9.99)'), -9.99);
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
