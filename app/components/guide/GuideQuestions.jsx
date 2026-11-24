/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * The guided setup's two questions, in a box in the middle of the screen
 * (GuideShell draws it): how customers pay, then which features. Answers sit
 * side by side; Postpaid and Both tick COD Checkout. "Start setup" hands over
 * to the side panel and the spotlight (GuideProvider.start). Opens by itself
 * only on Home for a new store; "Guided setup", "Change features" and
 * "Restart" open it by hand, always at Question 1 with the earlier answers
 * ticked ("Restart" then starts the guide over on Start setup). × / Esc /
 * "Skip for now" / Cancel close it without changing anything.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@shopify/polaris';
import { StoreIcon, CheckIcon, ArrowLeftIcon, XIcon, CreditCardIcon, CashDollarIcon, PaymentIcon } from '@shopify/polaris-icons';
import { useT } from '../../i18n/admin';
import { useGuide } from './GuideProvider';
import { GUIDE_MODULE_META } from './guide-meta';
import { GUIDE_MODULE_IDS, GUIDE_PAYMENTS, selectionForPayment, paymentWantsCod } from '../../utils/guide.shared.js';

const PAYMENT_META = {
  prepaid: { label: 'admin.guide.pay_prepaid', desc: 'admin.guide.pay_prepaid_desc', icon: CreditCardIcon },
  postpaid: { label: 'admin.guide.pay_postpaid', desc: 'admin.guide.pay_postpaid_desc', icon: CashDollarIcon },
  both: { label: 'admin.guide.pay_both', desc: 'admin.guide.pay_both_desc', icon: PaymentIcon },
};

function Option({ on, icon, title, desc, role, onClick, ...data }) {
  return (
    <button type="button" role={role} aria-checked={on} className={`brx-gq-opt${on ? ' is-on' : ''}`} onClick={onClick} {...data}>
      <span className="brx-gq-opt-ic" aria-hidden="true"><Icon source={icon} /></span>
      <span className="brx-gq-opt-t"><b>{title}</b><small>{desc}</small></span>
      <span className="brx-gq-tick" aria-hidden="true">{on && <Icon source={CheckIcon} />}</span>
    </button>
  );
}

export default function GuideQuestions() {
  const t = useT();
  const g = useGuide();
  const editing = g.editing;
  const mode = g.questionsMode; // 'edit' | 'restart' | null (first time)
  // Always from Question 1; opened again, the earlier answers are already ticked.
  const [view, setView] = useState('payment');
  const [payment, setPayment] = useState(g.state.payment);
  const [picked, setPicked] = useState(g.state.modules);
  const [codAuto, setCodAuto] = useState(false);
  const boxRef = useRef(null);

  // Focus moves into the box; Esc closes it.
  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') g.closeQuestions(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePayment = (value) => {
    const sel = selectionForPayment(value, picked, { codAuto });
    setPayment(value);
    setPicked(sel.modules);
    setCodAuto(sel.codAuto);
  };
  const toggle = (id) => {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
    if (id === 'cod') setCodAuto(false);
  };

  const onPayment = view === 'payment';
  return (
    <div className="brx-gq-back" role="presentation" data-guide-questions={view}>
      <div className="brx-gq-modal" role="dialog" aria-modal="true" aria-labelledby="brx-gq-title" tabIndex={-1} ref={boxRef}>
        <div className="brx-gq-head">
          <span className="brx-gq-logo" aria-hidden="true"><Icon source={StoreIcon} /></span>
          <span className="brx-gq-brand">{t(mode === 'restart' ? 'admin.guide.restart' : mode === 'edit' ? 'admin.guide.change_features' : 'admin.guide.welcome_title')}</span>
          <span className="brx-gq-count">{t('admin.guide.question_of', { n: onPayment ? 1 : 2, total: 2 })}</span>
          <button type="button" className="brx-gs-iconbtn" onClick={g.closeQuestions} aria-label={t('admin.guide.skip_for_now')} title={t('admin.guide.skip_for_now')} data-guide-close-questions>
            <Icon source={XIcon} />
          </button>
        </div>
        <div className="brx-gq-progress" aria-hidden="true"><i style={{ width: onPayment ? '50%' : '100%' }} /></div>

        <div className="brx-gq-q">
          <h2 id="brx-gq-title">{t(onPayment ? 'admin.guide.q_payment' : 'admin.guide.q_features')}</h2>
          <p>{t(onPayment ? 'admin.guide.q_payment_help' : 'admin.guide.q_features_help')}</p>
        </div>

        {onPayment ? (
          <div className="brx-gq-pay" role="radiogroup" aria-labelledby="brx-gq-title">
            {GUIDE_PAYMENTS.map((id) => (
              <Option key={id} role="radio" on={payment === id} icon={PAYMENT_META[id].icon} title={t(PAYMENT_META[id].label)} desc={t(PAYMENT_META[id].desc)}
                onClick={() => choosePayment(id)} data-guide-payment={id} />
            ))}
          </div>
        ) : (
          <>
            {paymentWantsCod(payment) && picked.includes('cod') && (
              <div className="brx-gs-note" data-guide-cod-note>{t('admin.guide.cod_picked')}</div>
            )}
            <div className="brx-gq-feats" role="group" aria-labelledby="brx-gq-title">
              {GUIDE_MODULE_IDS.map((id) => (
                <Option key={id} role="checkbox" on={picked.includes(id)} icon={GUIDE_MODULE_META[id].icon} title={t(GUIDE_MODULE_META[id].name)} desc={t(GUIDE_MODULE_META[id].desc)}
                  onClick={() => toggle(id)} data-guide-feature={id} />
              ))}
            </div>
          </>
        )}

        <div className="brx-gq-foot">
          {onPayment
            ? <button type="button" className="brx-gq-skip" onClick={g.closeQuestions} data-guide-not-now>{t(editing ? 'admin.guide.cancel' : 'admin.guide.skip_for_now')}</button>
            : <button type="button" className="brx-gq-skip" onClick={() => setView('payment')} data-guide-back><Icon source={ArrowLeftIcon} />{t('admin.guide.back')}</button>}
          {onPayment ? (
            <button type="button" className="brx-gs-btn brx-gs-btn--primary brx-gq-next" disabled={!payment} onClick={() => setView('features')} data-guide-continue>{t('admin.guide.next')}</button>
          ) : (
            <button type="button" className="brx-gs-btn brx-gs-btn--primary brx-gq-next" disabled={!payment || !picked.length} onClick={() => g.start(payment, picked)} data-guide-start>
              {t(mode === 'edit' ? 'admin.guide.save_features' : 'admin.guide.start')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
