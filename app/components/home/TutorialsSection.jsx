import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Text } from '@shopify/polaris';
import {
  CartIcon, DiscountCodeIcon, RewardIcon,
  ChartCohortIcon, CollectionIcon, StarIcon,
} from '@shopify/polaris-icons';
import VideoTutorialCard, { VIDEO_CARD_STYLES } from '../VideoTutorialCard';
import { useT } from '../../i18n/admin';

// Video tutorials, the Academy intro and tips. They used to be the Home page; they now live on
// the Account page (/app/additional#tutorials), which the Home page's Help link opens.

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

const TIPS = [
  { id: 1, title: 'admin.home.tip1_title',        body: 'admin.home.tip1_body', color: '#ef4444' },
  { id: 2, title: 'admin.home.tip2_title',      body: 'admin.home.tip2_body',     color: '#f59e0b' },
  { id: 3, title: 'admin.home.tip3_title',     body: 'admin.home.tip3_body',   color: '#2ecc71' },
  { id: 4, title: 'admin.home.tip4_title',       body: 'admin.home.tip4_body', color: '#10b981' },
  { id: 5, title: 'admin.home.tip5_title', body: 'admin.home.tip5_body', color: '#1a9de0' },
  { id: 6, title: 'admin.home.tip6_title',    body: 'admin.home.tip6_body',   color: '#06b6d4' },
];

const VIDEO_PROGRESS_KEY = 'cn_video_progress_seconds';


/* "MM:SS" → total seconds */
function parseDurationToSeconds(dur) {
  if (!dur) return 0;
  const parts = String(dur).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
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

export default function TutorialsSection() {
  const t = useT();
  const navigate = useNavigate();
  const markStep = (id) => {
    try {
      const steps = JSON.parse(localStorage.getItem('cn_completed_steps') || '[1]');
      if (!steps.includes(id)) localStorage.setItem('cn_completed_steps', JSON.stringify([...steps, id]));
    } catch {}
  };
  return (
    <div id="tutorials" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
            <div style={{ marginBottom: 14 }}>
              <div>
                <Text as="h2" variant="headingMd" fontWeight="semibold">{t('admin.home.videos')}</Text>
                <div style={{ marginTop: 3 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.videos_sub')}</Text></div>
              </div>
            </div>
            <VideoTutorials markStep={markStep} navigate={navigate} />
          </div>


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

    </div>
  );
}
