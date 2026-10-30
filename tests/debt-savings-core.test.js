import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDebtSummary, calculateSavingsSummary, validateDebtInput,
  validateSavingsGoalInput, validateFundMovement
} from '../finance-core.js';

test('debt summary never estimates principal from installment count', () => {
  const [debt] = calculateDebtSummary([{id:'d1',principal_remaining:null,installments_remaining:3}], [
    {debt_id:'d1',amount:42.15,principal_component:null}
  ]);
  assert.equal(debt.paidTotal,42.15);
  assert.equal(debt.principalRemaining,null);
});
test('debt summary uses only explicitly entered remaining principal', () => {
  const [debt] = calculateDebtSummary([{id:'d1',principal_remaining:126.45}], []);
  assert.equal(debt.principalRemaining,126.45);
});
test('savings balance is starting balance plus contributions minus withdrawals', () => {
  const [goal] = calculateSavingsSummary([{id:'g1',target_amount:500,starting_balance:100}], [
    {goal_id:'g1',movement_type:'contribution',amount:50},
    {goal_id:'g1',movement_type:'withdrawal',amount:20}
  ]);
  assert.equal(goal.balance,130);
  assert.equal(goal.remaining,370);
  assert.equal(goal.percent,26);
});
test('debt and savings validators reject invalid input', () => {
  assert.match(validateDebtInput({space_id:'s',name:'Rata',installments_remaining:-1}),/rate/);
  assert.match(validateSavingsGoalInput({space_id:'s',name:'Fondo',target_amount:0}),/obiettivo/);
  assert.match(validateFundMovement({space_id:'s',goal_id:'g',movement_type:'other',amount:2,occurred_on:'2026-10-30'}),/Tipo/);
});
