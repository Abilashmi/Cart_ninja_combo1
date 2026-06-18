-- Creates the ai_agent_history table for storing AI agent action runs per shop.
-- Replaces the previous local-JSON-only approach so history survives deployments.
-- 50 existing entries were migrated from ai-agent-history-data.json via
-- scripts/migrate-ai-history.cjs

CREATE TABLE IF NOT EXISTS `ai_agent_history` (
  `id`             VARCHAR(36)  NOT NULL,
  `shopDomain`     VARCHAR(255) NOT NULL,
  `prompt`         TEXT,
  `summary`        TEXT,
  `response`       LONGTEXT,
  `appliedActions` LONGTEXT,
  `status`         VARCHAR(20)  NOT NULL DEFAULT 'applied',
  `createdAt`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_shopDomain` (`shopDomain`),
  INDEX `idx_createdAt` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
