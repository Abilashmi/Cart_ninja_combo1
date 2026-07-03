import { useState } from 'react';
import {
  Card, FormLayout, TextField, Select, BlockStack, Text,
  InlineStack, Button, Tabs, ChoiceList, Divider, Icon,
} from '@shopify/polaris';
import { ChevronDownIcon } from '@shopify/polaris-icons';
import {
  DiscountCodeIcon, GiftCardFilledIcon, DeliveryFilledIcon,
  StarFilledIcon, DiscountFilledIcon, CashDollarIcon,
} from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';
import { CustomizableLockedSection } from '../plan/PlanGate';
import { usePlan } from '../PlanContext';

const COUPON_ICON_MAP = {
  discount: DiscountCodeIcon,
  gift: GiftCardFilledIcon,
  shipping: DeliveryFilledIcon,
  star: StarFilledIcon,
  percent: DiscountFilledIcon,
  cash: CashDollarIcon,
};

const COUPON_ICON_OPTIONS = [
  { label: 'Discount Tag', value: 'discount' },
  { label: 'Gift Card', value: 'gift' },
  { label: 'Free Shipping', value: 'shipping' },
  { label: 'Star', value: 'star' },
  { label: 'Percentage', value: 'percent' },
  { label: 'Cash', value: 'cash' },
];

function makeCouponSliderItem(shopifyCoupon) {
  return {
    id: shopifyCoupon.id,
    code: shopifyCoupon.code,
    labelText: shopifyCoupon.code,
    description: shopifyCoupon.title || shopifyCoupon.code,
    bgColor: '#4f46e5',
    textColor: '#ffffff',
    icon: 'discount',
    borderRadius: 8,
    buttonText: 'Apply',
    buttonBgColor: '#000000',
    buttonTextColor: '#ffffff',
  };
}

