import { useState } from 'react';
import { useCartEditor } from '../context/CartEditorContext';
import { SECTION_GROUPS } from '../types/cartEditorTypes';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ColorIcon,
  SettingsIcon,
  LayoutHeaderIcon,
  MegaphoneIcon,
  ChartVerticalIcon,
  DiscountCodeIcon,
  ProductIcon,
  CartIcon,
  CashDollarIcon,
  CodeIcon,
} from '@shopify/polaris-icons';
import { Icon } from '@shopify/polaris';

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
  color: ColorIcon,
  settings: SettingsIcon,
  'layout-header': LayoutHeaderIcon,
  megaphone: MegaphoneIcon,
  chart: ChartVerticalIcon,
  discount: DiscountCodeIcon,
  product: ProductIcon,
  cart: CartIcon,
  cash: CashDollarIcon,
  code: CodeIcon,
};

const SECTION_COMPONENT_MAP = {
  design: DesignSection,
  general: GeneralSection,
  header: HeaderSection,
  announcements: AnnouncementsSection,
  progressBar: ProgressBarSection,
  couponSlider: CouponSliderSection,
  upsellProducts: UpsellSection,
  emptyCart: EmptyCartSection,
  checkoutButton: CheckoutSection,
  customCSS: CustomCSSSection,
};

export function CartEditorSidebar({ onDiscard }) {
  const { status, setStatus, setActiveSection, previewMode, setPreviewMode, body } = useCartEditor();
  const [openSection, setOpenSection] = useState(null);

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
    <div className="cart-editor-left">
      {/* Header */}
      <div className="cart-editor-left-header">
        <div className="cart-editor-left-header-top">
          <button className="cart-editor-back-btn" onClick={onDiscard}>
            <Icon source={ArrowLeftIcon} />
          </button>
          <span className="cart-editor-title">Cart Editor</span>
        </div>

        {/* Controls */}
        <div className="cart-editor-left-header-controls">
          <div className="cart-editor-control-row">
            <span className="cart-editor-control-label">Status</span>
            <button
              className={`cart-editor-status-pill ${status === 'active' ? 'active' : ''}`}
              onClick={() => setStatus(status === 'active' ? 'inactive' : 'active')}
            >
              <span className="status-dot" />
              {status === 'active' ? 'Active' : 'Inactive'}
            </button>
          </div>

          <div className="cart-editor-control-row">
            <span className="cart-editor-control-label">Preview</span>
            <div className="cart-editor-segmented">
              <button
                className={`segmented-btn ${previewMode === 'items' ? 'active' : ''}`}
                onClick={() => setPreviewMode('items')}
              >
                Items
              </button>
              <button
                className={`segmented-btn ${previewMode === 'empty' ? 'active' : ''}`}
                onClick={() => setPreviewMode('empty')}
              >
                Empty
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Accordion */}
      <div className="cart-editor-accordion">
        {SECTION_GROUPS.map((group) => (
          <div key={group.title} className="accordion-group">
            <div className="accordion-group-label">{group.title}</div>
            {group.items.map((item) => {
              const isOpen = openSection === item.id;
              const IconComponent = ICON_MAP[item.icon] || SettingsIcon;
              const isEnabled = item.toggleable ? getEnabled(item.enabledKey) : undefined;
              const SectionComponent = SECTION_COMPONENT_MAP[item.id];

              return (
                <div
                  key={item.id}
                  className={`accordion-item ${isOpen ? 'open' : ''}`}
                >
                  <button
                    className="accordion-row"
                    onClick={() => toggleSection(item.id)}
                  >
                    <span className="accordion-row-icon">
                      <Icon source={IconComponent} />
                    </span>
                    <span className="accordion-row-label">{item.label}</span>
                    {item.toggleable && (
                      <span className={`accordion-badge ${isEnabled ? 'on' : 'off'}`}>
                        {isEnabled ? 'On' : 'Off'}
                      </span>
                    )}
                    <span className={`accordion-chevron ${isOpen ? 'open' : ''}`}>
                      <Icon source={ChevronDownIcon} />
                    </span>
                  </button>

                  {isOpen && SectionComponent && (
                    <div className="accordion-content">
                      <SectionComponent />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
