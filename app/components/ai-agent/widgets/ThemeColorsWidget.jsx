import { useEffect, useRef, useState } from 'react';

// Each combo is shown as one circle split into 4 pie-chart wedges (header
// background, header text, checkout background, checkout text) via a CSS
// conic-gradient. Clicking a circle SELECTS it and previews it live in the
// REAL Cart Editor preview (via a 'brixThemePreview' event CartEditorContext
// listens for, rendered on top of state without touching what Save
// persists) — not a mockup inside the chat. Only a separate Apply click
// actually writes it (see onApply); switching selection or leaving without
// applying reverts the live preview back to the real saved colors.
function pieBackground(p) {
  return `conic-gradient(${p.headerBgColor} 0deg 90deg, ${p.headerTextColor} 90deg 180deg, ${p.checkoutBgColor} 180deg 270deg, ${p.checkoutTextColor} 270deg 360deg)`;
}

function dispatchPreview(p) {
  window.dispatchEvent(new CustomEvent('brixThemePreview', {
    detail: {
      header: { bgColor: p.headerBgColor, textColor: p.headerTextColor },
      checkoutButton: { bgColor: p.checkoutBgColor, textColor: p.checkoutTextColor },
    },
  }));
}

function clearPreview() {
  window.dispatchEvent(new CustomEvent('brixThemePreviewClear'));
}

export default function ThemeColorsWidget({ palette, onApply }) {
  const palettes = Array.isArray(palette) ? palette : palette ? [palette] : [];
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [applying, setApplying] = useState(false);
  const [appliedIndex, setAppliedIndex] = useState(null);
  const [error, setError] = useState(null);

  // Tracks whether there's a live, un-applied preview active so the unmount
  // cleanup below knows whether it needs to revert it.
  const previewPendingRef = useRef(false);

  useEffect(() => () => {
    if (previewPendingRef.current) clearPreview();
  }, []);

  if (palettes.length === 0) return null;

  const selectCombo = (i) => {
    if (applying) return;
    setSelectedIndex(i);
    setError(null);
    dispatchPreview(palettes[i]);
    previewPendingRef.current = true;
  };

  const handleApply = async () => {
    if (selectedIndex == null || applying) return;
    setApplying(true);
    setError(null);
    const res = await onApply(palettes[selectedIndex]);
    setApplying(false);
    if (res.success) {
      setAppliedIndex(selectedIndex);
      // The real cartEditorConfigUpdated event (fired by applyWidget's
      // syncAfterToFeatureStore) already clears the preview override once
      // the confirmed data lands — nothing left to revert.
      previewPendingRef.current = false;
    } else {
      setError(res.message || "Couldn't apply that combo.");
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
        {palettes.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => selectCombo(i)}
            disabled={applying}
            title={`Combo ${i + 1} — click to preview`}
            style={{
              position: 'relative',
              width: 46,
              height: 46,
              borderRadius: '50%',
              background: pieBackground(p),
              border: selectedIndex === i ? '3px solid #1a9de0' : '1px solid rgba(0,0,0,0.15)',
              cursor: applying ? 'default' : 'pointer',
              padding: 0,
              flexShrink: 0,
              boxShadow: selectedIndex === i ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
              transform: selectedIndex === i ? 'scale(1.06)' : 'scale(1)',
              transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
              opacity: applying && selectedIndex !== i ? 0.5 : 1,
            }}
          >
            {appliedIndex === i && (
              <span style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#1a9de0', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
                ✓
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>
        {selectedIndex == null ? 'Click a combo to preview it live' : appliedIndex === selectedIndex ? 'Applied' : 'Previewing in your cart editor — click Apply to make it final'}
      </div>

      {error && (
        <div style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', textAlign: 'center' }}>{error}</div>
      )}

      <button
        type="button"
        onClick={handleApply}
        disabled={selectedIndex == null || applying}
        style={{
          alignSelf: 'center',
          background: '#1a1a1a',
          color: '#fff',
          border: 'none',
          borderRadius: 999,
          padding: '7px 20px',
          fontSize: 12,
          fontWeight: 700,
          cursor: selectedIndex == null || applying ? 'default' : 'pointer',
          opacity: selectedIndex == null ? 0.4 : 1,
        }}
      >
        {applying ? 'Applying…' : 'Apply'}
      </button>
    </div>
  );
}
