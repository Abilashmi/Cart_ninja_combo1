// Shopify product data for combo pages (no app-wide imports, so tests can
// run it with a fake Admin API). Box templates load every product of their
// collections; the older designs keep their first 50.
import { toGrams } from '../utils/combo-weight.shared.js';
import { adminGraphql, mapLimit } from './admin-graphql.server';

const PRODUCT_FRAGMENT = `
  fragment ProductInfo on Product {
    id
    title
    handle
    descriptionHtml
    description(truncateAt: 160)
    vendor
    productType
    tags
    featuredImage { url altText width height }
    images(first: 10) { nodes { url altText width height } }
    variants(first: 25) { nodes { id title price compareAtPrice availableForSale image { url altText } inventoryItem { measurement { weight { value unit } } } } }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
  }
`;

// Box templates (cards + popup): no descriptionHtml (the cards and popup use
// the short description), and status so drafts / archived products stay off
// the page now that it lists every product of a collection.
const BOX_PRODUCT_FRAGMENT = `
  fragment BoxProductInfo on Product {
    id
    status
    title
    handle
    description(truncateAt: 160)
    vendor
    productType
    tags
    featuredImage { url altText }
    images(first: 10) { nodes { url altText } }
    variants(first: 25) { nodes { id title price compareAtPrice availableForSale image { url altText } inventoryItem { measurement { weight { value unit } } } } }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
  }
`;

// Box templates show every product of their collections (up to this many
// each); the older designs keep their first 50.
export const BOX_MAX_PRODUCTS = 3000;
// Products per detail query: what one collection query held before.
const DETAIL_BATCH = 50;

// One page product from Shopify's ProductInfo (collection products and the
// box templates' extra products look the same).
export function pageProduct(node) {
  return {
    id: node.id, title: node.title, handle: node.handle,
    descriptionHtml: node.descriptionHtml || '',
    // Quick Shop cards and filters: one-line subtitle, Brand / Type
    // dropdowns, tag chips and badges.
    summary: node.description || '',
    vendor: node.vendor || '',
    productType: node.productType || '',
    tags: (node.tags || []).slice(0, 40),
    secondImageSrc: node.images?.nodes?.length > 1 ? node.images.nodes[1].url : null,
    image: node.featuredImage ? { url: node.featuredImage.url, altText: node.featuredImage.altText } : null,
    images: (node.images?.nodes || []).map((img) => ({
      url: img.url, altText: img.altText,
    })),
    variants: (node.variants?.nodes || []).map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compareAtPrice || null,
      available: v.availableForSale !== false,
      image: v.image ? { url: v.image.url, altText: v.image.altText } : null,
      // Weight-priced combos: grams per unit, null when the variant has no weight.
      grams: toGrams(v.inventoryItem?.measurement?.weight?.value, v.inventoryItem?.measurement?.weight?.unit),
    })),
    variantId: node.variants?.nodes?.[0]?.id || null,
    price: node.priceRangeV2?.minVariantPrice?.amount || '0.00',
    currency: node.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
  };
}

export async function loadCollections(admin) {
  const data = await adminGraphql(admin, `#graphql
    query { collections(first: 250) {
      nodes { id title handle productsCount { count } image { url } }
    } }
  `);
  return (data.collections?.nodes || []).map((n) => ({
    id: n.id, title: n.title, handle: n.handle, image: n.image?.url || '',
  }));
}

// The older designs: a collection's first 50 products, as always.
export async function loadClassicCollection(admin, handle) {
  const data = await adminGraphql(admin, `
    query GetCollectionByHandle($handle: String!) {
      collectionByHandle(handle: $handle) {
        products(first: 50) {
          edges { node { ...ProductInfo } }
        }
      }
    }
    ${PRODUCT_FRAGMENT}
  `, { handle });
  return (data.collectionByHandle?.products?.edges || []).map((e) => pageProduct(e.node));
}

// Every product id of a collection in its own sort order, 250 per page
// (ids only, so each page is cheap).
async function boxCollectionIds(admin, handle) {
  const ids = [];
  let after = null;
  while (ids.length < BOX_MAX_PRODUCTS) {
    const data = await adminGraphql(admin, `#graphql
      query BrixBoxCollectionIds($handle: String!, $after: String) {
        collectionByHandle(handle: $handle) {
          products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }
        }
      }`, { handle, after });
    const products = data.collectionByHandle?.products;
    (products?.nodes || []).forEach((n) => { if (n?.id) ids.push(n.id); });
    if (!products?.pageInfo?.hasNextPage || !products.pageInfo.endCursor) break;
    after = products.pageInfo.endCursor;
  }
  return ids.slice(0, BOX_MAX_PRODUCTS);
}

// Product nodes for ids (any order). A query Shopify finds too costly is
// split in two and tried again.
async function boxProductNodes(admin, ids) {
  try {
    const data = await adminGraphql(admin, `
      query BrixBoxProducts($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Product { ...BoxProductInfo } }
      }
      ${BOX_PRODUCT_FRAGMENT}
    `, { ids });
    return (data.nodes || []).filter((n) => n?.id);
  } catch (error) {
    if (ids.length > 5 && /cost/i.test(String(error?.message || ''))) {
      const half = Math.ceil(ids.length / 2);
      return [...await boxProductNodes(admin, ids.slice(0, half)), ...await boxProductNodes(admin, ids.slice(half))];
    }
    throw error;
  }
}

// Active products by id, in the ids' order; DETAIL_BATCH per query, a few at once.
async function boxProducts(admin, ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += DETAIL_BATCH) chunks.push(ids.slice(i, i + DETAIL_BATCH));
  const pages = await mapLimit(chunks, 3, (chunk) => boxProductNodes(admin, chunk));
  const byId = new Map(pages.flat().map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id))
    .filter((n) => n && (!n.status || n.status === 'ACTIVE'))
    .map(pageProduct);
}

// Box templates: every product of the collection (it used to be the first 50).
export async function loadBoxCollection(admin, handle) {
  return boxProducts(admin, await boxCollectionIds(admin, handle));
}

export async function loadExtraProducts(admin, ids) {
  return boxProducts(admin, ids);
}

export async function loadActiveDiscounts(admin) {
  const data = await adminGraphql(admin, `#graphql
    query PreviewDiscounts {
      discountNodes(first: 50, reverse: true) {
        edges {
          node {
            id
            discount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) { edges { node { code } } }
                status
                customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } }
              }
              ... on DiscountCodeBxgy {
                title
                codes(first: 1) { edges { node { code } } }
                status
                customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } }
              }
              ... on DiscountCodeFreeShipping {
                title
                codes(first: 1) { edges { node { code } } }
                status
              }
            }
          }
        }
      }
    }
  `);
  return (data.discountNodes?.edges || [])
    .map(({ node }) => {
      const d = node.discount;
      if (!d) return null;
      const code = d.codes?.edges?.[0]?.node?.code || '';
      const gets = d.customerGets?.value;
      let valueType = '';
      let value = 0;
      if (gets) {
        if ('percentage' in gets) { valueType = 'percentage'; value = parseFloat(gets.percentage || 0) * 100; }
        else if ('amount' in gets) { valueType = 'fixed_amount'; value = parseFloat(gets.amount?.amount || 0); }
      }
      return { id: node.id, title: d.title || code, code, type: d.__typename || '', status: d.status || 'ACTIVE', valueType, value };
    })
    .filter(Boolean)
    .filter((d) => d.status === 'ACTIVE');
}
