/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Sidebar sections of the COD customizer for the product page payment options
// (Pay Online / Cash on Delivery) and the prepaid discount. Form state is
// form.pp (codSettingsForm.js paymentForm); everything is saved with the rest
// of the COD settings, and the prepaid discount is synced to Shopify on save.
import {
  Banner, BlockStack, Button, ButtonGroup, Card, Checkbox, FormLayout, InlineStack, Select, Text, TextField, Badge,
} from '@shopify/polaris';
import { ColorField } from '../sections/ColorField';
import { SliderField } from '../shared/SliderField';
import { PAY_COLORS, contrastRatio, HEX } from './codSettingsForm';
import { PAY_RADIUS_MAX, PAY_TEXT_LIMITS, PREPAID_PERCENT_MAX, PREPAID_PERCENT_MIN } from '../../utils/product-payment.shared';

const PLACEMENT_OPTIONS = [
  { label: 'Above the purchase buttons (recommended)', value: 'before_purchase_buttons' },
  { label: 'Below the product price', value: 'below_price' },
  { label: 'Below the variant options', value: 'below_variants' },
  { label: 'Below the quantity', value: 'below_quantity' },
  { label: 'Above Buy it now', value: 'above_buy_now' },
  { label: 'Below Add to cart', value: 'below_add_to_cart' },
  { label: 'Only where I add the "Payment options" theme block', value: 'app_block' },
];

const BANNER_OPTIONS = [
  { label: 'Above the payment options', value: 'above_selector' },
  { label: 'Inside the Pay Online card', value: 'in_online_card' },
  { label: 'Below the product price', value: 'below_price' },
];

function Segmented({ label, value, options, onChange, help }) {
  return (
    <BlockStack gap="100">
      <Text as="p">{label}</Text>
      <ButtonGroup variant="segmented" fullWidth>
        {options.map(([v, l]) => <Button key={v} pressed={value === v} onClick={() => onChange(v)}>{l}</Button>)}
      </ButtonGroup>
      {help ? <Text as="p" variant="bodySm" tone="subdued">{help}</Text> : null}
    </BlockStack>
  );
}

/** form.pp updater: setPP(['prepaid', 'percent'])(value). */
export function usePaymentSetter(setForm) {
  return (path) => (value) => setForm((f) => {
    const pp = { ...f.pp };
    if (path.length === 1) pp[path[0]] = value;
    else pp[path[0]] = { ...pp[path[0]], [path[1]]: value };
    return { ...f, pp };
  });
}

