/**
 * One-time migration: create AI tables in cart_drawer_ninja
 * and copy data from u218702675_cartdrawer.
 * Run once: node scripts/migrate-ai-tables.js
 */
const mysql = require('mysql2/promise');

async function run() {
  const src = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'u218702675_cartdrawer',
  });
  const dst = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'cart_drawer_ninja',
  });

  // ── 1. Create tables ───────────────────────────────────────────────────────
  const tables = [
    {
      name: 'ai_conversations',
      ddl: `CREATE TABLE IF NOT EXISTS \`ai_conversations\` (
        \`id\`         VARCHAR(36)  NOT NULL,
        \`shopDomain\` VARCHAR(255) NOT NULL DEFAULT '',
        \`title\`      VARCHAR(255) NOT NULL DEFAULT 'New Chat',
        \`pinned\`     TINYINT(1)   NOT NULL DEFAULT 0,
        \`archived\`   TINYINT(1)   NOT NULL DEFAULT 0,
        \`createdAt\`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_shopDomain\` (\`shopDomain\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      name: 'ai_messages',
      ddl: `CREATE TABLE IF NOT EXISTS \`ai_messages\` (
        \`id\`              VARCHAR(36) NOT NULL,
        \`conversationId\`  VARCHAR(36) NOT NULL,
        \`role\`            VARCHAR(20) NOT NULL DEFAULT 'user',
        \`message\`         TEXT,
        \`summary\`         TEXT,
        \`actions\`         LONGTEXT,
        \`executedActions\` LONGTEXT,
        \`before\`          LONGTEXT,
        \`after\`           LONGTEXT,
        \`synced\`          TINYINT(1),
        \`off_topic\`       TINYINT(1) NOT NULL DEFAULT 0,
        \`insight_mode\`    VARCHAR(50),
        \`createdAt\`       DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_conversationId\` (\`conversationId\`),
        CONSTRAINT \`fk_am_conv\` FOREIGN KEY (\`conversationId\`)
          REFERENCES \`ai_conversations\` (\`id\`) ON DELETE CASCADE
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      name: 'ai_suggestions',
      ddl: `CREATE TABLE IF NOT EXISTS \`ai_suggestions\` (
        \`id\`        VARCHAR(36)  NOT NULL,
        \`page\`      VARCHAR(100) NOT NULL DEFAULT '/app',
        \`title\`     VARCHAR(255) NOT NULL DEFAULT '',
        \`prompt\`    TEXT,
        \`priority\`  INT          NOT NULL DEFAULT 0,
        \`active\`    TINYINT(1)   NOT NULL DEFAULT 1,
        \`createdAt\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_page\` (\`page\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      name: 'ai_tools',
      ddl: `CREATE TABLE IF NOT EXISTS \`ai_tools\` (
        \`id\`          VARCHAR(36)  NOT NULL,
        \`name\`        VARCHAR(100) NOT NULL,
        \`description\` TEXT,
        \`parameters\`  TEXT,
        \`active\`      TINYINT(1)  NOT NULL DEFAULT 1,
        \`createdAt\`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      name: 'ai_actions',
      ddl: `CREATE TABLE IF NOT EXISTS \`ai_actions\` (
        \`id\`             VARCHAR(36)  NOT NULL,
        \`conversationId\` VARCHAR(36),
        \`module\`         VARCHAR(100) DEFAULT '',
        \`actionName\`     VARCHAR(100) NOT NULL,
        \`payload\`        TEXT,
        \`status\`         VARCHAR(20)  NOT NULL DEFAULT 'pending',
        \`createdAt\`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_conversationId\` (\`conversationId\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      name: 'activity_logs',
      ddl: `CREATE TABLE IF NOT EXISTS \`activity_logs\` (
        \`id\`          INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\` VARCHAR(255) NOT NULL,
        \`action\`      VARCHAR(100) NOT NULL,
        \`entity_type\` VARCHAR(50),
        \`entity_id\`   INT,
        \`details\`     LONGTEXT,
        \`ip_address\`  VARCHAR(45),
        \`created_at\`  DATETIME     DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_shop\` (\`shop_domain\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    await dst.execute(t.ddl);
    console.log('✅ Table ready:', t.name);
  }

  // ── 2. Migrate rows (INSERT IGNORE = skip duplicates on re-run) ────────────
  const dataTables = ['ai_conversations', 'ai_messages', 'ai_suggestions', 'ai_tools', 'ai_actions'];
  for (const table of dataTables) {
    const [rows] = await src.query(`SELECT * FROM \`${table}\``);
    if (rows.length === 0) {
      console.log(`   (skip ${table} — 0 rows)`);
      continue;
    }
    const cols = Object.keys(rows[0]);
    const ph = cols.map(() => '?').join(',');
    const sql = `INSERT IGNORE INTO \`${table}\` (\`${cols.join('`,`')}\`) VALUES (${ph})`;
    let n = 0;
    for (const row of rows) {
      await dst.execute(sql, cols.map(c => row[c]));
      n++;
    }
    console.log(`✅ Migrated ${n} rows → ${table}`);
  }

  // ── 3. Verify ──────────────────────────────────────────────────────────────
  console.log('\n=== Verification (cart_drawer_ninja) ===');
  for (const t of ['ai_conversations', 'ai_messages', 'ai_suggestions', 'ai_tools', 'ai_actions', 'activity_logs']) {
    const [r] = await dst.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(` ${t}: ${r[0].n} rows`);
  }

  await src.end();
  await dst.end();
  console.log('\nDone.');
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
