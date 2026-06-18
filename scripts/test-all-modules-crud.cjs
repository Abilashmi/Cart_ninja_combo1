/**
 * CRUD test for every module against cart_drawer_ninja.
 * Run: node scripts/test-all-modules-crud.cjs
 */
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'cart_drawer_ninja',
  });
  const shop = 'crud-test.myshopify.com';
  const results = [];
  const ok = (label) => results.push(`  ✅ ${label}`);
  const fail = (label, err) => results.push(`  ❌ ${label}: ${err}`);

  // ── 1. cart_drawer_config ─────────────────────────────────────────────────
  try {
    await conn.execute(`INSERT INTO cart_drawer_config (shop_domain,is_enabled,checkout_button_text) VALUES (?,1,'Test Checkout') ON DUPLICATE KEY UPDATE is_enabled=1,checkout_button_text='Test Checkout',updated_at=CURRENT_TIMESTAMP(3)`, [shop]);
    const [r] = await conn.query('SELECT * FROM cart_drawer_config WHERE shop_domain=?', [shop]);
    if (r[0].checkout_button_text === 'Test Checkout') ok('cart_drawer_config CREATE/READ');
    await conn.execute('UPDATE cart_drawer_config SET checkout_button_text=? WHERE shop_domain=?', ['Updated Checkout', shop]);
    const [r2] = await conn.query('SELECT checkout_button_text FROM cart_drawer_config WHERE shop_domain=?', [shop]);
    if (r2[0].checkout_button_text === 'Updated Checkout') ok('cart_drawer_config UPDATE');
    else fail('cart_drawer_config UPDATE', 'value did not change');
  } catch(e) { fail('cart_drawer_config', e.message); }

  // ── 2. progress_bar_settings + tiers ─────────────────────────────────────
  try {
    const [ins] = await conn.execute(`INSERT INTO progress_bar_settings (shop_domain,is_enabled,mode,bar_foreground_color) VALUES (?,1,'amount','#ff0000') ON DUPLICATE KEY UPDATE is_enabled=1,bar_foreground_color='#ff0000',updated_at=CURRENT_TIMESTAMP(3)`, [shop]);
    let settingsId = ins.insertId;
    if (!settingsId) {
      const [ex] = await conn.query('SELECT id FROM progress_bar_settings WHERE shop_domain=?', [shop]);
      settingsId = ex[0].id;
    }
    await conn.execute('DELETE FROM progress_bar_tiers WHERE settings_id=?', [settingsId]);
    await conn.execute('INSERT INTO progress_bar_tiers (shop_domain,settings_id,min_value,description,reward_type,sort_order) VALUES (?,?,500,"Free Shipping","free_shipping",0)', [shop, settingsId]);
    await conn.execute('INSERT INTO progress_bar_tiers (shop_domain,settings_id,min_value,description,reward_type,sort_order) VALUES (?,?,1000,"Free Gift","product",1)', [shop, settingsId]);
    const [tiers] = await conn.query('SELECT * FROM progress_bar_tiers WHERE settings_id=?', [settingsId]);
    if (tiers.length === 2) ok('progress_bar_settings + 2 tiers CREATE/READ');
    else fail('progress_bar tiers', `expected 2 tiers, got ${tiers.length}`);
    // Update
    await conn.execute('UPDATE progress_bar_settings SET bar_foreground_color=? WHERE shop_domain=?', ['#00ff00', shop]);
    const [r2] = await conn.query('SELECT bar_foreground_color FROM progress_bar_settings WHERE shop_domain=?', [shop]);
    if (r2[0].bar_foreground_color === '#00ff00') ok('progress_bar_settings UPDATE');
    // Delete tier
    await conn.execute('DELETE FROM progress_bar_tiers WHERE settings_id=? AND sort_order=1', [settingsId]);
    const [t2] = await conn.query('SELECT COUNT(*) as n FROM progress_bar_tiers WHERE settings_id=?', [settingsId]);
    if (t2[0].n === 1) ok('progress_bar_tiers DELETE tier');
  } catch(e) { fail('progress_bar', e.message); }

  // ── 3. coupon_slider_settings ─────────────────────────────────────────────
  try {
    await conn.execute(`INSERT INTO coupon_slider_settings (shop_domain,is_enabled,selected_template,title_text) VALUES (?,1,'template2','My Coupons') ON DUPLICATE KEY UPDATE is_enabled=1,selected_template='template2',title_text='My Coupons',updated_at=CURRENT_TIMESTAMP(3)`, [shop]);
    const [r] = await conn.query('SELECT * FROM coupon_slider_settings WHERE shop_domain=?', [shop]);
    if (r[0].selected_template === 'template2') ok('coupon_slider_settings CREATE/READ');
    await conn.execute('UPDATE coupon_slider_settings SET title_text=? WHERE shop_domain=?', ['Updated Coupons', shop]);
    const [r2] = await conn.query('SELECT title_text FROM coupon_slider_settings WHERE shop_domain=?', [shop]);
    if (r2[0].title_text === 'Updated Coupons') ok('coupon_slider_settings UPDATE');
  } catch(e) { fail('coupon_slider_settings', e.message); }

  // ── 4. coupon_display_rules (full CRUD) ───────────────────────────────────
  try {
    const [ins] = await conn.execute(`INSERT INTO coupon_display_rules (shop_domain,coupon_code,name,heading_text,subtext_text,bg_color,button_text,is_active,sort_order) VALUES (?,?,?,?,?,?,?,1,0)`, [shop,'SAVE10','Save 10%','Get 10% Off','Limited time offer','#ffffff','Apply']);
    const ruleId = ins.insertId;
    const [r] = await conn.query('SELECT * FROM coupon_display_rules WHERE id=?', [ruleId]);
    if (r[0].coupon_code === 'SAVE10') ok('coupon_display_rules CREATE/READ');
    // Update code and name
    await conn.execute('UPDATE coupon_display_rules SET coupon_code=?,name=? WHERE id=?', ['SAVE20','Save 20%',ruleId]);
    const [r2] = await conn.query('SELECT coupon_code,name FROM coupon_display_rules WHERE id=?', [ruleId]);
    if (r2[0].coupon_code === 'SAVE20' && r2[0].name === 'Save 20%') ok('coupon_display_rules UPDATE (code + name)');
    // Second rule
    await conn.execute(`INSERT INTO coupon_display_rules (shop_domain,coupon_code,name,is_active,sort_order) VALUES (?,?,?,1,1)`, [shop,'FLAT50','Flat 50 Off']);
    const [all] = await conn.query('SELECT * FROM coupon_display_rules WHERE shop_domain=? ORDER BY sort_order', [shop]);
    if (all.length === 2) ok('coupon_display_rules multiple rules READ');
    // Delete one
    await conn.execute('DELETE FROM coupon_display_rules WHERE id=?', [ruleId]);
    const [remaining] = await conn.query('SELECT COUNT(*) as n FROM coupon_display_rules WHERE shop_domain=?', [shop]);
    if (remaining[0].n === 1) ok('coupon_display_rules DELETE');
  } catch(e) { fail('coupon_display_rules', e.message); }

  // ── 5. upsell_widget_settings ─────────────────────────────────────────────
  try {
    await conn.execute(`INSERT INTO upsell_widget_settings (shop_domain,is_enabled,title,layout,display_limit) VALUES (?,1,'My Upsells','carousel',4) ON DUPLICATE KEY UPDATE is_enabled=1,title='My Upsells',layout='carousel',display_limit=4,updated_at=CURRENT_TIMESTAMP(3)`, [shop]);
    const [r] = await conn.query('SELECT * FROM upsell_widget_settings WHERE shop_domain=?', [shop]);
    if (r[0].layout === 'carousel' && r[0].display_limit === 4) ok('upsell_widget_settings CREATE/READ');
    await conn.execute('UPDATE upsell_widget_settings SET title=?,display_limit=? WHERE shop_domain=?', ['Updated Upsells', 3, shop]);
    const [r2] = await conn.query('SELECT title,display_limit FROM upsell_widget_settings WHERE shop_domain=?', [shop]);
    if (r2[0].title === 'Updated Upsells' && r2[0].display_limit === 3) ok('upsell_widget_settings UPDATE');
  } catch(e) { fail('upsell_widget_settings', e.message); }

  // ── 6. upsell_rules (existing table) ─────────────────────────────────────
  try {
    const ruleId = `${shop}-rule-1`;
    await conn.execute(`INSERT INTO upsell_rules (id,shop,enabled,ruleType,priority,upsellProducts,layout,title,updatedAt) VALUES (?,?,1,'GLOBAL',0,?,?,'My Upsell Title',CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE enabled=1,updatedAt=CURRENT_TIMESTAMP(3)`, [ruleId, shop, JSON.stringify(['gid://shopify/Product/123']), 'grid']);
    const [r] = await conn.query('SELECT * FROM upsell_rules WHERE id=?', [ruleId]);
    if (r[0].ruleType === 'GLOBAL') ok('upsell_rules CREATE/READ');
    await conn.execute('UPDATE upsell_rules SET layout=?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?', ['carousel', ruleId]);
    const [r2] = await conn.query('SELECT layout FROM upsell_rules WHERE id=?', [ruleId]);
    if (r2[0].layout === 'carousel') ok('upsell_rules UPDATE');
  } catch(e) { fail('upsell_rules', e.message); }

  // ── 7. fbt_widget_settings + fbt_rules ───────────────────────────────────
  try {
    await conn.execute(`INSERT INTO fbt_widget_settings (shop_domain,is_enabled,selected_template,mode,bg_color) VALUES (?,1,'fbt2','manual','#f9fafb') ON DUPLICATE KEY UPDATE is_enabled=1,selected_template='fbt2',bg_color='#f9fafb',updated_at=CURRENT_TIMESTAMP(3)`, [shop]);
    const [r] = await conn.query('SELECT * FROM fbt_widget_settings WHERE shop_domain=?', [shop]);
    if (r[0].selected_template === 'fbt2') ok('fbt_widget_settings CREATE/READ');
    // Add rules
    await conn.execute('DELETE FROM fbt_rules WHERE shop_domain=?', [shop]);
    await conn.execute(`INSERT INTO fbt_rules (shop_domain,name,trigger_scope,fbt_products,is_active,sort_order) VALUES (?,?,?,?,1,0)`, [shop, 'Test Rule', 'all', JSON.stringify(['gid://shopify/Product/456','gid://shopify/Product/789'])]);
    const [rules] = await conn.query('SELECT * FROM fbt_rules WHERE shop_domain=?', [shop]);
    if (rules.length === 1 && JSON.parse(rules[0].fbt_products).length === 2) ok('fbt_rules CREATE/READ');
    // Update rule
    await conn.execute('UPDATE fbt_rules SET name=? WHERE shop_domain=?', ['Updated Rule', shop]);
    const [r2] = await conn.query('SELECT name FROM fbt_rules WHERE shop_domain=?', [shop]);
    if (r2[0].name === 'Updated Rule') ok('fbt_rules UPDATE');
    // Delete rule
    await conn.execute('DELETE FROM fbt_rules WHERE shop_domain=?', [shop]);
    const [r3] = await conn.query('SELECT COUNT(*) as n FROM fbt_rules WHERE shop_domain=?', [shop]);
    if (r3[0].n === 0) ok('fbt_rules DELETE');
  } catch(e) { fail('fbt_widget_settings/fbt_rules', e.message); }

  // ── 8. ai_applied_configs ────────────────────────────────────────────────
  try {
    const { v4: uuid } = { v4: () => require('crypto').randomUUID() };
    const id = require('crypto').randomUUID();
    await conn.execute(`INSERT INTO ai_applied_configs (id,shop_domain,config_type,actions_applied,settings_applied,prompt,ai_summary,is_active) VALUES (?,?,?,?,?,?,?,1)`, [id, shop, 'progress_bar', JSON.stringify(['enableGoalBar']), JSON.stringify({goal:999}), 'Enable progress bar', 'Progress bar enabled with ₹999 target']);
    const [r] = await conn.query('SELECT * FROM ai_applied_configs WHERE id=?', [id]);
    if (r[0].config_type === 'progress_bar') ok('ai_applied_configs CREATE/READ');
    // Soft delete
    await conn.execute('UPDATE ai_applied_configs SET is_active=0 WHERE id=?', [id]);
    const [r2] = await conn.query('SELECT is_active FROM ai_applied_configs WHERE id=?', [id]);
    if (r2[0].is_active === 0) ok('ai_applied_configs soft-delete');
  } catch(e) { fail('ai_applied_configs', e.message); }

  // ── 9. Verify all modules have data for the test shop ────────────────────
  const tables = [
    ['cart_drawer_config', 'shop_domain'],
    ['progress_bar_settings', 'shop_domain'],
    ['progress_bar_tiers', 'shop_domain'],
    ['coupon_slider_settings', 'shop_domain'],
    ['coupon_display_rules', 'shop_domain'],
    ['upsell_widget_settings', 'shop_domain'],
    ['upsell_rules', 'shop'],
    ['fbt_widget_settings', 'shop_domain'],
  ];
  let allHaveData = true;
  for (const [tbl, col] of tables) {
    const [r] = await conn.query(`SELECT COUNT(*) as n FROM \`${tbl}\` WHERE \`${col}\`=?`, [shop]);
    if (r[0].n === 0) { allHaveData = false; results.push(`  ⚠️  ${tbl} has 0 rows for test shop`); }
  }
  if (allHaveData) ok('All module tables have data for test shop');

  // ── Cleanup ───────────────────────────────────────────────────────────────
  for (const [tbl, col] of [...tables, ['ai_applied_configs','shop_domain']]) {
    await conn.execute(`DELETE FROM \`${tbl}\` WHERE \`${col}\`=?`, [shop]).catch(()=>{});
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter(r=>r.includes('✅')).length;
  const failed = results.filter(r=>r.includes('❌')).length;
  console.log('\n=== CRUD TEST RESULTS ===');
  results.forEach(r => console.log(r));
  console.log(`\n${passed} passed, ${failed} failed`);

  await conn.end();
}
run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
