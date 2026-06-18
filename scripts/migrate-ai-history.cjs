const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'cart_drawer_ninja',
  });

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`ai_agent_history\` (
      \`id\`             VARCHAR(36)  NOT NULL,
      \`shopDomain\`     VARCHAR(255) NOT NULL,
      \`prompt\`         TEXT,
      \`summary\`        TEXT,
      \`response\`       LONGTEXT,
      \`appliedActions\` LONGTEXT,
      \`status\`         VARCHAR(20)  NOT NULL DEFAULT 'applied',
      \`createdAt\`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_shopDomain\` (\`shopDomain\`),
      INDEX \`idx_createdAt\` (\`createdAt\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  console.log('✅ Table ai_agent_history created');

  const histFile = path.resolve(__dirname, '..', 'ai-agent-history-data.json');
  let total = 0;
  try {
    const raw = fs.readFileSync(histFile, 'utf-8');
    const map = JSON.parse(raw);
    for (const [shop, entries] of Object.entries(map)) {
      for (const e of entries) {
        const ts = e.timestamp
          ? new Date(e.timestamp).toISOString().slice(0, 19).replace('T', ' ')
          : new Date().toISOString().slice(0, 19).replace('T', ' ');
        await conn.execute(
          'INSERT IGNORE INTO `ai_agent_history` (id, shopDomain, prompt, summary, response, appliedActions, status, createdAt) VALUES (?,?,?,?,?,?,?,?)',
          [
            e.id,
            shop,
            e.prompt || null,
            e.summary || null,
            e.response ? JSON.stringify(e.response) : null,
            e.appliedActions ? JSON.stringify(e.appliedActions) : null,
            e.status || 'applied',
            ts,
          ]
        );
        total++;
      }
    }
    console.log(`✅ Migrated ${total} history entries from local JSON`);
  } catch (e) {
    console.log('   (no local history file or already empty:', e.message, ')');
  }

  await conn.execute(
    `INSERT IGNORE INTO \`_prisma_migrations\`
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (UUID(), 'manual', NOW(3), ?, NULL, NULL, NOW(3), 1)`,
    ['20260618000002_create_ai_agent_history']
  );

  const [r] = await conn.query('SELECT COUNT(*) AS n FROM `ai_agent_history`');
  console.log(`\n✅ ai_agent_history: ${r[0].n} rows`);
  await conn.end();
  console.log('Done.');
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
