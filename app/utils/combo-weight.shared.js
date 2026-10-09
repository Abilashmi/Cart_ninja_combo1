/**
 * Combo pages: weight-based box pricing — the one copy of the rules.
 *
 * A shopper builds a box on a combo page; once the box's total weight reaches
 * a tier the merchant set (e.g. 1 kg), that tier's price applies: a
 * percentage off, a fixed amount off, or a fixed box price. Weight is each
 * variant's Shopify weight; variants without one don't count.
 *
 * Everything lives inside createComboWeightCore(), which has no imports and
 * uses only ES5 syntax, so exactly the same code runs in:
 *   - the checkout Function (extensions/brix-combo-weight-discount), which
 *     really applies the discount,
 *   - BRIX COD (app/services/cod.server.js), so COD charges the same price,
 *   - the storefront script (combo-page[.]js.jsx injects
 *     createComboWeightCore.toString()), the builder and its preview.
 * Don't add imports, closures over outside variables, or newer syntax inside
 * the factory: its source text is shipped to browsers as-is.
 *
 * Money inside is always whole minor units (paise, cents) so splitting a
 * discount across lines adds up exactly.
 */
export function createComboWeightCore() {
  var GRAMS_PER_UNIT = {
    GRAMS: 1, G: 1,
    KILOGRAMS: 1000, KG: 1000,
    OUNCES: 28.349523125, OZ: 28.349523125,
    POUNDS: 453.59237, LB: 453.59237, LBS: 453.59237,
  };
  var ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'XPF', 'PYG', 'RWF', 'KMF', 'DJF', 'GNF', 'VUV', 'BIF'];
  var THREE_DECIMAL = ['BHD', 'KWD', 'OMR', 'JOD', 'TND'];
  var TIER_TYPES = ['percentage', 'fixed_amount', 'fixed_price'];
  // The Weight Box template (Pro): always priced by weight, its own design.
  var WEIGHT_BOX_LAYOUT = 'layout5';
  var LIMITS = { tiers: 5, products: 50, collections: 100, label: 60, message: 160, maxGrams: 1000000 };
  var DEFAULT_MESSAGES = {
    locked: 'Add {{remaining}} more to unlock {{tier}}',
    unlocked: '{{tier}} unlocked!',
    over_max: 'Your box can weigh up to {{max}}. Remove something to add this.',
  };

  function round(value, places) {
    var f = Math.pow(10, places);
    return Math.round(value * f) / f;
  }

  /** Grams for one unit of a variant, or null when it has no usable weight. */
  function toGrams(value, unit) {
    var n = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(n) || n <= 0) return null;
    var factor = GRAMS_PER_UNIT[String(unit || '').toUpperCase()];
    if (!factor) return null;
    return round(n * factor, 3);
  }

  function decimalsFor(currencyCode) {
    var code = String(currencyCode || '').toUpperCase();
    if (ZERO_DECIMAL.indexOf(code) !== -1) return 0;
    if (THREE_DECIMAL.indexOf(code) !== -1) return 3;
    return 2;
  }

  /** A money amount (major units, number or decimal string) as whole minor units. */
  function toMinor(amount, decimals) {
    var n = Number(amount);
    if (!isFinite(n)) return 0;
    return Math.round(Number((n * Math.pow(10, decimals)).toFixed(6)));
  }

  function fromMinor(minor, decimals) {
    return (minor / Math.pow(10, decimals)).toFixed(decimals);
  }

  /**
   * Split total minor units across parts in proportion to weights (largest
   * remainder). The parts always add up to exactly total, and none is larger
   * than its weight when total <= sum(weights).
   */
  function allocateMinor(total, weights) {
    var parts = [];
    var rems = [];
    var sum = 0;
    var i;
    for (i = 0; i < weights.length; i++) sum += weights[i] > 0 ? weights[i] : 0;
    total = Math.max(0, Math.round(total));
    if (!(sum > 0) || total === 0) {
      for (i = 0; i < weights.length; i++) parts.push(0);
      return parts;
    }
    if (total > sum) total = sum;
    var given = 0;
    for (i = 0; i < weights.length; i++) {
      var w = weights[i] > 0 ? weights[i] : 0;
      var share = Math.floor((total * w) / sum);
      parts.push(share);
      rems.push({ index: i, rem: total * w - share * sum });
      given += share;
    }
    rems.sort(function (a, b) { return b.rem - a.rem || a.index - b.index; });
    for (i = 0; given < total && i < rems.length; i++) {
      parts[rems[i].index] += 1;
      given += 1;
    }
    return parts;
  }

  /** The highest tier the box reaches (tiers ascending), or null. */
  function pickTier(tiers, grams) {
    var found = null;
    for (var i = 0; i < (tiers || []).length; i++) {
      if (grams >= tiers[i].min_grams) found = tiers[i];
    }
    return found;
  }

  function nextTierAfter(tiers, grams) {
    for (var i = 0; i < (tiers || []).length; i++) {
      if (tiers[i].min_grams > grams) return tiers[i];
    }
    return null;
  }

  /**
   * "1.05 kg" / "950 g". Rounds down, so a box is never shown heavier than it
   * is; roundUp for amounts still to add, so "add 0 kg more" never appears.
   */
  function formatWeight(grams, unit, roundUp) {
    var g = Math.max(0, Number(grams) || 0);
    var step = roundUp ? Math.ceil : Math.floor;
    var nudge = roundUp ? -1e-9 : 1e-9;
    if (unit === 'g') return step(g + nudge) + ' g';
    var kg = step(g / 10 + nudge) / 100;
    return String(kg) + ' kg';
  }

  /** What a tier is called at checkout and on the page. */
  function tierLabel(tier, unit) {
    if (tier && tier.label) return tier.label;
    return formatWeight(tier ? tier.min_grams : 0, unit) + ' box discount';
  }

  function fillMessage(template, vars) {
    return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (all, key) {
      return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : all;
    });
  }

  function fnv1a(text, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) >>> 0 : (h * 16777619) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /** Fingerprint of everything that changes the price. Same input → same hash, in every runtime. */
  function pricingHash(pricing) {
    var p = pricing || {};
    var q = p.qualify || {};
    var tiers = (p.tiers || []).map(function (t) {
      return [t.min_grams, t.type, t.value, tierLabel(t, p.unit)];
    });
    var canonical = JSON.stringify([
      1,
      p.max_grams === undefined ? null : p.max_grams,
      q.mode || 'layout_collections',
      (q.collection_ids || []).slice().sort(),
      (q.product_ids || []).slice().sort(),
      tiers,
    ]);
    return fnv1a(canonical, 2166136261) + fnv1a(canonical, 374761393);
  }

  function toGid(type, value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (/^\d+$/.test(s)) return 'gid://shopify/' + type + '/' + s;
    var m = new RegExp('^gid://shopify/' + type + '/(\\d+)$').exec(s);
    return m ? s : null;
  }

  function uniqueGids(type, list) {
    var out = [];
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) {
      var gid = toGid(type, arr[i] && typeof arr[i] === 'object' ? arr[i].id : arr[i]);
      if (gid && out.indexOf(gid) === -1) out.push(gid);
    }
    return out;
  }

  function cleanText(value, max, fallback) {
    var s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!s) return fallback;
    return s.slice(0, max);
  }

  function defaultWeightPricing() {
    return {
      unit: 'kg',
      max_grams: null,
      qualify: { mode: 'layout_collections', collection_ids: [], product_ids: [] },
      tiers: [{ id: 't1', min_grams: 1000, type: 'percentage', value: 10, label: '' }],
      messages: { locked: DEFAULT_MESSAGES.locked, unlocked: DEFAULT_MESSAGES.unlocked, over_max: DEFAULT_MESSAGES.over_max },
    };
  }

  /**
   * Validate and clean a merchant's weight pricing. Always returns a usable
   * value (with its hash); errors (each { field, message }) must be empty
   * before it may be saved.
   */
  function normalizeWeightPricing(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var errors = [];
    var warnings = [];
    var unit = src.unit === 'g' ? 'g' : 'kg';

    var maxGrams = null;
    if (src.max_grams !== null && src.max_grams !== undefined && src.max_grams !== '') {
      var m = Number(src.max_grams);
      if (!isFinite(m) || m <= 0 || Math.floor(m) !== m) {
        errors.push({ field: 'max_grams', message: 'Max weight must be a whole number of grams above 0.' });
      } else if (m > LIMITS.maxGrams) {
        errors.push({ field: 'max_grams', message: 'Max weight can be at most 1000 kg.' });
      } else {
        maxGrams = m;
      }
    }

    var rawTiers = Array.isArray(src.tiers) ? src.tiers : [];
    if (rawTiers.length === 0) errors.push({ field: 'tiers', message: 'Add at least one weight tier.' });
    if (rawTiers.length > LIMITS.tiers) errors.push({ field: 'tiers', message: 'You can add up to ' + LIMITS.tiers + ' tiers.' });
    var tiers = [];
    var usedIds = {};
    for (var i = 0; i < Math.min(rawTiers.length, LIMITS.tiers); i++) {
      var t = rawTiers[i] && typeof rawTiers[i] === 'object' ? rawTiers[i] : {};
      var field = 'tiers.' + i;
      var id = typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) && !usedIds[t.id] ? t.id : 't' + (i + 1);
      while (usedIds[id]) id = id + 'x';
      usedIds[id] = true;

      var min = Number(t.min_grams);
      if (!isFinite(min) || min <= 0 || Math.floor(min) !== min) {
        errors.push({ field: field + '.min_grams', message: 'Tier ' + (i + 1) + ': the weight must be a whole number of grams above 0.' });
        min = 0;
      } else if (min > LIMITS.maxGrams) {
        errors.push({ field: field + '.min_grams', message: 'Tier ' + (i + 1) + ': the weight can be at most 1000 kg.' });
      }

      var type = TIER_TYPES.indexOf(t.type) !== -1 ? t.type : null;
      if (!type) {
        errors.push({ field: field + '.type', message: 'Tier ' + (i + 1) + ': choose percentage off, amount off or box price.' });
        type = 'percentage';
      }

      var value = Number(t.value);
      if (!isFinite(value)) value = 0;
      value = round(value, 2);
      if (type === 'percentage' && !(value > 0 && value <= 100)) {
        errors.push({ field: field + '.value', message: 'Tier ' + (i + 1) + ': the percentage must be above 0 and at most 100.' });
      } else if (type !== 'percentage' && !(value > 0)) {
        errors.push({ field: field + '.value', message: 'Tier ' + (i + 1) + ': the amount must be above 0.' });
      }

      if (tiers.length && min > 0 && min <= tiers[tiers.length - 1].min_grams) {
        errors.push({ field: field + '.min_grams', message: 'Tier ' + (i + 1) + ' must weigh more than tier ' + i + '.' });
      }
      tiers.push({ id: id, min_grams: min, type: type, value: value, label: cleanText(t.label, LIMITS.label, '') });
    }

    var top = tiers.length ? tiers[tiers.length - 1].min_grams : 0;
    if (maxGrams !== null && top > 0 && maxGrams < top) {
      errors.push({ field: 'max_grams', message: 'Max weight must be at least the heaviest tier (' + formatWeight(top, unit) + ').' });
    }
    var hasFixedPrice = false;
    for (i = 0; i < tiers.length; i++) if (tiers[i].type === 'fixed_price') hasFixedPrice = true;
    if (hasFixedPrice && maxGrams === null) {
      errors.push({ field: 'max_grams', message: 'A fixed box price needs a max weight, so the box can\'t keep growing at the same price.' });
    }

    var q = src.qualify && typeof src.qualify === 'object' ? src.qualify : {};
    var mode = q.mode === 'selected' ? 'selected' : 'layout_collections';
    var collectionIds = uniqueGids('Collection', q.collection_ids);
    var productIds = uniqueGids('Product', q.product_ids);
    if (collectionIds.length > LIMITS.collections) errors.push({ field: 'qualify.collection_ids', message: 'Choose at most ' + LIMITS.collections + ' collections.' });
    if (productIds.length > LIMITS.products) errors.push({ field: 'qualify.product_ids', message: 'Choose at most ' + LIMITS.products + ' products.' });
    if (mode === 'selected' && collectionIds.length === 0 && productIds.length === 0) {
      errors.push({ field: 'qualify', message: 'Choose at least one product or collection that counts toward the box.' });
    }
    if (mode === 'layout_collections') {
      // The page's own collections are resolved on the server when it syncs.
      collectionIds = [];
      productIds = [];
    }

    var msgs = src.messages && typeof src.messages === 'object' ? src.messages : {};
    var messages = {
      locked: cleanText(msgs.locked, LIMITS.message, DEFAULT_MESSAGES.locked),
      unlocked: cleanText(msgs.unlocked, LIMITS.message, DEFAULT_MESSAGES.unlocked),
      over_max: cleanText(msgs.over_max, LIMITS.message, DEFAULT_MESSAGES.over_max),
    };

    for (i = 0; i < tiers.length; i++) {
      if (tiers[i].type === 'percentage' && tiers[i].value >= 50 && tiers[i].value <= 100) {
        warnings.push({ field: 'tiers.' + i + '.value', message: 'Tier ' + (i + 1) + ' gives ' + tiers[i].value + '% off. Check that is what you meant.' });
      }
    }

    var value2 = {
      unit: unit,
      max_grams: maxGrams,
      qualify: { mode: mode, collection_ids: collectionIds.slice(0, LIMITS.collections), product_ids: productIds.slice(0, LIMITS.products) },
      tiers: tiers,
      messages: messages,
    };
    value2.hash = pricingHash(value2);
    return { value: value2, errors: errors, warnings: warnings };
  }

  /**
   * Price one box.
   *   pricing  normalized weight pricing ({ tiers, max_grams, unit })
   *   lines    [{ key, unitGrams, quantity, subtotalMinor, qualifies }]
   *            subtotalMinor = the line's total before this discount, in minor units
   *   decimals minor-unit places of the currency the lines are priced in
   *   rate     shop currency → that currency (fixed amounts/prices are set in the shop currency)
   * Lines that don't qualify or have no weight don't count toward the box and
   * are never discounted.
   */
  function computeBox(opts) {
    var pricing = opts.pricing || {};
    var tiers = pricing.tiers || [];
    var decimals = opts.decimals === undefined ? 2 : opts.decimals;
    var rate = Number(opts.rate) > 0 ? Number(opts.rate) : 1;
    var lines = opts.lines || [];
    var counted = [];
    var unweighedKeys = [];
    var grams = 0;
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      var qty = Number(line.quantity) || 0;
      if (line.qualifies === false || qty <= 0) continue;
      if (!(line.unitGrams > 0)) { unweighedKeys.push(line.key); continue; }
      counted.push(line);
      grams += line.unitGrams * qty;
    }
    grams = round(grams, 2);

    var maxGrams = pricing.max_grams === undefined ? null : pricing.max_grams;
    var overMax = maxGrams !== null && grams > maxGrams;
    var tier = overMax ? null : pickTier(tiers, grams);
    var nextTier = nextTierAfter(tiers, grams);
    var remainingGrams = nextTier ? Math.ceil(round(nextTier.min_grams - grams, 2)) : 0;

    var subtotals = [];
    var subtotal = 0;
    for (i = 0; i < counted.length; i++) {
      var s = Math.max(0, Math.round(Number(counted[i].subtotalMinor) || 0));
      subtotals.push(s);
      subtotal += s;
    }

    var parts = [];
    if (tier && subtotal > 0) {
      if (tier.type === 'percentage') {
        for (i = 0; i < subtotals.length; i++) parts.push(Math.min(subtotals[i], Math.round((subtotals[i] * tier.value) / 100)));
      } else if (tier.type === 'fixed_amount') {
        parts = allocateMinor(Math.min(toMinor(tier.value * rate, decimals), subtotal), subtotals);
      } else if (tier.type === 'fixed_price') {
        parts = allocateMinor(Math.max(0, subtotal - toMinor(tier.value * rate, decimals)), subtotals);
      }
    }
    var discountMinor = 0;
    var allocations = [];
    for (i = 0; i < parts.length; i++) {
      discountMinor += parts[i];
      if (parts[i] > 0) allocations.push({ key: counted[i].key, amountMinor: parts[i] });
    }

    var countedKeys = [];
    for (i = 0; i < counted.length; i++) countedKeys.push(counted[i].key);
    return {
      grams: grams,
      tier: tier,
      nextTier: nextTier,
      remainingGrams: remainingGrams,
      overMax: overMax,
      subtotalMinor: subtotal,
      discountMinor: discountMinor,
      allocations: allocations,
      countedKeys: countedKeys,
      unweighedKeys: unweighedKeys,
    };
  }

  /**
   * What the weight meter tells the shopper about a box (computeBox result):
   * { tone: 'muted' | 'success' | 'error', text }. view = { tiers, unit,
   * maxGrams, messages, enabled }; with enabled false (the box discount isn't
   * live) it only talks about weight, never a discount.
   */
  function boxMessage(view, box) {
    var msgs = view.messages || DEFAULT_MESSAGES;
    var unit = view.unit;
    var tiers = view.tiers || [];
    var vars = {
      weight: formatWeight(box.grams, unit),
      max: view.maxGrams === null || view.maxGrams === undefined ? '' : formatWeight(view.maxGrams, unit),
      remaining: formatWeight(box.remainingGrams, unit, true),
      tier: '',
    };
    if (box.overMax) return { tone: 'error', text: fillMessage(msgs.over_max || DEFAULT_MESSAGES.over_max, vars) };
    if (!view.enabled) {
      if (tiers.length && box.grams < tiers[0].min_grams) {
        return { tone: 'muted', text: 'Add ' + formatWeight(tiers[0].min_grams - box.grams, unit, true) + ' more to complete your box' };
      }
      return { tone: 'muted', text: 'Your box weighs ' + vars.weight };
    }
    if (box.nextTier) {
      vars.tier = tierLabel(box.nextTier, unit);
      var locked = fillMessage(msgs.locked || DEFAULT_MESSAGES.locked, vars);
      if (box.tier) return { tone: 'success', text: fillMessage(msgs.unlocked || DEFAULT_MESSAGES.unlocked, { tier: tierLabel(box.tier, unit) }) + ' ' + locked };
      return { tone: 'muted', text: locked };
    }
    if (box.tier) return { tone: 'success', text: fillMessage(msgs.unlocked || DEFAULT_MESSAGES.unlocked, { tier: tierLabel(box.tier, unit) }) };
    return { tone: 'muted', text: 'Your box weighs ' + vars.weight };
  }

  /**
   * Collection handles a combo template's layout shows products from — the
   * products that count toward the box in "layout_collections" mode.
   */
  function comboCollectionHandles(config) {
    var c = config || {};
    var handles = [];
    function add(h) { if (h && handles.indexOf(h) === -1) handles.push(h); }
    var i;
    if (c.layout === 'layout1' || !c.layout) {
      for (i = 1; i <= 5; i++) {
        if (i === 1 || c['step_' + i + '_collection'] || c['step_' + i + '_title']) add(c['step_' + i + '_collection']);
      }
    }
    if (c.layout === 'layout2') {
      for (i = 1; i <= (c.tab_count || 8); i++) add(c['col_' + i]);
    }
    // The Weight Box: its collection pills, like layout2's tabs.
    if (c.layout === WEIGHT_BOX_LAYOUT) {
      for (i = 1; i <= (c.tab_count || 4); i++) add(c['col_' + i]);
    }
    if (!c.layout || c.layout === 'layout3' || c.layout === 'layout4') add(c.collection_handle || c.step_1_collection);
    if (c.layout === 'layout3') {
      for (i = 1; i <= 4; i++) add(c['col_' + i]);
    }
    return handles;
  }

  return {
    WEIGHT_BOX_LAYOUT: WEIGHT_BOX_LAYOUT,
    TIER_TYPES: TIER_TYPES,
    LIMITS: LIMITS,
    DEFAULT_MESSAGES: DEFAULT_MESSAGES,
    toGrams: toGrams,
    decimalsFor: decimalsFor,
    toMinor: toMinor,
    fromMinor: fromMinor,
    allocateMinor: allocateMinor,
    pickTier: pickTier,
    nextTierAfter: nextTierAfter,
    formatWeight: formatWeight,
    tierLabel: tierLabel,
    fillMessage: fillMessage,
    pricingHash: pricingHash,
    defaultWeightPricing: defaultWeightPricing,
    normalizeWeightPricing: normalizeWeightPricing,
    computeBox: computeBox,
    boxMessage: boxMessage,
    comboCollectionHandles: comboCollectionHandles,
  };
}

const core = createComboWeightCore();

export const {
  WEIGHT_BOX_LAYOUT, TIER_TYPES, LIMITS, DEFAULT_MESSAGES,
  toGrams, decimalsFor, toMinor, fromMinor, allocateMinor, pickTier, nextTierAfter, formatWeight,
  tierLabel, fillMessage, pricingHash, defaultWeightPricing, normalizeWeightPricing, computeBox,
  boxMessage, comboCollectionHandles,
} = core;

/**
 * Is this saved combo config a weight-priced box? Absent keys = the classic
 * item-count combo. The Weight Box template is always one.
 */
export function isWeightCombo(config) {
  return Boolean(config && (config.pricing_mode === 'weight' || config.layout === WEIGHT_BOX_LAYOUT));
}
