// Lightweight, bounded read of the live product catalog via Admin GraphQL —
// used as a fallback reasoning source when historical order/analytics data
// is too thin (new stores, low order volume, or a plan without analytics
// access) to generate insights from. Deliberately capped at 50 products /
// 20 collections, never persisted, and every number returned here traces
// back to a real GraphQL field — nothing is estimated or invented.
export async function getCatalogSnapshot(admin) {
  const response = await admin.graphql(`#graphql
    query CatalogSnapshot {
      shop { currencyCode }
      products(first: 50, query: "status:active") {
        edges {
          node {
            vendor
            tags
            totalInventory
            priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
            collections(first: 1) { edges { node { id } } }
          }
        }
      }
      collections(first: 20) {
        edges { node { title productsCount { count } } }
      }
    }
  `);
  const json = await response.json();
  const currencyCode = json.data?.shop?.currencyCode || "";
  const products = json.data?.products?.edges?.map((e) => e.node) || [];
  const collections = json.data?.collections?.edges?.map((e) => e.node) || [];

  const vendorCounts = new Map();
  const tagCounts = new Map();
  let outOfStockCount = 0;
  let uncategorizedCount = 0;
  let pricedCount = 0;
  let priceSum = 0;
  let minPrice = null;
  let maxPrice = null;

  for (const p of products) {
    if (p.vendor) vendorCounts.set(p.vendor, (vendorCounts.get(p.vendor) || 0) + 1);
    for (const t of p.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    if ((p.totalInventory ?? 0) <= 0) outOfStockCount++;
    if (!p.collections?.edges?.length) uncategorizedCount++;

    const min = parseFloat(p.priceRangeV2?.minVariantPrice?.amount);
    const max = parseFloat(p.priceRangeV2?.maxVariantPrice?.amount);
    if (!Number.isNaN(min)) {
      pricedCount++;
      priceSum += min;
      minPrice = minPrice === null ? min : Math.min(minPrice, min);
      maxPrice = maxPrice === null ? (Number.isNaN(max) ? min : max) : Math.max(maxPrice, Number.isNaN(max) ? min : max);
    }
  }

  const topVendors = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  return {
    currencyCode,
    productCount: products.length,
    collectionCount: collections.length,
    uncategorizedProductCount: uncategorizedCount,
    outOfStockCount,
    avgPrice: pricedCount ? priceSum / pricedCount : null,
    minPrice,
    maxPrice,
    topVendors,
    topTags,
  };
}
