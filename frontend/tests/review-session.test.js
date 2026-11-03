import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewTimer, requestedReviewLimit, reviewQuestionLimit } from '../src/review/session.js';

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