export function PaymentOptionsSection({ form, set, setPP, errors, money }) {
  const pp = form.pp;
  const codHiddenWhy = !form.enabled ? 'COD is off (Active / Inactive at the top), so this card is hidden.'
    : !form.product ? '"Show COD on product pages" is off (Product page), so this card is hidden.' : '';
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">Shoppers choose Pay Online or Cash on Delivery on the product page, before they buy.</Text>
      <Card>
        <FormLayout>
          <Checkbox
            label="Show payment options on product pages"
            checked={pp.enabled}
            onChange={setPP(['enabled'])}
            helpText={pp.enabled ? 'They replace the product page COD button set up in Product page.' : 'Off: product pages stay as they are.'}
          />
          {pp.enabled && (
            <>
              <Checkbox label="Show Pay Online" checked={pp.online.enabled} onChange={setPP(['online', 'enabled'])} helpText="Pays in your normal Shopify checkout." />
              <Checkbox
                label="Show Cash on Delivery"
                checked={pp.cod.enabled}
                onChange={setPP(['cod', 'enabled'])}
                helpText={pp.cod.enabled && codHiddenWhy ? codHiddenWhy : 'Opens the BRIX COD checkout, with your COD fee and rules.'}
              />
              {!pp.online.enabled && !pp.cod.enabled && (
                <Banner tone="warning">Both are off, so nothing shows on product pages.</Banner>
              )}
              <Select
                label="Selected when the page opens"
                options={[{ label: 'Pay Online', value: 'online' }, { label: 'Cash on Delivery', value: 'cod' }]}
                value={pp.defaultMethod}
                onChange={setPP(['defaultMethod'])}
              />
              <TextField label="Heading" value={pp.heading} onChange={setPP(['heading'])} maxLength={PAY_TEXT_LIMITS.heading} placeholder="Choose payment method" helpText="Leave empty for no heading." autoComplete="off" />
            </>
          )}
        </FormLayout>
      </Card>
      {pp.enabled && pp.online.enabled && (
        <Card>
          <FormLayout>
            <Text as="h3" variant="headingMd">Pay Online</Text>
            <FormLayout.Group>
              <TextField label="Label" value={pp.online.label} onChange={setPP(['online', 'label'])} maxLength={PAY_TEXT_LIMITS.label} error={errors.ppOnlineLabel} autoComplete="off" />
              <TextField label="Description" value={pp.online.description} onChange={setPP(['online', 'description'])} maxLength={PAY_TEXT_LIMITS.description} placeholder="Get instant savings" autoComplete="off" />
            </FormLayout.Group>
            <TextField
              label="Button text"
              value={pp.online.buttonText}
              onChange={setPP(['online', 'buttonText'])}
              maxLength={PAY_TEXT_LIMITS.buttonText}
              error={errors.ppOnlineButton}
              helpText={'"· Save 10%" is added for you while the prepaid discount applies and the badge is on.'}
              autoComplete="off"
            />
            <Checkbox
              label="Write the saving on Shopify's Buy it now button"
              checked={pp.relabelBuyNow}
              onChange={setPP(['relabelBuyNow'])}
              helpText="Only its text changes; it still opens Shopify checkout. Themes without Buy it now get a BRIX Pay Online button."
            />
            <Checkbox label="Show payment icon" checked={pp.online.showIcon} onChange={setPP(['online', 'showIcon'])} />
          </FormLayout>
        </Card>
      )}
      {pp.enabled && pp.cod.enabled && (
        <Card>
          <FormLayout>
            <Text as="h3" variant="headingMd">Cash on Delivery</Text>
            <FormLayout.Group>
              <TextField label="Label" value={pp.cod.label} onChange={setPP(['cod', 'label'])} maxLength={PAY_TEXT_LIMITS.label} error={errors.ppCodLabel} autoComplete="off" />
              <TextField label="Description" value={pp.cod.description} onChange={setPP(['cod', 'description'])} maxLength={PAY_TEXT_LIMITS.description} placeholder="Pay when your order arrives" autoComplete="off" />
            </FormLayout.Group>
            <TextField label="Button text" value={form.productText} onChange={set('productText')} error={errors.productText} maxLength={60} helpText="The same text as the product page COD button." autoComplete="off" />
            <Checkbox label="Show payment icon" checked={pp.cod.showIcon} onChange={setPP(['cod', 'showIcon'])} />
            <Text as="p" variant="bodySm" tone="subdued">
              {form.codFeeEnabled && Number(form.codFee) > 0
                ? `COD fee: ${money(Number(form.codFee))} ${form.codFeeLabel}${form.showCodFee ? ', shown on the card' : ', charged but not shown on the card'} (set in COD fee).`
                : 'No COD fee (set in COD fee).'}
            </Text>
          </FormLayout>
        </Card>
      )}
    </BlockStack>
  );
}

function PrepaidStatus({ status, dirty, enabled }) {
  if (!enabled) return null;
  if (dirty) return <Banner tone="info">Save to set up these changes in Shopify checkout.</Banner>;
  if (!status) return <Banner tone="info">Save to set up the discount in Shopify checkout.</Banner>;
  if (status.verified) {
    return (
      <Banner tone="success" title="Active in Shopify checkout">
        {`${status.percent}% off online payments${status.minSubtotal > 0 ? ` on orders from ${status.minSubtotal} ${status.currency || ''}`.trimEnd() : ''}. Shoppers see the offer on product pages.`}
      </Banner>
    );
  }
  return (
    <Banner tone="warning" title="Not active yet: shoppers don't see the offer">
      {status.message || ({
        not_deployed: 'The prepaid discount is not installed on this store yet. Deploy the app once with its latest extension, then save again.',
        plan_locked: 'The prepaid discount goes live for shoppers on the Starter or Pro plan.',
        inactive: 'The BRIX Prepaid Discount is not active in Shopify (Discounts).',
        failed: 'Shopify could not be updated. Save again to retry.',
      }[status.state] || 'Save again to retry.')}
    </Banner>
  );
}

