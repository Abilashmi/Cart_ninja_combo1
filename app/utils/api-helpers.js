import fs from 'fs';
import path from 'path';

/* =========================
   IST DATE FORMATTER
   ========================= */
export const formatToIST = (dateString = null, timeZone = 'Asia/Kolkata') => {
  const date = dateString ? new Date(dateString) : new Date();
  return date.toLocaleString(undefined, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

/* =========================
   PHP BACKEND CONFIG
========================= */
export const BASE_PHP_URL =
  'https://int.thecomboforge.com';

/* =========================
   DATABASE HELPERS (PHP REPLACEMENT)
========================= */
export const getDb = async (shop = null) => {
  console.log(
    `[DB] 💿 Fetching data from PHP backend... Shop: ${shop || 'All'}`
  );
  try {
    // We need to fetch both templates and discounts to maintain the structure expected by the app
    const templatesUrl = `${BASE_PHP_URL}/templates.php${shop ? `?shopdomain=${shop}&shop=${shop}` : ''}`;
    const discountsUrl = `${BASE_PHP_URL}/discount.php${shop ? `?shopdomain=${shop}&shop=${shop}` : ''}`;

    console.log(`[DB] 🔗 Templates URL: ${templatesUrl}`);
    console.log(`[DB] 🔗 Discounts URL: ${discountsUrl}`);

    const [templatesRes, discountsRes] = await Promise.all([
      fetch(templatesUrl)
        .then(async (res) => {
          const text = await res.text();
          console.log(`[DB] 📥 Raw Templates Response: ${text.substring(0, 500)}`);
          try {
            return JSON.parse(text);
          } catch (e) {
            console.error(`[DB] ❌ Failed to parse Templates JSON:`, e.message);
            return { data: [] };
          }
        })
        .catch((err) => ({ data: [] })),
      fetch(discountsUrl)
        .then(async (res) => {
          const text = await res.text();
          console.log(
            `[DB] 📥 Raw Discounts Response from PHP:`,
            text.substring(0, 500) + (text.length > 500 ? '...' : '')
          );
          try {
            return JSON.parse(text);
          } catch (e) {
            console.error(`[DB] ❌ Failed to parse JSON:`, e.message);
            return { data: [] };
          }
        })
        .catch((err) => {
          console.error(`[DB] ❌ Fetch error:`, err.message);
          return { data: [] };
        }),
    ]);

    return {
      templates: Array.isArray(templatesRes) ? templatesRes : (templatesRes.templates || templatesRes.data || []),
      discounts: Array.isArray(discountsRes) ? discountsRes : (discountsRes.data || []),
    };
  } catch (error) {
    console.error('[DB] ❌ Error fetching from PHP backend:', error);
    return { templates: [], discounts: [] };
  }
};

export const saveDb = (data) => {
  // saveDb was used for fake_db.json.
  // With PHP, updates happen individually via sendToPhp.
  // We'll keep this as a no-op or log it to prevent crashes,
  // but the app should rely on action functions calling sendToPhp.
  console.log(
    '[DB] ℹ️ saveDb called. Local JSON sync is disabled as we are now using PHP/MySQL.'
  );
};

/* =========================
   SEND DATA TO PHP API
========================= */
export async function sendToPhp(payload, endpoint) {
  if (!endpoint) {
    console.error('[PHP API] ❌ Endpoint required for sendToPhp');
    return;
  }
  const phpUrl = `${BASE_PHP_URL}/${endpoint}`;

  console.log(`[PHP API] 📡 Initiating request to: ${phpUrl}`);

  try {
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '',
      },
      body: JSON.stringify(payload),
    };

    const response = await fetch(phpUrl, fetchOptions);
    const resultText = await response.text();

    console.log(
      `[PHP API] 📥 Status: ${response.status} ${response.statusText}`
    );

    if (!response.ok) {
      throw new Error(`PHP HTTP ${response.status}: ${resultText.substring(0, 300)}`);
    }

    let resultJson;
    try {
      resultJson = JSON.parse(resultText);
    } catch (e) {
      resultJson = { text: resultText };
    }

    return resultJson;
  } catch (error) {
    console.error('[PHP API] ❌ Connection Failed:', error.message);
    throw error;
  }
}

