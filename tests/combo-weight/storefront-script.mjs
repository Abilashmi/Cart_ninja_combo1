// The storefront combo-page script exactly as app/routes/combo-page[.]js.jsx
// serves it, for browser checks that can't import a .jsx route module: the
// String.raw body with the same values interpolated.
import fs from 'node:fs';
import path from 'node:path';
import { createComboWeightCore } from '../../app/utils/combo-weight.shared.js';
import { WEIGHT_BOX_CSS } from '../../app/utils/combo-weight-box.css.js';
import { createQuickShopKit, QUICK_SHOP_CSS } from '../../app/utils/combo-quickshop.shared.js';

const INTERPOLATIONS = {
  '${createComboWeightCore.toString()}': () => createComboWeightCore.toString(),
  '${JSON.stringify(WEIGHT_BOX_CSS)}': () => JSON.stringify(WEIGHT_BOX_CSS),
  '${createQuickShopKit.toString()}': () => createQuickShopKit.toString(),
  '${JSON.stringify(QUICK_SHOP_CSS)}': () => JSON.stringify(QUICK_SHOP_CSS),
};

export function loadComboPageScript() {
  const source = fs.readFileSync(path.resolve('app/routes/combo-page[.]js.jsx'), 'utf8');
  let script = source.slice(source.indexOf('String.raw`') + 'String.raw`'.length, source.lastIndexOf('\n`;'));
  for (const [placeholder, value] of Object.entries(INTERPOLATIONS)) script = script.replace(placeholder, value);
  if (script.includes('${')) throw new Error('combo-page script has an interpolation this helper does not know about');
  return script;
}
