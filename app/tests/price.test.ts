import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearPrice } from '../src/price.ts';

test('Canadian dollars with a bare $ get the code', () => {
  assert.equal(clearPrice('$12.99', 'CAD'), '$12.99 CAD');
  assert.equal(clearPrice('$13.99', 'cad'), '$13.99 CAD');
});

test('other dollar currencies get the code', () => {
  assert.equal(clearPrice('$15.99', 'AUD'), '$15.99 AUD');
  assert.equal(clearPrice('$199.00', 'MXN'), '$199.00 MXN');
  assert.equal(clearPrice('$12.98', 'SGD'), '$12.98 SGD');
});

test('US dollars stay as written', () => {
  assert.equal(clearPrice('$9.99', 'USD'), '$9.99');
});

test('strings that already name the currency stay as written', () => {
  assert.equal(clearPrice('CA$12.99', 'CAD'), 'CA$12.99');
  assert.equal(clearPrice('US$9.99', 'USD'), 'US$9.99');
  assert.equal(clearPrice('A$15.99', 'AUD'), 'A$15.99');
  assert.equal(clearPrice('R$ 54,90', 'BRL'), 'R$ 54,90');
  assert.equal(clearPrice('12,99 CAD', 'CAD'), '12,99 CAD');
});

test('unique symbols stay as written', () => {
  assert.equal(clearPrice('₩14,000', 'KRW'), '₩14,000');
  assert.equal(clearPrice('9,99 €', 'EUR'), '9,99 €');
  assert.equal(clearPrice('¥1,500', 'JPY'), '¥1,500');
  assert.equal(clearPrice('£9.99', 'GBP'), '£9.99');
  assert.equal(clearPrice('₹999', 'INR'), '₹999');
});

test('shared non-dollar symbols get the code', () => {
  assert.equal(clearPrice('¥78.00', 'CNY'), '¥78.00 CNY');
  assert.equal(clearPrice('129,00 kr', 'SEK'), '129,00 kr SEK');
});

test('no currency code or no price', () => {
  assert.equal(clearPrice('$12.99', null), '$12.99');
  assert.equal(clearPrice(null, 'CAD'), null);
  assert.equal(clearPrice('', 'CAD'), null);
});
