import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatWait } from '../src/wait.ts';

test('wait times read as minutes and seconds, or hours past one hour', () => {
  assert.equal(formatWait(60_000), '1:00');
  assert.equal(formatWait(59_001), '1:00');
  assert.equal(formatWait(59_000), '0:59');
  assert.equal(formatWait(900_000), '15:00');
  assert.equal(formatWait(3_600_000), '1:00:00');
  assert.equal(formatWait(0), '0:00');
  assert.equal(formatWait(-5), '0:00');
});