export function PrepaidSection({ form, setPP, errors, currencyCode, status, dirty }) {
  const pp = form.pp;
  const p = pp.prepaid;
  const canUse = pp.enabled && pp.online.enabled;
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">A discount for paying online, given by Shopify at checkout. Cash on Delivery orders never get it.</Text>
      <PrepaidStatus status={status} dirty={dirty} enabled={p.enabled && canUse} />
      <Card>
        <FormLayout>
          <Checkbox
            label="Give a prepaid discount"
            checked={p.enabled}
            onChange={setPP(['prepaid', 'enabled'])}
            disabled={!canUse}
            helpText={canUse ? 'Turning the payment options or Pay Online off also stops it.' : 'Turn on payment options with Pay Online first (Payment options).'}
          />
          {p.enabled && (
            <>
              <FormLayout.Group>
                <TextField
                  label="Discount"
                  type="number"
                  min={PREPAID_PERCENT_MIN}
                  max={PREPAID_PERCENT_MAX}
                  suffix="%"
                  value={p.percent}
                  onChange={setPP(['prepaid', 'percent'])}
                  error={errors.ppPercent}
                  helpText={`${PREPAID_PERCENT_MIN} to ${PREPAID_PERCENT_MAX}%`}
                  autoComplete="off"
                />
                <TextField
                  label="Minimum order"
                  type="number"
                  min={0}
                  prefix={currencyCode}
                  value={p.minSubtotal}
                  onChange={setPP(['prepaid', 'minSubtotal'])}
                  error={errors.ppMinSubtotal}
                  placeholder="No minimum"
                  helpText="The order subtotal at checkout."
                  autoComplete="off"
                />
              </FormLayout.Group>
              <TextField label="Discount title" value={p.title} onChange={setPP(['prepaid', 'title'])} maxLength={PAY_TEXT_LIMITS.title} error={errors.ppTitle} helpText="Its name in Shopify checkout and on the order." autoComplete="off" />
              <Checkbox label={'Show a "Save X%" badge'} checked={p.showBadge} onChange={setPP(['prepaid', 'showBadge'])} helpText="On the Pay Online card and its Buy button." />
              <Checkbox label="Show the exact savings amount" checked={p.showSavingsAmount} onChange={setPP(['prepaid', 'showSavingsAmount'])} helpText={'"(save ₹110)" next to the online price.'} />
            </>
          )}
        </FormLayout>
      </Card>
      {p.enabled && (
        <Card>
          <FormLayout>
            <Text as="h3" variant="headingMd">Offer message</Text>
            <Checkbox label="Show the offer message" checked={pp.layout.showBanner} onChange={setPP(['layout', 'showBanner'])} />
            {pp.layout.showBanner && (
              <>
                <Select label="Where" options={BANNER_OPTIONS} value={pp.layout.bannerPlacement} onChange={setPP(['layout', 'bannerPlacement'])} />
                <TextField label="Message" value={p.offerTitle} onChange={setPP(['prepaid', 'offerTitle'])} maxLength={PAY_TEXT_LIMITS.offerTitle} placeholder="{percent}% off when you pay online" autoComplete="off" />
                {pp.layout.bannerPlacement !== 'in_online_card' && (
                  <TextField label="Second line" value={p.offerDescription} onChange={setPP(['prepaid', 'offerDescription'])} maxLength={PAY_TEXT_LIMITS.offerDescription} placeholder="Pay online and save {amount}" autoComplete="off" />
                )}
                {Number(p.minSubtotal) > 0 && (
                  <TextField label="Message below the minimum" value={p.minNotMetText} onChange={setPP(['prepaid', 'minNotMetText'])} maxLength={PAY_TEXT_LIMITS.minNotMetText} placeholder="Get {percent}% off on orders above {min}" helpText="Shown instead while the product is below the minimum. Leave empty to show nothing." autoComplete="off" />
                )}
                <Text as="p" variant="bodySm" tone="subdued">{'{percent} {amount} {min} and {price} are filled in for each shopper.'}</Text>
              </>
            )}
          </FormLayout>
        </Card>
      )}
      <Banner tone="info">
        It applies to every online payment in Shopify checkout (cart, drawer and Buy it now), not only orders from product pages. Third-party checkouts (for example Shiprocket) may not run Shopify discounts: test one order first. If Shopify&apos;s own &quot;Cash on Delivery (COD)&quot; payment method is on in your checkout, shoppers who pick it there would still get this discount, so use BRIX COD instead.
      </Banner>
    </BlockStack>
  );
}

