/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// The FBT widget exactly as the storefront draws it (fbt-core.shared.js html/css),
// with sample products, so ticking items and switching variants can be tried here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { css, html, formatMoney, itemFromProduct, chooseVariant } from '../../utils/fbt-core.shared.js';

const STYLE = css();

export default function FbtPreview({ config, samples, moneyFormat }) {
  const [checked, setChecked] = useState({});
  const [variants, setVariants] = useState({});
  const box = useRef(null);

  // The markup isn't React's, so its checkboxes and selects are listened to directly.
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onChange = (e) => {
      const key = e.target.getAttribute('data-fbt-toggle');
      if (key) setChecked((c) => ({ ...c, [key]: e.target.checked }));
      const vkey = e.target.getAttribute('data-fbt-variant');
      if (vkey) setVariants((v) => ({ ...v, [vkey]: e.target.value }));
    };
    const onClick = (e) => { if (e.target.closest('a, button')) e.preventDefault(); };
    el.addEventListener('change', onChange);
    el.addEventListener('click', onClick);
    return () => { el.removeEventListener('change', onChange); el.removeEventListener('click', onClick); };
  });

  const { current, items } = useMemo(() => {
    const built = samples.map((p, i) => itemFromProduct(p, i === 0 ? 'current' : `p${p.id}`, true));
    const list = built.filter(Boolean);
    const cur = list[0] || null;
    const rest = list.slice(1, 1 + config.maxItems);
    for (const it of [cur, ...rest].filter(Boolean)) {
      if (checked[it.key] !== undefined) it.checked = checked[it.key];
      else if (it.key !== 'current' && config.style === 'bundle') it.checked = config.preselect;
      if (variants[it.key]) chooseVariant(it, variants[it.key]);
    }
    return { current: cur, items: rest };
  }, [samples, config.maxItems, config.style, config.preselect, checked, variants]);

  if (!items.length) {
    return <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Add a few products to your store to see the preview.</div>;
  }
  const markup = html({
    config,
    current: config.style === 'bundle' && !config.showCurrent ? null : current,
    items,
    money: (cents) => formatMoney(cents, moneyFormat),
    busy: '',
    added: {},
    status: '',
  });
  return (
    <div className="fbt-preview">
      <style>{STYLE}</style>
      {/* Same markup as the storefront: its checkboxes and selects work here too. */}
      <div ref={box} dangerouslySetInnerHTML={{ __html: markup }} />
    </div>
  );
}
