// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// The Home loader awaits getAgencyStoreStatus before anything else, so these
// run it against a real local HTTP server (no fetch stub) to prove a slow or
// broken Agency Dashboard can't hold the page.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let mode = 'json';
const openSockets = new Set();

before(async () => {
  server = http.createServer((req, res) => {
    if (mode === 'hang') return; // accept the request and never answer
    if (mode === 'html') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body>404</body></html>');
      return;
    }
    if (mode === 'slow-body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"success":true,'); // headers + a partial body, then stall
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { stage: 'AUTHORIZATION_REQUIRED' } }));
  });
  server.on('connection', (s) => { openSockets.add(s); s.on('close', () => openSockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.AGENCY_DASHBOARD_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AGENCY_DASHBOARD_INTERNAL_SECRET = 'test-secret';
});

after(async () => {
  openSockets.forEach((s) => s.destroy());
  await new Promise((resolve) => server.close(resolve));
});

const { getAgencyStoreStatus } = await import('../../app/utils/agency-dashboard.server.js');

test('a healthy dashboard answer is passed through', async () => {
  mode = 'json';
  const status = await getAgencyStoreStatus('a.myshopify.com');
  assert.equal(status.stage, 'AUTHORIZATION_REQUIRED');
  assert.equal(status.shop, 'a.myshopify.com');
});

test('a dashboard that never answers fails open within the time limit instead of holding Home', async () => {
  mode = 'hang';
  const started = Date.now();
  const status = await getAgencyStoreStatus('a.myshopify.com', { timeoutMs: 200 });
  const elapsed = Date.now() - started;
  assert.equal(status.stage, 'ERROR', 'must degrade to ERROR so Home renders normally');
  assert.ok(elapsed < 1500, `took ${elapsed}ms — the limit is not being applied`);
});

test('a dashboard that sends headers then stalls mid-body is also cut off', async () => {
  mode = 'slow-body';
  const started = Date.now();
  const status = await getAgencyStoreStatus('a.myshopify.com', { timeoutMs: 200 });
  assert.equal(status.stage, 'ERROR');
  assert.ok(Date.now() - started < 1500);
});

test('an HTML page instead of JSON (a wrong or dev-tunnel URL) fails open without throwing', async () => {
  mode = 'html';
  const status = await getAgencyStoreStatus('a.myshopify.com');
  assert.equal(status.stage, 'ERROR');
});

test('the default limit is short enough that Home is never held for long', async () => {
  mode = 'hang';
  const started = Date.now();
  const status = await getAgencyStoreStatus('a.myshopify.com');
  const elapsed = Date.now() - started;
  assert.equal(status.stage, 'ERROR');
  assert.ok(elapsed >= 2500 && elapsed < 5000, `default limit took ${elapsed}ms`);
});
