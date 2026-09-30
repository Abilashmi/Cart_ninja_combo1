// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';

import { withTimeout, TIMED_OUT } from '../../app/utils/with-timeout.js';

test('a promise that settles in time passes its value straight through', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000, null);
  assert.equal(result, 'ok');
});

test('a promise that never settles resolves to the fallback instead of hanging', async () => {
  const never = new Promise(() => {});
  const result = await withTimeout(never, 10, null);
  assert.equal(result, null, 'this is the whole point — a hang must not stay a hang');
});

test('the default fallback is the TIMED_OUT marker, distinguishable from a real null', async () => {
  const result = await withTimeout(new Promise(() => {}), 10);
  assert.equal(result, TIMED_OUT);
});

test('a rejection still rejects rather than being swallowed as a timeout', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('boom')), 1000, null),
    /boom/,
    'a genuine failure must stay visible, not get silently converted into the fallback'
  );
});

test('the pending timer does not keep the event loop alive after the promise wins', async () => {
  // If the timer were left dangling, a long timeout would hold the process
  // (and in a server handler, the request) open well past the real work.
  const started = Date.now();
  await withTimeout(Promise.resolve('fast'), 60_000, null);
  assert.ok(Date.now() - started < 1000);
});
