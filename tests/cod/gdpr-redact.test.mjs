/* eslint-env node */
// Run with: node --import ./tests/packs/register.mjs --test tests/cod/gdpr-redact.test.mjs
// Shopify's privacy webhooks done for real (php_backend/gdpr_lib.php through
// customers-redact.php / shop-redact.php / customers-data-request.php) on a
// throwaway MariaDB (php-harness.mjs), plus the Node side
// (services/compliance.server.js) against those same PHP files.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { harnessAvailable, startHarness } from './php-harness.mjs';

if (!harnessAvailable()) {
  console.log('SKIP gdpr-redact tests: PHP / MariaDB binaries not found.');
  process.exit(0);
}

const harness = await startHarness({ portOffset: 5, extraFiles: ['gdpr_lib.php', 'customers-redact.php', 'shop-redact.php', 'customers-data-request.php', 'install_shop.php', 'uninstall_shop.php'] });
after(() => harness.stop());
process.env.PHP_BASE_URL = harness.baseUrl;
process.env.BRIX_INTERNAL_SECRET = harness.secret;
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.CUSTOMER_DATA_KEY = crypto.randomBytes(32).toString('base64');

const sql = (q, p = []) => harness.db.query(q, p).then(([rows]) => rows);
const A = 'alpha.myshopify.com';
const B = 'beta.myshopify.com';
const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PHONE_HASH = hex('asha-phone');
const OTHER_HASH = hex('ravi-phone');

const DDL = [
  `CREATE TABLE cod_orders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop VARCHAR(255) NOT NULL, idem_key VARCHAR(64) NOT NULL, phone_hash CHAR(64) NOT NULL, phone_masked VARCHAR(16) NOT NULL, customer_name VARCHAR(120) NULL, pincode VARCHAR(10) NULL, total DECIMAL(12,2) NULL, draft_order_id VARCHAR(64) NULL, order_id VARCHAR(64) NULL, order_name VARCHAR(32) NULL)`,
  `CREATE TABLE cod_otp (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop VARCHAR(255) NOT NULL, phone_hash CHAR(64) NOT NULL, code_hash CHAR(64) NOT NULL)`,
  `CREATE TABLE partial_cod_orders (code VARCHAR(32) PRIMARY KEY, shop VARCHAR(255) NOT NULL, order_id VARCHAR(64) NULL, order_name VARCHAR(64) NULL, customer_name VARCHAR(120) NULL, pincode VARCHAR(10) NULL, advance DECIMAL(12,2) NOT NULL DEFAULT 0)`,
  `CREATE TABLE store_orders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, order_id VARCHAR(64) NOT NULL, order_number VARCHAR(64) NULL, total_price DECIMAL(12,2) NOT NULL, UNIQUE KEY u (shop_domain, order_id))`,
  `CREATE TABLE store_order_line_items (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, order_id VARCHAR(64) NOT NULL, line_item_id VARCHAR(64) NOT NULL, product_title VARCHAR(500) NOT NULL DEFAULT '', UNIQUE KEY u (shop_domain, order_id, line_item_id))`,
  `CREATE TABLE store_order_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, order_id VARCHAR(64) NOT NULL, revenue DECIMAL(12,2) NOT NULL)`,
  `CREATE TABLE customer_addresses (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, scope VARCHAR(10) NOT NULL DEFAULT 'store', phone_hash CHAR(64) NOT NULL, address_hash CHAR(64) NOT NULL, email_hash CHAR(64) NULL, customer_hash CHAR(64) NULL, order_hash CHAR(64) NULL, payload_enc TEXT NOT NULL, source VARCHAR(20) NOT NULL DEFAULT 'order', orders_count INT UNSIGNED NOT NULL DEFAULT 1, first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, UNIQUE KEY u (shop_domain, scope, phone_hash, address_hash))`,
  `CREATE TABLE ai_conversations (id VARCHAR(40) PRIMARY KEY, shopDomain VARCHAR(255) NOT NULL)`,
  `CREATE TABLE ai_messages (id VARCHAR(40) PRIMARY KEY, conversationId VARCHAR(40) NOT NULL, message TEXT)`,
  `CREATE TABLE support_chat_conversations (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop VARCHAR(255) NOT NULL)`,
  `CREATE TABLE support_chat_messages (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, conversation_id BIGINT UNSIGNED NOT NULL, body TEXT)`,
  `CREATE TABLE coupon_slider_widget (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shopDomain VARCHAR(255) NOT NULL)`,
  `CREATE TABLE cart_click_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_id VARCHAR(64) NULL, domain VARCHAR(255) NULL)`,
  `CREATE TABLE order_overage_charges (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, charge_amount DECIMAL(12,2) NOT NULL)`,
  `CREATE TABLE gdpr_redactions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, customer_id VARCHAR(64) NULL, customer_email VARCHAR(255) NULL)`,
];
const TABLES = ['cod_orders', 'cod_otp', 'partial_cod_orders', 'store_orders', 'store_order_line_items', 'store_order_events', 'customer_addresses', 'ai_conversations', 'ai_messages', 'support_chat_conversations', 'support_chat_messages', 'coupon_slider_widget', 'cart_click_events', 'order_overage_charges', 'gdpr_redactions', 'gdpr_log'];

