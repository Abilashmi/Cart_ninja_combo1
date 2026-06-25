import { Icon } from '@shopify/polaris';
import { getTheme } from './featureThemes';

export function FeatureHeaderBar({ feature, title, subtitle, right }) {
  const t = getTheme(feature);
  return (
    <div
      className="ft-headerbar"
      style={{ '--ft-accent': t.accent, '--ft-soft': t.soft, '--ft-from': t.from, '--ft-to': t.to }}
    >
      <style>{`
.ft-headerbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  background:#fff;border:1px solid #e5e7eb;border-left:4px solid var(--ft-accent);border-radius:12px;
  padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(16,24,40,.04)}
.ft-headerbar-left{display:flex;align-items:center;gap:13px;min-width:0}
.ft-headerbar-icon{width:42px;height:42px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--ft-from),var(--ft-to))}
.ft-headerbar-icon svg{width:22px;height:22px;fill:#fff}
.ft-headerbar-title{font-size:18px;font-weight:800;color:#1a1a1a;letter-spacing:-.3px;margin:0;line-height:1.2}
.ft-headerbar-sub{font-size:12.5px;color:#6b7280;margin-top:1px}
      `}</style>
      <div className="ft-headerbar-left">
        <div className="ft-headerbar-icon" aria-hidden="true"><Icon source={t.icon} /></div>
        <div>
          <h1 className="ft-headerbar-title">{title}</h1>
          {subtitle && <div className="ft-headerbar-sub">{subtitle}</div>}
        </div>
      </div>
      {right && <div className="ft-headerbar-right">{right}</div>}
    </div>
  );
}
