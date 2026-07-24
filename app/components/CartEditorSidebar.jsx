import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { useCartEditor } from '../context/CartEditorContext';
import { featureStore } from './ai-agent/featureStore';
import BrixBar from './ai-agent/BrixBar';
import { SECTION_GROUPS } from '../types/cartEditorTypes';
import {
  ArrowLeftIcon, ChevronDownIcon, ColorIcon, SettingsIcon,
  LayoutHeaderIcon, MegaphoneIcon, ChartVerticalIcon,
  DiscountCodeIcon, ProductIcon, CartIcon, CashDollarIcon, CodeIcon,
} from '@shopify/polaris-icons';
import { Icon, Modal, Text } from '@shopify/polaris';
import { DesignSection } from './sections/DesignSection';
import { HeaderSection } from './sections/HeaderSection';
import { AnnouncementsSection } from './sections/AnnouncementsSection';
import { ProgressBarSection } from './sections/ProgressBarSection';
import { CouponSliderSection } from './sections/CouponSliderSection';
import { UpsellSection } from './sections/UpsellSection';
import { EmptyCartSection } from './sections/EmptyCartSection';
import { CheckoutSection } from './sections/CheckoutSection';
import { CustomCSSSection } from './sections/CustomCSSSection';

const ICON_MAP = {
  color: ColorIcon, settings: SettingsIcon, 'layout-header': LayoutHeaderIcon,
  megaphone: MegaphoneIcon, chart: ChartVerticalIcon, discount: DiscountCodeIcon,
  product: ProductIcon, cart: CartIcon, cash: CashDollarIcon, code: CodeIcon,
};

const SECTION_COMPONENT_MAP = {
  design: DesignSection, header: HeaderSection,
  announcements: AnnouncementsSection, progressBar: ProgressBarSection,
  couponSlider: CouponSliderSection, upsellProducts: UpsellSection,
  emptyCart: EmptyCartSection, checkoutButton: CheckoutSection, customCSS: CustomCSSSection,
};

