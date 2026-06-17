/**
 * Storefront Scraper
 *
 * Fetches the merchant's live Shopify storefront and extracts:
 * - Brand colors (CSS variables, meta theme-color, button/header colors)
 * - Font families (heading + body)
 * - Border radius values
 * - Active offers / promo text from announcement bars
 *
 * Uses cheerio to parse HTML + inline <style> tags — no headless browser needed.
 * Shopify themes always inject a <style> block in <head> with all CSS variables.
 */

import * as cheerio from "cheerio";

const TIMEOUT_MS = 8000;

// Common Shopify CSS variable names for colors
const COLOR_VAR_PATTERNS = [
  "--color-base-accent-1",
  "--color-base-accent-2",
  "--color-button",
  "--color-button-text",
  "--color-base-background-1",
  "--color-base-background-2",
  "--color-base-text",
  "--color-primary",
  "--color-secondary",
  "--colors-accent",
  "--color-foreground",
  "--color-background",
];

// Common Shopify CSS variable names for fonts
const FONT_VAR_PATTERNS = [
  "--font-heading-family",
  "--font-body-family",
  "--font-heading--family",
  "--font-body--family",
  "--font-stack-heading",
  "--font-stack-body",
];

// Common Shopify CSS variable names for border radius
const RADIUS_VAR_PATTERNS = [
  "--buttons-radius",
  "--button-radius",
  "--border-radius",
  "--buttons-border-radius",
];

function extractCssVars(cssText, varNames) {
  const result = {};
  for (const name of varNames) {
    const re = new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+)`, "i");
    const match = cssText.match(re);
    if (match) result[name] = match[1].trim();
  }
  return result;
}

function pickHex(...candidates) {
  for (const c of candidates) {
    if (typeof c === "string") {
      const m = c.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
      if (m) return m[0];
      // rgb(r,g,b) → hex
      const rgb = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (rgb) {
        return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => parseInt(n).toString(16).padStart(2, "0")).join("");
      }
    }
  }
  return null;
}

function parseFont(value) {
  if (!value) return null;
  // e.g. "Assistant, sans-serif" or "'Playfair Display', serif"
  return value.split(",")[0].trim().replace(/['"]/g, "").split("_")[0];
}

function parseRadius(value) {
  if (!value) return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function extractOffers($) {
  const offers = [];
  const selectors = [
    "[class*='announcement']",
    "[class*='promo']",
    "[class*='banner']",
    "[class*='offer']",
    "[class*='notice']",
    "[id*='announcement']",
    "[id*='promo']",
    "header [class*='bar']",
  ];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text.length > 5 && text.length < 200) offers.push(text);
    });
  }
  return [...new Set(offers)].slice(0, 5);
}

export async function scrapeStorefront(shopDomain) {
  const url = `https://${shopDomain}/`;

  let html;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CartNinja/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn("[Scraper] Failed to fetch storefront:", err?.message);
    return { source: "scrape-failed", error: err?.message };
  }

  const $ = cheerio.load(html);

  // Collect all inline <style> content from <head>
  let cssText = "";
  $("head style").each((_, el) => {
    cssText += $(el).html() + "\n";
  });

  // Also try to fetch the first external stylesheet (CDN CSS has full variables)
  const firstCssHref = $('link[rel="stylesheet"]').first().attr("href");
  if (firstCssHref) {
    try {
      const cssUrl = firstCssHref.startsWith("//")
        ? `https:${firstCssHref}`
        : firstCssHref.startsWith("http")
        ? firstCssHref
        : `https://${shopDomain}${firstCssHref}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const cssRes = await fetch(cssUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (cssRes.ok) cssText += await cssRes.text();
    } catch {
      // ignore
    }
  }

  const colorVars = extractCssVars(cssText, COLOR_VAR_PATTERNS);
  const fontVars = extractCssVars(cssText, FONT_VAR_PATTERNS);
  const radiusVars = extractCssVars(cssText, RADIUS_VAR_PATTERNS);

  // meta theme-color
  const metaThemeColor = $('meta[name="theme-color"]').attr("content") || null;

  // Primary color: accent-1 → button → meta → fallback
  const primaryColor = pickHex(
    colorVars["--color-base-accent-1"],
    colorVars["--color-button"],
    colorVars["--color-primary"],
    colorVars["--color-foreground"],
    colorVars["--colors-accent"],
    metaThemeColor
  );

  // Secondary color: accent-2 → text → background-2
  const secondaryColor = pickHex(
    colorVars["--color-base-accent-2"],
    colorVars["--color-base-text"],
    colorVars["--color-secondary"],
    colorVars["--color-background"]
  );

  // Font: heading first, then body
  const font = parseFont(
    fontVars["--font-heading-family"] ||
    fontVars["--font-heading--family"] ||
    fontVars["--font-stack-heading"] ||
    fontVars["--font-body-family"] ||
    fontVars["--font-body--family"]
  );

  // Border radius
  const borderRadius = parseRadius(
    radiusVars["--buttons-radius"] ||
    radiusVars["--button-radius"] ||
    radiusVars["--buttons-border-radius"] ||
    radiusVars["--border-radius"]
  );

  // Offers from announcement bars
  const offers = extractOffers($);

  // Page title for context
  const pageTitle = $("title").first().text().trim();

  return {
    source: "live-scrape",
    url,
    pageTitle,
    primaryColor: primaryColor || null,
    secondaryColor: secondaryColor || null,
    font: font || null,
    borderRadius: borderRadius ?? null,
    offers,
    rawColorVars: colorVars,
    rawFontVars: fontVars,
  };
}
