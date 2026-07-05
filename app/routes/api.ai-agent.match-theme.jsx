import { authenticate } from '../shopify.server';
import { sendToPhp } from '../utils/api-helpers';

function normalizeHex(v) {
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('');
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return null;
}

// Walks the theme's parsed settings_data.json ("current" node) and collects
// every [lowercased key, hex value] pair, from both modern color_schemes
// blocks and legacy flat theme settings — key names vary a lot per theme.
function collectHexCandidates(node, out) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      const hex = normalizeHex(value.trim());
      if (hex) out.push([key.toLowerCase(), hex]);
    } else if (typeof value === 'object' && value !== null) {
      collectHexCandidates(value, out);
    }
  }
}

function pickColor(candidates, keywords, exclude = []) {
  for (const [key, value] of candidates) {
    if (keywords.some(k => key.includes(k)) && !exclude.some(e => key.includes(e))) {
      return value;
    }
  }
  return null;
}

// Fallback for themes whose settings_data.json yields nothing usable — scrape
// the live storefront's linked stylesheets for CSS custom properties, e.g.
// `--color-base-accent-1: 24, 24, 43;` (Dawn) or `--color-background: #fff;`.
const CSS_VAR_RE = /--([\w-]+)\s*:\s*([^;]+);/g;

function cssValueToHex(rawValue) {
  const v = rawValue.trim();
  const hex = normalizeHex(v);
  if (hex) return hex;
  const rgb = v.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (rgb) {
    const [, r, g, b] = rgb;
    return '#' + [r, g, b].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

async function fetchText(url, accessToken) {
  try {
    const res = await fetch(url, {
      headers: accessToken
        ? { 'X-Shopify-Access-Token': accessToken }
        : { 'User-Agent': 'Mozilla/5.0 (compatible; BrixThemeDetector/1.0)' },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function detectFromThemeSettings(shop, accessToken) {
  const themesRes = await fetch(
    `https://${shop}/admin/api/2024-04/themes.json?role=main`,
    { headers: { 'X-Shopify-Access-Token': accessToken } }
  );
  if (!themesRes.ok) return null;
  const { themes } = await themesRes.json();
  const mainTheme = (themes || []).find(t => t.role === 'main') || themes?.[0];
  if (!mainTheme) return null;

  const assetRes = await fetch(
    `https://${shop}/admin/api/2024-04/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
    { headers: { 'X-Shopify-Access-Token': accessToken } }
  );
  if (!assetRes.ok) return null;
  const { asset } = await assetRes.json();
  let settingsData;
  try { settingsData = JSON.parse(asset?.value || '{}'); } catch { return null; }

  const candidates = [];
  collectHexCandidates(settingsData.current || {}, candidates);
  if (candidates.length === 0) return null;

  const headerBgColor = pickColor(candidates, ['background', 'bg']);
  const headerTextColor = pickColor(candidates, ['text'], ['button']);
  const checkoutBgColor = pickColor(candidates, ['button', 'accent', 'primary'], ['label']);
  const checkoutTextColor = pickColor(candidates, ['button_label', 'button-label', 'buttonlabel']);

  if (!headerBgColor && !checkoutBgColor) return null;
  return {
    headerBgColor: headerBgColor || '#ffffff',
    headerTextColor: headerTextColor || '#1a1a1a',
    checkoutBgColor: checkoutBgColor || '#1a1a1a',
    checkoutTextColor: checkoutTextColor || '#ffffff',
  };
}

async function detectFromLiveCss(storeUrl) {
  const html = await fetchText(storeUrl);
  if (!html) return null;

  const linkHrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)]
    .map(m => m[1])
    .map(href => {
      try { return new URL(href, storeUrl).toString(); } catch { return null; }
    })
    .filter(Boolean)
    .slice(0, 6);

  const cssTexts = await Promise.all(linkHrefs.map((href) => fetchText(href)));
  const css = cssTexts.join('\n');
  const vars = [...css.matchAll(CSS_VAR_RE)].map(m => [m[1].toLowerCase(), cssValueToHex(m[2])]).filter(([, v]) => v);
  if (vars.length === 0) return null;

  const pick = (keywords) => {
    for (const [name, hex] of vars) {
      if (keywords.some(k => name.includes(k))) return hex;
    }
    return null;
  };

  const headerBgColor = pick(['background', 'bg-body', 'body-bg']);
  const checkoutBgColor = pick(['button', 'accent', 'primary', 'brand']);
  if (!headerBgColor && !checkoutBgColor) return null;

  return {
    headerBgColor: headerBgColor || '#ffffff',
    headerTextColor: pick(['text', 'foreground', 'body-text']) || '#1a1a1a',
    checkoutBgColor: checkoutBgColor || '#1a1a1a',
    checkoutTextColor: pick(['button-label', 'button-text', 'on-accent']) || '#ffffff',
  };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // Primary method: read the live theme's own settings_data.json via the
    // Admin REST Theme Assets API — this holds the exact hex values the
    // merchant picked in the theme customizer, so it works even for themes
    // whose compiled CSS doesn't expose custom properties.
    let theme = await detectFromThemeSettings(shop, session.accessToken).catch((e) => {
      console.error('[api.ai-agent.match-theme] settings_data.json detection failed:', e);
      return null;
    });

    // Fallback: scrape the live storefront's CSS for color variables.
    if (!theme) {
      const shopRes = await admin.graphql(`#graphql
        query { shop { primaryDomain { url } } }
      `);
      const shopJson = await shopRes.json();
      const storeUrl = shopJson?.data?.shop?.primaryDomain?.url;
      if (storeUrl) {
        theme = await detectFromLiveCss(storeUrl).catch((e) => {
          console.error('[api.ai-agent.match-theme] live CSS detection failed:', e);
          return null;
        });
      }
    }

    if (!theme) {
      return Response.json({
        success: false,
        error: 'Could not detect theme colors automatically from your theme settings or live site. Tell me the color codes and I\'ll apply them directly.',
      });
    }

    const phpResult = await sendToPhp(
      { shop, plan: { actions: ['applyTheme'], settings: { theme } } },
      'ai_agent_apply.php'
    );

    return Response.json({ success: true, theme, after: phpResult?.after || null });
  } catch (e) {
    console.error('[api.ai-agent.match-theme]', e);
    return Response.json({ success: false, error: e.message || 'Could not detect your theme colors.' });
  }
}
