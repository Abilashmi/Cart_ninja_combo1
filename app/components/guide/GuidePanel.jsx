/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * The guided setup's side panel (GuideShell places it): the current feature's
 * steps while the tour runs — how many are done, the app embed the feature
 * needs when it's off, the steps (click one to go to it), the save check on
 * the last one, the feature's video, Previous / Next — and, once everything
 * is done, a summary on Home. "Cancel tour" only stops the highlight (the
 * steps stay, with Resume tour); closing the guide (the arrow) leaves
 * `GuidePill` at the bottom of the page. The questions are a box
 * (GuideQuestions). Every action goes through GuideProvider; this file only draws.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon } from '@shopify/polaris';
import { ChevronDownIcon, ChevronUpIcon, CheckIcon, PlayIcon, ArrowLeftIcon, XIcon } from '@shopify/polaris-icons';
import { useT } from '../../i18n/admin';
import { useGuide } from './GuideProvider';
import { GUIDE_MODULE_META } from './guide-meta';
import { StepVideoModal } from '../home/TutorialsSection';
import { GUIDE_TOURS } from '../../config/guide-tours.js';
import { guideSteps, guideSummary, moduleStatuses, stepOnPage } from '../../utils/guide.shared.js';

const TOUR_LABEL = {
  not_started: 'admin.guide.status_not_started',
  in_progress: 'admin.guide.status_in_progress',
  completed: 'admin.guide.status_tour_completed',
  skipped: 'admin.guide.status_skipped',
};
const TOUR_TONE = { not_started: '', in_progress: 'is-progress', completed: 'is-done', skipped: '' };

/** A feature's three separate statuses: tour, configured, active (unknown ones left out). */
export function GuideStatusBadges({ tour, configured, active, stepsDone, stepsTotal }) {
  const t = useT();
  const tourText = tour === 'in_progress' && stepsTotal
    ? `${t(TOUR_LABEL.in_progress)} · ${stepsDone}/${stepsTotal}`
    : t(TOUR_LABEL[tour] || TOUR_LABEL.not_started);
  return (
    <span className="brx-gs-badges" data-guide-status>
      <span className={`brx-gs-badge ${TOUR_TONE[tour] || ''}`} data-status="tour">{tourText}</span>
      {configured != null && (
        <span className={`brx-gs-badge${configured ? ' is-info' : ''}`} data-status="configured">{t(configured ? 'admin.guide.status_configured' : 'admin.guide.status_not_configured')}</span>
      )}
      {active != null && (
        <span className={`brx-gs-badge${active ? ' is-ok' : ''}`} data-status="active">{t(active ? 'admin.guide.status_active' : 'admin.guide.status_off')}</span>
      )}
    </span>
  );
}

