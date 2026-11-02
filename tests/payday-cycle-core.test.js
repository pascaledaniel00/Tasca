import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaydayCycles,
  findPaydayCycle,
  groupTransactionsByPeriod,
  summarizePaydayCycle,
} from '../payday-cycle-core.js';

const movements = [
  { id: 1, type: 'income', status: 'confirmed', description: 'Stipendio', amount: 760, occurred_on: '2026-10-30' },
  { id: 2, type: 'expense', status: 'confirmed', description: 'Auto', amount: 250, occurred_on: '2026-11-02' },
  { id: 3, type: 'income', status: 'planned', description: 'Stipendio previsto', amount: 760, occurred_on: '2026-12-01' },
  { id: 4, type: 'transfer', status: 'confirmed', description: 'Giroconto', amount: 100, occurred_on: '2026-11-10' },
  { id: 5, type: 'expense', status: 'needs_review', description: 'Da verificare', amount: 20, occurred_on: '2026-11-12' },
];

test('crea cicli da accrediti stipendio effettivi e non da entrate previste', () => {
  const cycles = buildPaydayCycles(movements, { nextPayday: '2026-12-01' });
  assert.deepEqual(cycles, [{
    start: '2026-10-30', end: '2026-11-30', nextPayday: '2026-12-01',
    isOpen: false, days: 32,
  }]);
});

test('assegna il giorno precedente e il giorno di accredito a cicli diversi', () => {
  const cycles = buildPaydayCycles([
    { type: 'income', status: 'confirmed', description: 'Stipendio', amount: 760, occurred_on: '2026-10-30' },
    { type: 'income', status: 'confirmed', description: 'Stipendio', amount: 1200, occurred_on: '2026-12-01' },
  ]);
  assert.equal(findPaydayCycle('2026-11-30', cycles).start, '2026-10-30');
  assert.equal(findPaydayCycle('2026-12-01', cycles).start, '2026-12-01');
});

test('riepilogo ciclo esclude trasferimenti e movimenti non confermati', () => {
  const cycle = { start: '2026-10-30', end: '2026-11-30', nextPayday: '2026-12-01', isOpen: false };
  const result = summarizePaydayCycle(cycle, movements, { openingBalance: 50 });
  assert.equal(result.income, 760);
  assert.equal(result.expenses, 250);
  assert.equal(result.transfers, 100);
  assert.equal(result.projectedClosingBalance, 560);
  assert.equal(result.transactionCount, 3);
});

test('mese solare e ciclo stipendiale sono riferimenti distinti allo stesso movimento', () => {
  const cycles = [{ start: '2026-10-30', end: '2026-11-30' }];
  const [mapped] = groupTransactionsByPeriod([movements[1]], cycles);
  assert.equal(mapped.calendarMonth, '2026-11');
  assert.equal(mapped.paydayCycleStart, '2026-10-30');
  assert.equal(mapped.transaction, movements[1]);
});

test('rifiuta date non valide e non inventa un ciclo prima del primo stipendio', () => {
  assert.equal(findPaydayCycle('2026-02-30', []), null);
  assert.equal(findPaydayCycle('2026-10-01', buildPaydayCycles(movements)), null);
});
