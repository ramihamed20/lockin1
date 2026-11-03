import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewTimer, recoveryQuestions, gradeRecoveryAnswer, requestedReviewLimit, reviewQuestionLimit } from '../src/review/session.js';

test('review time budgets adapt to pace and stay bounded', () => {
  assert.equal(reviewQuestionLimit(null, 5), 10);
  assert.equal(reviewQuestionLimit({ seconds_per_question: 60 }, 5), 5);
  assert.equal(reviewQuestionLimit({ seconds_per_question: 120 }, 10), 5);
  assert.equal(reviewQuestionLimit({ seconds_per_question: 15 }, 10), 20);
  for (const value of [null, '', 'NaN', '0', '-1', '21', '3.5']) assert.equal(requestedReviewLimit(value), 10);
  assert.equal(requestedReviewLimit('5'), 5);
});

test('answer timing excludes paused background and request time', () => {
  let now = 0;
  const timer = createReviewTimer(() => now);
  timer.resume();
  now = 5000;
  timer.pause();
  now = 605000;
  assert.equal(timer.seconds(), 5);
  timer.resume();
  now = 610000;
  timer.pause();
  assert.equal(timer.seconds(), 10);
  now = 990000;
  assert.equal(timer.seconds(), 10);
  timer.resume();
  now += 990000;
  assert.equal(timer.seconds(), 900);
});


test('recovery is bounded, spaced and only uses already revealed valid answer keys', () => {
  const items = Array.from({length: 8}, (_, index) => ({ id: `q${index}`, options: [{id: 'a'}, {id: 'b'}] }));
  const outcomes = Object.fromEntries(items.map(item => [item.id, { was_correct: false, review_item: { correct_option_ids: ['b'], explanation: 'Why' } }]));
  assert.deepEqual(recoveryQuestions(items, outcomes).map(row => row.item.id), ['q0', 'q1', 'q2']);
  const result = recoveryQuestions(items, outcomes, 10);
  assert.equal(result.length, 3);
  assert.equal(outcomes.q0.was_correct, false);
  assert.deepEqual(outcomes.q0.review_item.correct_option_ids, ['b']);
  outcomes.q0.was_correct = true;
  outcomes.q1.review_item.correct_option_ids = ['unknown'];
  delete outcomes.q2.review_item.correct_option_ids;
  delete outcomes.q3;
  assert.deepEqual(recoveryQuestions(items, outcomes).map(row => row.item.id), ['q4', 'q5']);
  assert.equal(recoveryQuestions(items.slice(6), outcomes).length, 0);
});

test('local recovery respects multiple answers and rejects duplicate or partial selections', () => {
  assert.equal(gradeRecoveryAnswer(['b', 'a'], ['a', 'b']), true);
  assert.equal(gradeRecoveryAnswer(['a'], ['a', 'b']), false);
  assert.equal(gradeRecoveryAnswer(['a', 'a'], ['a', 'b']), false);
  assert.equal(gradeRecoveryAnswer([], ['a']), false);
});
