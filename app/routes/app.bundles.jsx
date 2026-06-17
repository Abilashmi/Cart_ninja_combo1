import { Outlet, useLocation, useNavigate, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

const NAV_TABS = [
  { id: 'dashboard', label: 'Dashboard', href: '/app/bundles' },
  { id: 'templates', label: 'Templates', href: '/app/bundles/templates' },
  { id: 'customize', label: 'Builder',   href: '/app/bundles/customize' },
  { id: 'analytics', label: 'Analytics', href: '/app/bundles/analytics' },
];

export default function AppBundlesLayout() {
  const location  = useLocation();
  const navigate  = useNavigate();

  const activeTabId = NAV_TABS.find(t =>
    t.href === '/app/bundles'
      ? location.pathname === '/app/bundles' || location.pathname === '/app/bundles/'
      : location.pathname.startsWith(t.href)
  )?.id ?? NAV_TABS[0].id;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F4F6FA',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <style>{`
        .cs-nav-btn {
          border: none; background: transparent; cursor: pointer;
          padding: 7px 15px; border-radius: 8px;
          font-size: 13.5px; font-weight: 500; color: #64748B;
          transition: background 0.13s, color 0.13s;
          outline: none; white-space: nowrap; font-family: inherit;
          line-height: 1;
        }
        .cs-nav-btn:hover  { background: rgba(91,71,251,0.07); color: #5B47FB; }
        .cs-nav-btn.active { background: rgba(91,71,251,0.11); color: #5B47FB; font-weight: 650; }
      `}</style>

      {/* ── Top command bar ─────────────────────────────────── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid rgba(15,15,35,0.08)',
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '58px',
        position: 'sticky',
        top: 0,
        zIndex: 200,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
      }}>
        {/* Left: logo + nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Logo mark */}
          <div style={{
            width: '34px', height: '34px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #5B47FB 0%, #8B5CF6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9.5 4 C7.5 3 5 2.3 3.5 3.2 L5 5 C7 4.8 8.8 5 9.5 5.6 Z" fill="white"/>
              <circle cx="13.5" cy="5.6" r="3.5" stroke="white" strokeWidth="1.8" fill="none"/>
              <line x1="10" y1="5.6" x2="17" y2="5.6" stroke="white" strokeWidth="1.3"/>
              <path d="M2 15 C2 9.5 22 9.5 22 15" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
              <line x1="2" y1="17.5" x2="15" y2="17.5" stroke="white" strokeWidth="2.3" strokeLinecap="round"/>
              <line x1="13.5" y1="16.5" x2="7" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="7" y1="21" x2="22" y2="21" stroke="white" strokeWidth="2.3" strokeLinecap="round"/>
            </svg>
          </div>

          {/* Brand name */}
          <div style={{ marginRight: '4px' }}>
            <div style={{ fontWeight: '700', fontSize: '15px', color: '#0F0F23', letterSpacing: '-0.3px', lineHeight: 1 }}>
              Combo Studio
            </div>
            <div style={{ fontSize: '10.5px', color: '#94A3B8', letterSpacing: '0.4px', marginTop: '2px', textTransform: 'uppercase' }}>
              Bundle Builder
            </div>
          </div>

          {/* Separator */}
          <div style={{ width: '1px', height: '22px', background: 'rgba(0,0,0,0.09)' }} />

          {/* Nav pills */}
          <nav style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            {NAV_TABS.map(tab => (
              <button
                key={tab.id}
                className={`cs-nav-btn${tab.id === activeTabId ? ' active' : ''}`}
                onClick={() => navigate(tab.href)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: status badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            padding: '4px 12px', borderRadius: '20px',
            background: 'rgba(91,71,251,0.08)', color: '#5B47FB',
            fontSize: '11.5px', fontWeight: '650',
            border: '1px solid rgba(91,71,251,0.18)',
          }}>
            Pro Trial
          </span>
          <span style={{
            padding: '4px 12px', borderRadius: '20px',
            background: 'rgba(16,185,129,0.08)', color: '#10B981',
            fontSize: '11.5px', fontWeight: '650',
            border: '1px solid rgba(16,185,129,0.20)',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#10B981', flexShrink: 0,
            }} />
            Live
          </span>
        </div>
      </div>

      {/* ── Page content ─────────────────────────────────────── */}
      <div style={{ padding: '28px' }}>
        <Outlet />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