/* =========================
   SEND SHOP DATA TO MySQL
========================= */
export async function sendShopData(shopData, shopDomain = null) {
  console.log('[Shop MySQL] 💾 Sending shop data to database...');

  const payload = {
    event: 'shop_sync',
    resource: 'shop',
    shop: shopDomain || shopData.shop_id || shopData.myshopifyDomain,
    data: shopData,
  };

  return await sendToPhp(payload, 'shop.php');
}

/* =========================
   SEND DISCOUNT DATA TO MySQL
========================= */
export async function sendDiscountData(discountData, action = 'create') {
  console.log(
    `[Discount MySQL] 💾 Sending discount data to database (${action})...`
  );

  const payload = {
    event: action, // create, update, delete
    resource: 'discount',
    data: discountData,
  };

  return await sendToPhp(payload, 'discount.php');
}

/* =========================
   SEND TEMPLATE DATA TO MySQL
========================= */
export async function sendTemplateData(templateData, action = 'create') {
  console.log(
    `[Template MySQL] 💾 Sending template data to database (${action})...`
  );

  const payload = {
    event: action, // create, update, delete
    resource: 'templates',
    data: templateData,
  };

  return await sendToPhp(payload, 'templates.php');
}

/* =========================
   ANALYTICS DATA FETCHING & TRANSFORMATION
   ========================= */

// 1. Fetch Visitors (Flexible schema handling)
export async function getVisitors(shop, start, end) {
  const url = `${BASE_PHP_URL}/visitors.php?shop=${shop}&shop_domain=${shop}&start_date=${start}&end_date=${end}`;
  console.log(`[API] 🕵️ Fetching Visitors: ${url}`);
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`[API] 📥 Raw Visitors Result: ${text.substring(0, 100)}`);
    const result = JSON.parse(text);
    const data =
      result.data || result.visitors || (Array.isArray(result) ? result : []);
    return data;
  } catch (e) {
    console.error('[API] ❌ Visitors Fetch Failed:', e.message);
    return [];
  }
}

// 2. Fetch Clicks (Flexible schema handling)
export async function getClicks(shop, start, end) {
  const url = `${BASE_PHP_URL}/clicks.php?shop=${shop}&shop_domain=${shop}&start_date=${start}&end_date=${end}`;
  console.log(`[API] 🕵️ Fetching Clicks: ${url}`);
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`[API] 📥 Raw Clicks Result: ${text.substring(0, 100)}`);
    const result = JSON.parse(text);
    const data =
      result.data || result.clicks || (Array.isArray(result) ? result : []);
    return data;
  } catch (e) {
    console.error('[API] ❌ Clicks Fetch Failed:', e.message);
    return [];
  }
}

// 3. Transformation Logic (Joined by Template/Date)
export function transformAnalytics(visitors = [], clicks = []) {
  const summary = {
    totalVisitors: visitors.length,
    totalClicks: clicks.length,
    checkoutClicks: 0,
    topTemplate: 'None',
    byTemplate: [],
    chartData: [],
  };

  const templateStats = {};

  // Process Visitors
  visitors.forEach((v) => {
    // Check various common field names for template
    const t = v.template_name || v.template || v.layout || 'Unknown';
    if (!templateStats[t])
      templateStats[t] = { name: t, visitors: 0, clicks: 0, checkouts: 0 };
    templateStats[t].visitors++;
  });

  // Process Clicks
  clicks.forEach((c) => {
    const t = c.template_name || c.template || c.layout || 'Unknown';
    if (!templateStats[t])
      templateStats[t] = { name: t, visitors: 0, clicks: 0, checkouts: 0 };
    templateStats[t].clicks++;

    // Check for checkout markers
    const isCheckout =
      c.action === 'checkout' ||
      c.type === 'checkout' ||
      c.target?.includes('checkout');
    if (isCheckout) {
      templateStats[t].checkouts++;
      summary.checkoutClicks++;
    }
  });

  // Convert map to grouped array + find Top Template
  let topClicks = -1;
  const tableData = Object.values(templateStats).map((s) => {
    const rate =
      s.visitors > 0 ? ((s.clicks / s.visitors) * 100).toFixed(1) : '0.0';
    if (s.clicks > topClicks && s.name !== 'Unknown') {
      topClicks = s.clicks;
      summary.topTemplate = s.name;
    }
    return { ...s, conversionRate: rate + '%' };
  });

  // Daily Chart Data
  const dateMap = {};
  clicks.forEach((c) => {
    const d = c.created_at?.split(' ')[0] || c.date || 'Unknown';
    if (d !== 'Unknown') dateMap[d] = (dateMap[d] || 0) + 1;
  });

  summary.chartData = Object.keys(dateMap)
    .sort()
    .map((date) => ({
      date: date.substring(5), // Shorten MM-DD
      clicks: dateMap[date],
    }));

  summary.byTemplate = tableData.sort((a, b) => b.clicks - a.clicks);
  return summary;
}

