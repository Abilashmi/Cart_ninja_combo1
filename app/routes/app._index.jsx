import { useState, useEffect, useRef } from 'react';
import { useLoaderData, useRouteError, useNavigate, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Text, Icon } from '@shopify/polaris';
import {
  CartIcon, DiscountCodeIcon, RewardIcon,
  CashDollarIcon, ChartCohortIcon, CollectionIcon,
  ArrowRightIcon, StarIcon, SettingsIcon,
} from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";
import { getAnalyticsData } from "../services/analytics.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import { getAgencyStoreStatus } from "../utils/agency-dashboard.server";
import { useCurrency } from "../components/CurrencyContext";
import { usePlan } from "../components/PlanContext";
import { PLANS } from "../config/plans";
import { cartDrawerEmbedEditorUrl } from '../config/theme-extension';
import { useAppEmbedStatus } from '../components/shared/useAppEmbedStatus';
import { formatAmount } from '../utils/currency.shared';
import VideoTutorialCard, { VIDEO_CARD_STYLES } from '../components/VideoTutorialCard';
import { useAdminLocale, useT } from '../i18n/admin';

/* ─── Loader: keep real Shopify auth + today's analytics ─── */

const DEFAULT_ANALYTICS = {
  checkout_click: 0,
  coupon_click: 0,
  upsell_click: 0,
  upsell_revenue_generated: 0,
  cartdrawer_total_revenue: 0,
  cartdrawer_total_coupon_applied: 0,
  avg_order_value: 0,
  conversion_rate: 0,
};

