/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// The cart-item list of the Cart Editor's live preview: the sample product, any
// products the merchant "added" from the upsell / recommended lists, and the
// reward products the cart has unlocked (FREE-tagged when the milestone's
// reward price is set to free). Presentational only — CartPreview owns the
// state (see utils/preview-cart.js for the logic).
//
// Rows use the storefront drawer's own markup and stylesheet
// (extensions/cart-drawer/assets/brix_cart_ui.css, .bxcd-item; built on the
// storefront by renderCartItemHtml in cart_drawer_inline.js), so the preview
// and the live drawer look the same on desktop and mobile.
import { useCurrency } from './CurrencyContext';

const GIFT_ICON = (
  <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M3 8a1 1 0 011-1h12a1 1 0 011 1v2H3V8zm0 3h6v6H5a2 2 0 01-2-2v-4zm8 0h6v4a2 2 0 01-2 2h-4v-6zM10 7V5.5A2.5 2.5 0 107.5 8H10zm0 0h2.5A2.5 2.5 0 1010 5.5V7z" />
  </svg>
);
const X_ICON = <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>;
const MINUS_ICON = <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 10h12" /></svg>;
const PLUS_ICON = <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>;
const BOX_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="1.5" style={{ width: 24, height: 24 }} aria-hidden="true">
    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

const stop = (fn) => (e) => { e.stopPropagation(); if (fn) fn(); };

/** One cart line, as on the storefront: image | title, variant, price, quantity | remove, line total. */
function ItemRow({ title, variant, image, price, quantity = 1, onRemove, testId }) {
  const { formatMoney } = useCurrency();
  return (
    <div className="bxcd-item" data-testid={testId}>
      <div className="bxcd-item__media">{image ? <img src={image} alt={title} /> : BOX_ICON}</div>
      <p className="bxcd-item__title">{title}</p>
      <button type="button" className="bxcd-item__remove" aria-label="Remove product" title="Remove" onClick={stop(onRemove)}>{X_ICON}</button>
      {variant ? <p className="bxcd-item__variant">{variant}</p> : null}
      <div className="bxcd-item__price"><span className="bxcd-item__unit">{formatMoney(price)}</span></div>
      <div className="bxcd-item__qty">
        <div className="bxcd-qty" role="group" aria-label="Quantity">
          <button type="button" className="bxcd-qty__btn" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={stop()}>{MINUS_ICON}</button>
          <span className="bxcd-qty__val">{quantity}</span>
          <button type="button" className="bxcd-qty__btn" aria-label="Increase quantity" onClick={stop()}>{PLUS_ICON}</button>
        </div>
      </div>
      <div className="bxcd-item__total">{formatMoney(price * quantity)}</div>
    </div>
  );
}

function GiftRow({ reward }) {
  const { formatMoney } = useCurrency();
  const isFree = reward.pricing === 'free';
  const price = Number(reward.product?.price) || 0;
  const title = reward.product?.title || 'Reward product';
  return (
    <div className="bxcd-item bxcd-item--gift" data-testid="preview-reward-line">
      <span className={`bxcd-item__badge${isFree ? ' bxcd-item__badge--free' : ''}`}>{GIFT_ICON}{isFree ? 'FREE GIFT' : 'REWARD'}</span>
      <div className="bxcd-item__media">{reward.product?.image ? <img src={reward.product.image} alt={title} /> : BOX_ICON}</div>
      <p className="bxcd-item__title">{title}</p>
      <button type="button" className="bxcd-item__remove" aria-label="Remove product" title="Remove" onClick={stop()}>{X_ICON}</button>
      <div className="bxcd-item__price">
        {isFree ? <span className="bxcd-item__note">Added for reaching your milestone</span> : <span className="bxcd-item__unit">{price > 0 ? formatMoney(price) : ''}</span>}
      </div>
      <div className="bxcd-item__total">
        {isFree ? (
          <>
            <span className="bxcd-item__free">FREE</span>
            {price > 0 && <span className="bxcd-item__was">{formatMoney(price)}</span>}
          </>
        ) : (price > 0 ? formatMoney(price) : '')}
      </div>
    </div>
  );
}

export default function PreviewCartItems({ baseTotal, added, rewards, onRemove, onReset }) {
  const itemCount = 1 + added.length + rewards.length;
  return (
    <div style={{ padding: '10px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#6d7175', margin: '0 4px 10px' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>Items included</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {added.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onReset(); }}
              style={{ border: 'none', background: 'none', color: '#2c6ecb', textDecoration: 'underline', fontSize: 11, cursor: 'pointer', padding: 0 }}
            >
              Reset preview
            </button>
          )}
          <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 6, fontWeight: 700, color: '#64748b' }}>{itemCount} ITEMS</span>
        </span>
      </div>

      <div className="bxcd-items">
        <ItemRow title="Boys Charcoal Grey Cotton Joggers" variant="Grey / 8-9 Y" price={baseTotal} testId="preview-sample-line" />
        {added.map((item) => (
          <ItemRow
            key={item.uid}
            testId="preview-added-line"
            title={item.product.title}
            image={item.product.image}
            price={Number(item.product.price) || 0}
            onRemove={() => onRemove(item.uid)}
          />
        ))}
        {rewards.map((reward) => <GiftRow key={reward.key} reward={reward} />)}
      </div>
    </div>
  );
}
