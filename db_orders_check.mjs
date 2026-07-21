import mysql from 'mysql2/promise';
const c = await mysql.createConnection({ host:'srv1408.hstgr.io', user:'u218702675_brix', password:process.env.DB2_PASS, database:'u218702675_brix' });

const [shopsWithOrders] = await c.query('SELECT shop_domain, order_count, total_revenue FROM shops WHERE order_count > 0');
console.log('--- shops.order_count > 0 ---');
console.table(shopsWithOrders);

const [rollup] = await c.query('SELECT shop_domain, date, order_count, revenue FROM analytics_daily_rollup ORDER BY date DESC LIMIT 20');
console.log('--- analytics_daily_rollup (latest 20) ---');
console.table(rollup);

const [storeOrders] = await c.query('SELECT shop_domain, order_id, financial_status, created_at FROM store_orders ORDER BY created_at DESC LIMIT 10');
console.log('--- store_orders (latest 10) ---');
console.table(storeOrders);

const [events] = await c.query('SELECT shop_domain, order_id, revenue, created_at FROM store_order_events ORDER BY created_at DESC LIMIT 10');
console.log('--- store_order_events (latest 10) ---');
console.table(events);

const [overageCharges] = await c.query('SELECT * FROM order_overage_charges ORDER BY id DESC LIMIT 10');
console.log('--- order_overage_charges ---');
console.table(overageCharges);

await c.end();
