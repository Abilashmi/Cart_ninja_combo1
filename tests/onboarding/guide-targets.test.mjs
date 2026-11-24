// Run with: node --test tests/onboarding
// Every guided-setup step points at an element that really exists: each
// target / reveal / click id in config/guide-tours.js is set in the page's
// own source (a literal data-tour="id", or the page's data-tour pattern plus
// a real section / step id), and each revealEvent has a page that answers it.
// Catches a renamed section or a typo for every feature, including those the
// browser check (guide-browser-check.mjs) doesn't walk through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GUIDE_TOURS } from '../../app/config/guide-tours.js';

const read = (f) => fs.readFileSync(f, 'utf8');
const literal = (src, id) => src.includes(`data-tour="${id}"`) || src.includes(`data-tour='${id}'`) || src.includes(`"${id}" : undefined`);

// Where each feature's elements live.
const FILES = {
  home: 'app/routes/app._index.jsx',
  cod: 'app/routes/app.cod_.customize.jsx',
  cart: ['app/components/CartEditorSidebar.jsx', 'app/components/CartPreview.jsx'],
  fbt: 'app/routes/app.fbt.jsx',
  coupon: 'app/routes/app.productwidget.jsx',
  combo: ['app/routes/app.bundles._index.jsx', 'app/routes/app.bundles.customize.jsx', 'app/components/bundles/TemplateManager.jsx', 'app/components/customization/AdvancedSection.jsx', 'app/components/customization/BuilderActionBar.jsx'],
  packs: ['app/routes/app.packs._index.jsx', 'app/components/packs/PackBuilder.jsx'],
  discounts: ['app/routes/app.coupons.jsx', 'app/routes/app.discounts.create.jsx'],
  brix_ai: 'app/components/ai-agent/BrixAiPage.jsx',
};
const sources = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, [].concat(f).map(read).join('\n')]));

// Section ids each editor really has.
const cartSections = [...read('app/types/cartEditorTypes.js').matchAll(/\{\s*id:\s*'(\w+)',\s*label:/g)].map((m) => m[1]);
const codSections = [...sources.cod.matchAll(/\{\s*id:\s*'(\w+)',\s*label:/g)].map((m) => m[1]);
const accordionIds = (src) => [...src.matchAll(/<AccordionSection id="(\w+)"/g)].map((m) => m[1]);
const packSteps = (sources.packs.match(/const STEP_KEYS = \[([^\]]+)\]/)?.[1] || '').match(/'(\w+)'/g)?.map((s) => s.slice(1, -1)) || [];

function exists(moduleId, id) {
  if (id === `home-mod-${moduleId}-customize`) return sources.home.includes('data-tour={homeCustomizeTarget(id)}');
  const section = /^(\w+)-section-(\w+?)(-toggle)?$/.exec(id);
  if (section) {
    const [, prefix, sectionId, toggle] = section;
    const src = sources[prefix === 'cart' ? 'cart' : prefix];
    const pattern = toggle ? `data-tour={\`${prefix}-section-\${` : `data-tour={\`${prefix}-section-\${`;
    const ids = prefix === 'cart' ? cartSections : prefix === 'cod' ? codSections : accordionIds(src);
    return Boolean(src && src.includes(pattern) && (!toggle || src.includes('-toggle`}')) && ids.includes(sectionId));
  }
  const step = /^packs-step-(\w+)$/.exec(id);
  if (step) return sources.packs.includes('data-tour={`packs-step-${STEP_KEYS[step]}`}') && packSteps.includes(step[1]);
  return literal(sources[moduleId], id);
}

test('the section and step lists were read', () => {
  assert.ok(cartSections.includes('upsellProducts') && codSections.includes('fraud'));
  assert.deepEqual(packSteps, ['product', 'type', 'configure', 'design', 'customize', 'review']);
  assert.ok(accordionIds(sources.fbt).includes('offer') && accordionIds(sources.coupon).includes('coupon'));
});

for (const [moduleId, tour] of Object.entries(GUIDE_TOURS)) {
  test(`${moduleId}: every step's element is in the page`, () => {
    for (const step of tour.steps) {
      for (const key of ['target', 'reveal', 'click']) {
        if (step[key]) assert.ok(exists(moduleId, step[key]), `${moduleId}.${step.id}.${key} = "${step[key]}" is not set by the page`);
      }
    }
  });
}

test('every revealEvent has a page that answers it', () => {
  const answered = {
    'combo-discount': sources.combo.includes("useGuideReveal((id) => { if (id === 'combo-discount')"),
  };
  for (const tour of Object.values(GUIDE_TOURS)) {
    for (const step of tour.steps) {
      if (!step.revealEvent) continue;
      if (step.revealEvent.startsWith('packs-step-')) {
        assert.ok(sources.packs.includes("String(id).replace(/^packs-step-/, '')") && packSteps.includes(step.revealEvent.slice('packs-step-'.length)), step.revealEvent);
      } else {
        assert.ok(answered[step.revealEvent], `${step.revealEvent} has no useGuideReveal handler`);
      }
    }
  }
});
