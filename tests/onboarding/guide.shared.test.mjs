// Run with: node --test tests/onboarding
// Guided setup rules: payment → COD, setup order, saved state, patches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDE_MODULE_IDS, selectionForPayment, orderModules, sanitizeGuideState, applyGuidePatch,
  goToStepPatch, stepDonePatch, completeModulePatch, skipModulePatch, restartPatch, guideSummary,
  nextUnfinishedModule, moduleStatuses, stepOnPage, guideSteps,
} from '../../app/utils/guide.shared.js';
import { GUIDE_TOURS } from '../../app/config/guide-tours.js';

const NOW = new Date('2026-11-24T10:00:00Z');

test('payment answer: postpaid and both pick COD, prepaid does not', () => {
  assert.deepEqual(selectionForPayment('postpaid', []), { modules: ['cod'], codAuto: true });
  assert.deepEqual(selectionForPayment('both', ['cart']), { modules: ['cod', 'cart'], codAuto: true });
  assert.deepEqual(selectionForPayment('prepaid', []), { modules: [], codAuto: false });
  assert.deepEqual(selectionForPayment('prepaid', ['cart']), { modules: ['cart'], codAuto: false });
});

test('switching to prepaid drops COD only when the guide added it', () => {
  const auto = selectionForPayment('postpaid', ['fbt']);
  assert.deepEqual(selectionForPayment('prepaid', auto.modules, { codAuto: auto.codAuto }), { modules: ['fbt'], codAuto: false });
  // Picked by the merchant: stays.
  assert.deepEqual(selectionForPayment('prepaid', ['cod', 'fbt'], { codAuto: false }), { modules: ['cod', 'fbt'], codAuto: false });
  // Already picked before postpaid: not "auto", so it stays when going back to prepaid.
  const kept = selectionForPayment('postpaid', ['cod']);
  assert.equal(kept.codAuto, false);
});

test('setup order: feature order, COD first, unknown and repeated dropped', () => {
  assert.deepEqual(orderModules(['fbt', 'combo', 'cart', 'cod'], 'postpaid'), ['cod', 'cart', 'fbt', 'combo']);
  assert.deepEqual(orderModules(['brix_ai', 'nope', 'cart', 'cart'], 'prepaid'), ['cart', 'brix_ai']);
  assert.deepEqual(orderModules('cart', 'both'), []);
});

test('every feature has a tour: steps on its own pages, a save check last, real ids', () => {
  for (const id of GUIDE_MODULE_IDS) {
    const steps = GUIDE_TOURS[id]?.steps;
    assert.ok(steps && steps.length >= 3, id);
    // Home is reached through the feature card's Customize (the spotlight's pointer), never a step.
    assert.ok(steps.every((s) => s.route !== '/app'), `${id}: no step on Home`);
    assert.equal(steps.at(-1).kind, 'save', `${id} ends with the save check`);
    assert.equal(steps.filter((s) => s.kind === 'save').length, 1, `${id} has one save check`);
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, `${id} step ids are unique`);
    for (const s of steps) {
      assert.match(s.route, /^\/app(\/|$)/, `${id}.${s.id} route`);
      assert.match(s.target, /^[a-zA-Z0-9_-]+$/, `${id}.${s.id} target is a data-tour id`);
      if (s.reveal) assert.match(s.reveal, /^[a-zA-Z0-9_-]+$/);
      if (s.click) assert.match(s.click, /^[a-zA-Z0-9_-]+$/);
      assert.ok(s.title && s.body, `${id}.${s.id} has text`);
    }
  }
});

test('saved state: garbage in, valid state out', () => {
  const s = sanitizeGuideState({
    status: 'active', payment: 'both', modules: ['fbt', 'cod', 'x'], current: { module: 'fbt', step: 99 },
    progress: { fbt: { step: 2, done: ['template', 'zzz', 'template', 'interaction'], tour: 'weird' }, nope: { step: 1 } },
    collapsed: 'yes',
  });
  assert.deepEqual(s.modules, ['cod', 'fbt']);
  assert.equal(s.current.module, 'fbt');
  assert.equal(s.current.step, guideSteps('fbt').length - 1, 'step clamped to the tour');
  assert.deepEqual(s.progress.fbt.done, ['template', 'interaction']);
  assert.equal(s.progress.fbt.tour, 'in_progress');
  assert.equal(s.progress.nope, undefined);
  assert.equal(s.collapsed, false);
  assert.equal(sanitizeGuideState(null).status, 'new');
  assert.equal(sanitizeGuideState({ status: 'active', modules: [] }).status, 'new', 'nothing picked = not started');
});

