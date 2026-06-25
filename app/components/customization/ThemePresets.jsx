import { useState } from 'react';
import { Text, Popover, Button } from '@shopify/polaris';

export function paletteToPatch({ primary, onPrimary, accent, bg, text, muted, radius }) {
  return {
    bg_color: bg,
    text_color: text,
    preview_bg_color: bg,
    preview_text_color: text,
    primary_color: primary,
    heading_color: text,
    description_color: muted,
    tab_bg_color: bg === '#ffffff' ? '#f4f5f7' : muted,
    tab_text_color: text,
    tab_active_bg_color: primary,
    tab_active_text_color: onPrimary,
    tab_border_radius: radius,
    add_btn_bg: primary,
    add_btn_text_color: onPrimary,
    add_btn_border_radius: radius,
    product_add_btn_color: primary,
    product_add_btn_text_color: onPrimary,
    buy_btn_color: primary,
    buy_btn_text_color: onPrimary,
    checkout_btn_bg: primary,
    checkout_btn_text_color: onPrimary,
    progress_bar_color: accent,
    selection_highlight_color: primary,
    preview_bar_bg: bg,
    preview_bar_text_color: text,
    preview_checkout_btn_bg: primary,
    preview_checkout_btn_text_color: onPrimary,
    preview_reset_btn_bg: primary,
    preview_reset_btn_text_color: onPrimary,
    preview_discount_price_color: primary,
  };
}

const PRESETS = [
  { id: 'mono',   name: 'Minimal',  swatch: ['#111111', '#ffffff'], palette: { primary: '#111111', onPrimary: '#ffffff', accent: '#111111', bg: '#ffffff', text: '#1a1a1a', muted: '#6b7280', radius: 8 } },
  { id: 'ocean',  name: 'Ocean',    swatch: ['#2563eb', '#e0ecff'], palette: { primary: '#2563eb', onPrimary: '#ffffff', accent: '#0ea5e9', bg: '#ffffff', text: '#0f172a', muted: '#64748b', radius: 12 } },
  { id: 'forest', name: 'Forest',   swatch: ['#059669', '#d1fae5'], palette: { primary: '#059669', onPrimary: '#ffffff', accent: '#10b981', bg: '#ffffff', text: '#064e3b', muted: '#6b7280', radius: 10 } },
  { id: 'sunset', name: 'Sunset',   swatch: ['#ea580c', '#ffedd5'], palette: { primary: '#ea580c', onPrimary: '#ffffff', accent: '#f59e0b', bg: '#fffaf5', text: '#431407', muted: '#9a6b4f', radius: 14 } },
  { id: 'royal',  name: 'Royal',    swatch: ['#7c3aed', '#ede9fe'], palette: { primary: '#7c3aed', onPrimary: '#ffffff', accent: '#a855f7', bg: '#ffffff', text: '#2e1065', muted: '#6b7280', radius: 12 } },
  { id: 'noir',   name: 'Noir',     swatch: ['#111111', '#facc15'], palette: { primary: '#facc15', onPrimary: '#111111', accent: '#facc15', bg: '#ffffff', text: '#111111', muted: '#4b5563', radius: 10 } },
];

export function ThemePresets({ config, applyConfigPatch, updateConfig }) {
  const [brandOpen, setBrandOpen] = useState(false);
  const brand = config.primary_color || '#111111';

  return (
    <div className="cst-section-card" style={{ marginBottom: 12 }}>
      <div className="cst-section-body" style={{ borderTop: 'none' }}>
        <style>{`
.cst-theme-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
.cst-theme-card{cursor:pointer;border:1px solid #e1e3e5;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;align-items:center;background:#fff;transition:border-color .15s ease,box-shadow .15s ease}
.cst-theme-card:hover{border-color:#9aa5ff;box-shadow:0 2px 8px rgba(99,102,241,.12)}
.cst-theme-swatch{display:flex;width:100%;height:34px;border-radius:7px;overflow:hidden;border:1px solid rgba(0,0,0,.06)}
.cst-theme-swatch span{flex:1}
.cst-theme-name{font-size:11.5px;font-weight:600;color:#374151}
.cst-brand-row{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid #eef0f2}
.cst-brand-chip{width:30px;height:30px;border-radius:8px;border:1px solid #d1d5db;cursor:pointer;flex-shrink:0}
        `}</style>
        <Text as="p" variant="bodyMd" fontWeight="bold">Quick Themes</Text>
        <Text as="p" variant="bodySm" tone="subdued">One click restyles colors, buttons &amp; tabs across the whole page.</Text>

        <div className="cst-theme-grid">
          {PRESETS.map((p) => (
            <div
              key={p.id}
              className="cst-theme-card"
              role="button"
              tabIndex={0}
              onClick={() => applyConfigPatch(paletteToPatch(p.palette))}
              onKeyDown={(e) => { if (e.key === 'Enter') applyConfigPatch(paletteToPatch(p.palette)); }}
            >
              <div className="cst-theme-swatch">
                <span style={{ background: p.swatch[0] }} />
                <span style={{ background: p.swatch[1] }} />
                <span style={{ background: p.palette.accent }} />
              </div>
              <span className="cst-theme-name">{p.name}</span>
            </div>
          ))}
        </div>

        <div className="cst-brand-row">
          <Popover
            active={brandOpen}
            activator={
              <button
                type="button"
                className="cst-brand-chip"
                style={{ background: brand }}
                onClick={() => setBrandOpen((v) => !v)}
                aria-label="Pick brand color"
              />
            }
            onClose={() => setBrandOpen(false)}
          >
            <div style={{ padding: 12 }}>
              <input
                type="color"
                value={brand}
                onChange={(e) => updateConfig('primary_color', e.target.value)}
                style={{ width: 180, height: 40, border: 'none', background: 'none' }}
              />
            </div>
          </Popover>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text as="p" variant="bodySm" fontWeight="semibold">Brand color</Text>
            <Text as="p" variant="bodyXs" tone="subdued">{brand}</Text>
          </div>
          <Button
            size="slim"
            onClick={() =>
              applyConfigPatch(
                paletteToPatch({
                  primary: brand,
                  onPrimary: '#ffffff',
                  accent: brand,
                  bg: config.bg_color || '#ffffff',
                  text: config.text_color || '#1a1a1a',
                  muted: '#6b7280',
                  radius: Number(config.add_btn_border_radius ?? 8),
                })
              )
            }
          >
            Apply to all
          </Button>
        </div>
      </div>
    </div>
  );
}
