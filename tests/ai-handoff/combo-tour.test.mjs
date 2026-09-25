// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const T = await import('../../app/utils/combo-tour.js');
beforeEach(() => store.clear());

test('the tour walks the whole combo flow in order, and ends on the app embed', () => {
  assert.deepEqual(T.COMBO_TOUR_STEPS.map((s) => s.id), ['create', 'template', 'ai', 'preview', 'discount', 'save', 'embed']);
  assert.deepEqual(T.COMBO_TOUR_STEPS.map((s) => s.page), ['dashboard', 'picker', 'builder', 'builder', 'builder', 'builder', 'builder']);
  assert.equal(T.COMBO_TOUR_STEPS.at(-1).kind, 'embed');
});

test('never started -> null; start / go to step / dismiss / finish are remembered', () => {
  assert.equal(T.readTour(), null);
  T.startTour();
  assert.deepEqual(T.readTour(), { status: 'active', step: 0 });
  T.goToStep(4);
  assert.deepEqual(T.readTour(), { status: 'active', step: 4 });
  T.dismissTour(4);
  assert.equal(T.readTour().status, 'dismissed');
  T.finishTour();
  assert.deepEqual(T.readTour(), { status: 'done', step: 6 });
});

test('corrupt or out-of-range storage is handled safely', () => {
  store.set(T.COMBO_TOUR_KEY, '{not json');
  assert.equal(T.readTour(), null);
  store.set(T.COMBO_TOUR_KEY, JSON.stringify({ status: 'active', step: 99 }));
  assert.equal(T.readTour().step, 6);
  store.set(T.COMBO_TOUR_KEY, JSON.stringify({ status: 'weird', step: 2 }));
  assert.equal(T.readTour().status, 'dismissed');
});

test('nextStepOnPage finds the neighbouring step on the same screen', () => {
  assert.equal(T.nextStepOnPage(3, -1, 'builder'), 3);
  assert.equal(T.nextStepOnPage(1, -1, 'builder'), -1);
  assert.equal(T.nextStepOnPage(2, -1, 'picker'), 1);
});

test('the tour is remembered per store: another store starts fresh', () => {
  T.setTourShop('a.myshopify.com');
  T.startTour();
  T.finishTour();
  assert.equal(T.readTour().status, 'done');
  T.setTourShop('b.myshopify.com');
  assert.equal(T.readTour(), null, 'a new store has no memory, so its first visit auto-starts the tour');
  T.setTourShop('a.myshopify.com');
  assert.equal(T.readTour().status, 'done');
  T.setTourShop('');
});
