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
  { id: 'customize', label: 'Builder', href: '/app/bundles/customize' },
  { id: 'analytics', label: 'Analytics', href: '/app/bundles/analytics' },
];

function BundleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="11" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="7" y="12" width="6" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 7h2M10 10v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function AppBundlesLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTabId = NAV_TABS.find((tab) =>
    tab.href === '/app/bundles'
      ? location.pathname === '/app/bundles' || location.pathname === '/app/bundles/'
      : location.pathname.startsWith(tab.href)
  )?.id ?? NAV_TABS[0].id;

  return (
    <div className="cf-shell">
      <style>{`
        .cf-shell {
          --cf-bg: #f6f7f7;
          --cf-surface: #ffffff;
          --cf-ink: #202223;
          --cf-muted: #6d7175;
          --cf-border: #dfe3e8;
          --cf-green: #006241;
          --cf-green-soft: #e6f4ee;
          min-height: 100vh;
          background: var(--cf-bg);
          color: var(--cf-ink);
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        }
        .cf-topbar {
          position: sticky;
          top: 0;
          z-index: 200;
          height: 60px;
          padding: 0 28px;
          background: var(--cf-surface);
          border-bottom: 1px solid var(--cf-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }
        .cf-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 220px;
        }
        .cf-brand-mark {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid #bdd6ca;
          background: var(--cf-green-soft);
          color: var(--cf-green);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .cf-brand-title {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.15;
        }
        .cf-brand-subtitle {
          color: var(--cf-muted);
          font-size: 11px;
          margin-top: 2px;
        }
        .cf-nav {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px;
          border: 1px solid var(--cf-border);
          border-radius: 8px;
          background: #f7f8f8;
        }
        .cf-nav-btn {
          border: 0;
          background: transparent;
          cursor: pointer;
          padding: 8px 13px;
          border-radius: 6px;
          color: var(--cf-muted);
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
        }
        .cf-nav-btn:hover {
          color: var(--cf-ink);
          background: #eef1f1;
        }
        .cf-nav-btn.active {
          color: var(--cf-ink);
          background: var(--cf-surface);
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }
        .cf-status {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--cf-muted);
          font-size: 12px;
          font-weight: 600;
        }
        .cf-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          background: var(--cf-green-soft);
          border: 1px solid #bdd6ca;
          color: var(--cf-green);
        }
        .cf-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
        .cf-content {
          padding: 24px 28px 32px;
          max-width: 1480px;
          margin: 0 auto;
        }
        @media (max-width: 860px) {
          .cf-topbar {
            height: auto;
            padding: 14px 16px;
            align-items: flex-start;
            flex-direction: column;
          }
          .cf-nav {
            width: 100%;
            overflow-x: auto;
          }
          .cf-status {
            display: none;
          }
          .cf-content {
            padding: 16px;
          }
        }
      `}</style>

      <div className="cf-topbar">
        <div className="cf-brand">
          <div className="cf-brand-mark">
            <BundleMark />
          </div>
          <div>
            <div className="cf-brand-title">Combo Forge</div>
            <div className="cf-brand-subtitle">Bundle pages and offers</div>
          </div>
        </div>

        <nav className="cf-nav" aria-label="Combo Forge navigation">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`cf-nav-btn${tab.id === activeTabId ? ' active' : ''}`}
              onClick={() => navigate(tab.href)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="cf-status">
          <span className="cf-status-pill">
            <span className="cf-status-dot" />
            Storefront sync ready
          </span>
        </div>
      </div>

      <main className="cf-content">
        <Outlet />
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
