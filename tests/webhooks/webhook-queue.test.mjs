// Run with: node --import ./tests/packs/register.mjs --test tests/webhooks
// Webhooks answer Shopify at once and do their DB work after
// (app/services/webhook-queue.server.js): at most 4 tasks at a time, a
// failing task never stops the rest. An order's line items go to the DB in
// one statement (order-ingest.server.js), not one round trip per item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterResponse } from '../../app/services/webhook-queue.server.js';
import { upsertOrderFromPayload } from '../../app/services/order-ingest.server.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('queue: every task runs, at most 4 at once, a failure does not stop the rest', async () => {
  let running = 0, peak = 0, done = 0;
  const errors = console.error;
  console.error = () => {};
  for (let i = 0; i < 20; i += 1) {
    afterResponse(`t${i}`, async () => {
      running += 1; peak = Math.max(peak, running);
      await tick(5);
      running -= 1; done += 1;
      if (i === 3) throw new Error('boom');
    });
  }
  for (let i = 0; i < 100 && done < 20; i += 1) await tick(5);
  console.error = errors;
  assert.equal(done, 20);
  assert.equal(peak, 4);
});

test('order ingest: all line items in one INSERT', async () => {
  const statements = [];
  const db = { execute: async (sql, params) => { statements.push({ sql, params }); return /^\s*SELECT/i.test(sql) ? [[]] : [{ affectedRows: 1 }]; } };
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: n, product_id: 100 + n, variant_id: 200 + n, title: `Item ${n}`, quantity: 2, price: '10.00', total_discount: '1.00' }));
  await upsertOrderFromPayload(db, 'a.myshopify.com', { id: 9001, created_at: '2026-10-29T05:00:00Z', total_price: '150', line_items: items });
  const lineInserts = statements.filter((s) => /INSERT INTO store_order_line_items/.test(s.sql));
  assert.equal(lineInserts.length, 1, 'one statement for 8 items');
  assert.equal(lineInserts[0].params.length, 8 * 12);
  assert.equal((lineInserts[0].sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g) || []).length, 8);
  assert.deepEqual(lineInserts[0].params.slice(0, 12), ['a.myshopify.com', '9001', '1', '101', '201', 'Item 1', null, 2, 10, 1, 19, '2026-10-29 05:00:00']);
});