/**
 * Fetch discount list with real usage counts from Shopify GraphQL.
 * Returns array of { title, code, status, usage, usedCount }.
 */
export async function getShopifyDiscounts(admin) {
  try {
    const res = await admin.graphql(`
      #graphql
      query {
        discountNodes(first: 100, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              discount {
                __typename
                ... on DiscountCodeBasic {
                  title status usageLimit
                  codes(first: 1) { edges { node { code asyncUsageCount } } }
                }
                ... on DiscountCodeBxgy {
                  title status usageLimit
                  codes(first: 1) { edges { node { code asyncUsageCount } } }
                }
                ... on DiscountCodeFreeShipping {
                  title status usageLimit
                  codes(first: 1) { edges { node { code asyncUsageCount } } }
                }
              }
            }
          }
        }
      }
    `);
    const json = await res.json();
    const edges = json.data?.discountNodes?.edges || [];
    return edges
      .filter(({ node }) => node?.discount?.codes)
      .map(({ node }) => {
        const d = node.discount;
        const codeNode = d.codes?.edges?.[0]?.node;
        const usedCount = codeNode?.asyncUsageCount ?? 0;
        const usageLimit = d.usageLimit ?? null;
        return {
          title: d.title || 'Untitled',
          code: codeNode?.code || '',
          status: d.status?.toLowerCase() === 'active' ? 'active' : 'inactive',
          usedCount,
          usage: `${usedCount} / ${usageLimit !== null ? usageLimit : 'Unlimited'}`,
        };
      });
  } catch (e) {
    console.error('[API] ❌ getShopifyDiscounts failed:', e.message);
    return [];
  }
}

/**
 * Fetch orders within a date range from Shopify GraphQL.
 * Returns { ordersCount: number, totalRevenue: number }
 */
export async function getShopifyOrders(admin, start, end) {
  try {
    // Shopify orders query with created_at filter.
    const startTime = start
      ? new Date(start.replace(' ', 'T') + 'Z').toISOString()
      : null;
    const endTime = end
      ? new Date(end.replace(' ', 'T') + 'Z').toISOString()
      : new Date().toISOString();

    // Only count orders that came through the combo builder page
    let query = `financial_status:paid AND tag:combo-builder`;
    if (startTime) query += ` AND created_at:>=${startTime}`;
    if (endTime) query += ` AND created_at:<=${endTime}`;

    const res = await admin.graphql(
      `
      #graphql
      query getOrders($query: String!) {
        shop {
          currencyCode
        }
        orders(first: 100, query: $query) {
          edges {
            node {
              id
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
      }
    `,
      {
        variables: { query },
      }
    );

    const json = await res.json();
    const currencyCode = json.data?.shop?.currencyCode ?? null;
    const edges = json.data?.orders?.edges || [];

    const ordersCount = edges.length;
    const totalRevenue = edges.reduce(
      (acc, { node }) => acc + parseFloat(node.totalPriceSet.shopMoney.amount),
      0
    );

    return { ordersCount, totalRevenue, currencyCode };
  } catch (e) {
    console.error('[API] ❌ getShopifyOrders failed:', e.message);
    return { ordersCount: 0, totalRevenue: 0, currencyCode: null };
  }
}

