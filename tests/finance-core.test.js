import test from 'node:test';
import assert from 'node:assert/strict';
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


test('saldi condivisi considerano spese confermate, quote e rimborsi una sola volta', () => {
  const balances = calculateParticipantBalances(
    ['anna', 'luca'],
    [
      { type: 'expense', status: 'confirmed', paid_by: 'anna', amount: 60 },
      { type: 'expense', status: 'pending', paid_by: 'luca', amount: 100 },
    ],
    [
      { user_id: 'anna', share_amount: 30 },
      { user_id: 'luca', share_amount: 30 },
    ],
    [{ from_user_id: 'luca', to_user_id: 'anna', amount: 10 }]
  );
  assert.deepEqual(balances, [
    { user_id: 'anna', balance: 40 },
    { user_id: 'luca', balance: -40 },
  ]);
});

test('piano rimborsi compensa debitori e creditori con importi al centesimo', () => {
  assert.deepEqual(
    settlementPlan([
      { user_id: 'a', balance: -20.1 },
      { user_id: 'b', balance: -9.9 },
      { user_id: 'c', balance: 30 },
    ]),
    [
      { from_user_id: 'a', to_user_id: 'c', amount: 20.1 },
      { from_user_id: 'b', to_user_id: 'c', amount: 9.9 },
    ]
  );
});

test('esportazione CSV mantiene intestazioni, BOM e virgolette sicure', () => {
  const csv = serializeFinanceCsv([
    { name: 'movimenti', rows: [{ description: 'Cena; "amici"', amount: 25, notes: null }] },
    { name: 'budget', rows: [{ category: 'Casa', amount: 200 }] },
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"tipo_record";"description";"amount";"notes";"category"/);
  assert.match(csv, /"movimenti";"Cena; ""amici""";"25";"";""/);
  assert.match(csv, /"budget";"";"200";"";"Casa"/);
});

test('validazione ricorrenze controlla importo, frequenza, data e rate residue', () => {
  const valid = {
    space_id: 'personal',
    name: 'Rata telefono',
    amount: 42.15,
    cadence: 'monthly',
    next_due_on: '2026-11-01',
    remaining_installments: 4,
  };
  assert.equal(validateRecurringPlanInput(valid), null);
  assert.match(validateRecurringPlanInput({ ...valid, amount: 0 }), /maggiore di zero/);
  assert.match(validateRecurringPlanInput({ ...valid, cadence: 'daily' }), /frequenza valida/);
  assert.match(validateRecurringPlanInput({ ...valid, next_due_on: '2026-02-30' }), /data di scadenza valida/);
  assert.match(validateRecurringPlanInput({ ...valid, remaining_installments: 1.5 }), /numero intero/);
});