/** "Needs the … app embed · Off · I've turned it on" while the feature's embed is off in the live theme. */
function EmbedNotice({ handle }) {
  const t = useT();
  const g = useGuide();
  const status = g.embeds[handle];
  useEffect(() => {
    if (handle && !status) g.checkEmbed(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);
  // Only when the theme was read and the embed is really off (never a guess).
  if (!handle || !status || !status.checked || status.enabled) return null;
  return (
    <div className="brx-gs-embed" role="status" data-guide-embed={handle}>
      <span className="brx-gs-embed-t">
        {t('admin.guide.embed_needed', { name: status.name })}
        {status.editorUrl && (
          <a href={status.editorUrl} target="_blank" rel="noreferrer" className="brx-gs-embed-link" data-guide-embed-open>{t('admin.guide.embed_open')}</a>
        )}
      </span>
      <span className="brx-gs-embed-off">{t('admin.guide.embed_off')}</span>
      <button type="button" className="brx-gs-embed-check" disabled={status.loading} onClick={() => g.checkEmbed(handle)} data-guide-embed-check>
        {status.loading ? t('admin.guide.embed_checking') : t('admin.guide.embed_recheck')}
      </button>
    </div>
  );
}

function Header({ module, kicker, title, onCollapse, onClose }) {
  const t = useT();
  const meta = module ? GUIDE_MODULE_META[module] : null;
  return (
    <div className="brx-gs-hd">
      <span className="brx-gs-ic brx-gs-ic--round" aria-hidden="true"><Icon source={meta ? meta.icon : CheckIcon} /></span>
      <div className="brx-gs-hd-t">
        <div className="brx-gs-kicker">{kicker}</div>
        <div className="brx-gs-title" data-guide-title>{title}</div>
      </div>
      {onCollapse && (
        <button type="button" className="brx-gs-iconbtn" onClick={onCollapse} aria-label={t('admin.guide.collapse')} title={t('admin.guide.collapse')} data-guide-collapse>
          <Icon source={ChevronDownIcon} />
        </button>
      )}
      {onClose && (
        <button type="button" className="brx-gs-iconbtn" onClick={onClose} aria-label={t('admin.guide.close')} title={t('admin.guide.close')}><Icon source={XIcon} /></button>
      )}
    </div>
  );
}

/* ── one feature's steps ───────────────────────────────────── */
function Guided() {
  const t = useT();
  const g = useGuide();
  const location = useLocation();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const { state, verify } = g;
  const cur = state.current;
  const module = cur.module;
  const meta = GUIDE_MODULE_META[module];
  const name = t(meta.name);
  const steps = guideSteps(module);
  const step = steps[cur.step];
  const summary = guideSummary(state);
  const pm = summary.perModule[module] || { done: 0, total: steps.length };
  const elsewhere = step && !stepOnPage(step, location.pathname);
  const isSave = step?.kind === 'save';
  const mine = verify.module === module;
  const nextModule = state.modules[state.modules.indexOf(module) + 1];
  const tourVideo = GUIDE_TOURS[module]?.video;
  const checking = mine && verify.phase === 'checking';
  const position = state.modules.indexOf(module) + 1;
  const paused = state.status === 'paused';

  return (
    <div className="brx-gs-card" data-guide-panel="guided" data-guide-module={module}>
      <Header module={module} kicker={`${t('admin.guide.label')} · ${t('admin.guide.feature_of', { n: position, total: state.modules.length })}`} title={name} onCollapse={() => g.setCollapsed(true)} />
      <div className="brx-gs-segs" aria-label={t('admin.guide.features_done', { done: summary.modulesDone, total: summary.modulesTotal })} data-guide-features-done>
        {state.modules.map((id) => {
          const tour = state.progress?.[id]?.tour;
          const cls = id === module ? 'is-current' : tour === 'completed' ? 'is-done' : tour === 'skipped' ? 'is-skipped' : '';
          return (
            <button key={id} type="button" className={`brx-gs-seg ${cls}`} title={t(GUIDE_MODULE_META[id].name)} aria-label={t(GUIDE_MODULE_META[id].name)} aria-current={id === module ? 'step' : undefined} onClick={() => g.openModule(id)} data-guide-seg={id} />
          );
        })}
      </div>

      <div className="brx-gs-body">
        <div>
          <div className="brx-gs-count"><span data-guide-steps-done>{t('admin.guide.steps_done', { done: pm.done, total: pm.total })}</span></div>
          <div className="brx-gs-bar" role="progressbar" aria-label={t('admin.guide.steps_done', { done: pm.done, total: pm.total })} aria-valuemin={0} aria-valuemax={pm.total} aria-valuenow={pm.done}>
            <i style={{ width: `${pm.total ? Math.round((pm.done / pm.total) * 100) : 0}%` }} />
          </div>
        </div>

        <EmbedNotice handle={meta.embed} />

        <ol className="brx-gs-steps">
          {steps.map((s, i) => {
            const done = state.progress?.[module]?.done?.includes(s.id) || state.progress?.[module]?.tour === 'completed';
            const current = i === cur.step;
            return (
              <li key={s.id}>
                <button type="button" className={`brx-gs-step${current ? ' is-current' : ''}${done ? ' is-done' : ''}`} aria-current={current ? 'step' : undefined} onClick={() => g.goToStep(module, i)} data-guide-step={s.id}>
                  <span className="brx-gs-num">{done ? <Icon source={CheckIcon} /> : i + 1}</span>
                  <span className="brx-gs-step-t">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {paused && <div className="brx-gs-note" data-guide-paused>{t('admin.guide.tour_cancelled')}</div>}
        {!paused && elsewhere && !checking && !(mine && verify.phase === 'done') && !g.onHome && (
          <div className="brx-gs-note" data-guide-elsewhere>
            {t('admin.guide.step_elsewhere')}
            <div className="brx-gs-row"><button type="button" className="brx-gs-btn" onClick={() => g.goToStep(module, cur.step)}>{t('admin.guide.go_to_step')}</button></div>
          </div>
        )}
        {checking && <div className="brx-gs-note" data-guide-checking><span className="brx-gs-spin" aria-hidden="true" />{t('admin.guide.checking')}</div>}
        {mine && verify.phase === 'failed' && (
          <div className="brx-gs-note is-warn" role="alert" data-guide-not-saved>
            {verify.unknown ? t('admin.guide.check_unknown') : t('admin.guide.not_saved', { name })}
            <div className="brx-gs-row">
              <button type="button" className="brx-gs-btn" onClick={() => g.verifyModule(module)}>{t('admin.guide.check_again')}</button>
              <button type="button" className="brx-gs-textlink" onClick={g.skipModule}>{t('admin.guide.skip_feature')}</button>
            </div>
          </div>
        )}
        {mine && verify.phase === 'done' && (
          <div className="brx-gs-note is-ok" role="status" data-guide-module-done>
            {t('admin.guide.module_done', { name })}
            {nextModule && <> {t('admin.guide.next_feature', { name: t(GUIDE_MODULE_META[nextModule].name) })}</>}
          </div>
        )}

        {tourVideo && (
          <div className="brx-gs-video">
            <span className="brx-gs-play" aria-hidden="true"><Icon source={PlayIcon} /></span>
            <span className="brx-gs-video-t"><b>{t(tourVideo.title)}</b>{tourVideo.dur && <span>{tourVideo.dur}</span>}</span>
            <button type="button" className="brx-gs-btn" onClick={() => setVideo({ title: tourVideo.title, desc: tourVideo.desc, videoUrl: tourVideo.url })} data-guide-watch>{t('admin.guide.watch')}</button>
          </div>
        )}

        {paused ? (
          // Tour cancelled: the steps stay; the highlight comes back on Resume (or a step's click).
          <div className="brx-gs-row">
            <button type="button" className="brx-gs-btn brx-gs-btn--primary brx-gs-btn--wide" onClick={g.resume} data-guide-resume>{t('admin.guide.resume_tour')}</button>
          </div>
        ) : (
          <div className="brx-gs-row">
            <button type="button" className="brx-gs-btn brx-gs-btn--wide" disabled={cur.step === 0} onClick={g.prev} data-guide-prev>{t('admin.guide.previous')}</button>
            <button type="button" className="brx-gs-btn brx-gs-btn--primary brx-gs-btn--wide" disabled={checking} onClick={g.next} data-guide-next>
              {t(elsewhere ? 'admin.guide.next' : isSave ? 'admin.guide.check_finish' : 'admin.guide.next')}
            </button>
          </div>
        )}

        <div className="brx-gs-row brx-gs-row--split">
          {!paused && <button type="button" className="brx-gs-textlink" onClick={g.pause} data-guide-pause>{t('admin.guide.pause')}</button>}
          <button type="button" className="brx-gs-textlink" onClick={g.skipModule} data-guide-skip>{t('admin.guide.skip_feature')}</button>
          <button type="button" className="brx-gs-textlink" onClick={g.editFeatures} data-guide-edit>{t('admin.guide.change_features')}</button>
          <button type="button" className="brx-gs-textlink" onClick={g.restart} data-guide-restart>{t('admin.guide.restart_short')}</button>
        </div>

        {!g.onHome && (
          <button type="button" className="brx-gs-link" onClick={() => navigate('/app')} data-guide-dashboard><Icon source={ArrowLeftIcon} />{t('admin.guide.back_dashboard')}</button>
        )}
        {g.saveError && <div className="brx-gs-note is-warn" role="status">{t('admin.guide.save_error')}</div>}
      </div>
      {video && <StepVideoModal step={video} onClose={() => setVideo(null)} />}
    </div>
  );
}

/* ── all done ──────────────────────────────────────────────── */
function Finished() {
  const t = useT();
  const g = useGuide();
  const summary = guideSummary(g.state);
  return (
    <div className="brx-gs-card" data-guide-panel="done">
      <Header kicker={t('admin.guide.label')} title={t('admin.guide.done_title')} onClose={g.closeFinished} />
      <div className="brx-gs-body">
        <p className="brx-gs-sub" style={{ margin: 0 }}>{t('admin.guide.done_help')}</p>
        <ul className="brx-gs-mods">
          {g.state.modules.map((id) => {
            const s = moduleStatuses(g.state, g.modulesStatus, id);
            const pm = summary.perModule[id];
            return (
              <li key={id} className="brx-gs-mod" data-guide-mod={id}>
                <span className="brx-gs-cic" aria-hidden="true"><Icon source={GUIDE_MODULE_META[id].icon} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="brx-gs-mod-t">{t(GUIDE_MODULE_META[id].name)}</span>
                  <GuideStatusBadges tour={s.tour} configured={s.configured} active={s.active} stepsDone={pm.done} stepsTotal={pm.total} />
                </span>
              </li>
            );
          })}
        </ul>
        <div className="brx-gs-row brx-gs-row--split">
          <button type="button" className="brx-gs-textlink" onClick={g.editFeatures}>{t('admin.guide.change_features')}</button>
          <button type="button" className="brx-gs-btn" onClick={g.restart} data-guide-restart>{t('admin.guide.restart')}</button>
        </div>
      </div>
    </div>
  );
}

export default function GuidePanel() {
  const t = useT();
  const g = useGuide();
  const body = (g.state.status === 'active' || g.state.status === 'paused') && g.state.current ? <Guided /> : <Finished />;
  return <aside className="brx-gs-aside" aria-label={t('admin.guide.label')} data-guide-aside>{body}</aside>;
}

/**
 * The guide closed (the arrow): "Guided setup · 2/5" at the bottom of every
 * page, next to the support chat button. A tap opens it again as it was.
 */
export function GuidePill() {
  const t = useT();
  const g = useGuide();
  const cur = g.state.current;
  if (!cur) return null;
  const meta = GUIDE_MODULE_META[cur.module];
  const pm = guideSummary(g.state).perModule[cur.module] || { done: 0, total: guideSteps(cur.module).length };
  // Reopens the guide as it was closed (a cancelled tour stays cancelled until Resume).
  const open = () => g.setCollapsed(false);
  return (
    <button type="button" className="brx-gs-pill" onClick={open} aria-label={`${t('admin.guide.expand')}: ${t(meta.name)}`} data-guide-pill={g.state.status}>
      <span className="brx-gs-pill-ic" aria-hidden="true"><Icon source={meta.icon} /></span>
      <span>{t('admin.guide.pill', { done: pm.done, total: pm.total })}</span>
      <Icon source={ChevronUpIcon} />
    </button>
  );
}