/**
 * Fetch AI usage stats from the local SQLite log for a given shop and date range.
 * Returns { total, recommend, suggest }
 */
export async function getAiUsageStats(prisma, shop, start, end) {
  try {
    const where = { shop };
    if (start || end) {
      where.createdAt = {};
      if (start) {
        where.createdAt.gte = new Date(
          start.replace(' ', 'T') + (start.includes('T') ? '' : 'Z')
        );
      }
      if (end) {
        where.createdAt.lte = new Date(
          end.replace(' ', 'T') + (end.includes('T') ? '' : 'Z')
        );
      }
    }

    const getRawCount = async (feat = null) => {
      try {
        let query = `SELECT COUNT(*) as count FROM "AiUsageLog" WHERE "shop" = ?`;
        const params = [shop];
        if (start) {
          query += ` AND "createdAt" >= ?`;
          params.push(start);
        }
        if (end) {
          query += ` AND "createdAt" <= ?`;
          params.push(end);
        }
        if (feat) {
          query += ` AND "feature" = ?`;
          params.push(feat);
        }
        const result = await prisma.$queryRawUnsafe(query, ...params);
        return Number(result[0]?.count || 0);
      } catch (e) {
        console.warn(`[AI Stats] Raw count failed for ${feat || 'total'}:`, e.message);
        return 0;
      }
    };

    const [
      total,
      recommend,
      sparkleTitle,
      sparkleDescription,
      sparkleStep,
      sparkleCollection,
    ] = await Promise.all([
      getRawCount(),
      getRawCount('recommend'),
      getRawCount('sparkle_title'),
      getRawCount('sparkle_description'),
      getRawCount('sparkle_step'),
      getRawCount('sparkle_collection'),
    ]);

    return {
      total,
      recommend,
      sparkleTitle,
      sparkleDescription,
      sparkleStep,
      sparkleCollection,
    };
  } catch (e) {
    console.error('[AI Usage] ❌ getAiUsageStats failed:', e.message);
    return {
      total: 0,
      recommend: 0,
      sparkleTitle: 0,
      sparkleDescription: 0,
      sparkleStep: 0,
      sparkleCollection: 0,
    };
  }
}

/**
 * Unified Analytics Fetcher (Uses analytics.php)
 */
