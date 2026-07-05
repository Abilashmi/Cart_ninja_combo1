/**
 * Server-side currency utilities
 * Fetches currency symbol and settings from Shopify API
 */

// This loader runs on every /app/* navigation (it lives on the shared
// layout route), so an uncached Admin GraphQL round trip here directly adds
// to the perceived time for every single in-app navigation. A shop's
// currency essentially never changes, so cache it in-process for a while —
// mirrors the plan_key cache in plan-permissions.server.js.
const CURRENCY_CACHE_TTL_MS = 5 * 60_000;
const currencyCache = new Map(); // shop -> { symbol, expiresAt }

/**
 * Fetch shop currency symbol from Shopify
 * @param {Object} admin - Shopify admin API client
 * @param {string} [shop] - Shop domain, used as the cache key
 * @returns {Promise<string>} Currency symbol (e.g., "$", "₹", "€")
 */
export async function getShopCurrencySymbol(admin, shop) {
  if (!admin) {
    console.warn("[Currency] No admin client provided, defaulting to $");
    return "$";
  }

  if (shop) {
    const cached = currencyCache.get(shop);
    if (cached && cached.expiresAt > Date.now()) return cached.symbol;
  }

  try {
    const response = await admin.graphql(`
      query {
        shop {
          currencyCode
        }
      }
    `);

    const data = await response.json();
    const currencyCode = data?.data?.shop?.currencyCode;

    if (!currencyCode) {
      console.warn("[Currency] Could not fetch currency code, defaulting to $");
      return "$";
    }

    const symbol = getCurrencySymbolFromCode(currencyCode);
    if (shop) currencyCache.set(shop, { symbol, expiresAt: Date.now() + CURRENCY_CACHE_TTL_MS });
    return symbol;
  } catch (error) {
    console.error("[Currency] Error fetching currency:", error);
    return "$";
  }
}

/**
 * Get currency symbol for a given currency code
 * @param {string} currencyCode - ISO 4217 currency code (e.g., "USD", "INR", "EUR")
 * @returns {string} Currency symbol
 */
export function getCurrencySymbolFromCode(currencyCode) {
  const symbolMap = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    INR: "₹",
    AUD: "A$",
    CAD: "C$",
    CHF: "CHF",
    CNY: "¥",
    SEK: "kr",
    NZD: "NZ$",
    MXN: "$",
    SGD: "S$",
    HKD: "HK$",
    NOK: "kr",
    KRW: "₩",
    TRY: "₺",
    RUB: "₽",
    BRL: "R$",
    ZAR: "R",
    THB: "฿",
    MYR: "RM",
    PHP: "₱",
    IDR: "Rp",
    VND: "₫",
    KES: "KSh",
    NGN: "₦",
    PKR: "₨",
    BDT: "৳",
    AED: "د.إ",
    SAR: "﷼",
    QAR: "﷼",
  };

  return symbolMap[currencyCode] || currencyCode;
}

/**
 * Format amount with currency symbol
 * @param {number} value - The value to format
 * @param {string} currencyCode - ISO 4217 currency code
 * @param {string} locale - Locale for formatting (default: "en-US")
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value, currencyCode = "USD", locale = "en-US") {
  try {
    const currencySymbol = getCurrencySymbolFromCode(currencyCode);
    const amount = parseFloat(value) || 0;

    // Get locale-specific formatting
    const localeMap = {
      USD: "en-US",
      EUR: "en-EN",
      GBP: "en-GB",
      INR: "en-IN",
      JPY: "ja-JP",
      AUD: "en-AU",
      CAD: "en-CA",
      CHF: "de-CH",
      CNY: "zh-CN",
      KRW: "ko-KR",
      THB: "th-TH",
    };

    const effectiveLocale = localeMap[currencyCode] || locale;

    // Format based on currency
    if (currencyCode === "JPY" || currencyCode === "KRW") {
      return `${currencySymbol}${amount.toLocaleString(effectiveLocale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })}`;
    }

    return `${currencySymbol}${amount.toLocaleString(effectiveLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  } catch (error) {
    console.error("[Currency] Error formatting currency:", error);
    return `${value}`;
  }
}

/**
 * Store currency in session/context for use in components
 * @param {string} currencySymbol - Currency symbol
 * @param {string} currencyCode - ISO currency code
 * @returns {Object} Currency object
 */
export function createCurrencyContext(currencySymbol = "$", currencyCode = "USD") {
  return {
    symbol: currencySymbol,
    code: currencyCode,
  };
}