function toCount(v) { const n = parseInt(v, 10); return isFinite(n) ? Math.max(0, n) : 0; }
function toAmount(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? Math.max(0, n) : 0;
}
function normalizeAnalytics(p = {}) {
  return {
    checkout_click: toCount(p.checkout_click),
    coupon_click: toCount(p.coupon_click),
    upsell_click: toCount(p.upsell_click),
    upsell_revenue_generated: toAmount(p.upsell_revenue_generated),
    cartdrawer_total_revenue: toAmount(p.cartdrawer_total_revenue),
    cartdrawer_total_coupon_applied: toCount(p.cartdrawer_total_coupon_applied),
    avg_order_value: toAmount(p.avg_order_value),
    conversion_rate: toAmount(p.conversion_rate),
  };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // A merchant landing here right after installing BRIX (or reopening it
  // with an agency authorization/activation still pending) should be sent
  // straight into the agency-connect screen instead of ordinary Home.
  // Fails open to Home for every other stage (COMPLETE, NOT_INSTALLED,
  // ERROR, no relationship at all) — the vast majority of merchants have
  // no agency relationship and must never be gated here.
  const agencyStatus = await getAgencyStoreStatus(shop);
  const needsAgencyConnect = ["AUTHORIZATION_REQUIRED", "ACTIVATION_REQUIRED"].includes(agencyStatus.stage);
  // eslint-disable-next-line no-undef
  console.log(`[BRIX AGENCY DEBUG] shop=${shop} stage=${agencyStatus.stage} redirect=${needsAgencyConnect ? "/app/agency-connect" : "none"}`);
  if (needsAgencyConnect) {
    return redirect("/app/agency-connect");
  }

  try {
    fetch(`${BASE_PHP_URL}/install_shop.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop }),
    }).catch(console.error);
  } catch {}

  let initialAnalytics = { ...DEFAULT_ANALYTICS };
  try {
    const today = new Date().toISOString().split('T')[0];
    // Calls the analytics loader logic directly in-process instead of
    // fetching this app's own /api/analytics route over HTTP — a self-fetch
    // would round-trip out through the public tunnel URL and back on every
    // home-page load.
    const data = await getAnalyticsData(shop, today, today);
    if (data?.success) initialAnalytics = normalizeAnalytics(data.data);
  } catch {}

  return { shop, initialAnalytics };
};

/* ─── Static content ─── */

const PLAN_BADGE_STYLE = {
  free:    { background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151' },
  starter: { background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' },
  growth:  { background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#047857' },
  pro:    { background: '#e8f9fe', border: '1px solid #93c5fd', color: '#1a9de0' },
  lite:      { background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1' },
  scale:     { background: '#eef2ff', border: '1px solid #a5b4fc', color: '#3730a3' },
  enterprise: { background: '#111827', border: '1px solid #111827', color: '#ffffff' },
};

const COURSE_SECTIONS = [
  {
    id: 1, title: 'Getting Started',
    lessons: [
      { n: 1, title: 'Welcome to Brix',             desc: 'Get oriented and understand what Brix can do for your store.',         dur: '3:12', color: '#667eea' },
      { n: 2, title: 'Setting Up Your Cart Drawer', desc: 'Activate the embed, choose a layout, and go live in minutes.',         dur: '5:40', color: '#10b981' },
    ],
  },
  {
    id: 2, title: 'Boosting Revenue',
    lessons: [
      { n: 3, title: 'Boosting AOV with FBT',        desc: 'Add frequently bought together widgets to your product pages.',       dur: '4:55', color: '#f59e0b' },
      { n: 4, title: 'Coupon Banners That Convert',  desc: 'Create high-converting coupon banners with targeting rules.',         dur: '4:20', color: '#ec4899' },
      { n: 5, title: 'Build a Combo Bundle',         desc: 'Design multi-product bundles with custom layouts and templates.',     dur: '6:10', color: '#2ecc71' },
    ],
  },
  {
    id: 3, title: 'AI & Analytics',
    lessons: [
      { n: 6, title: 'Using Brix AI to Write Content',   desc: 'Let Brix AI generate titles, descriptions, and upsell copy for you.', dur: '3:48', color: '#06b6d4' },
      { n: 7, title: 'Reading Your Analytics Dashboard', desc: 'Understand funnels, KPIs, and what to optimise first.',               dur: '5:05', color: '#ef4444' },
    ],
  },
];
const ALL_LESSONS = COURSE_SECTIONS.flatMap(s => s.lessons);

// TODO: paste the embed URL (YouTube/Vimeo/CDN) here once the intro video is published
const WELCOME_VIDEO_URL = 'https://www.youtube.com/embed/Ap1wvi6FN9I';

// Each step's real tutorial video (previously all six reused WELCOME_VIDEO_URL
// as a placeholder).
const ENABLE_APP_EMBED_VIDEO_URL = 'https://www.youtube.com/embed/xIogTy1RM-0';
const CART_DRAWER_VIDEO_URL = 'https://www.youtube.com/embed/QmiqbSUgDrw';
const FBT_VIDEO_URL = 'https://www.youtube.com/embed/o70b1FMW4v4';
const COUPON_BANNER_VIDEO_URL = 'https://www.youtube.com/embed/l6_m_kGPx9M';
const COMBO_BUILDER_VIDEO_URL = 'https://www.youtube.com/embed/f7RGtknTVO4';
const ANALYTICS_VIDEO_URL = 'https://www.youtube.com/embed/FfVLZMmE1PM';

const STEPS = [
  { id: 1, title: 'admin.home.step1_title',             desc: 'admin.home.step1_desc', to: '/app/brix-ai',       color: '#1a9de0', icon: StarIcon,        minPlan: 'starter', dur: '01:30', category: 'admin.home.step1_category',         difficulty: 'Beginner',     videoUrl: ENABLE_APP_EMBED_VIDEO_URL, thumbnail: '/brixai.png' },
  { id: 2, title: 'admin.home.step2_title',  desc: 'admin.home.step2_desc',      to: '/app/cartdrawer',    color: '#10b981', icon: CartIcon,         minPlan: 'starter', dur: '02:10', category: 'admin.home.step2_category',      difficulty: 'Beginner',     videoUrl: CART_DRAWER_VIDEO_URL, thumbnail: '/carteditor.png' },
  { id: 3, title: 'admin.home.step3_title',     desc: 'admin.home.step3_desc',        to: '/app/fbt',           color: '#f59e0b', icon: RewardIcon,       minPlan: 'starter', dur: '01:55', category: 'admin.home.step3_category',      difficulty: 'Intermediate', videoUrl: FBT_VIDEO_URL, thumbnail: '/Fbt.png' },
  { id: 4, title: 'admin.home.step4_title', desc: 'admin.home.step4_desc',           to: '/app/productwidget', color: '#ec4899', icon: DiscountCodeIcon, minPlan: 'starter', dur: '01:40', category: 'admin.home.step4_category',    difficulty: 'Beginner',     videoUrl: COUPON_BANNER_VIDEO_URL, thumbnail: '/coupon_banner.png' },
  { id: 5, title: 'admin.home.step5_title', desc: 'admin.home.step5_desc', to: '/app/bundles', color: '#2ecc71', icon: CollectionIcon,   minPlan: 'starter', dur: '03:45', category: 'admin.home.step5_category',    difficulty: 'Beginner',     videoUrl: COMBO_BUILDER_VIDEO_URL, thumbnail: '/bundle.png' },
  { id: 6, title: 'admin.home.step6_title',  desc: 'admin.home.step6_desc',                   to: '/app/analytics',    color: '#06b6d4', icon: ChartCohortIcon,  minPlan: 'starter', dur: '02:05', category: 'admin.home.step6_category',        difficulty: 'Intermediate', videoUrl: ANALYTICS_VIDEO_URL, thumbnail: '/Analytics.png' },
];

const MINI_TUTORIALS = [
  { id: 1, title: 'Add a coupon banner',       dur: '1:20', color: '#ec4899', tag: 'Coupons' },
  { id: 2, title: 'Set up FBT in 2 mins',      dur: '2:00', color: '#f59e0b', tag: 'FBT'     },
  { id: 3, title: 'Customise drawer colours',  dur: '0:55', color: '#10b981', tag: 'Design'  },
  { id: 4, title: 'Create your first bundle',  dur: '1:45', color: '#2ecc71', tag: 'Bundles' },
  { id: 5, title: 'Write with Brix AI',        dur: '1:10', color: '#06b6d4', tag: 'AI'      },
];

const TIPS = [
  { id: 1, title: 'admin.home.tip1_title',        body: 'admin.home.tip1_body', color: '#ef4444' },
  { id: 2, title: 'admin.home.tip2_title',      body: 'admin.home.tip2_body',     color: '#f59e0b' },
  { id: 3, title: 'admin.home.tip3_title',     body: 'admin.home.tip3_body',   color: '#2ecc71' },
  { id: 4, title: 'admin.home.tip4_title',       body: 'admin.home.tip4_body', color: '#10b981' },
  { id: 5, title: 'admin.home.tip5_title', body: 'admin.home.tip5_body', color: '#1a9de0' },
  { id: 6, title: 'admin.home.tip6_title',    body: 'admin.home.tip6_body',   color: '#06b6d4' },
];

const STORAGE_KEY = 'cn_first_visit_date';
const LESSON_PROGRESS_KEY = 'cn_lesson_watched_times';
const VIDEO_PROGRESS_KEY = 'cn_video_progress_seconds';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/* "MM:SS" → total seconds */
function parseDurationToSeconds(dur) {
  if (!dur) return 0;
  const parts = String(dur).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/* ─── Lesson-lock helpers ─── */

function isUnlocked(n, watchedTimes) {
  if (n === 1) return true;
  const prevTs = watchedTimes[n - 1];
  if (!prevTs) return false;
  return Date.now() - prevTs >= TWENTY_FOUR_HOURS;
}

function unlockAt(n, watchedTimes) {
  if (n === 1) return null;
  const prevTs = watchedTimes[n - 1];
  if (!prevTs) return null;
  return prevTs + TWENTY_FOUR_HOURS;
}

function fmtCountdown(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Unlocking soon…';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `Unlocks in ${h}h ${m}m`;
}

/* live countdown badge — re-renders every minute */
function CountdownBadge({ unlockTimestamp }) {
  const [label, setLabel] = useState(() => fmtCountdown(unlockTimestamp));
  useEffect(() => {
    const id = setInterval(() => setLabel(fmtCountdown(unlockTimestamp)), 60_000);
    return () => clearInterval(id);
  }, [unlockTimestamp]);
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 999, padding: '2px 6px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

/* ─── CoursePlayer ─── */

function CoursePlayer({ selected, onSelect, watchedTimes, onWatch }) {
  const lesson = ALL_LESSONS.find(l => l.n === selected) || ALL_LESSONS[0];
  const [expanded, setExpanded] = useState([1, 2, 3]);
  const toggle = (id) => setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const lessonUnlocked = isUnlocked(lesson.n, watchedTimes);
  const lessonWatched  = !!watchedTimes[lesson.n];

  /* clicking play marks the lesson watched and unlocks the countdown for next */
  const handlePlay = () => {
    if (!lessonUnlocked) return;
    onWatch(lesson.n);
  };

  const handleSidebarClick = (n) => {
    if (!isUnlocked(n, watchedTimes)) return;
    onSelect(n);
    onWatch(n);
  };

  /* next lesson unlock state */
  const nextN = lesson.n + 1;
  const nextUnlocked = isUnlocked(nextN, watchedTimes);
  const nextUnlockTs = unlockAt(nextN, watchedTimes);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', border: '1px solid #e1e3e5', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>

      {/* ── Sidebar ── */}
      <div style={{ background: '#f9fafb', borderRight: '1px solid #e1e3e5', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e1e3e5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text as="p" variant="bodySm" fontWeight="bold">Contents</Text>
          <Text as="p" variant="bodyXs" tone="subdued">{ALL_LESSONS.length} lessons</Text>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {COURSE_SECTIONS.map(section => (
            <div key={section.id}>
              <button onClick={() => toggle(section.id)} style={{ width: '100%', padding: '10px 16px', background: '#f3f4f6', border: 'none', borderBottom: '1px solid #e1e3e5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', textAlign: 'left' }}>{section.id}. {section.title}</span>
                <span style={{ color: '#9ca3af', fontSize: 10, flexShrink: 0 }}>{expanded.includes(section.id) ? '▲' : '▼'}</span>
              </button>

              {expanded.includes(section.id) && section.lessons.map(l => {
                const unlocked = isUnlocked(l.n, watchedTimes);
                const watched  = !!watchedTimes[l.n];
                const lockTs   = unlockAt(l.n, watchedTimes);
                const isActive = selected === l.n;

                return (
                  <button
                    key={l.n}
                    onClick={() => handleSidebarClick(l.n)}
                    disabled={!unlocked}
                    style={{
                      width: '100%', padding: '10px 16px',
                      background: isActive ? '#eff6ff' : '#fff',
                      border: 'none', borderBottom: '1px solid #f3f4f6',
                      cursor: unlocked ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                      opacity: unlocked ? 1 : 0.6,
                    }}
                  >
                    {/* state indicator */}
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${watched ? '#10b981' : isActive ? '#3b82f6' : unlocked ? '#d1d5db' : '#e5e7eb'}`, flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: watched ? '#d1fae5' : isActive ? '#eff6ff' : '#fff' }}>
                      {watched
                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        : !unlocked
                          ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          : isActive
                            ? <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} />
                            : null
                      }
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: watched ? '#059669' : isActive ? '#0e8bc8' : unlocked ? '#374151' : '#9ca3af', fontWeight: watched || isActive ? 600 : 400, lineHeight: 1.4 }}>{l.title}</div>
                      {unlocked
                        ? <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{l.dur} video</div>
                        : lockTs
                          ? <div style={{ marginTop: 3 }}><CountdownBadge unlockTimestamp={lockTs} /></div>
                          : <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>Complete previous lesson first</div>
                      }
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Player ── */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', background: `linear-gradient(135deg, #f8fafc 0%, ${lesson.color}18 60%, #f8fafc 100%)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 340, borderBottom: '1px solid #e1e3e5' }}>
          <div style={{ position: 'absolute', top: 14, left: 18 }}>
            <Text as="p" variant="bodyXs" tone="subdued">Lesson {lesson.n} of {ALL_LESSONS.length}</Text>
            <div style={{ marginTop: 2 }}><Text as="p" variant="headingSm" fontWeight="semibold">{lesson.title}</Text></div>
          </div>

          {/* watched badge */}
          {lessonWatched && (
            <div style={{ position: 'absolute', top: 14, right: 18, display: 'flex', alignItems: 'center', gap: 5, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 999, padding: '3px 10px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#059669' }}>Watched</span>
            </div>
          )}

          {/* play button */}
          <div
            onClick={handlePlay}
            style={{ width: 60, height: 60, borderRadius: '50%', background: '#fff', border: `2px solid ${lessonUnlocked ? lesson.color : '#d1d5db'}`, boxShadow: `0 4px 16px ${lessonUnlocked ? lesson.color : '#d1d5db'}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: lessonUnlocked ? 'pointer' : 'not-allowed', opacity: lessonUnlocked ? 1 : 0.5 }}
          >
            {lessonUnlocked
              ? <div style={{ width: 0, height: 0, borderTop: '12px solid transparent', borderBottom: '12px solid transparent', borderLeft: `20px solid ${lesson.color}`, marginLeft: 4 }} />
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            }
          </div>

          <Text as="p" variant="bodyXs" tone="subdued">{lesson.desc}</Text>

          {/* locked overlay message */}
          {!lessonUnlocked && (
            <div style={{ background: '#fff', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>This lesson is locked</span>
              {unlockAt(lesson.n, watchedTimes)
                ? <CountdownBadge unlockTimestamp={unlockAt(lesson.n, watchedTimes)} />
                : <span style={{ fontSize: 11, color: '#9ca3af' }}>Watch the previous lesson to unlock</span>
              }
            </div>
          )}

          {/* playbar */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
            <div style={{ height: 3, background: '#e5e7eb' }}><div style={{ height: '100%', width: lessonWatched ? '100%' : '0%', background: lesson.color, transition: 'width 0.4s' }} /></div>
            <div style={{ background: '#f9fafb', borderTop: '1px solid #e1e3e5', padding: '7px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div onClick={handlePlay} style={{ width: 28, height: 28, borderRadius: '50%', background: lessonUnlocked ? lesson.color : '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: lessonUnlocked ? 'pointer' : 'not-allowed' }}>
                  <div style={{ width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '10px solid #fff', marginLeft: 2 }} />
                </div>
                <Text as="p" variant="bodyXs" tone="subdued">{lessonWatched ? lesson.dur : `0:00`} / {lesson.dur}</Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button disabled={lesson.n === 1} onClick={() => { if (isUnlocked(lesson.n - 1, watchedTimes)) { onSelect(lesson.n - 1); onWatch(lesson.n - 1); } }} style={{ background: 'none', border: 'none', color: lesson.n === 1 ? '#d1d5db' : '#6b7280', fontSize: 14, cursor: lesson.n === 1 ? 'default' : 'pointer' }}>◀◀</button>
                <button
                  disabled={!nextUnlocked}
                  onClick={() => { if (nextUnlocked && nextN <= ALL_LESSONS.length) { onSelect(nextN); onWatch(nextN); } }}
                  style={{ background: 'none', border: 'none', color: nextUnlocked ? '#6b7280' : '#d1d5db', fontSize: 14, cursor: nextUnlocked ? 'pointer' : 'not-allowed' }}
                >▶▶</button>
                <Text as="p" variant="bodyXs" tone="subdued">1x</Text>
              </div>
            </div>
          </div>
        </div>

        {/* below-player info */}
        <div style={{ padding: '16px 20px' }}>
          <Text as="p" variant="headingSm" fontWeight="bold">{lesson.title}</Text>
          <div style={{ marginTop: 4 }}><Text as="p" variant="bodyXs" tone="subdued">{lesson.desc}</Text></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {/* next lesson button */}
            {lesson.n < ALL_LESSONS.length && (
              nextUnlocked
                ? <button onClick={() => { onSelect(nextN); onWatch(nextN); }} style={{ padding: '6px 16px', background: ALL_LESSONS[nextN - 1]?.color ?? '#1a9de0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Next lesson →</button>
                : nextUnlockTs
                  ? <span style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <CountdownBadge unlockTimestamp={nextUnlockTs} />
                    </span>
                  : <span style={{ fontSize: 11, color: '#9ca3af' }}>Watch this lesson to unlock the next one</span>
            )}
            {lesson.n > 1 && (
              <button onClick={() => { onSelect(lesson.n - 1); }} style={{ padding: '6px 16px', background: '#f3f4f6', color: '#374151', border: '1px solid #e1e3e5', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>← Previous</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── StepVideoModal — the modal overlay used by the Setup Checklist thumbnails ─── */

function StepVideoModal({ step, onClose, onGoToStep }) {
  const t = useT();
  if (!step) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17, 24, 39, 0.65)', zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 720, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <Text as="p" variant="bodySm" fontWeight="semibold">{t(step.title)}</Text>
            <div style={{ marginTop: 2 }}><Text as="p" variant="bodyXs" tone="subdued">{t(step.desc)}</Text></div>
          </div>
          <button onClick={onClose} aria-label={t('admin.common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1, color: '#6b7280', padding: 4, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, background: '#000' }}>
          {step.videoUrl ? (
            <iframe
              src={step.videoUrl}
              title={t(step.title)}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>{t('admin.home.video_soon')}</span>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>{t('admin.common.close')}</button>
          {step.to && (
            <button onClick={onGoToStep} style={{ padding: '8px 16px', background: step.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {t('admin.home.go_to_step')} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── VideoTutorials (reusable in both modes) ───
 * Each card tracks its own watch progress (persisted in localStorage) so a
 * partially-watched video shows a resume-style progress bar on its
 * thumbnail — there is no overall "N of 6 done" checklist bar here.
 */

function VideoTutorials({ markStep, navigate }) {
  const t = useT();
  const [activeStepId, setActiveStepId] = useState(null);
  const activeStep = STEPS.find(s => s.id === activeStepId) || null;

  // { [stepId]: secondsWatched }
  const [videoProgress, setVideoProgress] = useState({});
  const sessionStartRef = useRef(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIDEO_PROGRESS_KEY);
      if (stored) setVideoProgress(JSON.parse(stored));
    } catch {}
  }, []);

  // While a video is open, approximate its watch position by elapsed time
  // and persist the furthest point reached — so returning later resumes
  // showing progress instead of starting the bar over from zero.
  useEffect(() => {
    if (!activeStepId) return;
    sessionStartRef.current = Date.now();
    const durationSec = parseDurationToSeconds(STEPS.find(s => s.id === activeStepId)?.dur);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - sessionStartRef.current) / 1000;
      setVideoProgress(prev => {
        const next = { ...prev, [activeStepId]: Math.min(durationSec, Math.max(prev[activeStepId] || 0, elapsed)) };
        try { localStorage.setItem(VIDEO_PROGRESS_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeStepId]);

  const handleGoToStep = () => {
    if (activeStep) {
      markStep(activeStep.id);
      if (activeStep.to) navigate(activeStep.to);
    }
    setActiveStepId(null);
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '18px 20px' }}>
      <style>{VIDEO_CARD_STYLES}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {STEPS.map(step => {
          const durationSec = parseDurationToSeconds(step.dur);
          const watchedSec = videoProgress[step.id] || 0;
          const progressPct = durationSec > 0 ? Math.min(100, Math.round((watchedSec / durationSec) * 100)) : 0;
          return (
            <VideoTutorialCard
              key={step.id}
              title={t(step.title)}
              description={t(step.desc)}
              category={t(step.category)}
              difficulty={step.difficulty}
              difficultyLabel={step.difficulty === 'Intermediate' ? t('admin.home.intermediate') : t('admin.home.beginner')}
              duration={step.dur}
              accent={step.color}
              watched={progressPct >= 90}
              progressPct={progressPct}
              thumbnailUrl={step.thumbnail}
              onPlay={() => setActiveStepId(step.id)}
            />
          );
        })}
      </div>

      <StepVideoModal step={activeStep} onClose={() => setActiveStepId(null)} onGoToStep={handleGoToStep} />
    </div>
  );
}

/* ─── Main Component ─── */

export default function DashboardPage() {
  const { shop, initialAnalytics } = useLoaderData();
  // Real app embed status from App Bridge (it used to always say "active").
  const embedStatus = useAppEmbedStatus();
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();
  const { plan, canUse } = usePlan();
  const navigate = useNavigate();
  const t = useT();
  const adminLocale = useAdminLocale();

  const analytics = normalizeAnalytics(initialAnalytics);

  // Always starts as 'normal' so the first paint matches the server-rendered
  // HTML exactly (no hydration mismatch) and nothing is blank while waiting
  // on localStorage. The effect below upgrades this to 'tutorial' right
  // after mount for first-time visitors — previously `mode` started as
  // `null` with an early `if (!mode) return null`, which blanked the whole
  // page until that same effect fired.
  const [mode, setMode] = useState('normal');
  const [completedSteps, setCompletedSteps] = useState([1]);
  const [selectedLesson, setSelectedLesson] = useState(1);
  // watchedTimes: { [lessonN]: timestamp } — persisted in localStorage
  const [watchedTimes, setWatchedTimes] = useState({});
  const [fbkRating, setFbkRating] = useState(0);
  const [fbkHovered, setFbkHovered] = useState(0);
  const [fbkNote, setFbkNote] = useState('');
  const [fbkSubmitted, setFbkSubmitted] = useState(false);
  const [fbkSubmitting, setFbkSubmitting] = useState(false);
  const [fbkError, setFbkError] = useState('');

  const submitFeedback = async () => {
    if (!fbkRating || fbkSubmitting) return;
    setFbkSubmitting(true);
    setFbkError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: fbkRating, note: fbkNote }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || t('admin.home.feedback_failed'));
      setFbkSubmitted(true);
    } catch (e) {
      setFbkError(e.message || t('admin.common.generic_error'));
    } finally {
      setFbkSubmitting(false);
    }
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const today = new Date().toDateString();
      if (!stored) { localStorage.setItem(STORAGE_KEY, today); setMode('tutorial'); }
      else if (stored === today) { setMode('tutorial'); }
    } catch {}
    try {
      const steps = localStorage.getItem('cn_completed_steps');
      if (steps) setCompletedSteps(JSON.parse(steps));
    } catch {}
    try {
      const times = localStorage.getItem(LESSON_PROGRESS_KEY);
      if (times) setWatchedTimes(JSON.parse(times));
    } catch {}
  }, []);

  const toggleMode = () => setMode(m => m === 'tutorial' ? 'normal' : 'tutorial');

  const markStep = (id) => {
    setCompletedSteps(prev => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try { localStorage.setItem('cn_completed_steps', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Mark lesson as watched (stores timestamp once; never overwrites)
  const handleWatch = (n) => {
    setWatchedTimes(prev => {
      if (prev[n]) return prev; // already recorded
      const next = { ...prev, [n]: Date.now() };
      try { localStorage.setItem(LESSON_PROGRESS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const doneCount = completedSteps.length;
  const progressPct = Math.round((doneCount / STEPS.length) * 100);
  const dateLabel = new Date().toLocaleDateString(adminLocale === 'en' ? 'en-US' : adminLocale, { weekday: 'long', month: 'long', day: 'numeric' });

  const kpis = [
    { label: t('admin.home.kpi_revenue'), value: formatAmount(analytics.cartdrawer_total_revenue,  currencySymbol, currencyCode), accent: '#008060', icon: CashDollarIcon  },
    { label: t('admin.home.kpi_aov'), value: formatAmount(analytics.avg_order_value,            currencySymbol, currencyCode), accent: '#1a9de0', icon: CartIcon        },
    { label: t('admin.home.kpi_conversion'), value: `${analytics.conversion_rate}%`,                                                  accent: '#10b981', icon: ChartCohortIcon },
    { label: t('admin.home.kpi_upsell'), value: formatAmount(analytics.upsell_revenue_generated,  currencySymbol, currencyCode), accent: '#2ecc71', icon: RewardIcon      },
  ];

  const quickActions = [
    { label: t('admin.nav.cart_editor'), to: '/app/cartdrawer',    accent: '#008060', icon: CartIcon,         minPlan: 'starter' },
    { label: t('admin.nav.analytics'), to: '/app/analytics',     accent: '#1a9de0', icon: ChartCohortIcon,  minPlan: 'starter' },
    { label: t('admin.home.link_fbt'), to: '/app/fbt',           accent: '#10b981', icon: RewardIcon,       minPlan: 'starter' },
    { label: t('admin.nav.coupon_banner'), to: '/app/productwidget', accent: '#f59e0b', icon: DiscountCodeIcon, minPlan: 'starter' },
    { label: t('admin.nav.build_combo'), to: '/app/bundles',       accent: '#2ecc71', icon: CollectionIcon,   minPlan: 'starter' },
    { label: t('admin.nav.brix_ai'), to: '/app/brix-ai',       accent: '#1a9de0', icon: StarIcon,         minPlan: 'starter' },
  ];

  const ModeToggle = () => (
    <button onClick={toggleMode} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
      {mode === 'tutorial' ? t('admin.home.go_dashboard') : t('admin.home.getting_started')}
    </button>
  );

  /* ─── TUTORIAL MODE ─── */
  if (mode === 'tutorial') {
    return (
      <Page fullWidth>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Welcome hero */}
          <div style={{ background: '#ffffff', border: '1px solid #e3e5e8', borderRadius: 16, padding: '28px 32px', boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'inline-block', marginBottom: 10, padding: '3px 10px', borderRadius: 999, background: '#f3f3f3', color: '#4a4f55', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{t('admin.home.getting_started')}</span>
              <Text as="h1" variant="headingXl" fontWeight="bold">{t('admin.home.welcome')}</Text>
              <div style={{ marginTop: 6 }}>
                <Text as="p" variant="bodyMd" tone="subdued">{t('admin.home.welcome_sub')}</Text>
              </div>
              <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div role="progressbar" aria-label={t('admin.home.setup_progress')} aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={doneCount} style={{ width: 220, height: 6, background: '#ececec', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progressPct}%`, background: '#111111', borderRadius: 999, transition: 'width 0.3s' }} />
                </div>
                <Text as="p" variant="bodySm" fontWeight="semibold">{t('admin.home.steps_done', { done: doneCount, total: STEPS.length })}</Text>
              </div>
            </div>
            <ModeToggle />
          </div>

          {/* Brix Academy — full course player temporarily disabled
          <div>
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Text as="h2" variant="headingMd" fontWeight="semibold">Brix Academy</Text>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#1a1a1a', color: '#fff', borderRadius: 999, padding: '2px 9px' }}>7 lessons</span>
            </div>
            <CoursePlayer selected={selectedLesson} onSelect={setSelectedLesson} watchedTimes={watchedTimes} onWatch={handleWatch} />
          </div>
          */}

          {/* Brix Academy — intro video */}
          <div>
            <div style={{ marginBottom: 14, textAlign: 'center' }}>
              <Text as="h2" variant="headingMd" fontWeight="semibold">{t('admin.home.academy')}</Text>
              <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.academy_sub')}</Text></div>
            </div>
            <div style={{ width: '100%' }}>
              {WELCOME_VIDEO_URL ? (
                <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid #e1e3e5' }}>
                  <iframe
                    src={WELCOME_VIDEO_URL}
                    title={t('admin.home.welcome')}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                  />
                </div>
              ) : (
                <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid #e1e3e5', background: 'linear-gradient(135deg, #f8fafc 0%, #667eea18 60%, #f8fafc 100%)' }}>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#fff', border: '2px solid #667eea', boxShadow: '0 4px 16px #667eea30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 0, height: 0, borderTop: '12px solid transparent', borderBottom: '12px solid transparent', borderLeft: '20px solid #667eea', marginLeft: 4 }} />
                    </div>
                    <Text as="p" variant="bodySm" fontWeight="semibold">{t('admin.home.welcome')}</Text>
                    <Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.video_soon')}</Text>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Video Tutorials */}
          <div>
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <Text as="h2" variant="headingMd" fontWeight="semibold">{t('admin.home.videos')}</Text>
                <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.videos_sub')}</Text></div>
              </div>
              <button onClick={toggleMode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a9de0', fontSize: 12, fontWeight: 600 }}>{t('admin.home.view_dashboard')} →</button>
            </div>
            <VideoTutorials markStep={markStep} navigate={navigate} />
          </div>

          {/* Mini Tutorials — hidden for now (video section)
          <div>
            <div style={{ marginBottom: 14 }}>
              <Text as="h2" variant="headingMd" fontWeight="semibold">Mini Tutorials</Text>
              <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">Quick 1–2 min walkthroughs for specific tasks</Text></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {MINI_TUTORIALS.map(mt => (
                <div key={mt.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = mt.color; e.currentTarget.style.boxShadow = `0 2px 10px ${mt.color}25`; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ height: 80, background: `linear-gradient(135deg, ${mt.color}22, ${mt.color}08)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', border: `2px solid ${mt.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 8px ${mt.color}30` }}>
                      <div style={{ width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: `10px solid ${mt.color}`, marginLeft: 3 }} />
                    </div>
                    <span style={{ position: 'absolute', bottom: 7, right: 9, fontSize: 10, fontWeight: 700, color: mt.color }}>{mt.dur}</span>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: mt.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{mt.tag}</span>
                    <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.3 }}>{mt.title}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          */}

          {/* Tips & Tricks */}
          <div>
            <div style={{ marginBottom: 14 }}>
              <Text as="h2" variant="headingMd" fontWeight="semibold">{t('admin.home.tips')}</Text>
              <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.tips_sub')}</Text></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {TIPS.map(tip => (
                <div key={tip.id} style={{ background: '#fff', border: '1px solid #f3f4f6', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: tip.color, flexShrink: 0, marginTop: 5 }} />
                  <div>
                    <Text as="p" variant="bodySm" fontWeight="semibold">{t(tip.title)}</Text>
                    <div style={{ marginTop: 4 }}><Text as="p" variant="bodyXs" tone="subdued">{t(tip.body)}</Text></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 72 }} />
        </div>
      </Page>
    );
  }

  /* ─── NORMAL MODE ─── */
  return (
    <Page fullWidth>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <Text as="h1" variant="headingXl" fontWeight="bold">{t('admin.home.welcome_back')}</Text>
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Text as="p" variant="bodyMd" tone="subdued">{dateLabel}</Text>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#d1d5db' }} />
              {(embedStatus === 'active' || embedStatus === 'off') && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: embedStatus === 'active' ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                  <Text as="p" variant="bodyMd" tone="subdued">{embedStatus === 'active' ? t('admin.home.embed_on') : t('admin.home.embed_off')}</Text>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ padding: '5px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...PLAN_BADGE_STYLE[plan] }}>
              {t('admin.home.plan_badge', { plan: PLANS[plan]?.label || t('admin.account.free') })}
            </span>
            <ModeToggle />
          </div>
        </div>

        {/* KPI tiles */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <button onClick={() => navigate('/app/analytics')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a9de0', fontSize: 12, fontWeight: 600, padding: 0 }}>{t('admin.home.view_analytics')} →</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '22px 22px 18px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: `linear-gradient(135deg, ${k.accent}, ${k.accent}bb)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${k.accent}40`, flexShrink: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', width: 22, height: 22, filter: 'brightness(0) invert(1)' }}><Icon source={k.icon} /></span>
                </div>
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#1a1a1a', lineHeight: 1, letterSpacing: '-0.5px' }}>{k.value}</div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 7, fontWeight: 500 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Video Tutorials */}
        <div>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Text as="h2" variant="headingMd" fontWeight="semibold">{t('admin.home.videos')}</Text>
              <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.videos_sub')}</Text></div>
            </div>
            <button onClick={toggleMode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a9de0', fontSize: 12, fontWeight: 600 }}>{t('admin.home.view_getting_started')} →</button>
          </div>
          <VideoTutorials markStep={markStep} navigate={navigate} />
        </div>

        {/* Feedback */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 24px' }}>
          {fbkSubmitted ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 0' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#f0fdf4', border: '1.5px solid #86efac', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <Text as="p" variant="headingSm" fontWeight="bold" alignment="center">{t('admin.home.feedback_thanks')}</Text>
              <Text as="p" variant="bodyXs" tone="subdued" alignment="center">{t('admin.home.feedback_helps')}</Text>
              <button onClick={() => { setFbkSubmitted(false); setFbkRating(0); setFbkNote(''); setFbkError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12 }}>{t('admin.home.rate_again')}</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'start', gap: 24 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text as="p" variant="headingSm" fontWeight="bold">{t('admin.home.feedback')}</Text>
                </div>
                <div style={{ marginTop: 4 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.feedback_sub')}</Text></div>
                <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                  {[1,2,3,4,5].map(s => (
                    <button key={s} onClick={() => setFbkRating(s)} onMouseEnter={() => setFbkHovered(s)} onMouseLeave={() => setFbkHovered(0)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', transition: 'transform .12s', transform: fbkHovered >= s || fbkRating >= s ? 'scale(1.15)' : 'scale(1)' }}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill={fbkRating >= s || fbkHovered >= s ? '#1a1a1a' : 'none'} stroke={fbkRating >= s || fbkHovered >= s ? '#1a1a1a' : '#d1d5db'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
                <textarea value={fbkNote} onChange={e => setFbkNote(e.target.value)} placeholder={t('admin.home.feedback_placeholder')} rows={3}
                  style={{ width: '100%', padding: '10px 13px', border: '1px solid #e5e7eb', borderRadius: 9, fontSize: 12, color: '#1a1a1a', background: '#fafafa', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
                  onFocus={e => { e.target.style.borderColor = '#9ca3af'; e.target.style.background = '#fff'; }}
                  onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.background = '#fafafa'; }}
                />
                {fbkError && <Text as="p" variant="bodyXs" tone="critical">{fbkError}</Text>}
              </div>
              <button onClick={submitFeedback} disabled={!fbkRating || fbkSubmitting}
                style={{ padding: '10px 22px', background: fbkRating ? '#1a1a1a' : '#f3f4f6', color: fbkRating ? '#fff' : '#9ca3af', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: fbkRating && !fbkSubmitting ? 'pointer' : 'default', whiteSpace: 'nowrap', alignSelf: 'stretch', opacity: fbkSubmitting ? 0.7 : 1 }}>
                {fbkSubmitting ? t('admin.home.sending') : t('admin.home.send_feedback')}
              </button>
            </div>
          )}
        </div>

        {/* Mini Tutorials — hidden for now (video section)
        <div>
          <div style={{ marginBottom: 14 }}>
            <Text as="h2" variant="headingMd" fontWeight="semibold">Mini Tutorials</Text>
            <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">Quick 1–2 min walkthroughs for specific tasks</Text></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {MINI_TUTORIALS.map(mt => (
              <div key={mt.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
                onMouseOver={e => { e.currentTarget.style.borderColor = mt.color; e.currentTarget.style.boxShadow = `0 2px 10px ${mt.color}25`; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ height: 80, background: `linear-gradient(135deg, ${mt.color}22, ${mt.color}08)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', border: `2px solid ${mt.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 8px ${mt.color}30` }}>
                    <div style={{ width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: `10px solid ${mt.color}`, marginLeft: 3 }} />
                  </div>
                  <span style={{ position: 'absolute', bottom: 7, right: 9, fontSize: 10, fontWeight: 700, color: mt.color }}>{mt.dur}</span>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: mt.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{mt.tag}</span>
                  <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.3 }}>{mt.title}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        */}

        {/* Quick Links */}
        <div>
          <div style={{ marginBottom: 12 }}><Text as="h2" variant="headingMd" fontWeight="semibold">{t('admin.home.quick_links')}</Text></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
            {quickActions.map(a => (
              <button key={a.label} onClick={() => navigate(a.to)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
                onMouseOver={e => { e.currentTarget.style.borderColor = a.accent; e.currentTarget.style.background = `${a.accent}08`; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fff'; }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${a.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', width: 18, height: 18 }}><Icon source={a.icon} /></span>
                </div>
                <Text as="p" variant="bodyXs" fontWeight="semibold">{a.label}</Text>
              </button>
            ))}
          </div>
        </div>

        {/* App embed status (shopify.app.extensions()) + a link that turns it on */}
        <div style={{ background: embedStatus === 'off' ? '#fffbeb' : '#f9fafb', border: `1px solid ${embedStatus === 'off' ? '#fcd34d' : '#e5e7eb'}`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {embedStatus === 'active' ? t('admin.home.embed_live') : embedStatus === 'off' ? t('admin.home.embed_turn_on_title') : t('admin.home.embed')}
            </Text>
            <div style={{ marginTop: 2 }}>
              <Text as="p" variant="bodyXs" tone="subdued">
                {embedStatus === 'active'
                  ? t('admin.home.embed_live_help')
                  : embedStatus === 'off'
                    ? t('admin.home.embed_off_help')
                    : t('admin.home.embed_help')}
              </Text>
            </div>
          </div>
          <button onClick={() => window.open(embedStatus === 'active' ? `https://${shop}/admin/themes/current/editor?context=apps` : cartDrawerEmbedEditorUrl(shop), '_blank')}
            style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {embedStatus === 'active' ? t('admin.home.open_theme_editor') : t('admin.home.turn_on_embed')}
          </button>
        </div>

        {/* Refer & Earn — hidden for now
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 13, background: 'linear-gradient(135deg, #1a9de0, #2ecc71)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px #1a9de040' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text as="p" variant="headingSm" fontWeight="bold">Refer &amp; Earn</Text>
                <span style={{ fontSize: 11, fontWeight: 700, background: 'linear-gradient(135deg, #1a9de0, #2ecc71)', color: '#fff', borderRadius: 999, padding: '2px 9px' }}>Free 50 Credits</span>
              </div>
              <Text as="p" variant="bodyXs" tone="subdued">Earn 50 free AI credits for every friend you refer who signs up. No limit — the more you share, the more you earn.</Text>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', fontFamily: 'monospace' }}>brix.app/ref/yourcode</div>
                <button style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 11px', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Copy link</button>
              </div>
            </div>
          </div>
          <button style={{ padding: '10px 22px', background: 'linear-gradient(135deg, #1a9de0, #2ecc71)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, boxShadow: '0 2px 10px #1a9de040' }}>
            Share &amp; Earn →
          </button>
        </div>
        */}

        <div style={{ height: 72 }} />
      </div>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
