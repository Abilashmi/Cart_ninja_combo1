-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `state` VARCHAR(255) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `scope` TEXT NULL,
    `expires` DATETIME(3) NULL,
    `accessToken` VARCHAR(255) NOT NULL,
    `userId` BIGINT NULL,
    `firstName` VARCHAR(255) NULL,
    `lastName` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `accountOwner` BOOLEAN NOT NULL DEFAULT false,
    `locale` VARCHAR(100) NULL,
    `collaborator` BOOLEAN NULL DEFAULT false,
    `emailVerified` BOOLEAN NULL DEFAULT false,
    `refreshToken` VARCHAR(255) NULL,
    `refreshTokenExpires` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shops` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop_domain` VARCHAR(255) NOT NULL,
    `access_token` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `plan_name` VARCHAR(100) NOT NULL DEFAULT 'free',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `order_count` INTEGER NOT NULL DEFAULT 0,
    `total_revenue` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,

    UNIQUE INDEX `shops_shop_domain_key`(`shop_domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_drawer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(255) NOT NULL,
    `cartStatus` BOOLEAN NOT NULL DEFAULT true,
    `progress_data` LONGTEXT NULL,
    `coupon_data` LONGTEXT NULL,
    `upsell_data` LONGTEXT NULL,
    `progress_status` BOOLEAN NOT NULL DEFAULT false,
    `coupon_status` BOOLEAN NOT NULL DEFAULT false,
    `upsell_status` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `checkoutName` VARCHAR(255) NULL,
    `checkoutFooterText` VARCHAR(500) NULL,
    `customCSS` LONGTEXT NULL,
    `checkout_button_style` TEXT NULL,

    UNIQUE INDEX `cart_drawer_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_click_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop_id` VARCHAR(100) NULL,
    `domain` VARCHAR(255) NULL,
    `event_type` VARCHAR(50) NULL,
    `widget_type` VARCHAR(100) NULL,
    `session_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revenue` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `internal_id` VARCHAR(100) NOT NULL,
    `shopify_id` VARCHAR(100) NULL,
    `shop_domain` VARCHAR(255) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `discount_config` LONGTEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_shop`(`shop_domain`),
    INDEX `idx_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_slider_widget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopDomain` VARCHAR(255) NOT NULL,
    `temp1DefaultStyle` LONGTEXT NULL,
    `temp2DefaultStyle` LONGTEXT NULL,
    `temp3DefaultStyle` LONGTEXT NULL,
    `selectedTemplate` VARCHAR(50) NULL,
    `selectedTemplateCoupon` LONGTEXT NULL,
    `temp1CouponStyle` LONGTEXT NULL,
    `temp2CouponStyle` LONGTEXT NULL,
    `temp3CouponStyle` LONGTEXT NULL,
    `temp1CouponCondition` LONGTEXT NULL,
    `temp2CouponCondition` LONGTEXT NULL,
    `temp3CouponCondition` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupon_slider_widget_shopDomain_key`(`shopDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fbt_widget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopDomain` VARCHAR(255) NOT NULL,
    `temp1` LONGTEXT NULL,
    `temp2` LONGTEXT NULL,
    `temp3` LONGTEXT NULL,
    `selectedTemp` VARCHAR(50) NULL,
    `selectedMode` VARCHAR(50) NULL,
    `condition` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `ai_enabled` BOOLEAN NOT NULL DEFAULT false,
    `ai_product_count` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `fbt_widget_shopDomain_key`(`shopDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UpsellRule` (
    `id` VARCHAR(36) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `ruleType` VARCHAR(50) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `triggerProducts` LONGTEXT NULL,
    `triggerCollections` LONGTEXT NULL,
    `upsellProducts` LONGTEXT NULL,
    `upsellCollections` LONGTEXT NULL,
    `excludedProducts` LONGTEXT NULL,
    `excludedCollections` LONGTEXT NULL,
    `cartValueThreshold` INTEGER NULL DEFAULT 0,
    `displayLimit` INTEGER NOT NULL DEFAULT 3,
    `layout` VARCHAR(50) NOT NULL DEFAULT 'slider',
    `buttonText` VARCHAR(255) NOT NULL DEFAULT 'Add to Cart',
    `showPrice` BOOLEAN NOT NULL DEFAULT true,
    `title` VARCHAR(255) NOT NULL DEFAULT 'Recommended for you',
    `trackViews` BOOLEAN NOT NULL DEFAULT true,
    `trackClicks` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UpsellRule_shop_idx`(`shop`),
    INDEX `UpsellRule_ruleType_idx`(`ruleType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WidgetSettings` (
    `id` VARCHAR(36) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `coupons` LONGTEXT NOT NULL,
    `fbt` LONGTEXT NOT NULL,
    `progressBar` LONGTEXT NULL,
    `upsell` LONGTEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WidgetSettings_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboTemplate` (
    `id` VARCHAR(36) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(255) NULL,
    `templateType` VARCHAR(50) NOT NULL DEFAULT 'grid',
    `status` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `description` TEXT NULL,
    `customizationData` LONGTEXT NULL,
    `features` LONGTEXT NULL,
    `pageId` VARCHAR(255) NULL,
    `pageHandle` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ComboTemplate_shop_idx`(`shop`),
    INDEX `ComboTemplate_shop_status_idx`(`shop`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboAnalytic` (
    `id` VARCHAR(36) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `templateId` VARCHAR(36) NULL,
    `eventType` VARCHAR(50) NOT NULL,
    `revenue` DOUBLE NOT NULL DEFAULT 0,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ComboAnalytic_shop_idx`(`shop`),
    INDEX `ComboAnalytic_shop_eventType_idx`(`shop`, `eventType`),
    INDEX `ComboAnalytic_templateId_idx`(`templateId`),
    INDEX `ComboAnalytic_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboSubscription` (
    `id` VARCHAR(36) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `planId` VARCHAR(50) NOT NULL DEFAULT 'basic',
    `shopifySubId` VARCHAR(255) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'active',
    `trialEndsAt` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComboSubscription_shop_key`(`shop`),
    INDEX `ComboSubscription_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboAIUsage` (
    `id` VARCHAR(36) NOT NULL,
    `shop` VARCHAR(255) NOT NULL,
    `field` VARCHAR(100) NOT NULL,
    `model` VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
    `tokensIn` INTEGER NOT NULL DEFAULT 0,
    `tokensOut` INTEGER NOT NULL DEFAULT 0,
    `usedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ComboAIUsage_shop_idx`(`shop`),
    INDEX `ComboAIUsage_usedAt_idx`(`usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ComboAnalytic` ADD CONSTRAINT `ComboAnalytic_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ComboTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

