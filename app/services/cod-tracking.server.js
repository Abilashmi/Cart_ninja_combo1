/**
 * BRIX COD Checkout — server-side conversion events.
 *
 * COD orders are created with draftOrderComplete, so they never pass through
 * Shopify checkout and the merchant's Google / Meta apps never see them. The
 * popup (brix_cod.js) fires the browser events; this module sends the
 * server-side copy of the Purchase, which survives ad blockers and iOS:
 *
 *   GA4 Measurement Protocol  purchase / refund, transaction_id = order name
 *   Meta Conversions API      Purchase, event_id = brixcod_<order id>
 *
 * Both use the same ids as the browser events, so GA4 and Meta count each
 * order once. Nothing is sent without the shopper's consent (from Shopify's
 * Customer Privacy API in the browser), and personal data sent to Meta is
 * SHA-256 hashed as Meta requires.
 *
 * Pure helpers + fetch only: the caller (cod.server.js) loads settings and
 * secrets. Every send function resolves to a short status string and never
 * throws, so a tracking problem can never fail an order or a webhook.
 */
import crypto from 'node:crypto';
import { splitName, provinceCodeFor } from '../utils/cod.shared.js';

const SEND_TIMEOUT_MS = 8000;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';

// Overridable so tests can point the calls at a local server.
const ga4Base = () => (process.env.COD_GA4_MP_URL || 'https://www.google-analytics.com').replace(/\/$/, '');
const metaBase = () => (process.env.COD_META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');

const numericId = (gid) => String(gid || '').split('/').pop();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The id a catalog knows a line by: Shopify's channel format, the variant id, or the SKU. */
export function catalogItemId(line, format = 'shopify') {
  if (format === 'sku' && line.sku) return line.sku;
  if (format === 'shopify' && line.productId && line.variantId) return `shopify_IN_${line.productId}_${line.variantId}`;
  return String(line.variantId || line.sku || line.title || '');
}

export function metaEventId(orderId) {
  return `brixcod_${numericId(orderId)}`;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const norm = (value) => String(value || '').trim().toLowerCase();

/** Meta's customer-information parameters, normalised then hashed (only non-empty ones). */
export function metaUserData({ phone, address = {}, track = {}, clientIp, userAgent }) {
  const { firstName, lastName } = splitName(address.name);
  const plain = {
    ph: phone ? `91${phone}` : '',
    em: norm(address.email),
    fn: norm(firstName),
    ln: norm(lastName),
    ct: norm(address.city).replace(/[^\p{L}\p{N}]/gu, ''),
    st: norm(provinceCodeFor(address.state) || address.state).replace(/[^\p{L}\p{N}]/gu, ''),
    zp: norm(address.pincode),
    country: 'in',
  };
  const out = {};
  for (const [key, value] of Object.entries(plain)) if (value) out[key] = [sha256(value)];
  if (clientIp && clientIp !== 'unknown') out.client_ip_address = clientIp;
  if (userAgent) out.client_user_agent = userAgent;
  if (track.fbp) out.fbp = track.fbp;
  if (track.fbc) out.fbc = track.fbc;
  return out;
}

export function ga4PurchasePayload({ settings, order, quote, track }) {
  const items = (quote?.lines || []).map((line) => ({
    item_id: catalogItemId(line, settings.tracking.metaContentId),
    item_name: line.title,
    ...(line.variantTitle ? { item_variant: line.variantTitle } : {}),
    price: round2(line.unitPrice ?? (line.total / (line.quantity || 1))),
    quantity: line.quantity,
  }));
  return {
    client_id: track.gaClientId,
    consent: { ad_user_data: track.consent?.marketing ? 'GRANTED' : 'DENIED', ad_personalization: track.consent?.marketing ? 'GRANTED' : 'DENIED' },
    events: [{
      name: 'purchase',
      params: {
        transaction_id: order.orderName,
        value: round2(order.total),
        currency: order.currency,
        tax: round2(quote?.tax),
        shipping: round2((quote?.shipping || 0) + (quote?.codFee || 0)),
        ...(quote?.coupon?.applied ? { coupon: quote.coupon.code } : {}),
        payment_type: 'Cash on Delivery',
        items,
        ...(track.gaSessionId ? { session_id: track.gaSessionId } : {}),
        engagement_time_msec: 1,
      },
    }],
  };
}

export function metaPurchasePayload({ settings, secrets, order, quote, phone, address, track, clientIp, userAgent, now = Date.now() }) {
  const lines = quote?.lines || [];
  const format = settings.tracking.metaContentId;
  return {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(now / 1000),
      event_id: metaEventId(order.orderId),
      action_source: 'website',
      ...(track.pageUrl ? { event_source_url: track.pageUrl } : {}),
      user_data: metaUserData({ phone, address, track, clientIp, userAgent }),
      custom_data: {
        value: round2(order.total),
        currency: order.currency,
        content_type: 'product',
        content_ids: lines.map((l) => catalogItemId(l, format)),
        contents: lines.map((l) => ({ id: catalogItemId(l, format), quantity: l.quantity, item_price: round2(l.unitPrice ?? (l.total / (l.quantity || 1))) })),
        num_items: lines.reduce((n, l) => n + (l.quantity || 0), 0),
        order_id: order.orderName,
      },
    }],
    ...(secrets.metaTestCode ? { test_event_code: secrets.metaTestCode } : {}),
  };
}

