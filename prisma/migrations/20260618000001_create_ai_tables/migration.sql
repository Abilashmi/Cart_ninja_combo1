-- Migrated from u218702675_cartdrawer
-- Creates the AI chat/conversation/suggestion/tool tables that were missing
-- from cart_drawer_ninja. Data (10 ai_suggestions, 12 ai_tools) copied via
-- scripts/migrate-ai-tables.cjs

CREATE TABLE IF NOT EXISTS `ai_conversations` (
  `id`         VARCHAR(36)  NOT NULL,
  `shopDomain` VARCHAR(255) NOT NULL DEFAULT '',
  `title`      VARCHAR(255) NOT NULL DEFAULT 'New Chat',
  `pinned`     TINYINT(1)   NOT NULL DEFAULT 0,
  `archived`   TINYINT(1)   NOT NULL DEFAULT 0,
  `createdAt`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_shopDomain` (`shopDomain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_messages` (
  `id`              VARCHAR(36) NOT NULL,
  `conversationId`  VARCHAR(36) NOT NULL,
  `role`            VARCHAR(20) NOT NULL DEFAULT 'user',
  `message`         TEXT,
  `summary`         TEXT,
  `actions`         LONGTEXT,
  `executedActions` LONGTEXT,
  `before`          LONGTEXT,
  `after`           LONGTEXT,
  `synced`          TINYINT(1),
  `off_topic`       TINYINT(1) NOT NULL DEFAULT 0,
  `insight_mode`    VARCHAR(50),
  `createdAt`       DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_conversationId` (`conversationId`),
  CONSTRAINT `fk_am_conv` FOREIGN KEY (`conversationId`)
    REFERENCES `ai_conversations` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_suggestions` (
  `id`        VARCHAR(36)  NOT NULL,
  `page`      VARCHAR(100) NOT NULL DEFAULT '/app',
  `title`     VARCHAR(255) NOT NULL DEFAULT '',
  `prompt`    TEXT,
  `priority`  INT          NOT NULL DEFAULT 0,
  `active`    TINYINT(1)   NOT NULL DEFAULT 1,
  `createdAt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_page` (`page`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_tools` (
  `id`          VARCHAR(36)  NOT NULL,
  `name`        VARCHAR(100) NOT NULL,
  `description` TEXT,
  `parameters`  TEXT,
  `active`      TINYINT(1)  NOT NULL DEFAULT 1,
  `createdAt`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_actions` (
  `id`             VARCHAR(36)  NOT NULL,
  `conversationId` VARCHAR(36),
  `module`         VARCHAR(100) DEFAULT '',
  `actionName`     VARCHAR(100) NOT NULL,
  `payload`        TEXT,
  `status`         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  `createdAt`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_conversationId` (`conversationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `shop_domain` VARCHAR(255) NOT NULL,
  `action`      VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50),
  `entity_id`   INT,
  `details`     LONGTEXT,
  `ip_address`  VARCHAR(45),
  `created_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_shop` (`shop_domain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
