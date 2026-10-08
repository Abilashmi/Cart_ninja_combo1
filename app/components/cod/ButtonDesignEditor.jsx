/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Edits one COD button look (cart drawer, product page or combo page):
// style, colours, corners, font size, bold, capitals and the cash icon. Used
// by the COD customizer (app.cod_.customize.jsx); the storefront draws the
// same look (brix_cod.js buttonPaint / buttonType).
import { Badge, BlockStack, Button, ButtonGroup, Card, Checkbox, FormLayout, InlineStack, Text, TextField } from '@shopify/polaris';
import { ColorField } from '../sections/ColorField';
import { SliderField } from '../shared/SliderField';
import { COD_BUTTON_FONT_SIZES } from '../../utils/cod.shared';
import { STYLE_PRESETS, HEX, fullHex, contrastRatio } from './codSettingsForm';

const BUTTON_STYLES = [['filled', 'Filled'], ['outline', 'Outline'], ['minimal', 'Minimal']];

/**
 * look: { style, bg, color, radius?, fontSize, bold, uppercase, icon }
 * onChange(patch) merges into the look. showRadius: show the corners slider
 * (the product page sets its corners under Size and spacing).
 */
export default function ButtonDesignEditor({ look, onChange, showRadius = true, errors = {} }) {
  const textOnWhite = look.style !== 'filled';
  const ratio = textOnWhite ? contrastRatio(look.bg, '#ffffff') : contrastRatio(look.bg, look.color);
  return (
    <BlockStack gap="400">
      <Card>
        <FormLayout>
          <BlockStack gap="100">
            <Text as="p">Button style</Text>
            <ButtonGroup variant="segmented" fullWidth>
              {BUTTON_STYLES.map(([s, label]) => (
                <Button key={s} pressed={look.style === s} onClick={() => onChange({ style: s })}>{label}</Button>
              ))}
            </ButtonGroup>
          </BlockStack>
          <Text as="h3" variant="headingSm">Colours</Text>
          <InlineStack gap="400" wrap={false}>
            <ColorField label="Button colour" value={look.bg} onChange={(v) => onChange({ bg: v })} />
            {textOnWhite ? (
              <div style={{ flex: 1 }}><TextField label="Text colour" value="Button colour" disabled autoComplete="off" /></div>
            ) : (
              <ColorField label="Text colour" value={look.color} onChange={(v) => onChange({ color: v })} />
            )}
          </InlineStack>
          {(errors.bg || errors.color) && <Text as="p" tone="critical" variant="bodySm">{errors.bg || errors.color}</Text>}
          <div className="cod-swatches" aria-label="Colour presets">
            {STYLE_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                title={p.name}
                aria-label={`Use ${p.name}`}
                className={`cod-swatch${fullHex(look.bg) === p.bg && fullHex(look.color) === p.color ? ' on' : ''}`}
                style={{ background: `linear-gradient(135deg, ${p.bg} 60%, ${p.color} 60%)` }}
                onClick={() => onChange({ bg: p.bg, color: p.color })}
              />
            ))}
          </div>
          {HEX.test(look.bg) && HEX.test(look.color) && ratio < 4.5 && (
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="warning">{`Hard to read · ${ratio.toFixed(1)}:1`}</Badge>
              {!textOnWhite && (
                <Button variant="plain" onClick={() => onChange({ color: contrastRatio(look.bg, '#ffffff') >= contrastRatio(look.bg, '#111827') ? '#ffffff' : '#111827' })}>
                  Fix text colour
                </Button>
              )}
            </InlineStack>
          )}
          {showRadius && <SliderField label="Corner rounding" value={Number(look.radius) || 0} min={0} max={40} suffix="px" onChange={(v) => onChange({ radius: v })} />}
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingSm">Text</Text>
          <SliderField
            label="Font size" value={Number(look.fontSize) || 15}
            min={COD_BUTTON_FONT_SIZES[0]} max={COD_BUTTON_FONT_SIZES[1]} suffix="px"
            onChange={(v) => onChange({ fontSize: v })}
          />
          <Checkbox label="Bold" checked={look.bold !== false} onChange={(v) => onChange({ bold: v })} />
          <Checkbox label="ALL CAPS" checked={Boolean(look.uppercase)} onChange={(v) => onChange({ uppercase: v })} />
          <Checkbox label="Show the cash icon" checked={look.icon !== false} onChange={(v) => onChange({ icon: v })} />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
