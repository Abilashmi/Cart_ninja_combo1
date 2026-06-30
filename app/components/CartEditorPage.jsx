import { useNavigate, useLoaderData, useFetcher } from 'react-router';
import { useCallback, useState, useRef } from 'react';
import { Frame, Toast } from '@shopify/polaris';
import { CartEditorProvider, useCartEditor } from '../context/CartEditorContext';
import { CartEditorSidebar } from './CartEditorSidebar';
import { CartPreview } from './CartPreview';
import '../styles/cart-editor.css';

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`${url} returned success:false — ${JSON.stringify(json)}`);
  return json;
}

function CartEditorContent() {
  const navigate = useNavigate();
  const { isDirty, resetDirty, body, footer, status, settings, header } = useCartEditor();
  const legacyFetcher = useFetcher();
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const savedTimerRef = useRef(null);

  const handleSave = useCallback(async () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('saving');
    const pb  = body.progressBar;
    const cs  = body.couponSlider;
    const up  = body.upsellProducts;
    const cb  = footer.checkoutButton;
    const ann = body.announcements || {};

    // ── 1. Legacy blob (fire-and-forget, backwards compat) ───────────────
    legacyFetcher.submit({
      intent:              'saveCartConfig',
      cartStatus:          status === 'active' ? 1 : 0,
      progress_status:     pb.enabled ? 1 : 0,
      progress_data:       JSON.stringify(pb),
      coupon_status:       cs.enabled ? 1 : 0,
      coupon_data:         JSON.stringify(cs),
      upsell_status:       up.enabled ? 1 : 0,
      upsell_data:         JSON.stringify(up),
      checkoutName:        cb.text,
      checkoutFooterText:  cb.footerText,
      customCSS:           footer.customCSS,
      checkout_button_style: JSON.stringify({
        backgroundColor: cb.bgColor,
        textColor:       cb.textColor,
        borderRadius:    cb.borderRadius,
      }),
    }, { method: 'POST', action: '/app/cartdrawer', encType: 'application/json' });

    // ── 2. Normalized saves ──────────────────────────────────────────────
    try {
      await Promise.all([

        postJson('/api/cart-drawer-config', {
          is_enabled:                         status === 'active' ? 1 : 0,
          checkout_button_text:               cb.text,
          checkout_footer_text:               cb.footerText,
          checkout_button_bg_color:           cb.bgColor,
          checkout_button_text_color:         cb.textColor,
          checkout_button_border_radius:      cb.borderRadius,
          custom_css:                         footer.customCSS,
          announcement_enabled:               ann.enabled ? 1 : 0,
          announcement_text:                  ann.text || null,
          announcement_bg_color:              ann.bgColor   || '#111827',
          announcement_text_color:            ann.textColor || '#ffffff',
          announcement_font_size:             ann.fontSize  || 13,
          open_on_add:                        settings?.general?.openOnAdd         !== false ? 1 : 0,
          open_on_icon_click:                 settings?.general?.openOnIconClick   !== false ? 1 : 0,
          position:                           settings?.general?.position          || 'right',
          header_title:                       header?.title        || 'Your Cart',
          header_close_style:                 header?.closeStyle   || 'icon',
          header_bg_color:                    header?.bgColor      || '#ffffff',
          header_text_color:                  header?.textColor    || '#1a1a1a',
          header_border_bottom:               header?.borderBottom !== false ? 1 : 0,
          design_width:                       settings?.design?.width               || 'normal',
          design_border_radius:               settings?.design?.borderRadius        ?? 8,
          design_shadow:                      settings?.design?.shadow              !== false ? 1 : 0,
          design_animation:                   settings?.design?.animation           || 'slide',
          empty_cart_message:                 body.emptyCart?.message               || 'Your cart is empty',
          empty_cart_show_continue_shopping:  body.emptyCart?.showContinueShopping  !== false ? 1 : 0,
          empty_cart_show_recommendations:    body.emptyCart?.showRecommendations   !== false ? 1 : 0,
        }),

        postJson('/api/progress-bar', {
          is_enabled:             pb.enabled ? 1 : 0,
          mode:                   pb.mode             || 'amount',
          show_on_empty:          pb.showWhenEmpty    ?? pb.showOnEmpty ?? 1,
          bar_background_color:   pb.colors?.background || pb.barBackgroundColor || '#e5e7eb',
          bar_foreground_color:   pb.colors?.fill       || pb.barForegroundColor || '#2563eb',
          icon_color:             pb.colors?.icon       || pb.iconColor           || '#2563eb',
          border_radius:          pb.borderRadius       ?? 8,
          placement:              pb.position           || 'top',
          completion_text:        pb.completionMessage  || pb.completionText || "🎉 You've unlocked free shipping!",
          completion_text_color:  pb.colors?.message    || pb.completionTextColor || '#10b981',
          enable_confetti:        pb.confetti           ?? pb.enableConfetti ?? 1,
          tiers: (pb.tiers || []).map((t, i) => ({
            min_value:      t.minimumSpend  ?? t.minValue ?? 0,
            min_quantity:   t.minQuantity   ?? 0,
            description:    t.description   || 'Milestone',
            reward_type:    t.rewardType    || 'free_shipping',
            icon_type:      t.iconType      || 'preset',
            icon_preset:    t.iconPreset    || 'gift',
            icon_custom_svg: t.iconCustomSvg || null,
            products:       t.products      || [],
            sort_order:     i,
          })),
        }),

        postJson('/api/upsell-settings', {
          is_enabled:            up.enabled ? 1 : 0,
          title:                 up.title             || up.upsellTitle?.text || 'Recommended for you',
          title_color:           up.titleColor        || '#111827',
          show_on_empty_cart:    up.showWhenEmpty     ?? up.showOnEmptyCart ?? 0,
          layout:                up.layout            || 'grid',
          button_text:           up.buttonText        || 'Add to Cart',
          button_bg_color:       up.buttonColor       || '#111827',
          button_text_color:     up.buttonTextColor   || '#ffffff',
          button_border_radius:  up.buttonBorderRadius ?? 6,
          show_price:            up.showPrice !== false ? 1 : 0,
          position:              up.position          || 'bottom',
          display_limit:         up.limit             || up.displayLimit || 3,
          active_template:       up.activeTemplate    || up.layout || 'grid',
          manualRules:           up.manualRules       || [],
        }),

        postJson('/api/coupon-slider-settings', {
          is_enabled:        cs.enabled ? 1 : 0,
          selected_template: cs.template          || 'template1',
          title_text:        cs.sectionTitle      || cs.titleText || 'Apply Coupon',
          title_color:       cs.titleColor        || '#1e293b',
          title_font_size:   cs.titleFontSize     || 14,
          title_alignment:   cs.titleTextAlign    || cs.titleAlignment || 'left',
          position:          cs.position          || 'top',
          layout:            cs.layout            || 'grid',
          selectedCoupons:   cs.selectedCoupons   || [],
        }),

      ]);

      // Clear AI agent localStorage so it doesn't override fresh DB values on next reload
      try { localStorage.removeItem('cartninja_cart_config'); } catch {}

      resetDirty();
      setSaveStatus('saved');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('[Save] error:', err.message);
      setSaveStatus('error');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 4000);
      alert(`Save failed: ${err.message}`);
    }
  }, [body, footer, status, settings, header, legacyFetcher, resetDirty]);

  const handleDiscard = useCallback(() => {
    if (isDirty && !confirm('You have unsaved changes. Discard them?')) return;
    navigate('/app');
  }, [isDirty, navigate]);

  return (
    <Frame>
      {saveStatus === 'saved' && (
        <Toast content="Saved" onDismiss={() => setSaveStatus('idle')} />
      )}
      {saveStatus === 'error' && (
        <Toast content="Save failed" error onDismiss={() => setSaveStatus('idle')} />
      )}
      <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100vh', overflow: 'hidden', background: '#f6f6f7' }}>
        <div style={{ width: 460, minWidth: 460, flexShrink: 0, height: '100vh', overflow: 'hidden' }}>
          <CartEditorSidebar onDiscard={handleDiscard} />
        </div>
        <div style={{ flex: 1, minWidth: 0, height: '100vh', overflow: 'hidden' }}>
          <CartPreview onSave={handleSave} onDiscard={handleDiscard} isDirty={isDirty} saveStatus={saveStatus} />
        </div>
      </div>
    </Frame>
  );
}

export default function CartEditorPage() {
  const data          = useLoaderData();
  const coupons       = data?.coupons      ?? [];
  const allProducts   = data?.allProducts  ?? [];
  const initialStatus = data?.drawerEnabled === false ? 'inactive' : 'active';
  const cartRecord    = data?.cartRecord    ?? null;
  const configRecord  = data?.configRecord  ?? null;
  const pbRecord      = data?.pbRecord      ?? null;
  const csRecord      = data?.csRecord      ?? null;
  const upsellRecord  = data?.upsellRecord  ?? null;

  return (
    <CartEditorProvider
      availableCoupons={coupons}
      allProducts={allProducts}
      initialStatus={initialStatus}
      initialRecord={cartRecord}
      initialConfigRecord={configRecord}
      initialPbRecord={pbRecord}
      initialCsRecord={csRecord}
      initialUpsellRecord={upsellRecord}
    >
      <CartEditorContent />
    </CartEditorProvider>
  );
}
