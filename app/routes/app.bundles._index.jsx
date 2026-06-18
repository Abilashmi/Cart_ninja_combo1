/* eslint-disable react/prop-types */
import { useCallback, useMemo, useState } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { authenticate } from '../shopify.server';

const ONBOARDING_STEPS = [
  { id: 'template', title: 'Select layout', description: 'Choose the page structure for this bundle.', href: '/app/bundles/templates' },
  { id: 'products', title: 'Assign collections', description: 'Map each bundle step to the right products.', href: '/app/bundles/customize' },
  { id: 'content', title: 'Set offer content', description: 'Write titles, price messaging, and button text.', href: '/app/bundles/customize' },
  { id: 'style', title: 'Match storefront', description: 'Tune colors, spacing, media, and mobile behavior.', href: '/app/bundles/customize' },
  { id: 'publish', title: 'Publish page', description: 'Create or update the Shopify page for customers.', href: '/app/bundles/customize' },
];

const RECENT_ACTIVITY = [
  { message: 'Summer Combo was published', time: '2h ago', tone: 'success' },
  { message: 'Combo order recorded for $124.00', time: '4h ago', tone: 'success' },
  { message: 'COMBO20 discount configuration updated', time: '1 day ago', tone: 'info' },
  { message: '47 combo page sessions tracked today', time: '1 day ago', tone: 'info' },
  { message: 'Winter Sale saved as draft', time: '2 days ago', tone: 'attention' },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let templateCount = 0;
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
  } catch {
    // The template table may not exist on a fresh install.
  }

  return { templateCount, publishedCount, publishedPages };
};

