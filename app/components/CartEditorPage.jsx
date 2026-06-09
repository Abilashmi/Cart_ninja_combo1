import { useNavigate, useLoaderData } from 'react-router';
import { CartEditorProvider, useCartEditor } from '../context/CartEditorContext';
import { CartEditorSidebar } from './CartEditorSidebar';
import { CartPreview } from './CartPreview';
import '../styles/cart-editor.css';

function CartEditorContent() {
  const navigate = useNavigate();
  const { isDirty, resetDirty, state } = useCartEditor();

  const handleSave = async () => {
    try {
      const res = await fetch('/api/cartdrawer-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.settings || state),
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

  return (
    <CartEditorProvider availableCoupons={coupons} allProducts={allProducts} initialStatus={initialStatus}>
      <CartEditorContent />
    </CartEditorProvider>
  );
}
