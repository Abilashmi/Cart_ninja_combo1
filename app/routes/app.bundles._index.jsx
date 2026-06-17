import { useState, useCallback } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { authenticate } from '../shopify.server';

const ONBOARDING_STEPS = [
  { id: 'template', title: 'Choose a Template',  description: 'Pick Guided Architect, Grid, Carousel, or Editorial Split', href: '/app/bundles/templates' },
  { id: 'products', title: 'Pick Collections',   description: 'Select which product collections display in your bundle',   href: '/app/bundles/customize' },
  { id: 'content',  title: 'Customize Content',  description: 'Add titles, subtitles, CTAs, and AI-generated copy',        href: '/app/bundles/customize' },
  { id: 'style',    title: 'Style Your Bundle',  description: 'Adjust colors, fonts, banners, and spacing',                href: '/app/bundles/customize' },
  { id: 'publish',  title: 'Save & Publish',     description: 'Publish as a Shopify page — no theme embedding needed',     href: '/app/bundles/customize' },
];

const RECENT_ACTIVITY = [
  { message: 'Template "Summer Bundle" published',    time: '2h ago',     color: '#10B981' },
  { message: 'New bundle order — $124.00',            time: '4h ago',     color: '#10B981' },
  { message: 'Discount code BUNDLE20 created',        time: '1 day ago',  color: '#5B47FB' },
  { message: '47 new bundle impressions today',       time: '1 day ago',  color: '#5B47FB' },
  { message: 'Template "Winter Sale" saved as draft', time: '2 days ago', color: '#F59E0B' },
];

