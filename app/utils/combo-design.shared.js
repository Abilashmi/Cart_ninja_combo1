/**
 * Classic Combo: one template, three designs. The builder's Design section
 * switches a combo between them; `layout` stays the stored key, so existing
 * combos and the storefront renderers are unchanged.
 */

export const CLASSIC_DESIGNS = [
  { layout: 'layout1', name: 'Guided Architect', short: 'Step by step', description: 'One collection per step, in order.' },
  { layout: 'layout2', name: 'Velocity Stream', short: 'Collection tabs', description: 'Collections as tabs, picked in any order.' },
  { layout: 'layout4', name: 'Editorial Split', short: 'One grid', description: 'One collection in a single grid.' },
];

const CLASSIC_LAYOUTS = CLASSIC_DESIGNS.map((d) => d.layout);
const MAX_STEPS = 5; // comboCollectionHandles reads step_1..step_5
const MAX_TABS = 8;

/** Is this one of the Classic Combo designs (absent layout = layout1)? */
export function isClassicLayout(layout) {
  return !layout || CLASSIC_LAYOUTS.includes(layout);
}

export function classicDesignName(layout) {
  return (CLASSIC_DESIGNS.find((d) => d.layout === (layout || 'layout1')) || CLASSIC_DESIGNS[0]).name;
}

const filled = (v) => typeof v === 'string' && v.trim() !== '';

/** The collection handles a design is set up with, in order. */
export function designCollections(config, layout = config?.layout) {
  const c = config || {};
  const out = [];
  const add = (h) => { if (filled(h) && !out.includes(h)) out.push(h); };
  if (!layout || layout === 'layout1') {
    const steps = Math.min(MAX_STEPS, Math.max(1, Number(c.max_selections) || 1));
    for (let i = 1; i <= steps; i++) add(c[`step_${i}_collection`]);
  } else if (layout === 'layout2') {
    const tabs = Math.min(MAX_TABS, Math.max(1, Number(c.tab_count) || 1));
    for (let i = 1; i <= tabs; i++) add(c[`col_${i}`]);
  } else if (layout === 'layout4') {
    add(c.collection_handle);
  }
  return out;
}

/**
 * The config patch that moves a Classic Combo to another design. The new
 * design starts with the old one's collections when it has none of its own
 * (steps ↔ tabs ↔ the single grid collection); its own earlier setup is kept,
 * and no key is removed, so switching back restores everything.
 */
export function switchComboDesign(config, toLayout) {
  const c = config || {};
  if (!CLASSIC_LAYOUTS.includes(toLayout)) return {};
  const fromLayout = c.layout || 'layout1';
  const patch = { layout: toLayout };
  if (fromLayout === toLayout) return patch;
  const source = designCollections(c, fromLayout);
  if (!source.length || designCollections(c, toLayout).length) return patch;

  if (toLayout === 'layout1') {
    const steps = source.slice(0, MAX_STEPS);
    steps.forEach((handle, i) => { patch[`step_${i + 1}_collection`] = handle; });
    patch.max_selections = steps.length;
  } else if (toLayout === 'layout2') {
    const tabs = source.slice(0, MAX_TABS);
    tabs.forEach((handle, i) => { patch[`col_${i + 1}`] = handle; });
    patch.tab_count = tabs.length;
  } else if (toLayout === 'layout4') {
    patch.collection_handle = source[0];
  }
  return patch;
}
