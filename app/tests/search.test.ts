import assert from 'node:assert/strict';
import { test } from 'node:test';

import { categoriesFor, matchingLines, normalize, parseNote, searchNotes, snippet, textScore, type SearchNote } from '../src/search.ts';

const note = (text: string, labels: string[] = []): SearchNote => ({
  v: 1,
  engine: 'test',
  w: 1000,
  h: 1000,
  text,
  lines: text.split('\n').map((t, i) => ({ t, b: [0.1, i * 0.05, 0.5, 0.04] })),
  labels,
});

const names = {
  drink: 'drink, coffee, tea, 음료, 커피',
  food: 'food, meal, 음식',
  document: 'document, receipt, 문서, 영수증',
};

test('normalize ignores spaces, punctuation and case, and joins Korean jamo', () => {
  assert.equal(normalize('Ice  Americano, 9,000'), 'iceamericano9000');
  // Decomposed Hangul (as some keyboards send it) equals the composed form.
  assert.equal(normalize('가'), normalize('가'));
});

test('exact, look-alike and one-letter-off matches rank in that order', () => {
  assert.equal(textScore(note('HOT 아메리카노 4.5'), '아메리카노'), 3);
  assert.equal(textScore(note('Total 1O,OOO'), '10000'), 2);
  assert.equal(textScore(note('Starbuks Reserve'), 'Starbucks'), 1);
  assert.equal(textScore(note('Starbuks Reserve'), 'tea'), 0);
  // Short words never match by a one-letter slip.
  assert.equal(textScore(note('cat'), 'car'), 0);
});

test('every word must be found; text hits come before content-only hits', () => {
  const entries = [
    { id: 'receipt', note: note('CAFE MORI\n아메리카노 x2 9,000', ['receipt', 'document']), createdAt: 1, mimeType: 'image/jpeg' },
    { id: 'cup', note: note('', ['coffee', 'cup']), createdAt: 2, mimeType: 'image/jpeg' },
    { id: 'beach', note: note('', ['beach', 'sky']), createdAt: 3, mimeType: 'image/jpeg' },
  ];
  const r = searchNotes(entries, '아메리카노', 'all', names);
  assert.deepEqual(r.text.map((h) => h.id), ['receipt']);
  assert.deepEqual(r.content, []);
  const coffee = searchNotes(entries, '커피', 'all', names);
  assert.deepEqual(coffee.content.map((h) => h.id), ['cup']);
  const both = searchNotes(entries, '아메리카노 영수증', 'all', names);
  assert.deepEqual([...both.text, ...both.content].map((h) => h.id), ['receipt']);
});

test('filters browse without a query', () => {
  const entries = [
    { id: 'doc', note: note('a', ['document']), createdAt: 1, mimeType: 'image/jpeg' },
    { id: 'shot', note: note('hello there'), createdAt: 2, mimeType: 'image/png' },
    { id: 'plain', note: note(''), createdAt: 3, mimeType: 'image/jpeg' },
  ];
  assert.deepEqual(searchNotes(entries, '', 'document', names).text.map((h) => h.id), ['doc']);
  assert.deepEqual(searchNotes(entries, '', 'screenshot', names).text.map((h) => h.id), ['shot']);
  assert.deepEqual(searchNotes(entries, '', 'text', names).text.map((h) => h.id), ['shot']);
  assert.deepEqual(searchNotes(entries, '', 'all', names).text, []);
});

test('matching lines mark the box to highlight, also across a line break', () => {
  const n = note('CAFE MORI\n아메리카노 x2\n합계 21,000');
  assert.deepEqual(matchingLines(n, '아메리카노'), [1]);
  assert.deepEqual(matchingLines(n, '21000'), [2]);
  assert.deepEqual(matchingLines(note('Privat\ne Vision'), 'Private'), [0, 1]);
});

test('snippet splits out the matched part', () => {
  assert.deepEqual(snippet(note('HOT 아메리카노 4.5'), '아메리카노'), { before: 'HOT ', match: '아메리카노', after: ' 4.5' });
});

test('category names in any language point at the same group', () => {
  assert.deepEqual(categoriesFor('영수', names), ['document']);
  assert.deepEqual(categoriesFor('Coffee', names), ['drink']);
  assert.deepEqual(categoriesFor('x', names), []);
});

test('bad or foreign notes are ignored', () => {
  assert.equal(parseNote('not json'), null);
  assert.equal(parseNote('{"text":5}'), null);
  const n = parseNote('{"engine":"e","text":"hi","lines":[{"t":"hi","b":[0,0,1,1]},{"t":3}],"labels":["a",1]}');
  assert.equal(n?.lines.length, 1);
  assert.deepEqual(n?.labels, ['a']);
});
