import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQuizXP,
  getQuizBadges,
  getQuizLevel,
  scoreQuiz,
  selectVerifiedQuestions,
  validateAIQuiz,
} from '../quiz-core.js';

test('seleziona cinque domande verificate con quattro opzioni e una risposta corretta', () => {
  const questions = selectVerifiedQuestions({ count: 5, category: 'all', difficulty: 1 });
  assert.equal(questions.length, 5);
  for (const question of questions) {
    assert.equal(question.options.length, 4);
    assert.equal(question.correctValues.length, 1);
    assert.ok(question.options.some((option) => option.value === question.correctValues[0]));
  }
});

test('selezione per categoria non mescola argomenti', () => {
  const questions = selectVerifiedQuestions({ count: 2, category: 'saving', difficulty: 2 });
  assert.equal(questions.length, 2);
  assert.ok(questions.every((question) => question.category === 'saving'));
});

test('validazione quiz IA rifiuta struttura incompleta e accetta struttura valida', () => {
  assert.equal(validateAIQuiz({ questions: [] }, { count: 1 }), null);
  const q = {
    category: 'budget',
    question: 'Quale scelta aiuta a pianificare le spese mensili?',
    options: [{ value: 'A', label: 'Usare un budget' }, { value: 'B', label: 'Ignorare le uscite' }, { value: 'C', label: 'Contare solo il contante' }, { value: 'D', label: 'Non registrare gli acquisti' }],
    correctValues: ['A'],
    explanation: 'Un budget aiuta a pianificare le uscite.',
    hint: 'Pensa alla pianificazione prima dell’acquisto.',
  };
  assert.equal(validateAIQuiz({ questions: [q] }, { category: 'budget', count: 1 }).questions.length, 1);
  assert.equal(validateAIQuiz({ questions: [{ ...q, correctValues: ['Z'] }] }, { category: 'budget', count: 1 }), null);
});

test('calcolo punteggio e XP è limitato ai risultati validi', () => {
  const questions = [{ id: 'q1', correctValues: ['A'] }, { id: 'q2', correctValues: ['B'] }];
  assert.equal(scoreQuiz(questions, { q1: 'A', q2: 'C' }).correct, 1);
  assert.equal(calculateQuizXP({ correct: 3, total: 5 }), 40);
  assert.equal(calculateQuizXP({ correct: 99, total: 5 }), 60);
  assert.equal(calculateQuizXP({ correct: -1, total: 5 }), 10);
});

test('livelli e badge riflettono i progressi registrati', () => {
  assert.equal(getQuizLevel(100).level, 2);
  const badges = getQuizBadges([{ correct_answers: 5, total_questions: 5 }]);
  assert.ok(badges.some((badge) => badge.id === 'first-quiz'));
  assert.ok(badges.some((badge) => badge.id === 'accuracy-80'));
});
