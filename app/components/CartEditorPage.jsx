import { useNavigate, useLoaderData } from 'react-router';
import { CartEditorProvider, useCartEditor } from '../context/CartEditorContext';
import { CartEditorSidebar } from './CartEditorSidebar';
import { CartPreview } from './CartPreview';
import '../styles/cart-editor.css';

function CartEditorContent({ shop }) {
  const navigate = useNavigate();
  const { isDirty, resetDirty, body, footer, status } = useCartEditor();

  const handleSave = async () => {
    try {
      const pb = body.progressBar;
      const cs = body.couponSlider;
      const up = body.upsellProducts;
      const cb = footer.checkoutButton;

      const payload = {
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

      const res = await fetch('/app/cartdrawer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Save failed');
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
    <div className="cart-editor-root">
      <CartEditorSidebar onDiscard={handleDiscard} />
      <CartPreview onSave={handleSave} onDiscard={handleDiscard} isDirty={isDirty} />
    </div>
  );
}

export default function CartEditorPage() {
  const data = useLoaderData();
  const coupons = data?.coupons ?? [];
  const allProducts = data?.allProducts ?? [];
  const initialStatus = data?.drawerEnabled === false ? 'inactive' : 'active';
  const cartRecord = data?.cartRecord ?? null;
  const shop = data?.shop ?? '';

  return (
    <CartEditorProvider
      availableCoupons={coupons}
      allProducts={allProducts}
      initialStatus={initialStatus}
      initialRecord={cartRecord}
    >
      <CartEditorContent shop={shop} />
    </CartEditorProvider>
  );
}
