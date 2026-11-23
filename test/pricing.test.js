import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, parseQty } from '../src/pricing.js';

const on = { bulkDiscount: true, qaDefect: false };

test('no discount below 10', () => {
  assert.deepEqual(priceFor(9, on), { qty: 9, unitPrice: 10, discountPercent: 0, total: 90 });
});

test('10% bulk discount at 10', () => {
  assert.equal(priceFor(10, on).total, 90);
});

test('flag off means no discount', () => {
  assert.equal(priceFor(10, { bulkDiscount: false, qaDefect: false }).total, 100);
});

test('qa defect gives 1% instead of 10%', () => {
  assert.equal(priceFor(10, { bulkDiscount: true, qaDefect: true }).total, 99);
});

test('rejects bad qty', () => {
  for (const raw of ['0', '-1', 'abc', '1.5', '100001', '']) {
    assert.throws(() => parseQty(raw), RangeError, `expected RangeError for "${raw}"`);
  }
});

test('parses a valid qty', () => {
  assert.equal(parseQty('10'), 10);
});

test('qa defect never adds a discount below 10', () => {
  assert.equal(priceFor(9, { bulkDiscount: true, qaDefect: true }).total, 90);
});