export async function getAnalytics(shop, start, end, dateRange, admin = null) {
  const url = new URL(`${BASE_PHP_URL}/analytics.php`);
  url.searchParams.set('shop_domain', shop);

  // If explicit start/end are provided, always prefer them over date_range.
  // This ensures timezone-safe datetime boundaries are respected.
  if (start && end) {
    // analytics.php expects YYYY-MM-DD only — it appends time itself.
    // Strip any time component before sending to avoid "2026-03-16 00:00:00 00:00:00" double-append.
    url.searchParams.set('start_date', start.substring(0, 10));
    url.searchParams.set('end_date', end.substring(0, 10));
  } else if (dateRange) {
    url.searchParams.set('date_range', dateRange);
  } else {
    url.searchParams.set('date_range', 'last_30_days');
  }

  console.log(`[API] 📊 Fetching Unified Analytics: ${url.toString()}`);

  try {
    // Revenue and AOV come exclusively from the PHP analytics module (combo_orders table).
    // Never fetch revenue/AOV from Shopify directly — app analytics module is the single source.
    const ordersUrl = new URL(`${BASE_PHP_URL}/orders.php`);
    ordersUrl.searchParams.set('shop_domain', shop);
    if (start && end) {
      ordersUrl.searchParams.set('start_date', start.substring(0, 10));
      ordersUrl.searchParams.set('end_date', end.substring(0, 10));
    }

    console.log(`[API] 🛒 Fetching orders from: ${ordersUrl.toString()}`);

    const [response, discountRes, ordersRes, aiStats, templatesRes, currencyRes] = await Promise.all([
      fetch(url.toString()),

      fetch(`${BASE_PHP_URL}/discount.php?shopdomain=${shop}&shop=${shop}`)
        .then((r) => r.json())
        .catch(() => ({ data: [] })),
      fetch(ordersUrl.toString())
        .then(async (r) => {
          const text = await r.text();
          console.log(
            `[API] 🛒 orders.php HTTP ${r.status} — raw: ${text.substring(0, 200)}`
          );
          try {
            return JSON.parse(text);
          } catch {
            return { success: false, data: null };
          }
        })
        .catch((err) => {
          console.error(`[API] ❌ orders.php fetch failed: ${err.message}`);
          return { success: false, data: null };
        }),
      Promise.resolve({
        total: 0,
        recommend: 0,
        sparkleTitle: 0,
        sparkleDescription: 0,
        sparkleStep: 0,
        sparkleCollection: 0,
      }),
      fetch(`${BASE_PHP_URL}/templates.php?shopdomain=${shop}&shop=${shop}`)
        .then((r) => r.json())
        .catch(() => ({ data: [] })),
      // Fetch the store's currency and money format from Shopify
      admin
        ? admin.graphql(`#graphql
            query {
              shop {
                currencyCode
                moneyFormat
                ianaTimezone
              }
            }
          `)
            .then((r) => r.json())
            .then((j) => ({
              currencyCode: j?.data?.shop?.currencyCode ?? null,
              moneyFormat:  j?.data?.shop?.moneyFormat  ?? null,
              ianaTimezone: j?.data?.shop?.ianaTimezone ?? null,
            }))
            .catch(() => ({ currencyCode: null, moneyFormat: null, ianaTimezone: null }))
        : Promise.resolve({ currencyCode: null, moneyFormat: null, ianaTimezone: null }),
    ]);

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const rawText = await response.text();
    console.log(`[API] 📥 analytics.php raw: ${rawText.substring(0, 300)}`);
    let rawResponse;
    try { rawResponse = JSON.parse(rawText); } catch { rawResponse = {}; }
    // Handle both { success, data: {...} } and flat { total_visitors, visitors, ... } formats
    const phpData = (rawResponse.success !== undefined && rawResponse.data)
      ? rawResponse.data
      : rawResponse;
    if (!phpData || typeof phpData !== 'object') {
      console.error(`[API] ❌ Invalid data format:`, rawResponse);
      return null;
    }

    // Normalize and count active discounts from discount.php
    const rawDiscounts = discountRes.data || [];
    const normalizedDiscounts = rawDiscounts.map((d) => {
      const s1 = d.settings && typeof d.settings === 'object' ? d.settings : {};
      const s2 =
        s1.settings && typeof s1.settings === 'object' ? s1.settings : {};
      const flat = { ...d, ...s1, ...s2 };
      return {
        title: flat.title || flat.discount_title || 'Untitled',
        code: flat.code || flat.discount_code || '',
        status: flat.status || 'active',
        usage: flat.usage || '0 / Unlimited',
        value: flat.value || '0',
        valueType: flat.valueType || 'percentage',
      };
    });
    const activeDiscountCount = normalizedDiscounts.filter(
      (d) => d.status === 'active'
    ).length;
    console.log(
      `[API] 🏷️ Active discounts for ${shop}: ${activeDiscountCount}`
    );

    // Normalize template names
    const normalize = (name) =>
      (name || '').toLowerCase().replace(/[-_]/g, ' ').trim();

    // Build canonical name lookup from templates list
    const templatesData = templatesRes?.templates || templatesRes?.data || [];
    const nameToCanonical = {};
    templatesData.forEach((t) => {
      const canonical = t.title || t.name || 'Unknown';
      const slug = t.page_url
        ? t.page_url.split('/').filter(Boolean).pop()
        : null;
      [t.title, t.name, t.handle, t.slug, slug]
        .filter(Boolean)
        .forEach((alias) => {
          nameToCanonical[normalize(alias)] = canonical;
        });
    });
    const resolveTemplateName = (rawName) =>
      nameToCanonical[normalize(rawName)] || rawName || 'Unknown';

    // Merge duplicate templates using canonical names
    const templateMap = {};
    const topTemplatesRaw = phpData.top_templates || phpData.templates || phpData.by_template || [];
    topTemplatesRaw.forEach((t) => {
      const canonical = resolveTemplateName(t.template_name);
      const key = normalize(canonical);
      if (!templateMap[key]) {
        templateMap[key] = {
          name: canonical,
          visitors: 0,
          clicks: 0,
          checkouts: 0,
          discount: t.discount_code || t.discount || 'None',
        };
      }
      templateMap[key].visitors += Number(t.visitors || 0);
      templateMap[key].clicks += Number(t.clicks || 0);
      templateMap[key].checkouts += Number(t.checkouts || 0);
    });

    const byTemplate = Object.values(templateMap).map((t) => {
      const convRate =
        t.visitors > 0 ? ((t.clicks / t.visitors) * 100).toFixed(1) : '0.0';
      return {
        ...t,
        conversionRate: convRate + '%',
      };
    });

    // Top template logic:
    // Prefer PHP's own ordering (`top_templates[0]`) so UI/API "top" matches the backend.
    let topTemplate = 'None';
    if (topTemplatesRaw.length > 0) {
      topTemplate = resolveTemplateName(topTemplatesRaw[0].template_name);
    } else if (byTemplate.length > 0) {
      // Fallback if PHP doesn't include top_templates.
      const sorted = [...byTemplate].sort((a, b) => {
        if (b.clicks === a.clicks) return b.visitors - a.visitors;
        return b.clicks - a.clicks;
      });
      topTemplate = sorted[0]?.name || 'None';
    }

    // Chart fallback
    const chartData =
      phpData.chart_data && phpData.chart_data.length > 0
        ? phpData.chart_data
        : byTemplate.map((t) => ({
            date: t.name,
            clicks: t.clicks,
          }));

    const totalVisitors = Number(phpData.total_visitors || phpData.visitors || phpData.visitor_count || 0);

    // Revenue and AOV: from orders.php (combo_orders table) — the single source of truth.
    // analytics.php has visitor/click data; orders.php has revenue/order data.
    const ordersData = ordersRes?.success && ordersRes.data ? ordersRes.data : null;
    console.log('[API] 🛒 Orders.php data:', JSON.stringify(ordersData || {}).substring(0, 200));

    const totalRevenue = Number(ordersData?.total_revenue || 0);
    const totalOrders = Number(ordersData?.total_orders || 0);

    // Revenue by discount code from orders.php
    const revenueByDiscount = (ordersData?.orders_by_discount || []).map((d) => ({
      code: d.discount_code || 'No Discount',
      orders: Number(d.orders || 0),
      revenue: Number(d.revenue || 0),
      aov: Number(d.orders) > 0 ? Number(d.revenue) / Number(d.orders) : 0,
    }));


    // Merge order/revenue totals into byTemplate for the table
    const ordersByTemplate = {};
    (ordersData?.orders_by_template || []).forEach((o) => {
      const key = normalize(o.template_name || '');
      ordersByTemplate[key] = { orders: Number(o.orders || 0), revenue: Number(o.revenue || 0) };
    });
    byTemplate.forEach((t) => {
      const match = ordersByTemplate[t.name] || { orders: 0, revenue: 0 };
      t.orders = match.orders;
      t.revenue = match.revenue;
    });

    return {
      totalVisitors,
      totalClicks: Number(phpData.total_clicks || phpData.clicks || 0),
      checkoutClicks: Number(phpData.total_checkouts || phpData.checkouts || 0),
      discountUsage:
        activeDiscountCount > 0
          ? activeDiscountCount
          : Number(phpData.total_discounts || 0),
      discountList: normalizedDiscounts,
      totalRevenue,
      totalOrders,
      currencyCode: currencyRes?.currencyCode ?? null,
      moneyFormat:  currencyRes?.moneyFormat  ?? null,
      ianaTimezone: currencyRes?.ianaTimezone ?? null,
      aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      // CVR = confirmed combo orders ÷ combo page visitors × 100
      orderConversionRate:
        totalVisitors > 0 ? (totalOrders / totalVisitors) * 100 : 0,
      revenueByDiscount,
      topTemplate,
      byTemplate,
      chartData,
      aiStats,
    };
  } catch (error) {
    console.error('[API] ❌ Error fetching unified analytics:', error);
    return null;
  }
}
