// Box template builder (QuickShopSections.jsx Filters): why a Type / Brand /
// own tag filter won't show on the page being built. The kit (filterRow)
// shows one only when the page's products have two or more different values.
export function filterHiddenNote(kind, values, tagsTyped = '') {
  if (!values) return null;
  if (values.length >= 2) return null;
  if (kind === 'type') {
    return values.length
      ? `Hidden on this page: all its products have the same product type ("${values[0]}"). It shows once there are two or more.`
      : 'Hidden on this page: its products have no product type in Shopify. Set one on each product (Products > Category / Type), or use "Your own tag filter" with tags.';
  }
  if (kind === 'brand') {
    return values.length
      ? `Hidden on this page: all its products have the same vendor ("${values[0]}"). It shows once there are two or more.`
      : 'Hidden on this page: its products have no vendor in Shopify.';
  }
  if (!String(tagsTyped).trim()) return null;
  return values.length
    ? `Hidden on this page: only one of these tags is on its products ("${values[0]}"). It shows once two or more are.`
    : 'Hidden on this page: none of these tags is on its products.';
}