function StatCard({ label, value, detail }) {
  return (
    <div className="cf-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StatusBadge({ children, tone = 'neutral' }) {
  return <span className={`cf-badge cf-badge-${tone}`}>{children}</span>;
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M8 5H5.5A2.5 2.5 0 0 0 3 7.5v7A2.5 2.5 0 0 0 5.5 17h7A2.5 2.5 0 0 0 15 14.5V12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M11 3h6v6M10 10l6.5-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AppBundlesIndex() {
  const { templateCount, publishedCount, publishedPages } = useLoaderData();
  const navigate = useNavigate();
  const [completedSteps, setCompletedSteps] = useState([]);

  const toggleStep = useCallback((id) => {
    setCompletedSteps((prev) =>
      prev.includes(id) ? prev.filter((stepId) => stepId !== id) : [...prev, id]
    );
  }, []);

  const progress = Math.round((completedSteps.length / ONBOARDING_STEPS.length) * 100);

  const metrics = useMemo(() => [
    { label: 'Active templates', value: templateCount, detail: 'Ready to edit or publish' },
    { label: 'Published pages', value: publishedCount, detail: 'Live Shopify pages' },
    { label: 'Conversions', value: '0', detail: 'Awaiting order data' },
    { label: 'Combo revenue', value: '$0.00', detail: 'Current month' },
  ], [templateCount, publishedCount]);

  return (
    <div className="cf-dashboard">
      <style>{`
        .cf-dashboard {
          --ink: #202223;
          --muted: #6d7175;
          --border: #dfe3e8;
          --surface: #ffffff;
          --subtle: #f7f8f8;
          --green: #006241;
          --green-soft: #e6f4ee;
          --blue: #2c6ecb;
          --yellow: #b7791f;
          color: var(--ink);
        }
        .cf-page-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 18px;
        }
        .cf-page-kicker {
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .cf-page-head h1 {
          color: var(--ink);
          font-size: 24px;
          line-height: 1.25;
          margin: 0;
          font-weight: 750;
        }
        .cf-page-head p {
          color: var(--muted);
          font-size: 13px;
          line-height: 1.55;
          max-width: 620px;
          margin: 6px 0 0;
        }
        .cf-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .cf-btn {
          min-height: 38px;
          padding: 9px 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 650;
        }
        .cf-btn:hover {
          background: var(--subtle);
        }
        .cf-btn-primary {
          background: var(--green);
          border-color: var(--green);
          color: #ffffff;
        }
        .cf-btn-primary:hover {
          background: #004c34;
        }
        .cf-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }
        .cf-stat-card,
        .cf-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        }
        .cf-stat-card {
          padding: 16px;
          min-height: 118px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .cf-stat-card span,
        .cf-stat-card small {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.35;
        }
        .cf-stat-card strong {
          color: var(--ink);
          font-size: 28px;
          line-height: 1;
          font-weight: 760;
          margin: 12px 0;
        }
        .cf-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 18px;
          align-items: start;
        }
        .cf-panel {
          padding: 18px;
        }
        .cf-panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 14px;
        }
        .cf-panel h2 {
          font-size: 15px;
          margin: 0;
          font-weight: 720;
        }
        .cf-panel p {
          margin: 3px 0 0;
          color: var(--muted);
          font-size: 12.5px;
          line-height: 1.5;
        }
        .cf-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
          border: 1px solid transparent;
        }
        .cf-badge-success {
          color: var(--green);
          background: var(--green-soft);
          border-color: #bdd6ca;
        }
        .cf-badge-info {
          color: var(--blue);
          background: #eef4ff;
          border-color: #c7d7f2;
        }
        .cf-badge-attention {
          color: var(--yellow);
          background: #fff5d6;
          border-color: #f1d083;
        }
        .cf-badge-neutral {
          color: var(--muted);
          background: #f1f2f2;
          border-color: var(--border);
        }
        .cf-table {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }
        .cf-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
          padding: 12px 14px;
          background: #fff;
          border-bottom: 1px solid var(--border);
        }
        .cf-row:last-child {
          border-bottom: 0;
        }
        .cf-row-title {
          font-size: 13px;
          font-weight: 650;
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cf-row-sub {
          color: var(--muted);
          font-size: 12px;
          margin-top: 2px;
        }
        .cf-icon-btn {
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 7px;
          border: 1px solid var(--border);
          color: var(--muted);
          background: #fff;
          text-decoration: none;
        }
        .cf-empty {
          padding: 38px 24px;
          text-align: center;
          border: 1px dashed #b8c6c0;
          border-radius: 8px;
          background: #fbfcfc;
        }
        .cf-empty-mark {
          width: 44px;
          height: 44px;
          margin: 0 auto 14px;
          border-radius: 8px;
          background: var(--green-soft);
          color: var(--green);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cf-empty h3 {
          margin: 0 0 6px;
          font-size: 15px;
        }
        .cf-empty p {
          max-width: 430px;
          margin: 0 auto 18px;
        }
        .cf-steps {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cf-step {
          width: 100%;
          border: 1px solid transparent;
          background: transparent;
          border-radius: 8px;
          padding: 10px;
          display: flex;
          gap: 10px;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .cf-step:hover {
          background: var(--subtle);
          border-color: var(--border);
        }
        .cf-step-current {
          background: var(--green-soft);
          border-color: #bdd6ca;
        }
        .cf-step strong {
          display: block;
          color: var(--ink);
          font-size: 13px;
          font-weight: 650;
          line-height: 1.35;
        }
        .cf-step small {
          display: block;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.4;
          margin-top: 2px;
        }
        .cf-check {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid #b5babf;
          padding: 0;
          background: transparent;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 1px;
        }
        .cf-check-done {
          border-color: var(--green);
          background: var(--green);
          color: #fff;
        }
        .cf-progress {
          height: 6px;
          background: #e4e7e7;
          border-radius: 999px;
          overflow: hidden;
          margin: 8px 0 14px;
        }
        .cf-progress span {
          display: block;
          height: 100%;
          width: var(--progress);
          background: var(--green);
          border-radius: inherit;
        }
        .cf-action-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cf-action-card {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
          padding: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: pointer;
          text-align: left;
          font: inherit;
        }
        .cf-action-card:hover {
          background: var(--subtle);
        }
        .cf-activity {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cf-activity-row {
          display: flex;
          gap: 10px;
        }
        .cf-activity-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--green);
          margin-top: 5px;
          flex-shrink: 0;
        }
        @media (max-width: 980px) {
          .cf-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .cf-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 620px) {
          .cf-page-head {
            flex-direction: column;
          }
          .cf-metrics {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <header className="cf-page-head">
        <div>
          <div className="cf-page-kicker">Combo Forge</div>
          <h1>Build modular combo pages for Shopify.</h1>
          <p>
            Create, manage, and publish collection-based bundle pages with a focused workflow for templates,
            offers, storefront styling, and performance tracking.
          </p>
        </div>
        <div className="cf-actions">
          <button className="cf-btn" onClick={() => navigate('/app/bundles/templates')}>Manage templates</button>
          <button className="cf-btn cf-btn-primary" onClick={() => navigate('/app/bundles/customize')}>Create combo</button>
        </div>
      </header>

      <section className="cf-metrics" aria-label="Combo Forge metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="cf-grid">
        <div className="cf-panel">
          <div className="cf-panel-header">
            <div>
              <h2>Published combo pages</h2>
              <p>Standalone Shopify pages connected to Combo Forge templates.</p>
            </div>
            <StatusBadge tone="success">Storefront ready</StatusBadge>
          </div>

          {publishedPages.length > 0 ? (
            <div className="cf-table">
              {publishedPages.map((page, index) => (
                <div key={`${page.page_handle}-${index}`} className="cf-row">
                  <div>
                    <div className="cf-row-title">{page.name}</div>
                    <div className="cf-row-sub">/pages/{page.page_handle}</div>
                  </div>
                  <div className="cf-actions">
                    <StatusBadge tone="success">Live</StatusBadge>
                    {page.page_url && (
                      <a className="cf-icon-btn" href={page.page_url} target="_blank" rel="noreferrer" title="View page">
                        <ExternalIcon />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="cf-empty">
              <div className="cf-empty-mark">
                <svg width="24" height="24" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </div>
              <h3>No published pages yet</h3>
              <p>Create a template, assign products, and publish it as a Shopify page when it is ready.</p>
              <button className="cf-btn cf-btn-primary" onClick={() => navigate('/app/bundles/customize')}>Create first combo</button>
            </div>
          )}
        </div>

        <aside className="cf-side">
          <div className="cf-panel">
            <div className="cf-panel-header">
              <div>
                <h2>Setup checklist</h2>
                <p>{completedSteps.length} of {ONBOARDING_STEPS.length} steps complete</p>
              </div>
              <StatusBadge>{progress}%</StatusBadge>
            </div>
            <div className="cf-progress" style={{ '--progress': `${progress}%` }}>
              <span />
            </div>
            <div className="cf-steps">
              {ONBOARDING_STEPS.map((step, index) => {
                const done = completedSteps.includes(step.id);
                const current = index === completedSteps.length && !done;
                return (
                  <button
                    key={step.id}
                    className={`cf-step${current ? ' cf-step-current' : ''}`}
                    onClick={() => navigate(step.href)}
                  >
                    <button
                      type="button"
                      className={`cf-check${done ? ' cf-check-done' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleStep(step.id);
                      }}
                      aria-label={done ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
                    >
                      {done && (
                        <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden="true">
                          <path d="M1 5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <span>
                      <strong>{step.title}</strong>
                      {current && <small>{step.description}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="cf-panel" style={{ marginTop: 14 }}>
            <div className="cf-panel-header">
              <div>
                <h2>Quick actions</h2>
                <p>Common module tasks.</p>
              </div>
            </div>
            <div className="cf-action-list">
              {[
                ['Open template library', '/app/bundles/templates'],
                ['Edit combo builder', '/app/bundles/customize'],
                ['Review analytics', '/app/bundles/analytics'],
                ['View plans', '/app/bundles/plan'],
              ].map(([label, href]) => (
                <button key={label} className="cf-action-card" onClick={() => navigate(href)}>
                  <span>{label}</span>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="cf-panel" style={{ marginTop: 14 }}>
            <div className="cf-panel-header">
              <div>
                <h2>Recent activity</h2>
                <p>Latest combo events.</p>
              </div>
            </div>
            <div className="cf-activity">
              {RECENT_ACTIVITY.map((activity, index) => (
                <div key={`${activity.message}-${index}`} className="cf-activity-row">
                  <span className="cf-activity-dot" />
                  <div>
                    <div className="cf-row-title">{activity.message}</div>
                    <div className="cf-row-sub">{activity.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
