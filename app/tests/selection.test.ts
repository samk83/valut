import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampOffset, dragSelection, inOrder, tileAt, toggle } from '../src/selection.ts';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

test('tileAt finds the tile under a point', () => {
  // 3 columns of 100 pt tiles, 2 pt apart.
  assert.equal(tileAt(10, 10, 3, 100, 2, 7), 0);
  assert.equal(tileAt(150, 10, 3, 100, 2, 7), 1);
  assert.equal(tileAt(250, 110, 3, 100, 2, 7), 5);
  assert.equal(tileAt(10, 210, 3, 100, 2, 7), 6);
});

test('tileAt snaps points outside the grid to the nearest tile', () => {
  assert.equal(tileAt(-20, -50, 3, 100, 2, 7), 0);
  assert.equal(tileAt(999, 10, 3, 100, 2, 7), 2);
  assert.equal(tileAt(250, 900, 3, 100, 2, 7), 6);
  assert.equal(tileAt(10, 10, 3, 100, 2, 0), null);
});

test('dragSelection adds the range between anchor and finger, both ways, keeping the base', () => {
  const base = new Set(['g']);
  assert.deepEqual([...dragSelection(ids, base, 1, 3)].sort(), ['b', 'c', 'd', 'g']);
  assert.deepEqual([...dragSelection(ids, base, 3, 1)].sort(), ['b', 'c', 'd', 'g']);
  assert.deepEqual([...dragSelection(ids, new Set(), 2, 2)], ['c']);
  // The base set is never changed.
  assert.deepEqual([...base], ['g']);
});

test('dragging back shrinks the range again', () => {
  const base = new Set<string>();
  assert.equal(dragSelection(ids, base, 0, 5).size, 6);
  assert.equal(dragSelection(ids, base, 0, 2).size, 3);
});

test('toggle and inOrder', () => {
  const s = toggle(toggle(new Set(['a']), 'c'), 'a');
  assert.deepEqual([...s], ['c']);
  assert.deepEqual(inOrder(ids, new Set(['f', 'b', 'zz'])), ['b', 'f']);
});

test('clampOffset never scrolls past either end', () => {
  assert.equal(clampOffset(100, 18, 2000, 800), 118);
  assert.equal(clampOffset(1190, 18, 2000, 800), 1200);
  assert.equal(clampOffset(1200, 18, 2000, 800), 1200);
  assert.equal(clampOffset(5, -18, 2000, 800), 0);
  // A list shorter than the screen never scrolls.
  assert.equal(clampOffset(0, 18, 500, 800), 0);
});
