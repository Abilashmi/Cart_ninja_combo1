-- Migration: add general, header, design, and empty-cart fields to cart_drawer_config
-- Run once against the cart_drawer_ninja MySQL database.
-- All columns use IF NOT EXISTS to be safe to re-run.

ALTER TABLE cart_drawer_config
  -- General
  ADD COLUMN IF NOT EXISTS open_on_add              TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS open_on_icon_click       TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS position                 VARCHAR(10)  NOT NULL DEFAULT 'right',

  -- Header
  ADD COLUMN IF NOT EXISTS header_title             VARCHAR(255) NOT NULL DEFAULT 'Your Cart',
  ADD COLUMN IF NOT EXISTS header_close_style       VARCHAR(20)  NOT NULL DEFAULT 'icon',
  ADD COLUMN IF NOT EXISTS header_bg_color          VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS header_text_color        VARCHAR(20)  NOT NULL DEFAULT '#1a1a1a',
  ADD COLUMN IF NOT EXISTS header_border_bottom     TINYINT(1)   NOT NULL DEFAULT 1,

  -- Design
  ADD COLUMN IF NOT EXISTS design_width             VARCHAR(20)  NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS design_border_radius     INT          NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS design_shadow            TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS design_animation         VARCHAR(20)  NOT NULL DEFAULT 'slide',

  -- Empty Cart
  ADD COLUMN IF NOT EXISTS empty_cart_message                   VARCHAR(255) NOT NULL DEFAULT 'Your cart is empty',
  ADD COLUMN IF NOT EXISTS empty_cart_show_continue_shopping    TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS empty_cart_show_recommendations      TINYINT(1)   NOT NULL DEFAULT 1;