beforeEach(async () => {
  for (const t of TABLES) await sql(`DROP TABLE IF EXISTS ${t}`);
  for (const d of DDL) await sql(d);
  await sql('DELETE FROM shops');
  for (const shop of [A, B]) {
    await sql('INSERT INTO cod_orders (shop, idem_key, phone_hash, phone_masked, customer_name, pincode, total, draft_order_id, order_id, order_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [shop, 'k1', PHONE_HASH, '98xxxxxx10', 'Asha Rao', '600001', 1499, 'gid://shopify/DraftOrder/9', '111', '#1001']);
    await sql('INSERT INTO cod_orders (shop, idem_key, phone_hash, phone_masked, customer_name, pincode, total, order_id, order_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [shop, 'k2', OTHER_HASH, '91xxxxxx80', 'Ravi K', '560001', 799, '222', '#1002']);
    await sql('INSERT INTO cod_otp (shop, phone_hash, code_hash) VALUES (?, ?, ?), (?, ?, ?)', [shop, PHONE_HASH, hex('1'), shop, OTHER_HASH, hex('2')]);
    await sql('INSERT INTO partial_cod_orders (code, shop, order_id, order_name, customer_name, pincode, advance) VALUES (?, ?, ?, ?, ?, ?, 100), (?, ?, ?, ?, ?, ?, 100)', [`P-${shop}-1`, shop, 'gid://shopify/Order/333', '#1003', 'Asha Rao', '600001', `P-${shop}-2`, shop, '444', '#1004', 'Ravi K', '560001']);
    for (const id of ['111', '333', '222']) {
      await sql('INSERT INTO store_orders (shop_domain, order_id, order_number, total_price) VALUES (?, ?, ?, 500)', [shop, id, `#${id}`]);
      await sql('INSERT INTO store_order_line_items (shop_domain, order_id, line_item_id, product_title) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', [shop, id, `${id}-1`, 'Saree', shop, id, `${id}-2`, 'Blouse']);
      await sql('INSERT INTO store_order_events (shop_domain, order_id, revenue) VALUES (?, ?, 500)', [shop, id]);
    }
    await sql("INSERT INTO customer_addresses (shop_domain, scope, phone_hash, address_hash, payload_enc, expires_at) VALUES (?, 'store', ?, ?, 'v1:x', NOW() + INTERVAL 1 YEAR), (?, 'brix', ?, ?, 'v1:y', NOW() + INTERVAL 1 YEAR)", [shop, hex('p'), hex(`a-${shop}`), shop, hex('p'), hex(`b-${shop}`)]);
    await sql('INSERT INTO ai_conversations (id, shopDomain) VALUES (?, ?)', [`c-${shop}`, shop]);
    await sql('INSERT INTO ai_messages (id, conversationId, message) VALUES (?, ?, ?)', [`m-${shop}`, `c-${shop}`, 'hi']);
    const [conv] = await harness.db.query('INSERT INTO support_chat_conversations (shop) VALUES (?)', [shop]);
    await sql('INSERT INTO support_chat_messages (conversation_id, body) VALUES (?, ?)', [conv.insertId, 'help']);
    await sql('INSERT INTO coupon_slider_widget (shopDomain) VALUES (?)', [shop]);
    await sql('INSERT INTO cart_click_events (shop_id, domain) VALUES (?, ?)', ['1', shop]);
    await sql('INSERT INTO order_overage_charges (shop_domain, charge_amount) VALUES (?, 25)', [shop]);
    await sql('INSERT INTO shops (shop_domain, plan_name) VALUES (?, ?)', [shop, 'pro']);
  }
  await sql("INSERT INTO gdpr_redactions (shop_domain, customer_id, customer_email) VALUES (?, '5', 'old@example.com')", [A]);
});

const post = (file, body, secret = harness.secret) => fetch(`${harness.baseUrl}/${file}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Brix-Internal-Secret': secret } : {}) },
  body: JSON.stringify(body),
});

test('the deletion and install endpoints refuse anyone without the internal secret', async () => {
  for (const file of ['customers-redact.php', 'shop-redact.php', 'customers-data-request.php', 'install_shop.php', 'uninstall_shop.php']) {
    for (const secret of ['', 'wrong-secret-wrong-secret-wrong-secret']) {
      const res = await post(file, { shop_domain: A, shop: A }, secret);
      assert.equal(res.status, 403, `${file} without the secret`);
    }
  }
  assert.equal((await sql('SELECT COUNT(*) n FROM cod_orders'))[0].n, 4, 'nothing touched');
  assert.equal((await post('shop-redact.php', { shop_domain: 'not a shop' })).status, 400);
  assert.equal((await fetch(`${harness.baseUrl}/shop-redact.php`)).status, 405);
});

test('customers/redact: that shopper loses name, PIN, phone and order refs; others and the other store keep theirs', async () => {
  const res = await post('customers-redact.php', { shop_domain: A, cod_phone_hash: PHONE_HASH, orders_to_redact: [111, 'gid://shopify/Order/333'] });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.success, true);

  const [asha] = await sql("SELECT * FROM cod_orders WHERE shop = ? AND idem_key = 'k1'", [A]);
  assert.deepEqual([asha.customer_name, asha.pincode, asha.phone_masked, asha.order_id, asha.order_name, asha.draft_order_id], [null, null, '', null, null, null]);
  assert.notEqual(asha.phone_hash, PHONE_HASH);
  assert.equal(Number(asha.total), 1499, 'the merchant\'s COD totals stay');
  const [ravi] = await sql("SELECT customer_name, phone_hash FROM cod_orders WHERE shop = ? AND idem_key = 'k2'", [A]);
  assert.deepEqual([ravi.customer_name, ravi.phone_hash], ['Ravi K', OTHER_HASH]);
  assert.deepEqual((await sql('SELECT phone_hash FROM cod_otp WHERE shop = ?', [A])).map((r) => r.phone_hash), [OTHER_HASH]);

  const partial = await sql('SELECT code, customer_name, pincode, order_id FROM partial_cod_orders WHERE shop = ? ORDER BY code', [A]);
  assert.deepEqual(partial.map((r) => [r.customer_name, r.pincode, r.order_id]), [[null, null, null], ['Ravi K', '560001', '444']]);

  const orders = await sql('SELECT order_id, order_number, total_price FROM store_orders WHERE shop_domain = ? ORDER BY id', [A]);
  assert.equal(orders[2].order_id, '222', 'other orders keep their id');
  for (const o of orders.slice(0, 2)) {
    assert.match(o.order_id, /^redacted-[0-9a-f]{24}$/);
    assert.equal(o.order_number, null);
    assert.equal(Number(o.total_price), 500, 'revenue unchanged');
    assert.equal((await sql('SELECT COUNT(*) n FROM store_order_line_items WHERE shop_domain = ? AND order_id = ?', [A, o.order_id]))[0].n, 2, 'lines follow their order');
    assert.equal((await sql('SELECT COUNT(*) n FROM store_order_events WHERE shop_domain = ? AND order_id = ?', [A, o.order_id]))[0].n, 1);
  }
  assert.notEqual(orders[0].order_id, orders[1].order_id);

  // Store B untouched.
  assert.equal((await sql("SELECT customer_name FROM cod_orders WHERE shop = ? AND idem_key = 'k1'", [B]))[0].customer_name, 'Asha Rao');
  assert.equal((await sql("SELECT COUNT(*) n FROM store_orders WHERE shop_domain = ? AND order_id LIKE 'redacted-%'", [B]))[0].n, 0);

  // The log says it happened, without who; the old log's plain email is gone.
  const log = await sql('SELECT * FROM gdpr_log');
  assert.deepEqual(log.map((r) => [r.topic, r.shop_domain, r.orders_count]), [['customers/redact', A, 2]]);
  assert.ok(!JSON.stringify(log).includes(PHONE_HASH));
  assert.equal((await sql('SELECT customer_email FROM gdpr_redactions'))[0].customer_email, null);
});

test('shop/redact: every table with a shop column, chat children too; billing, BRIX-saved addresses and the other store stay', async () => {
  const res = await post('shop-redact.php', { shop_domain: A });
  assert.equal(res.status, 200);
  const counts = async (shop) => Object.fromEntries(await Promise.all([
    ['cod_orders', 'shop'], ['cod_otp', 'shop'], ['partial_cod_orders', 'shop'], ['store_orders', 'shop_domain'], ['store_order_line_items', 'shop_domain'],
    ['store_order_events', 'shop_domain'], ['ai_conversations', 'shopDomain'], ['support_chat_conversations', 'shop'], ['coupon_slider_widget', 'shopDomain'],
    ['cart_click_events', 'domain'], ['shops', 'shop_domain'], ['order_overage_charges', 'shop_domain'],
  ].map(async ([t, c]) => [t, (await sql(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = ?`, [shop]))[0].n])));
  const a = await counts(A);
  assert.equal(a.order_overage_charges, 1, 'billing records are kept');
  delete a.order_overage_charges;
  assert.ok(Object.values(a).every((n) => n === 0), JSON.stringify(a));
  assert.deepEqual((await sql('SELECT scope FROM customer_addresses WHERE shop_domain = ?', [A])).map((r) => r.scope), ['brix']);
  assert.deepEqual((await sql('SELECT id FROM ai_messages')).map((r) => r.id), [`m-${B}`]);
  assert.equal((await sql('SELECT COUNT(*) n FROM support_chat_messages'))[0].n, 1);
  const b = await counts(B);
  assert.ok(Object.values(b).every((n) => n > 0), JSON.stringify(b));
  assert.deepEqual((await sql('SELECT topic, shop_domain FROM gdpr_log')).map((r) => [r.topic, r.shop_domain]), [['shop/redact', A]]);
});

