import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Icon, Modal, Text, BlockStack } from '@shopify/polaris';
import { LockIcon } from '@shopify/polaris-icons';
import { usePlan } from '../PlanContext';
import { PLANS, getMinPlanForFeature } from '../../config/plans';

const GOLD = '#b8860b';

/**
 * Wraps a section of the editor UI and blurs/disables it when the current
 * plan doesn't have access to featureKey at all (locked state). Shows an
 * "Upgrade to unlock" CTA that opens a modal naming the required plan.
 */
export function LockedOverlay({ featureKey, children, minHeight = 160 }) {
  const { canAccessFeature } = usePlan();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (canAccessFeature(featureKey)) return children;

  const requiredPlanKey = getMinPlanForFeature(featureKey) || 'starter';
  const requiredPlan = PLANS[requiredPlanKey];

  return (
    <div style={{ position: 'relative', minHeight }}>
      <div
        style={{
          opacity: 0.45,
          filter: 'blur(2px)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
        aria-hidden="true"
      >
        {children}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.35)',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '18px 24px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            Requires the {requiredPlan?.label || 'Starter'} plan
          </Text>
          <div style={{ marginTop: 10 }}>
            <Button variant="primary" onClick={() => setOpen(true)}>Upgrade to unlock</Button>
          </div>
        </div>
      </div>

      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Upgrade to ${requiredPlan?.label || 'Starter'}`}
          primaryAction={{
            content: 'View plans',
            onAction: () => navigate('/app/subscribe'),
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setOpen(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                This feature is available on the {requiredPlan?.label || 'Starter'} plan and above.
                Upgrading also unlocks everything included at that tier.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </div>
  );
}

/**
 * Small lock-icon corner badge for use inside live preview surfaces (e.g.
 * CartPreview) where a locked/preview-only feature is still rendered at
 * full opacity so the merchant can see what they built — unlike
 * LockedOverlay, this never blurs or dims the wrapped content. Renders
 * nothing when the feature is fully enabled on the current plan.
 */
export function PreviewLockBadge({ featureKey }) {
  const { getFeatureState } = usePlan();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const state = getFeatureState(featureKey);

  if (state === 'enabled') return null;

  const requiredPlanKey = getMinPlanForFeature(featureKey) || 'starter';
  const requiredPlan = PLANS[requiredPlanKey];
  const label = state === 'preview' ? 'Preview only — upgrade to publish' : `Requires ${requiredPlan?.label || 'Starter'}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#ffffff',
          color: '#1f2937',
          border: '1px solid #f0dca0',
          borderRadius: 999,
          padding: '5px 11px 5px 8px',
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', width: 15, height: 15, color: GOLD }}>
          <Icon source={LockIcon} tone="inherit" />
        </span>
        {label}
      </button>

      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Upgrade to ${requiredPlan?.label || 'Starter'}`}
          primaryAction={{ content: 'View plans', onAction: () => navigate('/app/subscribe') }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setOpen(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                {state === 'preview'
                  ? `You can design and save this feature, but it won't appear on your storefront until you upgrade to ${requiredPlan?.label || 'Starter'}.`
                  : `This feature is available on the ${requiredPlan?.label || 'Starter'} plan and above. Upgrading also unlocks everything included at that tier.`}
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </>
  );
}

/**
 * For "design-type" features that are locked on the current plan but should
 * still be fully editable (merchant can design/save, just can't publish):
 * renders children completely normally (no blur, no disabled inputs) with a
 * PreviewLockBadge corner badge explaining the plan requirement. Use this
 * instead of LockedOverlay for features where the backend already enforces
 * "not published" independently of the editor UI (progress bar, custom CSS,
 * mobile swipe checkout, confetti, open countdown, AI cart upsell). Keep
 * using LockedOverlay for features with no meaningful "design without
 * publishing" state (Full Analytics, AI Analytics, Build a Combo).
 */
