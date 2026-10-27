import test from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetComparison,
  categoryBreakdown,
  monthlyTrend,
  summarizeTransactions,
  validateTransactionInput,
} from '../finance-core.js';

test('riepilogo separa entrate, uscite e trasferimenti', () => {
  assert.deepEqual(
    summarizeTransactions([
      { type: 'income', amount: '1200.00' },
      { type: 'refund', amount: 15 },
      { type: 'expense', amount: 90.25 },
      { type: 'transfer', amount: 400 },
      { type: 'expense', amount: 'non valido' },
    ]),
    { income: 1215, expense: 90.25, transfer: 400, residual: 1124.75 }
  );
});

test('andamento mensile include mesi senza movimenti e ignora trasferimenti', () => {
  assert.deepEqual(
    monthlyTrend(
      [
        { type: 'expense', amount: 25, occurred_on: '2026-08-10' },
        { type: 'income', amount: 1000, occurred_on: '2026-10-02' },
        { type: 'transfer', amount: 300, occurred_on: '2026-10-03' },
      ],
      '2026-10',
      3
    ),
    [
      { month: '2026-08', income: 0, expense: 25 },
      { month: '2026-09', income: 0, expense: 0 },
      { month: '2026-10', income: 1000, expense: 0 },
    ]
  );
});

test('distribuzione per categoria ordina e raggruppa le categorie minori', () => {
  const rows = [
    { type: 'expense', amount: 50, category: 'Casa', occurred_on: '2026-10-01' },
    { type: 'expense', amount: 30, category: 'Auto', occurred_on: '2026-10-02' },
    { type: 'expense', amount: 20, category: 'Bar', occurred_on: '2026-10-03' },
    { type: 'expense', amount: 10, category: 'Salute', occurred_on: '2026-10-04' },
    { type: 'expense', amount: 5, category: 'Regali', occurred_on: '2026-10-05' },
    { type: 'expense', amount: 2, category: 'Altro', occurred_on: '2026-10-06' },
    { type: 'income', amount: 500, category: 'Stipendio', occurred_on: '2026-10-06' },
  ];
  assert.deepEqual(categoryBreakdown(rows, '2026-10', 3), [
    { category: 'Casa', amount: 50 },
    { category: 'Auto', amount: 30 },
    { category: 'Bar', amount: 20 },
    { category: 'Altre categorie', amount: 17 },
  ]);
});

test('confronto budget rispetta spazio, categoria e mese', () => {
  const result = budgetComparison(
    [{ space_id: 'home', category: 'Alimentari', month_start: '2026-10-01', amount: 100 }],
    [
      {
        space_id: 'home',
        type: 'expense',
        category: 'Alimentari',
        amount: 125,
        occurred_on: '2026-10-03',
      },
      {
        space_id: 'other',
        type: 'expense',
        category: 'Alimentari',
        amount: 80,
        occurred_on: '2026-10-04',
      },
      {
        space_id: 'home',
        type: 'expense',
        category: 'Alimentari',
        amount: 20,
        occurred_on: '2026-09-04',
      },
      {
        space_id: 'home',
        type: 'transfer',
        category: 'Alimentari',
        amount: 50,
        occurred_on: '2026-10-04',
      },
    ],
    '2026-10'
  );
  assert.equal(result[0].spent, 125);
  assert.equal(result[0].remaining, -25);
  assert.equal(result[0].percent, 125);
});

test('rifiuta parametri temporali e limiti non validi', () => {
  assert.throws(() => monthlyTrend([], 'ottobre', 6), TypeError);
  assert.throws(() => monthlyTrend([], '2026-10', 0), RangeError);
  assert.throws(() => categoryBreakdown([], '2026-10', 0), RangeError);
});

test('validazione movimento rifiuta dati incompleti o non validi', () => {
  const valid = {
    space_id: 'personal',
    type: 'expense',
    amount: 12.5,
    description: '  Caffè  ',
    category: 'Bar, colazioni e snack',
    occurred_on: '2026-10-27',
  };
  assert.equal(validateTransactionInput(valid), null);
  assert.match(validateTransactionInput({ ...valid, amount: 0 }), /maggiore di zero/);
  assert.match(validateTransactionInput({ ...valid, space_id: null }), /spazio personale/);
  assert.match(validateTransactionInput({ ...valid, occurred_on: '2026-02-30' }), /data valida/);
  assert.match(validateTransactionInput({ ...valid, description: ' ' }), /descrizione/);
});