function CouponAppearanceEditor({ item, onUpdate, onClose }) {
  return (
    <BlockStack gap="400">
      <div style={{ padding: '10px 12px', borderRadius: '6px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <Text as="p" variant="bodySm" tone="subdued">
          Editing coupon appearance. Changes apply only inside the cart drawer.
        </Text>
      </div>
      <FormLayout>
        <Text as="h4" variant="headingSm">Edit: {item.code}</Text>
        <InlineStack gap="400">
          <div style={{ flex: 1 }}>
            <TextField label="Coupon Code" value={item.code} onChange={() => {}} disabled autoComplete="off" />
          </div>
          <div style={{ flex: 1 }}>
            <TextField label="Label Text" value={item.labelText} onChange={(v) => onUpdate({ labelText: v })} autoComplete="off" />
          </div>
        </InlineStack>
        <TextField label="Description" value={item.description} onChange={(v) => onUpdate({ description: v })} autoComplete="off" />
        <Text as="h4" variant="headingSm">Appearance</Text>
        <InlineStack gap="400">
          <ColorField label="Background Color" value={item.bgColor} onChange={(v) => onUpdate({ bgColor: v })} />
          <ColorField label="Text Color" value={item.textColor} onChange={(v) => onUpdate({ textColor: v })} />
        </InlineStack>
        <InlineStack gap="400">
          <div style={{ flex: 1 }}>
            <BlockStack gap="200">
              <Select
                label="Icon"
                options={COUPON_ICON_OPTIONS}
                value={item.icon}
                onChange={(v) => onUpdate({ icon: v })}
              />
              {(() => {
                const IconComp = COUPON_ICON_MAP[item.icon] ?? DiscountCodeIcon;
                return (
                  <div style={{ padding: '8px 12px', border: '1px solid #e1e3e5', borderRadius: '8px', background: '#f9fafb', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Text as="span" variant="bodySm" tone="subdued">Preview:</Text>
                    <span style={{ color: item.bgColor, display: 'flex', lineHeight: 0 }}>
                      <IconComp width="20" height="20" fill="currentColor" />
                    </span>
                  </div>
                );
              })()}
            </BlockStack>
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label="Border Radius"
              type="number"
              value={String(item.borderRadius)}
              onChange={(v) => onUpdate({ borderRadius: Number(v) })}
              suffix="px"
              autoComplete="off"
            />
          </div>
        </InlineStack>
        <Text as="h4" variant="headingSm">Button Settings</Text>
        <TextField label="Button Text" value={item.buttonText} onChange={(v) => onUpdate({ buttonText: v })} autoComplete="off" />
        <InlineStack gap="400">
          <ColorField label="Button Background" value={item.buttonBgColor} onChange={(v) => onUpdate({ buttonBgColor: v })} />
          <ColorField label="Button Text Color" value={item.buttonTextColor} onChange={(v) => onUpdate({ buttonTextColor: v })} />
        </InlineStack>
        <Divider />
        <CustomizableLockedSection featureKey="open_countdown">
        <Text as="h4" variant="headingSm">Countdown Timer</Text>
        <FeatureToggle
          label="Enable timer for this coupon"
          enabled={item.timerEnabled ?? false}
          onToggle={(v) => onUpdate({ timerEnabled: v })}
        />
        {item.timerEnabled && (
          <>
            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField label="Hours" type="number" value={String(item.timerHours ?? 0)} onChange={(v) => onUpdate({ timerHours: Number(v) })} min={0} max={23} autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Minutes" type="number" value={String(item.timerMinutes ?? 15)} onChange={(v) => onUpdate({ timerMinutes: Number(v) })} min={0} max={59} autoComplete="off" />
              </div>
            </InlineStack>
            <TextField label="Timer Label" value={item.timerLabel ?? 'Offer expires in'} onChange={(v) => onUpdate({ timerLabel: v })} autoComplete="off" />
            <TextField label="Expired Label" value={item.timerExpiredLabel ?? 'Offer expired!'} onChange={(v) => onUpdate({ timerExpiredLabel: v })} autoComplete="off" />
            <InlineStack gap="400">
              <ColorField label="Timer Background" value={item.timerBgColor ?? '#fef2f2'} onChange={(v) => onUpdate({ timerBgColor: v })} />
              <ColorField label="Timer Text" value={item.timerTextColor ?? '#991b1b'} onChange={(v) => onUpdate({ timerTextColor: v })} />
              <ColorField label="Accent" value={item.timerAccentColor ?? '#dc2626'} onChange={(v) => onUpdate({ timerAccentColor: v })} />
            </InlineStack>
          </>
        )}
        </CustomizableLockedSection>
      </FormLayout>
      <InlineStack gap="200">
        <Button onClick={onClose}>Done</Button>
      </InlineStack>
    </BlockStack>
  );
}

function CouponStylesTab() {
  const { body, updateCouponSlider } = useCartEditor();
  const { couponSlider } = body;

  return (
    <BlockStack gap="400">
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Select Coupon Style</Text>
          <Text as="p" variant="bodySm" tone="subdued">Choose one style that applies to all coupons</Text>
          <ChoiceList
            title=""
            choices={[
              { label: 'Classic Banner', value: 'classic-banner' },
              { label: 'Minimal Card', value: 'minimal-card' },
              { label: 'Bold & Vibrant', value: 'bold-vibrant' },
            ]}
            selected={[couponSlider.template]}
            onChange={([v]) => updateCouponSlider({ template: v })}
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Display Settings</Text>
          <FeatureToggle
            label="Show when cart is empty"
            enabled={couponSlider.showWhenEmpty}
            onToggle={(v) => updateCouponSlider({ showWhenEmpty: v })}
          />
          <Select
            label="Position in Cart"
            options={[
              { label: 'Top of cart', value: 'top' },
              { label: 'Bottom of cart', value: 'bottom' },
            ]}
            value={couponSlider.position}
            onChange={(v) => updateCouponSlider({ position: v })}
          />
          <Select
            label="Layout"
            options={[
              { label: 'Grid (2 columns)', value: 'grid' },
              { label: 'Carousel', value: 'carousel' },
            ]}
            value={couponSlider.layout}
            onChange={(v) => updateCouponSlider({ layout: v })}
          />
          <Select
            label="Alignment"
            options={[
              { label: 'Horizontal', value: 'horizontal' },
              { label: 'Vertical', value: 'vertical' },
            ]}
            value={couponSlider.alignment}
            onChange={(v) => updateCouponSlider({ alignment: v })}
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Section Title</Text>
          <TextField
            label="Title text"
            value={couponSlider.sectionTitle}
            onChange={(v) => updateCouponSlider({ sectionTitle: v })}
            autoComplete="off"
          />
          <InlineStack gap="400">
            <div style={{ flex: 1 }}>
              <TextField
                label="Font size (px)"
                type="number"
                value={String(couponSlider.titleFontSize)}
                onChange={(v) => updateCouponSlider({ titleFontSize: Number(v) })}
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label="Text alignment"
                options={[
                  { label: 'Left', value: 'left' },
                  { label: 'Center', value: 'center' },
                  { label: 'Right', value: 'right' },
                ]}
                value={couponSlider.titleTextAlign}
                onChange={(v) => updateCouponSlider({ titleTextAlign: v })}
              />
            </div>
          </InlineStack>
          <ColorField
            label="Title text color"
            value={couponSlider.titleColor}
            onChange={(v) => updateCouponSlider({ titleColor: v })}
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}

function ManageCouponsTab() {
  const { body, availableCoupons, addCouponSliderItem, removeCouponSliderItem, updateCouponSliderItem } = useCartEditor();
  const { couponSlider } = body;
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState('');

  const selectedIds = new Set(couponSlider.selectedCoupons.map((c) => c.id));

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const addCoupon = (shopifyCoupon) => {
    addCouponSliderItem(makeCouponSliderItem(shopifyCoupon));
    setExpandedId(shopifyCoupon.id);
  };

  const removeCoupon = (id) => {
    removeCouponSliderItem(id);
    if (expandedId === id) setExpandedId(null);
  };

  const filteredCoupons = (availableCoupons || []).filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.code.toLowerCase().includes(q) || (c.title || '').toLowerCase().includes(q);
  });

  return (
    <BlockStack gap="400">
      {/* Active (selected) coupons — accordion */}
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Active in Cart Slider</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Click a coupon to edit its appearance in the cart drawer.
          </Text>

          {couponSlider.selectedCoupons.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed #c9cccf', borderRadius: '8px' }}>
              <Text as="p" variant="bodySm" tone="subdued">No coupons added yet. Pick from the list below.</Text>
            </div>
          ) : (
            <div style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden' }}>
              {couponSlider.selectedCoupons.map((item, idx) => {
                const IconComp = COUPON_ICON_MAP[item.icon] ?? DiscountCodeIcon;
                const isOpen = expandedId === item.id;
                const isLast = idx === couponSlider.selectedCoupons.length - 1;
                return (
                  <div key={item.id} style={{ borderBottom: isLast ? 'none' : '1px solid #e1e3e5' }}>
                    {/* Clickable row */}
                    <button
                      onClick={() => toggleExpand(item.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 14px',
                        background: isOpen ? '#f0f7f5' : '#ffffff',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                    >
                      {/* Color swatch */}
                      <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: item.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ color: item.textColor, display: 'flex', lineHeight: 0 }}>
                          <IconComp width="16" height="16" fill="currentColor" />
                        </span>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: isOpen ? '#008060' : '#202223', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.labelText || item.code}
                        </div>
                        <div style={{ fontSize: '11px', color: '#6d7175', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.description}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '11px', color: isOpen ? '#008060' : '#6d7175', fontWeight: 500 }}>
                          {isOpen ? 'Close' : 'Edit'}
                        </span>
                        <span style={{ color: isOpen ? '#008060' : '#8c9196', display: 'flex', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <Icon source={ChevronDownIcon} />
                        </span>
                      </div>
                    </button>

                    {/* Inline edit form */}
                    {isOpen && (
                      <div style={{ padding: '16px 14px 20px', background: '#fafbfb', borderTop: '1px solid #e1e3e5', animation: 'accordionFadeIn 0.15s ease' }}>
                        <CouponAppearanceEditor
                          item={item}
                          onUpdate={(updates) => updateCouponSliderItem(item.id, updates)}
                          onClose={() => setExpandedId(null)}
                          onRemove={() => removeCoupon(item.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </BlockStack>
      </Card>

      {/* Available coupons from store */}
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Your Store Coupons</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            All active discount codes from your Shopify store.
          </Text>

          <TextField
            label=""
            labelHidden
            placeholder="Search by code or title…"
            value={search}
            onChange={setSearch}
            autoComplete="off"
            clearButton
            onClearButtonClick={() => setSearch('')}
          />

          {!availableCoupons || availableCoupons.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', border: '1px dashed #c9cccf', borderRadius: '8px', background: '#f9fafb' }}>
              <Text as="p" variant="bodySm" tone="subdued">
                No active discount codes found in your store. Create coupons in the{' '}
                <strong>Coupon Creator</strong> section first.
              </Text>
            </div>
          ) : filteredCoupons.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <Text as="p" variant="bodySm" tone="subdued">No coupons match your search.</Text>
            </div>
          ) : (
            <div style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden' }}>
              {filteredCoupons.map((coupon, idx) => {
                const isSelected = selectedIds.has(coupon.id);
                const isLast = idx === filteredCoupons.length - 1;
                return (
                  <div
                    key={coupon.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      background: isSelected ? '#f1f8f5' : '#ffffff',
                      borderBottom: isLast ? 'none' : '1px solid #f1f2f3',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '6px', background: isSelected ? '#dcfce7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: isSelected ? '#008060' : '#4f46e5', display: 'flex', lineHeight: 0 }}>
                        <DiscountCodeIcon width="16" height="16" fill="currentColor" />
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: isSelected ? '#008060' : '#202223', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {coupon.code}
                      </div>
                      {coupon.title && coupon.title !== coupon.code && (
                        <div style={{ fontSize: '11px', color: '#6d7175', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {coupon.title}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      {isSelected ? (
                        <button
                          onClick={() => removeCoupon(coupon.id)}
                          style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fff1f2', color: '#dc2626', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          onClick={() => addCoupon(coupon)}
                          style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #b5e3d8', background: '#f1f8f5', color: '#008060', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export function CouponSliderSection() {
  const { body, updateCouponSlider } = useCartEditor();
  const { couponSlider } = body;
  const [selectedTab, setSelectedTab] = useState(0);
  const { canPublishFeature } = usePlan();
  const couponPublishable = canPublishFeature('coupon_lock_pro');

  const tabs = [
    { id: 'coupon-styles', content: 'Coupon Styles', panelID: 'coupon-styles-panel' },
    { id: 'manage-coupons', content: 'Manage Coupons', panelID: 'manage-coupons-panel' },
  ];

  return (
    <BlockStack gap="400">
      <FeatureToggle
        label="Enable Coupon Slider"
        enabled={couponSlider.enabled && couponPublishable}
        disabled={!couponPublishable}
        onToggle={(v) => updateCouponSlider({ enabled: v })}
      />
      <Text as="p" variant="bodyMd" tone="subdued">
        Display available coupons in your cart drawer for easy application.
      </Text>
      {couponSlider.enabled && (
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          <div style={{ paddingTop: '16px' }}>
            {selectedTab === 0 && <CouponStylesTab />}
            {selectedTab === 1 && <ManageCouponsTab />}
          </div>
        </Tabs>
      )}
    </BlockStack>
  );
}