test('customers/data_request: logged with the request id only', async () => {
  assert.equal((await post('customers-data-request.php', { shop_domain: A, data_request_id: '9988', orders_count: 3 })).status, 200);
  const [row] = await sql('SELECT topic, shop_domain, request_ref, orders_count FROM gdpr_log');
  assert.deepEqual({ ...row }, { topic: 'customers/data_request', shop_domain: A, request_ref: '9988', orders_count: 3 });
});

test('Node: the webhook payload becomes the same COD phone hash, order ids, and nothing else', async () => {
  const { redactCustomer, redactShop, recordDataRequest } = await import('../../app/services/compliance.server.js');
  const { phoneHash } = await import('../../app/services/cod.server.js');
  const sent = [];
  const spy = async (url, init) => { sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return fetch(url, init); };
  const fakeDb = { execute: async () => [{ affectedRows: 0 }] };
  const payload = { customer: { id: 77, email: 'asha@example.com', phone: '+91 98765 43210' }, orders_to_redact: [111, 333] };
  await sql('UPDATE cod_orders SET phone_hash = ? WHERE idem_key = ?', [phoneHash(A, '9876543210'), 'k1']);

  const out = await redactCustomer(A, payload, { fetchImpl: spy, db: fakeDb });
  assert.deepEqual(sent[0].body, { shop_domain: A, cod_phone_hash: phoneHash(A, '9876543210'), orders_to_redact: ['111', '333'] });
  assert.equal(sent[0].headers['X-Brix-Internal-Secret'], harness.secret);
  assert.ok(!JSON.stringify(sent[0]).includes('asha@example.com'), 'the email never leaves Node');
  assert.equal(out.changed.cod_orders, 1);
  assert.equal((await sql("SELECT customer_name FROM cod_orders WHERE shop = ? AND idem_key = 'k1'", [A]))[0].customer_name, null);

  await recordDataRequest(A, { data_request: { id: 5 }, orders_requested: [1, 2] }, { fetchImpl: spy });
  assert.deepEqual(sent[1].body, { shop_domain: A, data_request_id: '5', orders_count: 2 });

  let deletedSessionsFor = null;
  const sessions = { session: { deleteMany: async ({ where }) => { deletedSessionsFor = where.shop; return { count: 2 }; } } };
  const shopOut = await redactShop(B, { fetchImpl: spy, sessions });
  assert.equal(deletedSessionsFor, B);
  assert.equal(shopOut.sessionsDeleted, 2);
  assert.equal((await sql('SELECT COUNT(*) n FROM cod_orders WHERE shop = ?', [B]))[0].n, 0);
});

test('Node: a failing PHP call is retried, then reported', async () => {
  const { redactShop } = await import('../../app/services/compliance.server.js');
  let calls = 0;
  const flaky = async (url, init) => { calls += 1; return calls < 3 ? new Response('busy', { status: 503 }) : fetch(url, init); };
  await redactShop(A, { fetchImpl: flaky, retry: { delayMs: 1 } });
  assert.equal(calls, 3);
  const down = async () => new Response('down', { status: 503 });
  await assert.rejects(redactShop(A, { fetchImpl: down, retry: { attempts: 2, delayMs: 1 } }), /shop-redact\.php answered 503/);
});
