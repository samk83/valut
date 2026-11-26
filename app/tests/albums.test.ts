// Run: node --experimental-strip-types --test tests/   (from app/)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addToAlbum,
  cleanName,
  coverOf,
  createAlbum,
  deleteAlbum,
  EMPTY,
  liveItems,
  MAX_NAME,
  mergeAlbums,
  parseAlbums,
  removeFromAlbum,
  renameAlbum,
  serializeAlbums,
  setCover,
} from '../src/albums.ts';

const id = (n: number) => n.toString(16).padStart(32, '0');
const items = (...ns: number[]) => new Map(ns.map((n) => [id(n), { id: id(n) }]));

test('an album is made, filled, renamed and survives a save and read', () => {
  let doc = createAlbum(EMPTY, '  여행   2026 ', 'a1', 1);
  assert.equal(doc.albums[0].name, '여행 2026');
  doc = addToAlbum(doc, 'a1', [id(1), id(2)], 2);
  doc = addToAlbum(doc, 'a1', [id(3), id(1), 'not-an-id'], 3);
  assert.deepEqual(doc.albums[0].items, [id(3), id(1), id(2)]);
  doc = renameAlbum(doc, 'a1', '가족', 4);
  assert.equal(doc.albums[0].name, '가족');
  assert.equal(doc.albums[0].updatedAt, 4);
  assert.deepEqual(parseAlbums(serializeAlbums(doc)), doc);
});

test('names are trimmed and capped; empty names are refused', () => {
  assert.equal(cleanName('a'.repeat(100)).length, MAX_NAME);
  assert.equal([...cleanName('😀'.repeat(50))].length, MAX_NAME);
  assert.throws(() => createAlbum(EMPTY, '   ', 'x', 1));
  const doc = createAlbum(EMPTY, 'ok', 'x', 1);
  assert.throws(() => renameAlbum(doc, 'x', ' ', 2));
});

test('deleting an album or taking photos out of it only removes labels', () => {
  let doc = createAlbum(EMPTY, 'A', 'a', 1, [id(1), id(2)]);
  doc = createAlbum(doc, 'B', 'b', 2, [id(1)]);
  doc = setCover(doc, 'a', id(2), 3);
  doc = removeFromAlbum(doc, 'a', [id(2)], 4);
  assert.deepEqual(doc.albums.find((a) => a.id === 'a')!.items, [id(1)]);
  assert.equal(doc.albums.find((a) => a.id === 'a')!.cover, null);
  doc = deleteAlbum(doc, 'a');
  assert.deepEqual(
    doc.albums.map((a) => a.id),
    ['b'],
  );
  // The other album still shows the shared photo.
  assert.deepEqual(doc.albums[0].items, [id(1)]);
});

test('items that were destroyed are hidden, and the cover falls back to the newest one', () => {
  let doc = createAlbum(EMPTY, 'A', 'a', 1, [id(1), id(2), id(3)]);
  doc = setCover(doc, 'a', id(3), 2);
  const here = items(1, 2);
  assert.deepEqual(
    liveItems(doc.albums[0], here).map((i) => i.id),
    [id(1), id(2)],
  );
  assert.equal(coverOf(doc.albums[0], here)?.id, id(1));
  assert.equal(coverOf(doc.albums[0], items(3))?.id, id(3));
  assert.equal(coverOf(doc.albums[0], items()), null);
});

test('a broken saved list is not silently replaced, and broken entries are skipped', () => {
  assert.throws(() => parseAlbums('not json'));
  assert.throws(() => parseAlbums('{"v":1}'));
  const doc = parseAlbums(
    JSON.stringify({ v: 1, albums: [{ id: 'a', name: 'ok', items: [id(1), 5, id(1)] }, { id: 'a', name: 'dupe' }, { name: 'no id' }, { id: 'b', name: '' }] }),
  );
  assert.equal(doc.albums.length, 1);
  assert.deepEqual(doc.albums[0].items, [id(1)]);
});

test('merging a restored backup only adds: same album joins items, local name wins', () => {
  let local = createAlbum(EMPTY, '여행', 'a', 1, [id(1)]);
  local = createAlbum(local, '로컬', 'c', 2);
  let backup = createAlbum(EMPTY, 'Trip', 'a', 1, [id(2), id(1)]);
  backup = createAlbum(backup, '가족', 'b', 1, [id(3)]);
  const merged = mergeAlbums(local, backup);
  const a = merged.albums.find((x) => x.id === 'a')!;
  assert.equal(a.name, '여행');
  assert.deepEqual(a.items, [id(1), id(2)]);
  assert.deepEqual(merged.albums.find((x) => x.id === 'b')!.items, [id(3)]);
  assert.ok(merged.albums.find((x) => x.id === 'c'));
  // Merging the same list again changes nothing.
  assert.deepEqual(mergeAlbums(merged, backup), merged);
});

test('albums from the old phone are translated to the new ids; missing items are dropped', () => {
  let old = createAlbum(EMPTY, '강아지', 'a', 1, [id(10), id(11), id(12)]);
  old = setCover(old, 'a', id(12), 2);
  const toLocal = new Map([
    [id(10), id(100)],
    [id(12), id(102)],
  ]);
  const merged = mergeAlbums(EMPTY, old, (x) => toLocal.get(x) ?? null);
  assert.deepEqual(merged.albums[0].items, [id(100), id(102)]);
  assert.equal(merged.albums[0].cover, id(102));
});
