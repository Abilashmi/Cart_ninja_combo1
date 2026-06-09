/**
 * UPSELL STOREFRONT INTEGRATION
 * 
 * This file demonstrates how to integrate the Upsell feature into your cart drawer.
 * This is a complete example that can be used in your storefront JS code.
 * 
 * SETUP:
 * 1. Add this script to your Shopify storefront theme
 * 2. Update the API endpoint to match your app URL
 * 3. Include the UpsellContainer component in your cart drawer HTML
 */

// ============================================
// CART DRAWER UPSELL INTEGRATION
// ============================================

/**
 * Fetch upsell configuration from admin API
 */
async function fetchUpsellConfig() {
  try {
    const response = await fetch('/api/upsell', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('[Upsell] Failed to fetch config:', error);
    return null;
  }
}

/**
 * Track upsell event
 */
function trackUpsellEvent(event, data) {
  // Send to analytics
  console.log(`[Upsell Event] ${event}:`, data);

  // Example: Send to Google Analytics
  if (window.gtag) {
    window.gtag('event', event, {
      event_category: 'upsell',
      ...data,
    });
  }

  // Example: Send to Shopify Analytics
  if (window.Shopify && window.Shopify.analytics) {
    window.Shopify.analytics.track(event, {
      event_category: 'upsell',
      ...data,
    });
  }
}

/**
 * Add product to cart using Shopify Cart API
 */
async function addUpsellProductToCart(productGid, quantity = 1) {
  try {
    trackUpsellEvent('upsell_clicked', {
      productGid,
      quantity,
    });

    // Use Shopify's native cart API
    const response = await fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            id: productGid, // Variant ID in format: 123456789
            quantity,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Cart add failed: ${response.status}`);
    }

    const cartData = await response.json();

    trackUpsellEvent('upsell_added_to_cart', {
      productGid,
      quantity,
      cartTotal: cartData.total_price,
      itemCount: cartData.item_count,
    });

    // Refresh cart drawer UI
    await refreshCartDrawer();

    return cartData;
  } catch (error) {
    console.error('[Upsell] Failed to add to cart:', error);
    trackUpsellEvent('upsell_add_error', {
      productGid,
      error: error.message,
    });
    return null;
  }
}

/**
 * Refresh cart drawer after product add
 */
async function refreshCartDrawer() {
  try {
    // Get updated cart
    const response = await fetch('/cart.js');
    const cartData = await response.json();

    console.log('[Upsell] Cart updated:', cartData);

    // Trigger custom event for cart update
    window.dispatchEvent(
      new CustomEvent('upsell:cartUpdated', { detail: cartData })
    );

    // Update Shopify cart drawer if using native drawer
    if (window.theme && window.theme.cart) {
      window.theme.cart.refresh();
    }
  } catch (error) {
    console.error('[Upsell] Failed to refresh cart:', error);
  }
}

/**
 * Render upsell section in cart drawer
 */
async function renderUpsellSection(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) {
    console.warn('[Upsell] Container not found:', containerSelector);
    return;
  }

  try {
    // Fetch config
    const configData = await fetchUpsellConfig();
    if (!configData) return;

    const { config, products } = configData;

    if (!config.enabled || products.length === 0) {
      console.log('[Upsell] Disabled or no products');
      return;
    }

    trackUpsellEvent('upsell_viewed', {
      layout: config.ui.layout,
      productCount: products.length,
      limit: config.limit,
    });

    // Build HTML
    const html = buildUpsellHTML(config, products);
    container.innerHTML = html;

    // Attach event listeners
    attachUpsellEventListeners(products, config);
  } catch (error) {
    console.error('[Upsell] Failed to render:', error);
  }
}

/**
 * Build upsell HTML
 */
function buildUpsellHTML(config, products) {
  const displayProducts = products.slice(0, config.limit);
  const layoutClass = config.ui.layout === 'slider' ? 'upsell-slider' : 'upsell-list';

  let html = `
    <div class="upsell-container ${layoutClass}">
      <div class="upsell-header">
        <h3 class="upsell-title">${config.ui.title || 'Recommended for you'}</h3>
        <p class="upsell-subtitle">Complete your order</p>
      </div>
      <div class="upsell-products">
  `;

  displayProducts.forEach((product) => {
    html += `
      <div class="upsell-product-card" data-product-id="${product.id}" data-product-gid="${product.gid}">
        <div class="upsell-product-image">
          <img src="${product.image}" alt="${product.title}" loading="lazy" />
        </div>
        <div class="upsell-product-info">
          <h4 class="upsell-product-title">${product.title}</h4>
          ${
            config.ui.showPrice
              ? '<p class="upsell-product-price">${window.Shopify?.currency?.active || \'$\'}${product.price}</p>'
              : ''
          }
          ${
            product.description
              ? `<p class="upsell-product-desc">${product.description}</p>`
              : ''
          }
          <button 
            class="upsell-add-btn" 
            data-product-gid="${product.gid}"
            type="button"
          >
            ${config.ui.buttonText || 'Add to Cart'}
          </button>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Attach event listeners to upsell buttons
 */
function attachUpsellEventListeners(products, config) {
  const buttons = document.querySelectorAll('.upsell-add-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const productGid = btn.dataset.productGid;
      const productCard = btn.closest('.upsell-product-card');
      const productId = productCard.dataset.productId;

      // Disable button
      btn.disabled = true;
      btn.textContent = 'Adding...';

      await addUpsellProductToCart(productGid, 1);

      // Re-enable button
      btn.disabled = false;
      btn.textContent = config.ui.buttonText || 'Add to Cart';
    });
  });
}