export function CartEditorSidebar({ onDiscard }) {
  const {
    status, setStatus, setActiveSection,
    openSection: contextSection,
    previewMode, setPreviewMode, body,
  } = useCartEditor();

  const [openSection, setOpenSection] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const statusFetcher = useFetcher();
  const isTogglingStatus = statusFetcher.state !== 'idle';
  const isActive = status === 'active';

  // Sync preview-zone clicks into the local accordion
  useEffect(() => {
    if (!contextSection || contextSection === openSection) return;
    setOpenSection(contextSection);
  }, [contextSection]);

  useEffect(() => {
    const data = statusFetcher.data;
    if (!data || data.intent !== 'toggleDrawerStatus') return;
    if (data.success) {
      const enabled = data.drawerEnabled;
      setStatus(enabled ? 'active' : 'inactive');
      featureStore.set('cart_drawer', enabled);
      setStatusError(data.synced ? '' : 'Saved locally — will sync shortly.');
    } else {
      setStatusError(data.error || 'Could not update status.');
    }
  }, [statusFetcher.data, setStatus]);

  const submitStatusToggle = (enabled) => {
    setStatusError('');
    statusFetcher.submit({ intent: 'toggleDrawerStatus', enabled }, { method: 'POST', encType: 'application/json' });
  };

  const handleToggleStatus = () => {
    if (isActive) { setShowDeactivateModal(true); return; }
    submitStatusToggle(true);
  };

  const handleConfirmDeactivate = () => {
    setShowDeactivateModal(false);
    submitStatusToggle(false);
  };

  const toggleSection = (id) => {
    const next = openSection === id ? null : id;
    setOpenSection(next);
    setActiveSection(next ?? '');
    setPreviewMode(next === 'emptyCart' ? 'empty' : 'items');
  };

  const getEnabled = (key) => {
    if (key === 'announcements') return body.announcements.enabled;
    if (key === 'progressBar') return body.progressBar.enabled;
    if (key === 'couponSlider') return body.couponSlider.enabled;
    if (key === 'upsellProducts') return body.upsellProducts.enabled;
    return false;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#fff', borderRight: '1px solid #e1e3e5', overflow: 'hidden' }}>

      <Modal
        open={showDeactivateModal}
        onClose={() => setShowDeactivateModal(false)}
        title="Deactivate cart drawer"
        primaryAction={{ content: 'Deactivate', onAction: handleConfirmDeactivate, destructive: true }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setShowDeactivateModal(false) }]}
      >
        <Modal.Section>
          <Text as="p">Turning the cart drawer off will hide it immediately on your storefront.</Text>
        </Modal.Section>
      </Modal>

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e1e3e5', padding: '6px 12px 5px' }}>

        {/* Row 1: back + title + status pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <button onClick={onDiscard} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, color: '#6d7175' }}>
            <Icon source={ArrowLeftIcon} />
          </button>
          <span className="cart-editor-sidebar-title" style={{ fontWeight: 700, color: '#202223', flex: 1 }}>Cart Editor</span>
          <button onClick={handleToggleStatus} disabled={isTogglingStatus}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer', background: isActive ? '#aee9d1' : '#e4e5e7', color: isActive ? '#005e46' : '#6d7175', opacity: isTogglingStatus ? 0.6 : 1 }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
            {isTogglingStatus ? '…' : isActive ? 'Active' : 'Inactive'}
          </button>
        </div>

        {/* Row 2: PREVIEW segmented */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#8c9196', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Preview</span>
          <div style={{ display: 'flex', border: '1px solid #c9cccf', borderRadius: 6, overflow: 'hidden' }}>
            {['items', 'empty'].map(m => (
              <button key={m} onClick={() => setPreviewMode(m)}
                style={{ padding: '2px 9px', border: 'none', fontSize: 10, fontWeight: 500, cursor: 'pointer', background: previewMode === m ? '#202223' : '#fff', color: previewMode === m ? '#fff' : '#6d7175', borderLeft: m === 'empty' ? '1px solid #c9cccf' : 'none' }}
              >
                {m === 'items' ? 'Items' : 'Empty'}
              </button>
            ))}
          </div>
        </div>

        {statusError && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#8a6116' }}>{statusError}</p>}
      </div>

      {/* ── Accordion ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        {SECTION_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="cart-editor-group-label" style={{ padding: '4px 12px 2px', fontWeight: 700, textTransform: 'uppercase', color: '#8c9196', letterSpacing: '0.6px' }}>
              {group.title}
            </div>

            {group.items.map((item) => {
              const isOpen = openSection === item.id;
              const IconComponent = ICON_MAP[item.icon] || SettingsIcon;
              const isEnabled = item.toggleable ? getEnabled(item.enabledKey) : undefined;
              const SectionComponent = SECTION_COMPONENT_MAP[item.id];

              return (
                <div key={item.id} style={{ borderBottom: '1px solid #f1f2f3' }}>
                  <button
                    onClick={() => toggleSection(item.id)}
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, padding: '5px 12px', width: '100%', background: isOpen ? '#f0f7f5' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}
                  >
                    <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isOpen ? '#008060' : '#8c9196' }}>
                      <Icon source={IconComponent} />
                    </span>
                    <span className="cart-editor-row-label" style={{ flex: 1, fontWeight: 500, color: isOpen ? '#008060' : '#202223', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                      {item.label}
                    </span>
                    {item.toggleable && (
                      <span className="cart-editor-row-badge" style={{ padding: '1px 6px', borderRadius: 10, fontWeight: 600, flexShrink: 0, background: isEnabled ? '#aee9d1' : '#e4e5e7', color: isEnabled ? '#005e46' : '#6d7175' }}>
                        {isEnabled ? 'On' : 'Off'}
                      </span>
                    )}
                    <span style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#8c9196', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
                      <Icon source={ChevronDownIcon} />
                    </span>
                  </button>

                  {isOpen && SectionComponent && (
                    <div style={{ padding: '8px 12px 16px', background: '#fafbfb', borderTop: '1px solid #e1e3e5' }}>
                      <SectionComponent />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {/* Bottom spacer so last field is never hidden behind the BrixBar */}
        <div style={{ height: 32 }} />
      </div>

      {/* ── BrixBar pinned at bottom of sidebar (inline, not floating) ── */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e1e3e5' }}>
        <BrixBar size="sm" floating={false} />
      </div>
    </div>
  );
}
