-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Jun 15, 2026 at 09:11 AM
-- Server version: 11.8.6-MariaDB-log
-- PHP Version: 7.2.34

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `u218702675_cartdrawer`
--

-- --------------------------------------------------------

--
-- Table structure for table `cart_click_events`
--

CREATE TABLE `cart_click_events` (
  `id` int(11) NOT NULL,
  `shop_id` varchar(100) DEFAULT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `event_type` varchar(50) DEFAULT NULL,
  `widget_type` varchar(100) DEFAULT NULL,
  `session_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `revenue` decimal(10,2) DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cart_drawer`
--

CREATE TABLE `cart_drawer` (
  `id` int(11) NOT NULL,
  `shop` varchar(255) NOT NULL,
  `cartStatus` tinyint(1) DEFAULT 1,
  `progress_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`progress_data`)),
  `coupon_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`coupon_data`)),
  `upsell_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`upsell_data`)),
  `progress_status` tinyint(1) DEFAULT 0,
  `coupon_status` tinyint(1) DEFAULT 0,
  `upsell_status` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `checkoutName` varchar(255) DEFAULT NULL,
  `checkoutFooterText` varchar(500) DEFAULT NULL,
  `customCSS` longtext DEFAULT NULL,
  `checkout_button_style` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `coupons`
--

CREATE TABLE `coupons` (
  `id` int(11) NOT NULL,
  `internal_id` varchar(100) NOT NULL,
  `shopify_id` varchar(100) DEFAULT NULL,
  `shop_domain` varchar(255) NOT NULL,
  `code` varchar(100) NOT NULL,
  `discount_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`discount_config`)),
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `coupon_slider_widget`
--

CREATE TABLE `coupon_slider_widget` (
  `id` int(11) NOT NULL,
  `shopDomain` varchar(255) NOT NULL,
  `temp1DefaultStyle` longtext DEFAULT NULL,
  `temp2DefaultStyle` longtext DEFAULT NULL,
  `temp3DefaultStyle` longtext DEFAULT NULL,
  `selectedTemplate` varchar(50) DEFAULT NULL,
  `selectedTemplateCoupon` longtext DEFAULT NULL,
  `temp1CouponStyle` longtext DEFAULT NULL,
  `temp2CouponStyle` longtext DEFAULT NULL,
  `temp3CouponStyle` longtext DEFAULT NULL,
  `temp1CouponCondition` longtext DEFAULT NULL,
  `temp2CouponCondition` longtext DEFAULT NULL,
  `temp3CouponCondition` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `fbt_widget`
--

CREATE TABLE `fbt_widget` (
  `id` int(11) NOT NULL,
  `shopDomain` varchar(255) NOT NULL,
  `temp1` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`temp1`)),
  `temp2` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`temp2`)),
  `temp3` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`temp3`)),
  `selectedTemp` varchar(50) DEFAULT NULL,
  `selectedMode` varchar(50) DEFAULT NULL,
  `condition` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`condition`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `ai_enabled` tinyint(1) DEFAULT 0,
  `ai_product_count` int(11) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `shops`
--

CREATE TABLE `shops` (
  `id` int(11) NOT NULL,
  `shop_domain` varchar(255) NOT NULL,
  `access_token` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `plan_name` varchar(100) DEFAULT 'free',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `order_count` int(11) DEFAULT 0,
  `total_revenue` decimal(12,2) DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `cart_click_events`
--
ALTER TABLE `cart_click_events`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `cart_drawer`
--
ALTER TABLE `cart_drawer`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_shop` (`shop`);

--
-- Indexes for table `coupons`
--
ALTER TABLE `coupons`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_shop` (`shop_domain`),
  ADD KEY `idx_code` (`code`);

--
-- Indexes for table `coupon_slider_widget`
--
ALTER TABLE `coupon_slider_widget`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_shop` (`shopDomain`);

--
-- Indexes for table `fbt_widget`
--
ALTER TABLE `fbt_widget`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_shop` (`shopDomain`);

--
-- Indexes for table `shops`
--
ALTER TABLE `shops`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `shop_domain_UNIQUE` (`shop_domain`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `cart_click_events`
--
ALTER TABLE `cart_click_events`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `cart_drawer`
--
ALTER TABLE `cart_drawer`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `coupons`
--
ALTER TABLE `coupons`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `coupon_slider_widget`
--
ALTER TABLE `coupon_slider_widget`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `fbt_widget`
--
ALTER TABLE `fbt_widget`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `shops`
--
ALTER TABLE `shops`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
