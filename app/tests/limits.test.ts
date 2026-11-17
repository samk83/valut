// Run: node --experimental-strip-types --test tests/   (from app/)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FREE_LIMIT, fitToSlots, freeSlots } from '../src/limits.ts';

test('free plan allows 100 photos and videos in total', () => {
  assert.equal(FREE_LIMIT, 100);
  assert.equal(freeSlots(0, false), 100);
  assert.equal(freeSlots(37, false), 63);
  assert.equal(freeSlots(100, false), 0);
});

test('above the limit (for example after moving from another phone) nothing is negative', () => {
  assert.equal(freeSlots(250, false), 0);
});

test('premium has no limit', () => {
  assert.equal(freeSlots(0, true), Infinity);
  assert.equal(freeSlots(5000, true), Infinity);
});

test('a selection is cut to what fits, in order', () => {
  assert.deepEqual(fitToSlots([1, 2, 3], 5), { take: [1, 2, 3], leftOut: 0 });
  assert.deepEqual(fitToSlots([1, 2, 3], 2), { take: [1, 2], leftOut: 1 });
  assert.deepEqual(fitToSlots([1, 2, 3], 0), { take: [], leftOut: 3 });
  assert.deepEqual(fitToSlots([1, 2, 3], Infinity), { take: [1, 2, 3], leftOut: 0 });
});

test('settings upgrade card: free, near the limit, full, premium', async () => {
  const { planCard, NEAR_LIMIT_LEFT } = await import('../src/limits.ts');
  assert.equal(NEAR_LIMIT_LEFT, 10);
  assert.equal(planCard(0, false), 'free');
  assert.equal(planCard(89, false), 'free');
  assert.equal(planCard(90, false), 'near');
  assert.equal(planCard(99, false), 'near');
  assert.equal(planCard(100, false), 'full');
  assert.equal(planCard(250, false), 'full');
  assert.equal(planCard(0, true), 'premium');
  assert.equal(planCard(500, true), 'premium');
});
