// BRIX Combo Weight — checkout discount (Shopify Discount Function API,
// target cart.lines.discounts.generate.run).
//
// A combo page set to weight pricing adds the shopper's box to the cart with
// line properties _brix_combo_id (the template) and _brix_combo_group (one
// token per box). Once the box's weight reaches a tier, that tier's price
// applies: percentage off, a fixed amount off, or a fixed box price.
//
// Trust model (same as Packs): the properties only say "this line is in box X
// of template Y". What a box gets — tiers, max weight, which products count —
// comes only from the app-owned shop metafield `$app:combo_weight_config`,
// written by the BRIX server (app/services/combo-weight-shopify.server.js) for
// active weight templates on a Pro shop. Weight comes from Shopify's own
// variant weight. A forged property can at most claim the price the merchant
// really offers for a box of that real weight, and only on products that
// qualify for that template.
//
// Config shape: { version: 1, currency, templates: { "<id>": { id, hash, unit,
//   max_grams, product_ids: ["123"], collection_ids: ["456"],
//   tiers: [{ min_grams, type, value, label }] } } }
// Fixed amounts / prices are in the shop currency and converted with
// presentmentCurrencyRate.
//
// The pricing rules are the shared core (app/utils/combo-weight.shared.js),
// the same code BRIX COD and the combo page use, so all three agree.
import { createComboWeightCore } from '../../../app/utils/combo-weight.shared.js';

const core = createComboWeightCore();
const NONE = { operations: [] };

function numericId(gid) {
  const match = /(\d+)$/.exec(String(gid ?? ''));
  return match ? match[1] : null;
}

function qualifies(template, product) {
  const productId = numericId(product?.id);
  if (!productId) return false;
  if (Array.isArray(template.product_ids) && template.product_ids.includes(productId)) return true;
  const allowed = Array.isArray(template.collection_ids) ? template.collection_ids : [];
  if (!allowed.length) return false;
  return (product.inCollections || []).some((membership) => membership.isMember && allowed.includes(numericId(membership.collectionId)));
}

/**
 * @param {object} input Function run input (see the .graphql query)
 * @returns {{ operations: object[] }}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = input?.shop?.metafield?.jsonValue;
  const templates = config && typeof config === 'object' && config.templates && typeof config.templates === 'object' ? config.templates : null;
  const lines = input?.cart?.lines;
  if (!templates || !Array.isArray(lines) || lines.length === 0) return NONE;
  const classes = input?.discount?.discountClasses;
  if (Array.isArray(classes) && !classes.includes('PRODUCT')) return NONE;
  const rate = Number(input?.presentmentCurrencyRate) > 0 ? Number(input.presentmentCurrencyRate) : 1;

  // 1. Group marked lines into boxes (template + box token).
  const groups = new Map();
  for (const line of lines) {
    const merchandise = line.merchandise;
    if (!merchandise || merchandise.__typename !== 'ProductVariant') continue;
    const comboId = line.comboId?.value;
    const group = line.comboGroup?.value;
    if (!comboId || !group) continue;
    if (!Object.prototype.hasOwnProperty.call(templates, comboId)) continue;
    const template = templates[comboId];
    if (!template || !Array.isArray(template.tiers) || template.tiers.length === 0) continue;
    const key = `${comboId}:${group}`;
    if (!groups.has(key)) groups.set(key, { template, lines: [] });
    groups.get(key).lines.push(line);
  }

  // 2. Price each box with the shared rules.
  const candidates = [];
  for (const { template, lines: boxLines } of groups.values()) {
    const currency = boxLines[0].cost?.subtotalAmount?.currencyCode;
    const decimals = core.decimalsFor(currency);
    const byId = new Map(boxLines.map((line) => [line.id, line]));
    const box = core.computeBox({
      pricing: template,
      decimals,
      rate,
      lines: boxLines.map((line) => ({
        key: line.id,
        unitGrams: core.toGrams(line.merchandise.weight, line.merchandise.weightUnit),
        quantity: line.quantity,
        subtotalMinor: core.toMinor(line.cost?.subtotalAmount?.amount, decimals),
        qualifies: qualifies(template, line.merchandise.product),
      })),
    });
    if (!box.tier || box.discountMinor <= 0) continue;
    const message = core.tierLabel(box.tier, template.unit);

    if (box.tier.type === 'percentage') {
      const targets = box.countedKeys.map((id) => ({ cartLine: { id, quantity: byId.get(id).quantity } }));
      candidates.push({ message, targets, value: { percentage: { value: String(box.tier.value) } } });
    } else {
      for (const allocation of box.allocations) {
        candidates.push({
          message,
          targets: [{ cartLine: { id: allocation.key, quantity: byId.get(allocation.key).quantity } }],
          value: { fixedAmount: { amount: core.fromMinor(allocation.amountMinor, decimals), appliesToEachItem: false } },
        });
      }
    }
  }

  if (candidates.length === 0) return NONE;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: 'ALL' } }] };
}
