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
import { GeneralSection } from './sections/GeneralSection';
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
  design: DesignSection, general: GeneralSection, header: HeaderSection,
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

  useEffect(() => {
    const sync = () => setStatus(featureStore.get('cart_drawer') ? 'active' : 'inactive');
    sync();
    window.addEventListener('featureStateChanged', sync);
    return () => window.removeEventListener('featureStateChanged', sync);
  }, [setStatus]);

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

      {/* ── Header: 3 compact rows ── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e1e3e5', padding: '8px 14px 6px' }}>

        {/* Row 1: back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button onClick={onDiscard} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, color: '#6d7175' }}>
            <Icon source={ArrowLeftIcon} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#202223' }}>Cart Editor</span>
        </div>

        {/* Row 2: STATUS + pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#8c9196', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</span>
          <button onClick={handleToggleStatus} disabled={isTogglingStatus}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: isActive ? '#aee9d1' : '#e4e5e7', color: isActive ? '#005e46' : '#6d7175', opacity: isTogglingStatus ? 0.6 : 1 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
            {isTogglingStatus ? '…' : isActive ? 'Active' : 'Inactive'}
          </button>
        </div>

        {/* Row 3: PREVIEW + segmented */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#8c9196', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Preview</span>
          <div style={{ display: 'flex', border: '1px solid #c9cccf', borderRadius: 7, overflow: 'hidden' }}>
            {['items', 'empty'].map(m => (
              <button key={m} onClick={() => setPreviewMode(m)}
                style={{ padding: '3px 10px', border: 'none', fontSize: 11, fontWeight: 500, cursor: 'pointer', background: previewMode === m ? '#202223' : '#fff', color: previewMode === m ? '#fff' : '#6d7175', borderLeft: m === 'empty' ? '1px solid #c9cccf' : 'none' }}
              >
                {m === 'items' ? 'Items' : 'Empty'}
              </button>
            ))}
          </div>
        </div>

        {statusError && <p style={{ margin: '4px 0 0', fontSize: 10, color: '#8a6116' }}>{statusError}</p>}
      </div>

      {/* ── Accordion ── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {SECTION_GROUPS.map((group) => (
          <div key={group.title}>
            <div style={{ padding: '6px 14px 2px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#8c9196', letterSpacing: '0.6px' }}>
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
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: '7px 14px', width: '100%', background: isOpen ? '#f0f7f5' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}
                  >
                    <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isOpen ? '#008060' : '#8c9196' }}>
                      <Icon source={IconComponent} />
                    </span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: isOpen ? '#008060' : '#202223', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                      {item.label}
                    </span>
                    {item.toggleable && (
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, flexShrink: 0, background: isEnabled ? '#aee9d1' : '#e4e5e7', color: isEnabled ? '#005e46' : '#6d7175' }}>
                        {isEnabled ? 'On' : 'Off'}
                      </span>
                    )}
                    <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#8c9196', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
                      <Icon source={ChevronDownIcon} />
                    </span>
                  </button>

                  {isOpen && SectionComponent && (
                    <div style={{ padding: '12px 16px 16px', background: '#fafbfb', borderTop: '1px solid #e1e3e5' }}>
                      <SectionComponent />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── BrixBar pinned at bottom of sidebar (inline, not floating) ── */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e1e3e5' }}>
        <BrixBar size="sm" floating={false} />
      </div>
    </div>
  );
}
