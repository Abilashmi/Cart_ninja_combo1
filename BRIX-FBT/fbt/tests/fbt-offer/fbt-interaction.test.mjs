// Run with: node --import ./tests/packs/register.mjs --test tests/fbt-offer/fbt-interaction.test.mjs
// The FBT add style survives a refresh: fbt_widget_settings.interaction_type
// was ENUM('classic','quick-add','bundle') while the app saves 'quickAdd' /
// 'checkboxQty', so MariaDB stored '' and the page fell back to Classic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFbtInteractionColumn, cleanFbtInteraction } from '../../app/services/cart-config-writes.server.js';

test('the old ENUM column is widened to text once; a text column is left alone', async () => {
  const sql = [];
  const db = (type) => ({ execute: async (q) => { sql.push(q); return /information_schema/.test(q) ? [[{ COLUMN_TYPE: type }]] : [{}]; } });
  await ensureFbtInteractionColumn(db("enum('classic','quick-add','bundle')"));
  assert.ok(sql.some((q) => /MODIFY `interaction_type` VARCHAR\(20\)/.test(q)), sql.join(' | '));
  const before = sql.length;
  await ensureFbtInteractionColumn(db("enum('classic','quick-add','bundle')"));
  assert.equal(sql.length, before, 'checked once per process');
});

test('saved values read back as the app\'s own names; the lost ones are empty (then the template decides)', () => {
  assert.equal(cleanFbtInteraction('quickAdd'), 'quickAdd');
  assert.equal(cleanFbtInteraction('checkboxQty'), 'checkboxQty');
  assert.equal(cleanFbtInteraction('quick-add'), 'quickAdd', 'the ENUM spelling');
  assert.equal(cleanFbtInteraction('bundle'), 'bundle');
  assert.equal(cleanFbtInteraction(''), '', 'what the ENUM stored for quickAdd');
  assert.equal(cleanFbtInteraction(null), '');
  assert.equal(cleanFbtInteraction('nonsense'), '');
});