test('running with no step picks the next feature, and ends when all are done', () => {
  const s = sanitizeGuideState({ status: 'active', payment: 'prepaid', modules: ['cart', 'fbt'], progress: { cart: { tour: 'completed' }, fbt: { tour: 'in_progress', step: 3 } } });
  assert.deepEqual(s.current, { module: 'fbt', step: 3 });
  const done = sanitizeGuideState({ status: 'active', payment: 'prepaid', modules: ['cart'], progress: { cart: { tour: 'completed' } } });
  assert.equal(done.status, 'completed');
  assert.equal(done.current, null);
});

test('only the server check can mark a feature set up', () => {
  const start = applyGuidePatch(null, { status: 'active', payment: 'postpaid', modules: ['cod', 'cart'], current: { module: 'cod', step: 0 } }, { now: NOW });
  assert.equal(start.startedAt, NOW.toISOString());
  const cheat = applyGuidePatch(start, { status: 'completed', progress: { cod: { tour: 'completed', verifiedAt: NOW.toISOString() } } }, { now: NOW });
  assert.equal(cheat.progress.cod.tour, 'in_progress');
  assert.equal(cheat.progress.cod.verifiedAt, null);
  assert.equal(cheat.status, 'active');
  const real = applyGuidePatch(start, completeModulePatch(start, 'cod', NOW), { now: NOW, trusted: true });
  assert.equal(real.progress.cod.tour, 'completed');
  assert.equal(real.progress.cod.verifiedAt, NOW.toISOString());
  assert.deepEqual(real.current, { module: 'cart', step: 0 }, 'moves on to the next picked feature');
  assert.equal(real.progress.cart.tour, 'in_progress');
  const last = applyGuidePatch(real, completeModulePatch(real, 'cart', NOW), { now: NOW, trusted: true });
  assert.equal(last.status, 'completed');
  assert.equal(last.current, null);
  assert.equal(last.completedAt, NOW.toISOString());
});

test('steps: go to, mark done, skip a feature, restart', () => {
  let s = applyGuidePatch(null, { status: 'active', payment: 'prepaid', modules: ['cart', 'fbt', 'packs'], current: { module: 'cart', step: 0 } }, { now: NOW });
  s = applyGuidePatch(s, stepDonePatch(s, 'cart', 'design'), { now: NOW });
  assert.equal(stepDonePatch(s, 'cart', 'design'), null, 'a step is counted once');
  s = applyGuidePatch(s, goToStepPatch(s, 'cart', 2), { now: NOW });
  assert.deepEqual(s.current, { module: 'cart', step: 2 });
  assert.equal(s.progress.cart.step, 2);
  s = applyGuidePatch(s, skipModulePatch(s, 'cart'), { now: NOW });
  assert.equal(s.progress.cart.tour, 'skipped');
  assert.deepEqual(s.current, { module: 'fbt', step: 0 });
  assert.equal(nextUnfinishedModule(s, 'fbt'), 'fbt' === s.current.module ? 'packs' : null);
  const sum = guideSummary(s);
  assert.equal(sum.modulesTotal, 3);
  assert.equal(sum.modulesDone, 0, 'a skipped feature is not set up');
  assert.equal(sum.perModule.cart.done, 1);
  s = applyGuidePatch(s, restartPatch(s), { now: NOW });
  assert.deepEqual(s.progress, {});
  assert.deepEqual(s.current, { module: 'cart', step: 0 });
  assert.equal(s.status, 'active');
  assert.deepEqual(s.modules, ['cart', 'fbt', 'packs'], 'restart keeps the answers');
});

test('skipping the last feature ends the guide', () => {
  const s = applyGuidePatch(null, { status: 'active', payment: 'prepaid', modules: ['coupon'], current: { module: 'coupon', step: 1 } }, { now: NOW });
  const after = applyGuidePatch(s, skipModulePatch(s, 'coupon'), { now: NOW });
  assert.equal(after.status, 'completed');
});

test('statuses stay separate: tour, configured, active', () => {
  const s = sanitizeGuideState({ status: 'active', payment: 'prepaid', modules: ['fbt'], progress: { fbt: { tour: 'completed' } } });
  assert.deepEqual(moduleStatuses(s, { fbt: { configured: true, active: false } }, 'fbt'), { tour: 'completed', configured: true, active: false });
  assert.deepEqual(moduleStatuses(s, {}, 'cart'), { tour: 'not_started', configured: null, active: null });
});

test('a step belongs to its page', () => {
  assert.ok(stepOnPage({ route: '/app' }, '/app/'));
  assert.ok(stepOnPage({ route: '/app/cartdrawer' }, '/app/cartdrawer'));
  assert.ok(!stepOnPage({ route: '/app/cod/customize' }, '/app/cod'));
  assert.ok(!stepOnPage(null, '/app'));
});
