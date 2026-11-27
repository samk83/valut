import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMPTY, parseRating, shouldAskRating, withAsked, withFirstUse } from '../src/ratingRule.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 27);

test('never before 3 days of use, 10 items, and an import that added something', () => {
  const s = withFirstUse(EMPTY, T0);
  assert.equal(shouldAskRating(s, T0 + 2 * DAY, 50, 5), false);
  assert.equal(shouldAskRating(s, T0 + 3 * DAY, 9, 5), false);
  assert.equal(shouldAskRating(s, T0 + 3 * DAY, 50, 0), false);
  assert.equal(shouldAskRating(s, T0 + 3 * DAY, 10, 1), true);
});

test('first use unknown: wait (it is recorded when the vault opens)', () => {
  assert.equal(shouldAskRating(EMPTY, T0, 50, 5), false);
  assert.equal(withFirstUse(withFirstUse(EMPTY, T0), T0 + DAY).firstUse, T0);
});

test('at most every 120 days and 3 times in total', () => {
  let s = withAsked(withFirstUse(EMPTY, T0), T0 + 3 * DAY);
  assert.equal(shouldAskRating(s, T0 + 100 * DAY, 50, 1), false);
  assert.equal(shouldAskRating(s, T0 + 124 * DAY, 50, 1), true);
  s = withAsked(withAsked(s, T0 + 124 * DAY), T0 + 250 * DAY);
  assert.equal(shouldAskRating(s, T0 + 1000 * DAY, 50, 1), false);
});

test('a damaged file is read as empty', () => {
  assert.deepEqual(parseRating('{oops'), EMPTY);
  assert.deepEqual(parseRating(null), EMPTY);
  assert.deepEqual(parseRating('{"firstUse":"x","asked":[1,"a",null]}'), { firstUse: null, asked: [1] });
  const s = withAsked(withFirstUse(EMPTY, T0), T0 + 5);
  assert.deepEqual(parseRating(JSON.stringify(s)), s);
});