export function CustomizableLockedSection({ featureKey, children }) {
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <PreviewLockBadge featureKey={featureKey} />
    </div>
  );
}

/**
 * Blurs a single inline value (a KPI number, a stat, a table amount) and
 * shows a tiny lock icon next to it — headings/labels stay fully visible,
 * only the data itself is obscured. Pass a placeholder string as `children`
 * when locked (never the real fetched value — the backend already refuses
 * to send real numbers to a locked plan, so there's nothing real to blur;
 * CSS blur alone isn't a safe way to hide data since it's reversible via
 * devtools). Renders `children` unmodified when `locked` is false.
 */
export function LockedValue({ locked, children }) {
  if (!locked) return children;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ filter: 'blur(5px)', userSelect: 'none' }} aria-hidden="true">{children}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: '#ffffff', border: '1px solid #f0dca0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)', color: GOLD,
      }}>
        <span style={{ width: 13, height: 13, display: 'flex' }}>
          <Icon source={LockIcon} tone="inherit" />
        </span>
      </span>
    </span>
  );
}

/**
 * Block-level version of LockedValue for chart/graph areas — blurs the
 * placeholder content and centers a lock badge + short label on top.
 */
export function LockedChartArea({ locked, children, height = 200 }) {
  if (!locked) return children;
  return (
    <div style={{ position: 'relative', height }}>
      <div style={{ filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none', height: '100%' }} aria-hidden="true">
        {children}
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 44, height: 44, borderRadius: '50%',
          background: '#ffffff', border: '1px solid #f0dca0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', color: GOLD,
        }}>
          <span style={{ width: 22, height: 22, display: 'flex' }}><Icon source={LockIcon} tone="inherit" /></span>
        </span>
        <Text as="span" variant="bodyXs" fontWeight="semibold" tone="subdued">Upgrade to unlock</Text>
      </div>
    </div>
  );
}

/** "Preview Only" badge for features that can be edited/saved but not published on the current plan. */
export function PreviewBadge({ featureKey }) {
  const { canPreviewFeature } = usePlan();
  if (!canPreviewFeature(featureKey)) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: '#fffaf0', border: '1px solid #f0dca0', borderRadius: 999,
      padding: '4px 10px 4px 7px', fontSize: 11, fontWeight: 700,
      color: '#92700f', letterSpacing: '0.2px', whiteSpace: 'nowrap',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', width: 13, height: 13, color: GOLD }}>
        <Icon source={LockIcon} tone="inherit" />
      </span>
      Preview Only
    </span>
  );
}

/**
 * Card shown above a section's Save/Publish controls when the feature is
 * preview-only on the current plan — explains the storefront won't show it
 * until the merchant upgrades. Pair with disabling the section's own
 * publish/enable toggle via canPublishFeature.
 */
export function PreviewPublishBanner({ featureKey }) {
  const { canPreviewFeature } = usePlan();
  const navigate = useNavigate();
  if (!canPreviewFeature(featureKey)) return null;

  const requiredPlanKey = getMinPlanForFeature(featureKey) || 'starter';
  const requiredPlan = PLANS[requiredPlanKey];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      background: '#fffaf0', border: '1px solid #f0dca0', borderRadius: 12,
      padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 36, height: 36, borderRadius: '50%',
        background: '#ffffff', border: '1px solid #f0dca0', color: GOLD,
      }}>
        <span style={{ width: 18, height: 18, display: 'flex' }}>
          <Icon source={LockIcon} tone="inherit" />
        </span>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text as="p" variant="bodySm" fontWeight="semibold">Preview Only</Text>
        <Text as="p" variant="bodyXs" tone="subdued">
          You can design and save this feature, but it won&apos;t appear on your storefront until
          you upgrade to {requiredPlan?.label || 'Starter'}.
        </Text>
      </div>
      <Button onClick={() => navigate('/app/subscribe')}>Upgrade to publish</Button>
    </div>
  );
}