const QUICK_ACTIONS = [
  { label: 'Template Library', sub: 'Browse saved templates',    href: '/app/bundles/templates', color: '#5B47FB', icon: '▤' },
  { label: 'Bundle Builder',   sub: 'Design your bundle layout', href: '/app/bundles/customize', color: '#8B5CF6', icon: '✦' },
  { label: 'Analytics',        sub: 'View performance data',     href: '/app/bundles/analytics', color: '#10B981', icon: '◈' },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let templateCount  = 0;
  let publishedCount = 0;
  let publishedPages = [];

  try {
    const { default: prisma } = await import('../db.server');

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM combo_templates WHERE shop_domain = ? AND is_active = 1`,
      shop
    ).catch(() => [{ count: 0 }]);
    templateCount = Number(countRows[0]?.count ?? 0);

    const pubRows = await prisma.$queryRawUnsafe(
      `SELECT name, page_handle, page_url, updated_at FROM combo_templates
       WHERE shop_domain = ? AND page_url IS NOT NULL AND page_url != ''
       ORDER BY updated_at DESC LIMIT 5`,
      shop
    ).catch(() => []);
    publishedPages = Array.isArray(pubRows) ? pubRows : [];
    publishedCount = publishedPages.length;
  } catch { /* table may not exist yet */ }

  return { templateCount, publishedCount, publishedPages };
};

// ─── Tiny reusable pieces ────────────────────────────────────────────────────

function Chip({ children, color = '#5B47FB' }) {
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '20px',
      background: `${color}12`, color,
      fontSize: '11.5px', fontWeight: '650',
      border: `1px solid ${color}22`,
    }}>
      {children}
    </span>
  );
}

function IconBox({ icon, color }) {
  return (
    <div style={{
      width: '34px', height: '34px', borderRadius: '9px', flexShrink: 0,
      background: `${color}12`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '15px', color,
    }}>
      {icon}
    </div>
  );
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function AppBundlesIndex() {
  const { templateCount, publishedCount, publishedPages } = useLoaderData();
  const navigate = useNavigate();

  const [completedSteps, setCompletedSteps] = useState([]);

  const toggleStep = useCallback((id) => {
    setCompletedSteps(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }, []);

  const progress = Math.round((completedSteps.length / ONBOARDING_STEPS.length) * 100);

  const metrics = [
    { label: 'Active Templates', value: templateCount,  sub: '+12% this week', up: true  },
    { label: 'Published Pages',  value: publishedCount, sub: 'total',          up: null  },
    { label: 'Conversions',      value: '0',            sub: '0% rate',        up: null  },
    { label: 'Bundle Revenue',   value: '$0.00',        sub: 'this month',     up: null  },
  ];

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', color: '#0F0F23' }}>
      <style>{`
        .dash-card       { background:#fff; border-radius:14px; border:1px solid rgba(15,15,35,0.07); box-shadow:0 1px 3px rgba(0,0,0,0.04); }
        .dash-metric     { background:#fff; border-radius:12px; border:1px solid rgba(15,15,35,0.07); padding:18px 20px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
        .step-row        { display:flex; align-items:flex-start; gap:12px; padding:10px 12px; border-radius:10px; cursor:pointer; transition:background 0.12s; border:1px solid transparent; }
        .step-row:hover  { background:rgba(91,71,251,0.04); }
        .step-row.active { background:rgba(91,71,251,0.06); border-color:rgba(91,71,251,0.16); }
        .step-check      { width:22px; height:22px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.15s; margin-top:1px; }
        .page-row        { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-radius:10px; border:1px solid rgba(15,15,35,0.07); background:#FAFBFC; }
        .qaction         { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; border:1px solid rgba(15,15,35,0.07); cursor:pointer; transition:border-color 0.15s, box-shadow 0.15s; }
        .qaction:hover   { border-color:#5B47FB; box-shadow:0 2px 10px rgba(91,71,251,0.10); }
        .activity-dot    { width:7px; height:7px; border-radius:50%; flex-shrink:0; margin-top:5px; }
        @media(max-width:900px){.dash-2col{grid-template-columns:1fr !important;}.dash-metrics{grid-template-columns:repeat(2,1fr) !important;}}
      `}</style>

      {/* ── Hero strip ─────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #5B47FB 0%, #7C3AED 55%, #A855F7 100%)',
        borderRadius: '16px',
        padding: '26px 32px',
        marginBottom: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        gap: '20px',
      }}>
        {/* Background blobs */}
        <div style={{ position:'absolute', top:'-30px', right:'140px', width:'160px', height:'160px', borderRadius:'50%', background:'rgba(255,255,255,0.06)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:'10px',  right:'60px',  width:'90px',  height:'90px',  borderRadius:'50%', background:'rgba(255,255,255,0.08)', pointerEvents:'none' }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#fff', letterSpacing: '-0.4px', marginBottom: '7px' }}>
            Welcome to Combo Studio
          </div>
          <div style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.75)', maxWidth: '450px', lineHeight: 1.55 }}>
            Build high-converting product bundles and publish them as standalone Shopify pages — no theme editing required.
          </div>
        </div>
        <button
          onClick={() => navigate('/app/bundles/customize')}
          style={{
            padding: '11px 22px', borderRadius: '10px',
            background: '#fff', color: '#5B47FB',
            border: 'none', fontWeight: '700', fontSize: '13.5px',
            cursor: 'pointer', flexShrink: 0,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            transition: 'box-shadow 0.15s',
            position: 'relative', zIndex: 1,
          }}
        >
          + Create Bundle
        </button>
      </div>

      {/* ── Metrics row ────────────────────────────────────────── */}
      <div className="dash-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '22px' }}>
        {metrics.map(m => (
          <div key={m.label} className="dash-metric">
            <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: '500', marginBottom: '9px' }}>{m.label}</div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#0F0F23', letterSpacing: '-0.6px', lineHeight: 1, marginBottom: '7px' }}>
              {m.value}
            </div>
            <div style={{ fontSize: '12px', fontWeight: '500', color: m.up === true ? '#10B981' : '#94A3B8' }}>
              {m.up === true && '▲ '}{m.up === false && '▼ '}{m.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── Main 2-column ──────────────────────────────────────── */}
      <div className="dash-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>

        {/* ── Left: Published pages ── */}
        <div className="dash-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0F0F23', letterSpacing: '-0.3px' }}>
                Published Bundle Pages
              </div>
              <div style={{ fontSize: '12.5px', color: '#64748B', marginTop: '3px' }}>
                Live on your storefront via Cart Ninja
              </div>
            </div>
            <Chip color="#10B981">Active via Cart Ninja</Chip>
          </div>

          {publishedPages.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {publishedPages.map((p, i) => (
                <div key={i} className="page-row">
                  <div>
                    <div style={{ fontSize: '13.5px', fontWeight: '600', color: '#0F0F23' }}>{p.name}</div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>/pages/{p.page_handle}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Chip color="#10B981">Live</Chip>
                    {p.page_url && (
                      <a
                        href={p.page_url}
                        target="_blank"
                        rel="noreferrer"
                        title="View page"
                        style={{
                          width: '30px', height: '30px', borderRadius: '8px',
                          background: 'rgba(16,185,129,0.08)',
                          border: '1px solid rgba(16,185,129,0.20)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          textDecoration: 'none', color: '#10B981',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                          <path d="M10 4C5.5 4 2 10 2 10s3.5 6 8 6 8-6 8-6-3.5-6-8-6z" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '36px 24px',
              borderRadius: '12px',
              background: 'rgba(91,71,251,0.03)',
              border: '1.5px dashed rgba(91,71,251,0.22)',
              textAlign: 'center',
              marginBottom: '20px',
            }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>📦</div>
              <div style={{ fontSize: '14px', fontWeight: '650', color: '#0F0F23', marginBottom: '6px' }}>
                No bundle pages yet
              </div>
              <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '18px', lineHeight: 1.6 }}>
                Create a template and click <strong>Save &amp; Publish</strong> to go live instantly.
              </div>
              <button
                onClick={() => navigate('/app/bundles/customize')}
                style={{
                  padding: '10px 22px', borderRadius: '9px',
                  background: '#5B47FB', color: '#fff',
                  border: 'none', fontWeight: '650', fontSize: '13px', cursor: 'pointer',
                }}
              >
                Create Your First Bundle
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => navigate('/app/bundles/templates')}
              style={{
                padding: '9px 18px', borderRadius: '8px',
                border: '1px solid rgba(15,15,35,0.12)',
                background: '#fff', color: '#0F0F23',
                fontWeight: '600', fontSize: '13px', cursor: 'pointer',
              }}
            >
              Manage Templates
            </button>
            <button
              onClick={() => navigate('/app/bundles/customize')}
              style={{
                padding: '9px 18px', borderRadius: '8px',
                background: '#5B47FB', color: '#fff',
                border: 'none', fontWeight: '650', fontSize: '13px', cursor: 'pointer',
              }}
            >
              + New Bundle
            </button>
          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Getting started */}
          <div className="dash-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ fontSize: '14px', fontWeight: '700', color: '#0F0F23' }}>Getting Started</div>
              <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: '500' }}>
                {completedSteps.length}/{ONBOARDING_STEPS.length}
              </div>
            </div>
            {/* Progress bar */}
            <div style={{ height: '4px', background: 'rgba(15,15,35,0.07)', borderRadius: '4px', marginBottom: '14px' }}>
              <div style={{
                height: '100%', borderRadius: '4px',
                background: 'linear-gradient(90deg, #5B47FB, #8B5CF6)',
                width: `${progress}%`, transition: 'width 0.3s ease',
              }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {ONBOARDING_STEPS.map((s, i) => {
                const done    = completedSteps.includes(s.id);
                const current = i === completedSteps.length && !done;
                return (
                  <div
                    key={s.id}
                    className={`step-row${current ? ' active' : ''}`}
                    onClick={() => navigate(s.href)}
                  >
                    {/* Circle toggle */}
                    <div
                      className="step-check"
                      onClick={e => { e.stopPropagation(); toggleStep(s.id); }}
                      style={{
                        background: done ? '#10B981' : 'transparent',
                        border: done ? 'none' : '2px solid #D1D5DB',
                      }}
                    >
                      {done && (
                        <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                          <path d="M1 4l3 3 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: done ? '400' : '550',
                        color: done ? '#94A3B8' : '#0F0F23',
                        textDecoration: done ? 'line-through' : 'none',
                      }}>
                        {s.title}
                      </div>
                      {current && (
                        <div style={{ fontSize: '11.5px', color: '#64748B', marginTop: '2px', lineHeight: 1.4 }}>
                          {s.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div className="dash-card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#0F0F23', marginBottom: '12px' }}>Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {QUICK_ACTIONS.map(item => (
                <div key={item.label} className="qaction" onClick={() => navigate(item.href)}>
                  <IconBox icon={item.icon} color={item.color} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#0F0F23' }}>{item.label}</div>
                    <div style={{ fontSize: '11.5px', color: '#94A3B8', marginTop: '1px' }}>{item.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div className="dash-card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#0F0F23', marginBottom: '14px' }}>Recent Activity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {RECENT_ACTIVITY.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px' }}>
                  <div className="activity-dot" style={{ background: a.color }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12.5px', color: '#0F0F23', lineHeight: 1.4 }}>{a.message}</div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Plan upsell */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(91,71,251,0.06) 0%, rgba(139,92,246,0.06) 100%)',
            border: '1px solid rgba(91,71,251,0.18)',
            borderRadius: '14px',
            padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: '700', color: '#0F0F23' }}>Upgrade to Pro</div>
              <Chip color="#5B47FB">Free Trial</Chip>
            </div>
            <div style={{ fontSize: '12.5px', color: '#64748B', marginBottom: '14px', lineHeight: 1.55 }}>
              Unlimited templates, AI content generation, and advanced analytics.
            </div>
            <button
              onClick={() => navigate('/app/bundles/plan')}
              style={{
                width: '100%', padding: '9px', borderRadius: '8px',
                background: '#5B47FB', color: '#fff',
                border: 'none', fontWeight: '650', fontSize: '13px', cursor: 'pointer',
              }}
            >
              View Plans &amp; Upgrade
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
