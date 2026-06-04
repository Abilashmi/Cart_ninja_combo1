const PHP_BASE = 'https://int.thecartninja.com';

export async function sendToPhp(endpoint, payload) {
  const res = await fetch(`${PHP_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PHP request failed: ${res.status}`);
  return res.json();
}

export async function fetchBundleTemplates(shop) {
  const url = new URL('/api/bundle-templates', window.location.origin);
  url.searchParams.set('shop', shop);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch bundle templates');
  return res.json();
}

export async function saveBundleTemplate(data, extraHeaders = {}) {
  const res = await fetch('/api/bundle-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Save failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteBundleTemplate(id) {
  const res = await fetch('/api/bundle-templates', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

export async function fetchBundleAnalytics(shop) {
  const url = new URL('/api/bundle-analytics', window.location.origin);
  url.searchParams.set('shop', shop);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch analytics');
  return res.json();
}

export async function getBundleEmbedStatus(shop) {
  try {
    const res = await fetch(
      `https://int.thecartninja.com/combo_embed_status.php?shop=${encodeURIComponent(shop)}`,
      { headers: { 'ngrok-skip-browser-warning': 'true' } }
    );
    if (!res.ok) return { embedded: false };
    return res.json();
  } catch {
    return { embedded: false };
  }
}

export async function setBundleEmbedStatus(shop, embedded) {
  const res = await fetch('https://int.thecartninja.com/combo_embed_status.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify({ shop, embedded: embedded ? 1 : 0 }),
  });
  if (!res.ok) throw new Error('Failed to update embed status');
  return res.json();
}