async function post(url, body, label) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { status: 'sent', json };
    console.warn(`[cod-tracking] ${label} rejected:`, res.status, JSON.stringify(json).slice(0, 300));
    return { status: 'rejected', json };
  } catch (error) {
    console.warn(`[cod-tracking] ${label} unreachable:`, String(error?.message || error).slice(0, 200));
    return { status: 'failed', json: null };
  }
}

function ga4Url(settings, secrets, debug = false) {
  const url = new URL(`${ga4Base()}${debug ? '/debug' : ''}/mp/collect`);
  url.searchParams.set('measurement_id', settings.tracking.ga4Id);
  url.searchParams.set('api_secret', secrets.ga4ApiSecret);
  return url.toString();
}

function metaUrl(settings, secrets) {
  const url = new URL(`${metaBase()}/${META_GRAPH_VERSION}/${settings.tracking.metaPixelId}/events`);
  url.searchParams.set('access_token', secrets.metaCapiToken);
  return url.toString();
}

/**
 * Server-side Purchase for a newly placed COD order.
 * Resolves to { ga4, meta }, each one of: sent | rejected | failed | off | no_consent | no_client_id.
 */
export async function sendCodPurchaseEvents({ settings, secrets = {}, order, quote, phone, address, track, clientIp, userAgent }) {
  const t = settings?.tracking || {};
  const tr = track || { consent: {} };

  let ga4 = 'off';
  if (t.ga4Id && secrets.ga4ApiSecret) {
    if (!tr.consent?.analytics) ga4 = 'no_consent';
    else if (!tr.gaClientId) ga4 = 'no_client_id'; // a made-up id would break attribution
    else ga4 = post(ga4Url(settings, secrets), ga4PurchasePayload({ settings, order, quote, track: tr }), 'GA4 purchase');
  }

  let meta = 'off';
  if (t.metaPixelId && secrets.metaCapiToken) {
    if (!tr.consent?.marketing) meta = 'no_consent';
    else meta = post(metaUrl(settings, secrets), metaPurchasePayload({ settings, secrets, order, quote, phone, address, track: tr, clientIp, userAgent }), 'Meta CAPI Purchase');
  }

  const [g, m] = await Promise.all([ga4, meta]);
  return { ga4: typeof g === 'string' ? g : g.status, meta: typeof m === 'string' ? m : m.status };
}

/**
 * GA4 refund for a COD order Shopify cancelled or refunded, so GA revenue
 * reflects returns. GA matches it to the purchase by transaction_id alone, so
 * any client_id works. Meta has no refund event.
 */
export async function sendCodRefundEvent({ settings, secrets = {}, orderName, value, currency }) {
  if (!settings?.tracking?.ga4Id || !secrets.ga4ApiSecret || !orderName) return 'off';
  const payload = {
    client_id: `brixcod.${crypto.randomInt(1, 2 ** 31)}`,
    events: [{ name: 'refund', params: { transaction_id: orderName, value: round2(value), currency, engagement_time_msec: 1 } }],
  };
  return (await post(ga4Url(settings, secrets), payload, 'GA4 refund')).status;
}

/**
 * Admin "Send test events" button. GA4 goes to the validation endpoint
 * (nothing is recorded, it returns problems); Meta goes to the real endpoint
 * with the merchant's test event code, so it shows only under Test events.
 * Returns { ga4: {status, message}, meta: {status, message} }.
 */
export async function sendCodTestEvents({ settings, secrets = {} }) {
  const t = settings?.tracking || {};
  const order = { orderId: `gid://shopify/Order/${Date.now()}`, orderName: '#BRIX-TEST', total: 499, currency: 'INR' };
  const quote = { lines: [{ title: 'BRIX test product', quantity: 1, total: 499, unitPrice: 499, variantId: '1', productId: '1' }], tax: 0, shipping: 0, codFee: 0 };
  const track = { gaClientId: `${crypto.randomInt(1, 2 ** 31)}.${Math.floor(Date.now() / 1000)}`, consent: { analytics: true, marketing: true } };

  let ga4 = { status: 'off', message: 'Add a GA4 Measurement ID and API secret first.' };
  if (t.ga4Id && secrets.ga4ApiSecret) {
    const res = await post(ga4Url(settings, secrets, true), ga4PurchasePayload({ settings, order, quote, track }), 'GA4 test');
    const problems = res.json?.validationMessages || [];
    ga4 = res.status !== 'sent'
      ? { status: 'failed', message: "Google didn't accept the request. Check the Measurement ID." }
      : problems.length
        ? { status: 'rejected', message: problems.map((p) => p.description).join(' ').slice(0, 300) }
        : { status: 'sent', message: 'Google accepted a test purchase. Real orders will show in GA4 → Reports → Monetization.' };
  }

  let meta = { status: 'off', message: 'Add a Meta Pixel ID and Conversions API token first.' };
  if (t.metaPixelId && secrets.metaCapiToken) {
    if (!secrets.metaTestCode) {
      meta = { status: 'off', message: 'Add a test event code from Events Manager → Test events, so the test purchase stays out of your real data.' };
    } else {
      const res = await post(metaUrl(settings, secrets), metaPurchasePayload({
        settings, secrets, order, quote, phone: '9999999999', address: { name: 'Brix Test', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' }, track, clientIp: null, userAgent: 'BRIX test',
      }), 'Meta test');
      meta = res.status === 'sent'
        ? { status: 'sent', message: 'Meta accepted a test Purchase. It should appear in Events Manager → Test events within a minute.' }
        : { status: res.status, message: String(res.json?.error?.message || "Meta didn't accept the request. Check the Pixel ID and token.").slice(0, 300) };
    }
  }
  return { ga4, meta };
}
