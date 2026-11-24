/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * Home for a store that picked features in the guided setup: built from what
 * it picked and how its customers pay.
 *   1. Setup: each picked feature with its steps done, its separate statuses
 *      (tour, configured, active) and Customize (the tour points at it); the
 *      one being set up is open with its steps.
 *   2. BRIX impact: revenue and average order vs the previous period, orders
 *      this month against the plan's limit.
 *   3. Your feature numbers: a few real numbers per picked feature.
 *   4. Tips (for prepaid / COD stores) and Your plan.
 *   5. Tutorials for the picked features, basics first.
 * Numbers come from services/guide-dashboard.server.js (Home's loader); what
 * BRIX can't read shows as "No data yet", never as a made-up zero.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '@shopify/polaris';
import { CheckIcon, PlayIcon, LightbulbIcon, ChevronDownIcon, ChevronUpIcon } from '@shopify/polaris-icons';
import { useT } from '../../i18n/admin';
import { useGuide } from './GuideProvider';
import { GUIDE_MODULE_META, homeCustomizeTarget } from './guide-meta';
import { GuideStatusBadges } from './GuidePanel';
import { StepVideoModal } from '../home/TutorialsSection';
import { formatAmount } from '../../utils/currency.shared';
import { guideSteps, guideSummary, moduleStatuses, nextUnfinishedModule } from '../../utils/guide.shared.js';
import { compareWithPrevious, pickTips, pickTutorials, tipsHeading } from '../../utils/guide-dashboard.shared.js';

const NUMBER_LABEL = {
  cod_share: 'admin.gdash.n_cod_share',
  cod_rto: 'admin.gdash.n_cod_rto',
  cod_collect: 'admin.gdash.n_cod_collect',
  cart_upsell: 'admin.gdash.n_cart_upsell',
  cart_checkout: 'admin.gdash.n_cart_checkout',
  fbt_orders: 'admin.gdash.n_fbt_orders',
  combo_orders: 'admin.gdash.n_combo_orders',
  packs_active: 'admin.gdash.n_packs_active',
  coupon_clicks: 'admin.gdash.n_coupon_clicks',
  discounts_active: 'admin.gdash.n_discounts_active',
  ai_credits: 'admin.gdash.n_ai_credits',
};
const LEVEL_LABEL = { beginner: 'admin.gdash.level_beginner', intermediate: 'admin.gdash.level_intermediate', advanced: 'admin.gdash.level_advanced' };

/** "▲ 12% vs previous 30 days", or null when there's nothing to compare. */
function Change({ now, prev, days, lowerBetter = false }) {
  const t = useT();
  const c = compareWithPrevious(now, prev);
  if (!c) return null;
  const good = c.direction === 'same' ? null : (c.direction === 'up') !== lowerBetter;
  const arrow = c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '';
  return (
    <span className={`brx-gd-change${good === true ? ' is-good' : good === false ? ' is-bad' : ''}`}>
      {arrow} {t('admin.gdash.vs_prev', { pct: c.pct, days })}
    </span>
  );
}

/** The change against the previous period, else `fallback` (nothing to compare). */
function changeOr(now, prev, days, fallback) {
  return compareWithPrevious(now, prev) ? <Change now={now} prev={prev} days={days} /> : fallback;
}

/* ── 1. the picked features' setup ─────────────────────────── */
function SetupList() {
  const t = useT();
  const g = useGuide();
  const { state } = g;
  const summary = guideSummary(state);
  const first = nextUnfinishedModule(state);
  const [openId, setOpenId] = useState(null);
  const shown = openId || state.current?.module || first || state.modules[0];
  return (
    <div className="brx-gd-card brx-gd-setup" data-guide-dash="setup">
      {state.modules.map((id) => {
        const meta = GUIDE_MODULE_META[id];
        const name = t(meta.name);
        const pm = summary.perModule[id];
        const s = moduleStatuses(state, g.modulesStatus, id);
        const steps = guideSteps(id);
        const open = shown === id;
        const done = state.progress?.[id]?.done || [];
        return (
          <div key={id} className={`brx-gd-row${open ? ' is-open' : ''}`} data-tour={`home-mod-${id}`}>
            <div className="brx-gd-row-head">
              <span className="brx-gd-ic" aria-hidden="true"><Icon source={meta.icon} /></span>
              <button type="button" className="brx-gd-row-title" onClick={() => setOpenId(open ? '' : id)} aria-expanded={open}>
                <span className="brx-gd-row-name">
                  {t('admin.gdash.customise', { name })}
                  {id === first && s.tour !== 'completed' && <span className="brx-gd-first">{t('admin.gdash.set_up_first')}</span>}
                </span>
                <span className="brx-gd-row-bar">
                  <span className="brx-gs-bar"><i style={{ width: `${pm.total ? Math.round((pm.done / pm.total) * 100) : 0}%` }} /></span>
                  <span className="brx-gd-row-count">{pm.done}/{pm.total}</span>
                </span>
                <GuideStatusBadges tour={s.tour} configured={s.configured} active={s.active} stepsDone={pm.done} stepsTotal={pm.total} />
              </button>
              <button type="button" className="brx-gs-btn" data-tour={homeCustomizeTarget(id)} onClick={() => g.openModule(id)}>{t('admin.guide.customize')}</button>
              <button type="button" className="brx-gs-iconbtn" onClick={() => setOpenId(open ? '' : id)} aria-label={name} aria-expanded={open}>
                <Icon source={open ? ChevronUpIcon : ChevronDownIcon} />
              </button>
            </div>
            {open && (
              <ol className="brx-gs-steps brx-gd-steps">
                {steps.map((step, i) => {
                  const isDone = done.includes(step.id) || s.tour === 'completed';
                  const current = state.current?.module === id && state.current.step === i;
                  return (
                    <li key={step.id}>
                      <button type="button" className={`brx-gs-step${current ? ' is-current' : ''}${isDone ? ' is-done' : ''}`} onClick={() => g.goToStep(id, i)} data-guide-dash-step={`${id}:${step.id}`}>
                        <span className="brx-gs-num">{isDone ? <Icon source={CheckIcon} /> : i + 1}</span>
                        <span className="brx-gs-step-t">{step.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── 2. BRIX impact ────────────────────────────────────────── */
function Impact({ data, range, money }) {
  const t = useT();
  const days = data?.period?.days || range?.days || 30;
  const rev = data?.impact?.revenue || {};
  const aov = data?.impact?.aov || {};
  const plan = data?.plan;
  const used = plan?.used;
  const cap = plan?.cap;
  return (
    <div className="brx-gd-card" data-guide-dash="impact">
      <div className="brx-gd-head">
        <h2>{t('admin.gdash.impact')}</h2>
        <p>{t('admin.gdash.impact_sub', { period: range?.label || '', days })}</p>
      </div>
      <div className="brx-gd-tiles brx-gd-tiles--3">
        <div className="brx-gd-tile" data-guide-dash-tile="revenue">
          <span className="brx-gd-tile-k">{t('admin.gdash.revenue')}</span>
          <b>{rev.now != null ? money(rev.now) : '—'}</b>
          <small>{rev.now ? changeOr(rev.now, rev.prev, days, t('admin.gdash.in_period')) : t('admin.gdash.no_sales')}</small>
        </div>
        <div className="brx-gd-tile" data-guide-dash-tile="aov">
          <span className="brx-gd-tile-k">{t('admin.gdash.aov')}</span>
          <b>{aov.now != null ? money(aov.now) : '—'}</b>
          <small>{aov.now ? changeOr(aov.now, aov.prev, days, t('admin.gdash.in_period')) : t('admin.gdash.no_orders')}</small>
        </div>
        <div className="brx-gd-tile" data-guide-dash-tile="orders">
          <span className="brx-gd-tile-k">{t('admin.gdash.orders_month')}</span>
          <b>{used == null ? '—' : cap ? `${used} / ${cap}` : String(used)}</b>
          {cap ? <span className="brx-gs-bar"><i style={{ width: `${Math.min(100, Math.round(((used || 0) / cap) * 100))}%` }} /></span> : null}
          <small>{plan ? (cap ? t('admin.gdash.plan_limit', { plan: plan.label }) : t('admin.gdash.unlimited', { plan: plan.label })) : t('admin.gdash.no_data')}</small>
        </div>
      </div>
    </div>
  );
}

/* ── 3. numbers per picked feature ─────────────────────────── */
function Numbers({ data, money }) {
  const t = useT();
  const list = data?.numbers || [];
  if (!list.length) return null;
  const days = data?.period?.days || 30;
  const show = (n) => {
    if (n.value == null) return '—';
    if (n.kind === 'money') return money(n.value);
    if (n.kind === 'percent') return `${Math.round(n.value * 10) / 10}%`;
    return n.capped ? `${n.value}+` : String(Math.round(n.value));
  };
  const note = (n) => {
    if (n.value == null) return t('admin.gdash.no_data');
    if (n.note === 'vs_prev') return changeOr(n.value, n.prev, days, t('admin.gdash.in_period'));
    if (n.note === 'lower_better') return t('admin.gdash.lower_better');
    if (n.note === 'right_now') return t('admin.gdash.right_now');
    if (n.note === 'this_month') return n.limit != null ? t('admin.gdash.of_limit', { limit: n.limit }) : t('admin.gdash.this_month');
    return t('admin.gdash.in_period');
  };
  return (
    <div className="brx-gd-card" data-guide-dash="numbers">
      <div className="brx-gd-head"><h2>{t('admin.gdash.numbers')}</h2></div>
      <div className="brx-gd-tiles">
        {list.map((n) => (
          <div key={n.id} className="brx-gd-tile" data-guide-dash-tile={n.id}>
            <span className="brx-gd-tile-k"><span className="brx-gd-ic brx-gd-ic--sm" aria-hidden="true"><Icon source={GUIDE_MODULE_META[n.module].icon} /></span>{t(GUIDE_MODULE_META[n.module].name)}</span>
            <b>{show(n)}</b>
            <span className="brx-gd-tile-l">{t(NUMBER_LABEL[n.id])}</span>
            <small>{note(n)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 4. tips + plan ────────────────────────────────────────── */
function Tips({ payment, modules }) {
  const t = useT();
  const tips = pickTips(payment, modules);
  return (
    <div className="brx-gd-card" data-guide-dash="tips">
      <div className="brx-gd-head brx-gd-head--icon"><span className="brx-gd-ic brx-gd-ic--tip" aria-hidden="true"><Icon source={LightbulbIcon} /></span><h2>{t(tipsHeading(payment))}</h2></div>
      {tips.map((tip) => (
        <div key={tip.id} className="brx-gd-tip" data-guide-tip-id={tip.id}>
          <b>{t(tip.title)}</b>
          <span>{t(tip.body)}</span>
        </div>
      ))}
    </div>
  );
}

function Plan({ data, money }) {
  const t = useT();
  const navigate = useNavigate();
  const plan = data?.plan;
  if (!plan) return null;
  return (
    <div className="brx-gd-card" data-guide-dash="plan">
      <div className="brx-gd-head"><h2>{t('admin.gdash.your_plan')}</h2></div>
      <div className="brx-gd-plan"><b>{plan.label}</b> <span>{money(plan.price)} {t('admin.gdash.per_month')}</span></div>
      {plan.used != null && (
        <>
          <small className="brx-gd-muted">{plan.cap ? t('admin.gdash.orders_used', { used: plan.used, cap: plan.cap }) : t('admin.gdash.orders_used_unlimited', { used: plan.used })}</small>
          {plan.cap ? <span className="brx-gs-bar"><i style={{ width: `${Math.min(100, Math.round((plan.used / plan.cap) * 100))}%` }} /></span> : null}
        </>
      )}
      <div><button type="button" className="brx-gs-btn" onClick={() => navigate('/app/subscribe')}>{t('admin.gdash.see_plans')}</button></div>
    </div>
  );
}

/* ── 5. tutorials for the picked features ──────────────────── */
function Tutorials({ modules }) {
  const t = useT();
  const [video, setVideo] = useState(null);
  const list = pickTutorials(modules);
  if (!list.length) return null;
  return (
    <div className="brx-gd-card" data-guide-dash="tutorials">
      <div className="brx-gd-head"><h2>{t('admin.gdash.tutorials')}</h2><p>{t('admin.gdash.tutorials_sub')}</p></div>
      <div className="brx-gd-tuts">
        {list.map((tut) => (
          <div key={tut.id} className="brx-gd-tut" data-guide-tut={tut.id}>
            <div className="brx-gd-thumb">
              <span className="brx-gs-play" aria-hidden="true"><Icon source={PlayIcon} /></span>
              {tut.dur && <span className="brx-gd-dur">{tut.dur}</span>}
            </div>
            <b>{t(tut.title)}</b>
            <span className="brx-gd-muted">{t(tut.desc)}</span>
            <div className="brx-gd-tut-foot">
              <span className="brx-gs-badges">
                <span className="brx-gs-badge">{t(GUIDE_MODULE_META[tut.module].name)}</span>
                <span className={`brx-gs-badge${tut.level === 'beginner' ? ' is-ok' : ' is-info'}`}>{t(LEVEL_LABEL[tut.level])}</span>
              </span>
              {tut.url
                ? <button type="button" className="brx-gs-btn" onClick={() => setVideo({ title: tut.title, desc: tut.desc, videoUrl: tut.url })}>{t('admin.guide.watch')}</button>
                : <span className="brx-gd-muted" data-guide-tut-soon>{t('admin.gdash.coming_soon')}</span>}
            </div>
          </div>
        ))}
      </div>
      {video && <StepVideoModal step={video} onClose={() => setVideo(null)} />}
    </div>
  );
}

export default function GuideDashboard({ data, range, currencySymbol, currencyCode }) {
  const g = useGuide();
  const money = (v) => formatAmount(v || 0, currencySymbol, currencyCode);
  return (
    <div className="brx-gd" data-guide-dashboard>
      <SetupList />
      <Impact data={data} range={range} money={money} />
      <Numbers data={data} money={money} />
      <div className="brx-gd-split">
        <Tips payment={g.state.payment} modules={g.state.modules} />
        <Plan data={data} money={money} />
      </div>
      <Tutorials modules={g.state.modules} />
    </div>
  );
}