export function PaymentDesignSection({ form, setPP, errors }) {
  const pp = form.pp;
  const l = pp.layout;
  const a = pp.appearance;
  const badgeRatio = HEX.test(a.badgeBackground) && HEX.test(a.badgeText) ? contrastRatio(a.badgeBackground, a.badgeText) : 21;
  return (
    <BlockStack gap="400">
      <Text as="p" tone="subdued">How the payment options look on product pages. Phones always show the cards one under the other.</Text>
      <Card>
        <FormLayout>
          <Select
            label="Position on the product page"
            options={PLACEMENT_OPTIONS}
            value={l.placement}
            onChange={setPP(['layout', 'placement'])}
            helpText={'If you add the "Payment options" block in the theme editor, they show there instead.'}
          />
          <Segmented label="Cards" value={l.cardLayout} onChange={setPP(['layout', 'cardLayout'])} options={[['horizontal', 'Side by side'], ['vertical', 'Stacked']]} />
          <Segmented label="Card style" value={l.cardStyle} onChange={setPP(['layout', 'cardStyle'])} options={[['border', 'Border'], ['filled', 'Filled'], ['minimal', 'Minimal']]} />
          <Segmented
            label="Selected card"
            value={l.selectedStyle}
            onChange={(v) => { setPP(['layout', 'selectedStyle'])(v); if (v === 'radio_border') setPP(['layout', 'showRadio'])(true); }}
            options={[['border', 'Border'], ['background', 'Background'], ['radio_border', 'Radio + border']]}
          />
          <Segmented label="Spacing" value={l.spacing} onChange={setPP(['layout', 'spacing'])} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} />
          <SliderField label="Corner rounding" value={Number(l.radius) || 0} min={0} max={PAY_RADIUS_MAX} suffix="px" onChange={setPP(['layout', 'radius'])} />
          <Checkbox label="Show radio buttons" checked={l.showRadio} onChange={setPP(['layout', 'showRadio'])} helpText={l.showRadio ? '' : 'The selected card shows a tick instead.'} />
          <Checkbox label="Show payment icons" checked={l.showIcons} onChange={setPP(['layout', 'showIcons'])} />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Colours</Text>
          {[0, 2, 4, 6].map((i) => (
            <InlineStack key={i} gap="400" wrap={false}>
              {PAY_COLORS.slice(i, i + 2).map(([key, label]) => (
                <div key={key} style={{ flex: 1, minWidth: 0 }}>
                  <ColorField label={label} value={a[key]} onChange={setPP(['appearance', key])} />
                  {errors[`pp_${key}`] && <Text as="p" tone="critical" variant="bodySm">{errors[`pp_${key}`]}</Text>}
                </div>
              ))}
            </InlineStack>
          ))}
          {badgeRatio < 4.5 && (
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="warning">{`Badge hard to read · ${badgeRatio.toFixed(1)}:1`}</Badge>
              <Button variant="plain" onClick={() => setPP(['appearance', 'badgeText'])(contrastRatio(a.badgeBackground, '#ffffff') >= contrastRatio(a.badgeBackground, '#111827') ? '#ffffff' : '#111827')}>Fix text colour</Button>
            </InlineStack>
          )}
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
