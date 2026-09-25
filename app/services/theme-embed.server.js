// Is a given app embed switched on in the merchant's live theme?
//
// Read from the theme's config/settings_data.json (the same technique the FBT
// and Coupon Banner pages use). Deliberately optimistic: if the theme can't be
// read (missing scope, API error, timeout, unfamiliar structure) the result is
// `checked: false` and callers must NOT show a "not enabled" warning — we only
// ever warn when we successfully read the theme and confirmed the embed is off.

const API_VERSION = '2024-04';
const TIMEOUT_MS = 4000;

// settings_data.json keeps app embeds under `current.blocks`, and (depending on
// the theme) app blocks can also appear under sections. A block counts only
// when its type names this embed and it isn't disabled.
export function isEmbedEnabledInSettings(settingsData, handle) {
  const current = settingsData?.current || {};
  const blocks = [];
  Object.values(current.sections || {}).forEach((s) => Object.values(s?.blocks || {}).forEach((b) => blocks.push(b)));
  Object.values(current.blocks || {}).forEach((b) => blocks.push(b));
  const needle = String(handle).toLowerCase();
  return blocks.some((b) => b && !b.disabled && String(b.type || '').toLowerCase().includes(needle));
}

export async function getEmbedStatus(shop, accessToken, handle) {
  const headers = { 'X-Shopify-Access-Token': accessToken };
  const get = (path) => fetch(`https://${shop}/admin/api/${API_VERSION}/${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    const themesRes = await get('themes.json?role=main');
    if (!themesRes.ok) return { checked: false, enabled: true };
    const { themes } = await themesRes.json();
    const mainTheme = (themes || []).find((t) => t.role === 'main') || themes?.[0];
    if (!mainTheme) return { checked: false, enabled: true };

    const assetRes = await get(`themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`);
    if (!assetRes.ok) return { checked: false, enabled: true };
    const { asset } = await assetRes.json();
    if (!asset?.value) return { checked: false, enabled: true };
    return { checked: true, enabled: isEmbedEnabledInSettings(JSON.parse(asset.value), handle) };
  } catch {
    return { checked: false, enabled: true };
  }
}