/**
 * Initialize upsell on cart drawer open
 */
function initUpsellOnCartOpen() {
  // For Shopify native drawer
  if (window.Shopify && window.Shopify.CartDrawer) {
    window.Shopify.CartDrawer.on('open', () => {
      renderUpsellSection('[data-cart-drawer-upsell]');
    });
  }

  // For custom implementation
  document.addEventListener('cartDrawerOpen', () => {
    renderUpsellSection('[data-cart-drawer-upsell]');
  });

  // Initial render if drawer is already visible
  if (document.querySelector('[data-cart-drawer-upsell]')) {
    renderUpsellSection('[data-cart-drawer-upsell]');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUpsellOnCartOpen);
} else {
  initUpsellOnCartOpen();
}

// ============================================
// CSS STYLES FOR UPSELL
// ============================================

const upsellStyles = `
  .upsell-container {
    padding: 16px 0;
    border-top: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    margin: 16px 0;
  }

  .upsell-header {
    padding: 0 16px;
    margin-bottom: 16px;
  }

  .upsell-title {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 700;
    color: #111827;
  }

  .upsell-subtitle {
    margin: 0;
    font-size: 13px;
    color: #6b7280;
  }

  .upsell-products {
    display: flex;
    gap: 12px;
    padding: 0 16px;
  }

  .upsell-slider .upsell-products {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
  }

  .upsell-list .upsell-products {
    flex-direction: column;
  }

  .upsell-product-card {
    padding: 12px;
    background-color: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    transition: box-shadow 0.2s ease;
  }

  .upsell-slider .upsell-product-card {
    min-width: 160px;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
  }

  .upsell-product-card:hover {
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .upsell-product-image {
    width: 100%;
    height: 120px;
    background-color: #f3f4f6;
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  .upsell-slider .upsell-product-image {
    height: 100px;
  }

  .upsell-list .upsell-product-card {
    display: flex;
    gap: 12px;
  }

  .upsell-list .upsell-product-image {
    width: 80px;
    height: 80px;
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .upsell-product-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .upsell-product-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }

  .upsell-product-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #111827;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upsell-product-price {
    margin: 0;
    font-size: 13px;
    color: #6b7280;
    font-weight: 500;
  }

  .upsell-product-desc {
    margin: 0;
    font-size: 12px;
    color: #9ca3af;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .upsell-add-btn {
    width: 100%;
    padding: 10px 16px;
    background-color: #000000;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease;
    margin-top: 8px;
  }

  .upsell-add-btn:hover:not(:disabled) {
    background-color: #1f2937;
  }

  .upsell-add-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Mobile Responsive */
  @media (max-width: 480px) {
    .upsell-container {
      margin: 12px 0;
      padding: 12px 0;
    }

    .upsell-products {
      padding: 0 12px;
      gap: 8px;
    }

    .upsell-slider .upsell-product-card {
      min-width: 140px;
    }

    .upsell-product-image {
      height: 100px;
    }

    .upsell-product-title {
      font-size: 13px;
    }

    .upsell-add-btn {
      padding: 8px 12px;
      font-size: 12px;
    }
  }
`;

// Inject styles
const styleSheet = document.createElement('style');
styleSheet.textContent = upsellStyles;
document.head.appendChild(styleSheet);

// Export for use in modules
export {
  fetchUpsellConfig,
  addUpsellProductToCart,
  trackUpsellEvent,
  renderUpsellSection,
  initUpsellOnCartOpen,
};
