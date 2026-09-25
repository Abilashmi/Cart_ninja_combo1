// The cart-item list of the Cart Editor's live preview: the sample product, any
// products the merchant "added" from the upsell / recommended lists, and the
// reward products the cart has unlocked (FREE-tagged when the milestone's
// reward price is set to free). Presentational only — CartPreview owns the
// state (see utils/preview-cart.js for the logic).
const GIFT_ICON = (
  <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M3 8a1 1 0 011-1h12a1 1 0 011 1v2H3V8zm0 3h6v6H5a2 2 0 01-2-2v-4zm8 0h6v4a2 2 0 01-2 2h-4v-6zM10 7V5.5A2.5 2.5 0 107.5 8H10zm0 0h2.5A2.5 2.5 0 1010 5.5V7z" />
  </svg>
);

const BOX_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="1.5" style={{ width: 20, height: 20 }}>
    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

function Thumb({ image, size = 56 }) {
  return (
    <div style={{
      width: size, height: size, background: '#f1f2f3', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      ...(image ? { backgroundImage: `url(${image})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : {}),
    }}>
      {!image && BOX_ICON}
    </div>
  );
}

function GiftRow({ reward, currencySymbol }) {
  const isFree = reward.pricing === 'free';
  const price = Number(reward.product?.price) || 0;
  const money = `${currencySymbol}${price.toFixed(0)}`;
  return (
    <div className="cp-gift" data-testid="preview-reward-line">
      <span className={`cp-gift-badge${isFree ? '' : ' cp-gift-badge--reward'}`}>{GIFT_ICON}{isFree ? 'FREE GIFT' : 'REWARD'}</span>
      <Thumb image={reward.product?.image} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#064e3b', overflowWrap: 'anywhere' }}>{reward.product?.title || 'Reward product'}</div>
        <div style={{ fontSize: 11, color: '#047857' }}>Added for reaching your milestone</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
        {isFree ? (
          <>
            <span className="cp-gift-free">FREE</span>
            {price > 0 && <span className="cp-gift-old">{money}</span>}
          </>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: '#064e3b' }}>{price > 0 ? money : ''}</span>
        )}
      </div>
    </div>
  );
}

export default function PreviewCartItems({ baseTotal, added, rewards, currencySymbol, onRemove, onReset }) {
  const itemCount = 1 + added.length + rewards.length;
  return (
    <div style={{ padding: '10px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#6d7175', marginBottom: 10 }}>
        <span>Items included</span>
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
          <span>{itemCount} ITEMS</span>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid #f1f2f3' }}>
        <Thumb />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#202223' }}>Sample Product</div>
          <div style={{ fontSize: 12, color: '#6d7175' }}>{currencySymbol}{baseTotal} (1 × {currencySymbol}{baseTotal})</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
            <button style={{ width: 24, height: 24, border: '1px solid #c9cccf', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            <span style={{ fontSize: 13, fontWeight: 500 }}>1</span>
            <button style={{ width: 24, height: 24, border: '1px solid #c9cccf', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          </div>
        </div>
        <button style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#8c9196', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
      </div>

      {added.map((item) => {
        const price = Number(item.product.price) || 0;
        return (
          <div key={item.uid} data-testid="preview-added-line" style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid #f1f2f3' }}>
            <Thumb image={item.product.image} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#202223', overflowWrap: 'anywhere' }}>{item.product.title}</div>
              <div style={{ fontSize: 12, color: '#6d7175' }}>{currencySymbol}{price.toFixed(0)} (1 × {currencySymbol}{price.toFixed(0)})</div>
            </div>
            <button type="button" aria-label={`Remove ${item.product.title}`} onClick={(e) => { e.stopPropagation(); onRemove(item.uid); }} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#8c9196', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
          </div>
        );
      })}

      {rewards.map((reward) => <GiftRow key={reward.key} reward={reward} currencySymbol={currencySymbol} />)}
    </div>
  );
}
