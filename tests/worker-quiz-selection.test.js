import test from 'node:test';
import assert from 'node:assert/strict';
import { selectArchivedQuizQuestions } from '../worker.js';

const categories = ['budget', 'saving', 'debt', 'spending', 'banking', 'economy'];

function row(id, category, fingerprint, difficulty = 2, weekStart = '2026-10-25') {
  return {
    id,
    week_start: weekStart,
    category,
    fingerprint,
    question: {
      question: 'Domanda di prova ' + fingerprint,
      difficulty,
      options: [
        { value: 'A', label: 'Opzione A' },
        { value: 'B', label: 'Opzione B' },
        { value: 'C', label: 'Opzione C' },
        { value: 'D', label: 'Opzione D' },
      ],
      correctValues: ['A'],
      explanation: 'Spiegazione di prova.',
      hint: 'Indizio di prova.',
    },
  };
}

test('l’archivio cumulativo include settimane diverse e tutte le categorie', () => {
  const rows = categories.flatMap((category, index) => [
    row(index * 10 + 1, category, category + '-old', 2, '2026-10-18'),
    row(index * 10 + 2, category, category + '-new', 2, '2026-10-25'),
  ]);
  const result = selectArchivedQuizQuestions(rows, new Set(), 2);
  assert.deepEqual(Object.keys(result), categories);
  for (const category of categories) {
    assert.equal(result[category].length, 2);
    assert.deepEqual(
      new Set(result[category].map((question) => question.fingerprint)),
      new Set([category + '-old', category + '-new'])
    );
  }
});

test('lo storico è individuale: esclude le domande viste da un utente ma non dagli altri', () => {
  const rows = [row(1, 'budget', 'gia-vista'), row(2, 'budget', 'nuova')];
  const userA = selectArchivedQuizQuestions(rows, new Set(['gia-vista']), 2);
  const userB = selectArchivedQuizQuestions(rows, new Set(), 2);
  assert.deepEqual(userA.budget.map((question) => question.fingerprint), ['nuova']);
  assert.deepEqual(userB.budget.map((question) => question.fingerprint), ['gia-vista', 'nuova']);
});

test('deduplica lo stesso fingerprint presente in settimane diverse', () => {
  const rows = [
    row(1, 'budget', 'duplicata', 2, '2026-10-18'),
    row(2, 'budget', 'duplicata', 2, '2026-10-25'),
    row(3, 'budget', 'unica', 2, '2026-10-25'),
    row(4, 'budget', 'altro-livello', 1, '2026-10-25'),
  ];
  const result = selectArchivedQuizQuestions(rows, new Set(), 2);
  assert.deepEqual(result.budget.map((question) => question.fingerprint), ['duplicata', 'unica']);
});
