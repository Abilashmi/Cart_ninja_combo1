// Progress bar milestone positions, fill and money tags
// (app/utils/progress-layout.shared.js) and the storefront drawer's copy.
//
//   node --test tests/cart-drawer/progress-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { milestonePositions, progressFill, fillMoneyTag } from '../../app/utils/progress-layout.shared.js';

test('the storefront drawer carries the shared block verbatim', () => {
  const read = (...p) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n');
  const block = (s) => s.slice(s.indexOf('/* progress-layout:begin */'), s.indexOf('/* progress-layout:end */'))
    .split('\n').map((l) => l.trim()).join('\n');
  const src = block(read('app', 'utils', 'progress-layout.shared.js'));
  assert.ok(src.length > 500);
  assert.equal(block(read('extensions', 'cart-drawer', 'assets', 'cart_drawer_inline.js')), src, 'copy app/utils/progress-layout.shared.js begin..end into cart_drawer_inline.js');
});

// extrokids: ₹799 / ₹1000 / ₹1300 / ₹5000 / ₹12000 (they piled up at 7-11%).
const EXTRO = [799, 1000, 1300, 5000, 12000];

test('close milestones are held apart, in order, inside the track', () => {
  const pos = milestonePositions(EXTRO, 3, 97, 20);
  assert.equal(pos.length, 5);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] - pos[i - 1] >= 20 - 1e-9, `gap ${i}: ${pos[i] - pos[i - 1]}`);
  assert.ok(pos[0] >= 3 && pos[4] <= 97);
  assert.equal(pos[4], 97);
});

test('well spread milestones stay where their amounts put them', () => {
  assert.deepEqual(milestonePositions([2500, 5000, 10000], 0, 100, 20), [25, 50, 100]);
  assert.deepEqual(milestonePositions([500], 3, 97, 20), [97]);
  assert.deepEqual(milestonePositions([], 3, 97, 20), []);
});

test('too many milestones for the gap: spread evenly, never past the ends', () => {
  const pos = milestonePositions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 97, 20);
  assert.ok(pos.every((p) => p >= 3 - 1e-9 && p <= 97 + 1e-9), JSON.stringify(pos));
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1]);
});

test('the fill meets each milestone exactly at its amount', () => {
  const pos = milestonePositions(EXTRO, 3, 97, 20);
  EXTRO.slice(0, -1).forEach((t, i) => assert.ok(Math.abs(progressFill(t, EXTRO, pos) - pos[i]) < 1e-9, `at ${t}`));
  assert.equal(progressFill(12000, EXTRO, pos), 100);
  assert.equal(progressFill(20000, EXTRO, pos), 100);
  assert.equal(progressFill(0, EXTRO, pos), 0);
  const mid = progressFill(2476, EXTRO, pos); // the screenshot's cart: between ₹1300 and ₹5000
  assert.ok(mid > pos[2] && mid < pos[3], String(mid));
});

test('a sign typed before {amount} is not doubled', () => {
  assert.equal(fillMoneyTag('Add ₹{amount} more to boost your prepaid savings to 17%', '{amount}', '₹2,524.00'), 'Add ₹2,524.00 more to boost your prepaid savings to 17%');
  assert.equal(fillMoneyTag('Add ₹ {amount} more', '{amount}', '₹2,524.00'), 'Add ₹2,524.00 more');
  assert.equal(fillMoneyTag("You're {amount} away", '{amount}', '₹50.00'), "You're ₹50.00 away");
  assert.equal(fillMoneyTag('Spend Rs.{amount}', '{amount}', 'Rs.50'), 'Spend Rs.50');
  assert.equal(fillMoneyTag('Add $ {amount} or {amount}', '{amount}', '$5.00'), 'Add $5.00 or $5.00');
  assert.equal(fillMoneyTag('Add {amount} items', '{amount}', '3'), 'Add 3 items', 'item counts have no sign');
  assert.equal(fillMoneyTag('Only ₹{amount}', '{amount}', '3'), 'Only ₹3', 'a bare number keeps the typed sign');
});
