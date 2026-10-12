// Coupon card style settings shared by the Cart Editor's Coupon Slider and the
// Coupon Banner page: subtitle font, "Copied" button colours and the icon
// (built-in SVG or own image, colour, size, show / hide). Field names match
// app/utils/coupon-style.shared.js and both storefront renderers.
import { BlockStack, Checkbox, InlineStack, Select, Text, TextField } from '@shopify/polaris';
import { COUPON_FONT_WEIGHTS, COUPON_ICON_OPTIONS, couponIconSvg, httpsOrNull } from '../../utils/coupon-style.shared.js';

function ColorRow({ label, value, fallback, onChange }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <div style={{ flex: 1 }}><Text as="span" variant="bodySm">{label}</Text></div>
      <input
        type="color" aria-label={label} value={value || fallback} onChange={(e) => onChange(e.target.value)}
        style={{ width: 36, height: 28, border: '1px solid #c9cccf', borderRadius: 6, cursor: 'pointer', padding: 0, background: 'none' }}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: '#637381', cursor: 'pointer', fontSize: 12 }}>
          Reset
        </button>
      )}
    </InlineStack>
  );
}

/**
 * value = the coupon's style ({ subFontSize, subFontWeight, subColor,
 * copiedBgColor, copiedTextColor, iconShow, icon, iconImage, iconColor,
 * iconSize }); onChange(patch). defaults = what the card shows when a field is
 * empty ({ subColor, iconColor, iconShow, iconSize }). hideCopied for cards
 * without a button (text offers).
 */
export function CouponStyleFields({ value, onChange, defaults = {}, hideCopied = false }) {
  const v = value || {};
  const iconShow = v.iconShow === undefined || v.iconShow === null ? defaults.iconShow !== false : v.iconShow !== false;
  const imageOk = !v.iconImage || httpsOrNull(v.iconImage);
  return (
    <BlockStack gap="300">
      <Text as="h4" variant="headingSm">Subtitle font</Text>
      <InlineStack gap="300" wrap={false}>
        <div style={{ flex: 1 }}>
          <TextField
            label="Size" type="number" suffix="px" min={6} max={24} autoComplete="off" placeholder="Default"
            value={v.subFontSize === undefined || v.subFontSize === null ? '' : String(v.subFontSize)}
            onChange={(x) => onChange({ subFontSize: x === '' ? '' : Number(x) })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Select label="Weight" options={COUPON_FONT_WEIGHTS} value={String(v.subFontWeight || '')} onChange={(x) => onChange({ subFontWeight: x })} />
        </div>
      </InlineStack>
      <ColorRow label="Subtitle colour" value={v.subColor} fallback={defaults.subColor || '#6b7280'} onChange={(x) => onChange({ subColor: x })} />

      {!hideCopied && (
        <>
          <Text as="h4" variant="headingSm">After &ldquo;Copy&rdquo; is tapped</Text>
          <ColorRow label="Copied button background" value={v.copiedBgColor} fallback="#10b981" onChange={(x) => onChange({ copiedBgColor: x })} />
          <ColorRow label="Copied button text" value={v.copiedTextColor} fallback="#ffffff" onChange={(x) => onChange({ copiedTextColor: x })} />
        </>
      )}

      <Text as="h4" variant="headingSm">Icon</Text>
      <Checkbox label="Show icon" checked={iconShow} onChange={(x) => onChange({ iconShow: x })} />
      {iconShow && (
        <>
          <div role="radiogroup" aria-label="Icon" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COUPON_ICON_OPTIONS.map((o) => {
              const on = !v.iconImage && (v.icon || defaults.icon || 'discount') === o.value;
              return (
                <button
                  key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.label} title={o.label}
                  onClick={() => onChange({ icon: o.value, iconImage: '' })}
                  style={{ width: 36, height: 36, padding: 8, borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? '#008060' : '#d1d5db'}`, background: on ? '#f1f8f5' : '#fff' }}
                  // eslint-disable-next-line react/no-danger -- fixed built-in SVG markup
                  dangerouslySetInnerHTML={{ __html: couponIconSvg(o.value, 18, on ? '#008060' : '#374151') }}
                />
              );
            })}
          </div>
          <TextField
            label="Or your own icon image" placeholder="https://… (png, jpg, svg, webp)" autoComplete="off"
            value={v.iconImage || ''} onChange={(x) => onChange({ iconImage: x.trim() })}
            error={imageOk ? undefined : 'Use an image link that starts with https://'}
            helpText="Upload it in Shopify (Content → Files) and paste its link. Leave empty to use the icon above."
          />
          <InlineStack gap="300" blockAlign="end" wrap={false}>
            <div style={{ flex: 1 }}>
              <TextField
                label="Icon size" type="number" suffix="px" min={8} max={48} autoComplete="off" placeholder={String(defaults.iconSize || 'Default')}
                value={v.iconSize === undefined || v.iconSize === null ? '' : String(v.iconSize)}
                onChange={(x) => onChange({ iconSize: x === '' ? '' : Number(x) })}
              />
            </div>
            <div style={{ flex: 1, paddingBottom: 6 }}>
              {!v.iconImage && <ColorRow label="Icon colour" value={v.iconColor} fallback={defaults.iconColor || '#4f46e5'} onChange={(x) => onChange({ iconColor: x })} />}
            </div>
          </InlineStack>
        </>
      )}
    </BlockStack>
  );
}
