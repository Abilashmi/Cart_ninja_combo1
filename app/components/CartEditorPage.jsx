import { useNavigate, useLoaderData } from 'react-router';
import { CartEditorProvider, useCartEditor } from '../context/CartEditorContext';
import { CartEditorSidebar } from './CartEditorSidebar';
import { CartPreview } from './CartPreview';
import '../styles/cart-editor.css';

function CartEditorContent({ shop }) {
  const navigate = useNavigate();
  const { isDirty, resetDirty, body, footer, status, settings, header } = useCartEditor();

  const handleSave = async () => {
    try {
      const pb = body.progressBar;
      const cs = body.couponSlider;
      const up = body.upsellProducts;
      const cb = footer.checkoutButton;
      const ann = body.announcements || {};

      // ── 1. Legacy blob save (backwards compat) ────────────────────────────
      const legacyPayload = {
        intent: 'saveCartConfig',
        cartStatus: status === 'active' ? 1 : 0,
        progress_status: pb.enabled ? 1 : 0,
        progress_data: JSON.stringify(pb),
        coupon_status: cs.enabled ? 1 : 0,
        coupon_data: JSON.stringify(cs),
        upsell_status: up.enabled ? 1 : 0,
        upsell_data: JSON.stringify(up),
        checkoutName: cb.text,
        checkoutFooterText: cb.footerText,
        customCSS: footer.customCSS,
        checkout_button_style: JSON.stringify({
          backgroundColor: cb.bgColor,
          textColor: cb.textColor,
          borderRadius: cb.borderRadius,
        }),
      };
      fetch('/app/cartdrawer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacyPayload),
      }).catch(() => {});

      // ── 2. Normalized saves to dedicated tables ───────────────────────────
      await Promise.all([
        // Cart drawer general config
        fetch('/api/cart-drawer-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_enabled: status === 'active' ? 1 : 0,
            // Checkout
            checkout_button_text: cb.text,
            checkout_footer_text: cb.footerText,
            checkout_button_bg_color: cb.bgColor,
            checkout_button_text_color: cb.textColor,
            checkout_button_border_radius: cb.borderRadius,
            custom_css: footer.customCSS,
            // Announcement
            announcement_enabled: ann.enabled ? 1 : 0,
            announcement_text: ann.text || null,
            announcement_bg_color: ann.bgColor || '#111827',
            announcement_text_color: ann.textColor || '#ffffff',
            announcement_font_size: ann.fontSize || 13,
            // General
            open_on_add: settings?.general?.openOnAdd !== false ? 1 : 0,
            open_on_icon_click: settings?.general?.openOnIconClick !== false ? 1 : 0,
            position: settings?.general?.position || 'right',
            // Header
            header_title: header?.title || 'Your Cart',
            header_close_style: header?.closeStyle || 'icon',
            header_bg_color: header?.bgColor || '#ffffff',
            header_text_color: header?.textColor || '#1a1a1a',
            header_border_bottom: header?.borderBottom !== false ? 1 : 0,
            // Design
            design_width: settings?.design?.width || 'normal',
            design_border_radius: settings?.design?.borderRadius ?? 8,
            design_shadow: settings?.design?.shadow !== false ? 1 : 0,
            design_animation: settings?.design?.animation || 'slide',
            // Empty Cart
            empty_cart_message: body.emptyCart?.message || 'Your cart is empty',
            empty_cart_show_continue_shopping: body.emptyCart?.showContinueShopping !== false ? 1 : 0,
            empty_cart_show_recommendations: body.emptyCart?.showRecommendations !== false ? 1 : 0,
          }),
        }),

        // Progress bar
        fetch('/api/progress-bar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_enabled: pb.enabled ? 1 : 0,
            mode: pb.mode || 'amount',
            show_on_empty: pb.showOnEmpty ?? pb.showWhenEmpty ?? 1,
            bar_background_color: pb.barBackgroundColor || pb.track_color || '#e5e7eb',
            bar_foreground_color: pb.barForegroundColor || pb.fill_color || '#2563eb',
            icon_color: pb.iconColor || pb.icon_color || '#2563eb',
            border_radius: pb.borderRadius ?? 8,
            placement: pb.placement || 'top',
            completion_text: pb.completionText || pb.completionMessage || "🎉 You've unlocked free shipping!",
            completion_text_color: pb.completionTextColor || '#10b981',
            enable_confetti: pb.confetti ?? pb.enableConfetti ?? 1,
            tiers: (pb.tiers || []).map((t, i) => ({
              min_value: t.minValue ?? 0,
              min_quantity: t.minQuantity ?? 0,
              description: t.description || 'Milestone',
              reward_type: t.rewardType || 'free_shipping',
              icon_type: t.iconType || 'preset',
              icon_preset: t.iconPreset || 'gift',
              icon_custom_svg: t.iconCustomSvg || null,
              products: t.products || [],
              sort_order: i,
            })),
          }),
        }),

        // Upsell widget settings
        fetch('/api/upsell-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_enabled: up.enabled ? 1 : 0,
            title: up.title || up.upsellTitle?.text || 'Recommended for you',
            title_color: up.titleColor || up.upsellTitle?.color || '#111827',
            show_on_empty_cart: up.showOnEmptyCart ?? up.showWhenEmpty ?? 0,
            layout: up.layout || up.activeTemplate || 'grid',
            button_text: up.buttonText || 'Add to Cart',
            button_bg_color: up.buttonColor || '#111827',
            button_text_color: up.buttonTextColor || '#ffffff',
            show_price: up.showPrice !== false ? 1 : 0,
            position: up.position || 'bottom',
            display_limit: up.limit || up.displayLimit || 3,
            active_template: up.activeTemplate || up.layout || 'grid',
          }),
        }),

        // Coupon slider settings
        fetch('/api/coupon-slider-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_enabled: cs.enabled ? 1 : 0,
            selected_template: cs.selectedStyle || cs.template || 'template1',
            title_text: cs.title?.text || cs.titleText || 'Apply Coupon',
            title_color: cs.title?.textColor || cs.titleTextColor || '#1e293b',
            title_font_size: cs.title?.fontSize || cs.titleFontSize || 14,
            title_alignment: cs.title?.alignment || cs.titleAlignment || 'left',
            position: cs.position || 'top',
            layout: cs.layout || 'grid',
          }),
        }),
      ]);

      resetDirty();
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const handleDiscard = () => {
    if (isDirty && !confirm('You have unsaved changes. Discard them?')) {
      return;
    }
    navigate('/app');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100vh', overflow: 'hidden', background: '#f6f6f7' }}>
      {/* Left: fixed-width sidebar */}
      <div style={{ width: 360, minWidth: 360, flexShrink: 0, height: '100vh', overflow: 'hidden' }}>
        <CartEditorSidebar onDiscard={handleDiscard} />
      </div>
      {/* Right: preview fills remaining space */}
      <div style={{ flex: 1, minWidth: 0, height: '100vh', overflow: 'hidden' }}>
        <CartPreview onSave={handleSave} onDiscard={handleDiscard} isDirty={isDirty} />
      </div>
    </div>
  );
}

export default function CartEditorPage() {
  const data = useLoaderData();
  const coupons = data?.coupons ?? [];
  const allProducts = data?.allProducts ?? [];
  const initialStatus = data?.drawerEnabled === false ? 'inactive' : 'active';
  const cartRecord = data?.cartRecord ?? null;
  const configRecord = data?.configRecord ?? null;
  const shop = data?.shop ?? '';

  return (
    <CartEditorProvider
      availableCoupons={coupons}
      allProducts={allProducts}
      initialStatus={initialStatus}
      initialRecord={cartRecord}
      initialConfigRecord={configRecord}
    >
      <CartEditorContent shop={shop} />
    </CartEditorProvider>
  );
}
