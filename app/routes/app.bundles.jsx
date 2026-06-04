import { Outlet, useLocation, useNavigate, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { Icon } from '@shopify/polaris';
import {
  HomeIcon,
  PageIcon,
  PaintBrushFlatIcon,
  DiscountIcon,
  ChartVerticalIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

const NAV_TABS = [
  { id: 'dashboard',     label: 'Dashboard',       href: '/app/bundles',                  icon: HomeIcon          },
  { id: 'templates',     label: 'Templates',        href: '/app/bundles/templates',         icon: PageIcon          },
  { id: 'customize',     label: 'Customize',        href: '/app/bundles/customize',         icon: PaintBrushFlatIcon},
  { id: 'discountengine',label: 'Discount Engine',  href: '/app/bundles/discountengine',    icon: DiscountIcon      },
  { id: 'analytics',     label: 'Analytics',        href: '/app/bundles/analytics',         icon: ChartVerticalIcon },
];

// Inline bolt SVG — Polaris doesn't ship a lightning icon
function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export default function AppBundlesLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTabId = NAV_TABS.find(t =>
    t.href === '/app/bundles'
      ? location.pathname === '/app/bundles' || location.pathname === '/app/bundles/'
      : location.pathname.startsWith(t.href)
  )?.id || NAV_TABS[0].id;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7' }}>

      {/* Branded header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 12px rgba(102,126,234,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '12px',
            background: 'rgba(255,255,255,0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.3)',
          }}>
            <BoltIcon />
          </div>
          <div>
            <div style={{
              color: '#fff', fontWeight: '700', fontSize: '19px',
              letterSpacing: '-0.4px', lineHeight: '1.2',
            }}>
              Combo Forge
            </div>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '11px', letterSpacing: '0.5px' }}>
              BUNDLE BUILDER PLATFORM
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            padding: '4px 14px', borderRadius: '20px',
            background: 'rgba(255,255,255,0.18)',
            color: 'rgba(255,255,255,0.85)', fontSize: '12px', fontWeight: '500',
            border: '1px solid rgba(255,255,255,0.25)',
          }}>
            Pro Trial
          </div>
          <div style={{
            padding: '4px 14px', borderRadius: '20px',
            background: 'rgba(52,211,153,0.25)',
            color: '#6ee7b7', fontSize: '12px', fontWeight: '600',
            border: '1px solid rgba(52,211,153,0.3)',
            display: 'flex', alignItems: 'center', gap: '5px',
          }}>
            {/* CSS green dot instead of emoji */}
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#6ee7b7', display: 'inline-block',
            }} />
            Live
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '0 24px',
        display: 'flex',
        gap: '2px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {NAV_TABS.map(tab => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.href)}
              style={{
                padding: '13px 20px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '13.5px',
                fontWeight: active ? '600' : '400',
                color: active ? '#667eea' : '#6b7280',
                borderBottom: active ? '2.5px solid #667eea' : '2.5px solid transparent',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
              }}
            >
              <span style={{
                display: 'flex',
                color: active ? '#667eea' : '#9ca3af',
                transition: 'color 0.15s',
              }}>
                <Icon source={tab.icon} tone={active ? 'base' : 'subdued'} />
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Page content */}
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
