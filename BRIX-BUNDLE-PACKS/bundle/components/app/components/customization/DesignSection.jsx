import { memo } from 'react';
import { Text } from '@shopify/polaris';
import { SectionCard } from './SectionCard';
import { CLASSIC_DESIGNS, classicDesignName, switchComboDesign } from '../../utils/combo-design.shared.js';

// Small line drawings of each design, so the choice reads at a glance.
function DesignGlyph({ layout }) {
  const stroke = 'currentColor';
  if (layout === 'layout2') {
    return (
      <svg viewBox="0 0 48 32" width="48" height="32" fill="none" stroke={stroke} strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="3" width="11" height="5" rx="2.5" fill="currentColor" stroke="none" />
        <rect x="18" y="3" width="11" height="5" rx="2.5" />
        <rect x="32" y="3" width="11" height="5" rx="2.5" />
        <rect x="4" y="12" width="12" height="16" rx="2" />
        <rect x="18" y="12" width="12" height="16" rx="2" />
        <rect x="32" y="12" width="12" height="16" rx="2" />
      </svg>
    );
  }
  if (layout === 'layout4') {
    return (
      <svg viewBox="0 0 48 32" width="48" height="32" fill="none" stroke={stroke} strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="3" width="40" height="9" rx="2" fill="currentColor" stroke="none" opacity=".35" />
        <rect x="4" y="15" width="9" height="13" rx="2" />
        <rect x="14.5" y="15" width="9" height="13" rx="2" />
        <rect x="25" y="15" width="9" height="13" rx="2" />
        <rect x="35.5" y="15" width="8.5" height="13" rx="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 32" width="48" height="32" fill="none" stroke={stroke} strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="6" r="3.5" fill="currentColor" stroke="none" />
      <path d="M12 6h8" />
      <circle cx="24" cy="6" r="3.5" />
      <path d="M28 6h8" />
      <circle cx="40" cy="6" r="3.5" />
      <rect x="4" y="13" width="18" height="15" rx="2" />
      <rect x="26" y="13" width="18" height="15" rx="2" />
    </svg>
  );
}

/**
 * Classic Combo → Design: Guided Architect / Velocity Stream / Editorial
 * Split. Switching carries the collections over (switchComboDesign).
 */
function DesignSectionComponent({ config, applyConfigPatch, expanded, onToggle }) {
  const current = config.layout || 'layout1';
  return (
    <SectionCard title="Design" expanded={expanded} onToggle={onToggle} badge={classicDesignName(current)}>
      <div className="cst-design-grid" role="radiogroup" aria-label="Combo design">
        {CLASSIC_DESIGNS.map((design) => {
          const selected = design.layout === current;
          return (
            <button
              key={design.layout}
              type="button"
              role="radio"
              aria-checked={selected}
              data-design={design.layout}
              className={`cst-design-option${selected ? ' is-selected' : ''}`}
              onClick={() => { if (!selected) applyConfigPatch(switchComboDesign(config, design.layout)); }}
            >
              <span className="cst-design-glyph"><DesignGlyph layout={design.layout} /></span>
              <span className="cst-design-name">{design.name}</span>
              <span className="cst-design-short">{design.short}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        <Text as="p" variant="bodySm" tone="subdued">
          {CLASSIC_DESIGNS.find((d) => d.layout === current)?.description} Switching keeps your collections, offer and styling.
        </Text>
      </div>
    </SectionCard>
  );
}

export const DesignSection = memo(DesignSectionComponent);
