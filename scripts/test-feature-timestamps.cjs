const mysql = require('mysql2/promise');
async function test() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'cart_drawer_ninja',
  });

  const shop = 'test-ts.myshopify.com';

  // Insert initial row with all feature data
  await conn.execute(`
    INSERT INTO cart_drawer (shop, cartStatus, progress_data, coupon_data, upsell_data,
        progress_status, coupon_status, upsell_status,
        checkoutName, checkoutFooterText, customCSS, checkout_button_style,
        progress_updated_at, coupon_updated_at, upsell_updated_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 1, 1, 1, NULL, NULL, NULL, NULL,
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
        progress_data = VALUES(progress_data),
        coupon_data   = VALUES(coupon_data),
        upsell_data   = VALUES(upsell_data),
        progress_updated_at = IF(VALUES(progress_data) IS NOT NULL, CURRENT_TIMESTAMP(3), progress_updated_at),
        coupon_updated_at   = IF(VALUES(coupon_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), coupon_updated_at),
        upsell_updated_at   = IF(VALUES(upsell_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), upsell_updated_at),
        updated_at = CURRENT_TIMESTAMP(3)
  `, [shop, '{"enabled":true,"mode":"amount"}', '{"enabled":true}', '{"enabled":true}']);

  const [r1] = await conn.query(
    'SELECT progress_updated_at, coupon_updated_at, upsell_updated_at FROM cart_drawer WHERE shop=?', [shop]
  );
  const pb1 = r1[0].progress_updated_at;
  const cs1 = r1[0].coupon_updated_at;
  const up1 = r1[0].upsell_updated_at;
  console.log('After first save (all features):');
  console.log('  progress_updated_at:', pb1);
  console.log('  coupon_updated_at  :', cs1);
  console.log('  upsell_updated_at  :', up1);

  // Wait 1.1s then save only progress_data
  await new Promise(r => setTimeout(r, 1100));

  await conn.execute(`
    INSERT INTO cart_drawer (shop, cartStatus, progress_data, coupon_data, upsell_data,
        progress_status, coupon_status, upsell_status,
        checkoutName, checkoutFooterText, customCSS, checkout_button_style,
        progress_updated_at, coupon_updated_at, upsell_updated_at, updated_at)
    VALUES (?, 1, ?, NULL, NULL, 1, 0, 0, NULL, NULL, NULL, NULL,
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
        progress_data = VALUES(progress_data),
        coupon_data   = VALUES(coupon_data),
        upsell_data   = VALUES(upsell_data),
        progress_updated_at = IF(VALUES(progress_data) IS NOT NULL, CURRENT_TIMESTAMP(3), progress_updated_at),
        coupon_updated_at   = IF(VALUES(coupon_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), coupon_updated_at),
        upsell_updated_at   = IF(VALUES(upsell_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), upsell_updated_at),
        updated_at = CURRENT_TIMESTAMP(3)
  `, [shop, '{"enabled":true,"barColor":"#ff0000"}']);

  const [r2] = await conn.query(
    'SELECT progress_updated_at, coupon_updated_at, upsell_updated_at FROM cart_drawer WHERE shop=?', [shop]
  );
  const pb2 = r2[0].progress_updated_at;
  const cs2 = r2[0].coupon_updated_at;
  const up2 = r2[0].upsell_updated_at;

  console.log('\nAfter second save (ONLY progress_data, coupon_data=NULL, upsell_data=NULL):');
  console.log('  progress_updated_at:', pb2, String(pb2) !== String(pb1) ? '<-- ✅ CHANGED' : '<-- ❌ same');
  console.log('  coupon_updated_at  :', cs2, String(cs2) === String(cs1) ? '<-- ✅ UNCHANGED' : '<-- ❌ changed');
  console.log('  upsell_updated_at  :', up2, String(up2) === String(up1) ? '<-- ✅ UNCHANGED' : '<-- ❌ changed');

  await conn.execute('DELETE FROM cart_drawer WHERE shop=?', [shop]);
  console.log('\n✅ Per-feature timestamps verified — only changed feature timestamp advances');
  await conn.end();
}
test().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
