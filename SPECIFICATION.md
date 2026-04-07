# App Specification: Cart-App

## Overview
**Cart-App** is a comprehensive Shopify application designed to optimize the shopping experience and increase Average Order Value (AOV) through an interactive, feature-rich cart drawer. It combines rewards tracking, smart upselling, and discount management into a single, seamless interface.

---

## Core Features

### 1. Enhanced Cart Drawer
- **Dynamic Slide-out Interface**: Replaces the standard cart with a customizable drawer.
- **Real-time Updates**: Reflects changes in cart value and items immediately.
- **Customizable Design**: Options for colors, typography, and layout from the merchant dashboard.

### 2. Rewards Progress Bar
- **Milestone Tracking**: Visual progress bar showing customers how close they are to rewards.
- **Reward Tiers**: Support for multiple tiers (e.g., Free Shipping at $50, 10% Discount at $100, Free Gift at $150).
- **Gamification**: Uses micro-animations (like confetti) when a milestone is reached.

### 3. Intelligent Upselling (AI & FBT)
- **Frequently Bought Together (FBT)**: Suggests complementary products based on items already in the cart.
- **AI Upsell Module**: Sophisticated logic to recommend high-converting products.
- **In-Cart Additions**: Users can add upsell products without leaving the cart drawer.

### 4. Coupon Slider & Management
- **One-Click Apply**: Displays available coupons that users can apply instantly.
- **Multiple Styles**: Different visual layouts for coupons (Classic, Minimal, Bold).
- **Dynamic Visibility**: Option to show or hide the coupon section based on cart contents.

### 5. Analytics Dashboard
- **Performance Metrics**: Tracks total revenue generated through the app.
- **Conversion Rates**: Monitors how many users interact with upsells and coupons.
- **Engagement Insights**: Visualizes milestone achievements and popular upsell products using charts (Recharts).

### 6. Currency Customization
- **Contextual Currency**: Re-usable context for managing multiple currencies and locale-based formatting.

---

## Technical Architecture

### Tech Stack
- **Framework**: React Router / Shopify Remix (Node.js).
- **UI Library**: Shopify Polaris for a native-feeling admin experience.
- **Database**: Prisma ORM with SQLite (standard) or PostgreSQL/MySQL (production).
- **Storefront**: Shopify Theme App Extension (Liquid, JavaScript, CSS).
- **Hybrid Backend**: Distributed architecture using both Node.js (Remix) and a remote PHP logging/processing server (`shop_logger.php`, `save_cart_drawer.php`).

### Key Components
- **Admin App** (`/app/routes`): Managed via the Shopify Admin, providing a tabbed configuration interface (Progress bar, Coupons, Upsells, Analytics).
- **API Endpoints** (`/app/routes/api.*`): Robust set of internal APIs for configuration, product syncing, coupons, FBT, and analytics.
- **Theme Extension** (`/extensions/cart-drawer`): Injected into the merchant's theme via App Blocks (`cart_drawer.liquid`, `fbt.liquid`, `coupon_slider.liquid`).
- **PHP Event/Data Endpoints** (`/.php`): Used to synchronously push configuration logs, FBT events, and active app state to a tertiary domain (`https://blueviolet-clam-512487.hostingersite.com`).

---

## Data Flow
1. **Merchant Configuration**: Merchant configures settings in the Polaris-based dashboard.
2. **Persistence**: Settings are saved via Prisma and synchronized with the remote PHP-based backend using webhook-style fetch actions.
3. **Storefront Initialization**: Theme Extension fetches configuration data (JSON API) and renders Liquid blocks.
4. **Client-side Interactivity**: The vanilla JavaScript injects the React-like app experiences (or manages Vanilla Dom interactions) for cart updates, progress bar movements, and upsell carousels.
5. **Analytics Collection**: Events (upsell clicks, milestones achieved) are pushed to the backend for reporting.

---

## Directory Structure
- `/app`: Contains all dashboard routes, API handlers, Prisma setup, and Polaris components.
- `/extensions`: Contains the Shopify CLI theme app configuration and Liquid snippets.
- `/.php`: Contains isolated PHP endpoints that act as the remote backend environment for the Shopify extensions.
- `/prisma`: The SQLite and Schema configuration files.
