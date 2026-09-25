import { useState, useEffect } from 'react';

// The product list inside every "select products" modal (reward products,
// upsell trigger / offer products, FBT trigger / offer products): a search box,
// a live "N selected" pill, Select all / Deselect all / Clear buttons and a
// grid of product cards. The parent modal keeps owning the selection state,
// loading and saving — this only renders the list and edits `selectedIds`.
//
// `resetKey` (e.g. the modal's `open` flag) clears the search box each time the
// modal is reopened.

const CSS = `
.rpm{display:flex;flex-direction:column;gap:14px}
.rpm-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rpm-search{flex:1;min-width:160px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #c9cccf;border-radius:10px;background:#fff;color:#6d7175;transition:border-color .15s,box-shadow .15s}
.rpm-search:focus-within{border-color:#2c6ecb;box-shadow:0 0 0 3px rgba(44,110,203,.15)}
.rpm-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font:inherit;font-size:14px;padding:9px 0;color:#202223}
.rpm-count{flex-shrink:0;padding:4px 12px;border-radius:999px;background:#f1f2f3;color:#6d7175;font-size:12px;font-weight:650}
.rpm-count[data-active="true"]{background:#e3f1df;color:#0c5132}
.rpm-btn{flex-shrink:0;border:1px solid #c9cccf;background:#fff;color:#202223;font:inherit;font-size:13px;font-weight:600;padding:6px 14px;border-radius:999px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,transform .15s}
.rpm-btn:hover:not(:disabled){background:#f6f6f7;border-color:#b5bac0;transform:translateY(-1px)}
.rpm-btn:focus-visible{outline:2px solid #2c6ecb;outline-offset:2px}
.rpm-btn:disabled{opacity:.5;cursor:default}
.rpm-btn--quiet{color:#8e1f0b;border-color:#f0c4bd;background:#fff8f7}
.rpm-btn--quiet:hover:not(:disabled){background:#fdeceb;border-color:#e8a79d}
.rpm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;max-height:420px;overflow-y:auto;padding:4px}
.rpm-card{position:relative;display:flex;flex-direction:column;gap:4px;text-align:left;font:inherit;background:#fff;border:1.5px solid #e1e3e5;border-radius:14px;padding:8px 8px 10px;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s}
.rpm-card:hover{border-color:#b5bac0;transform:translateY(-1px);box-shadow:0 4px 12px rgba(16,24,40,.08)}
.rpm-card:focus-visible{outline:2px solid #2c6ecb;outline-offset:2px}
.rpm-card[data-selected="true"]{border-color:#2c6ecb;background:#f5f9ff;box-shadow:0 0 0 3px rgba(44,110,203,.16)}
.rpm-img{position:relative;display:block;width:100%;aspect-ratio:1/1;border-radius:10px;background:#f1f2f3 center/cover no-repeat;overflow:hidden}
.rpm-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#a3a8ae}
.rpm-check{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:#fff;border:1.5px solid #c9cccf;color:transparent;display:flex;align-items:center;justify-content:center;transition:all .15s}
.rpm-card[data-selected="true"] .rpm-check{background:#2c6ecb;border-color:#2c6ecb;color:#fff}
.rpm-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;font-weight:650;color:#202223;line-height:1.3;margin-top:4px}
.rpm-price{font-size:12px;color:#6d7175}
.rpm-none{margin:12px 0;text-align:center;color:#6d7175;font-size:13px}
`;

// eslint-disable-next-line react/prop-types
export default function ProductPickerBody({ products, selectedIds, setSelectedIds, currencySymbol = '', resetKey }) {
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); }, [resetKey]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? products.filter((p) => String(p.title || '').toLowerCase().includes(needle)) : products;
  const toggle = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // "Select all" acts on what is shown, so a search narrows what it picks.
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selectedIds.includes(p.id));
  const toggleAllVisible = () => {
    const visibleIds = visible.map((p) => p.id);
    setSelectedIds((prev) => (allVisibleSelected
      ? prev.filter((id) => !visibleIds.includes(id))
      : [...prev, ...visibleIds.filter((id) => !prev.includes(id))]));
  };

  return (
    <div className="rpm">
      <style>{CSS}</style>
      <div className="rpm-bar">
        <div className="rpm-search">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8 3a5 5 0 103.05 8.96l3.49 3.5a.75.75 0 101.06-1.06l-3.5-3.49A5 5 0 008 3zM4.5 8a3.5 3.5 0 116.99.2A3.5 3.5 0 014.5 8z" clipRule="evenodd" /></svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" />
        </div>
        <span className="rpm-count" data-active={selectedIds.length > 0}>{selectedIds.length} selected</span>
        <button type="button" className="rpm-btn" onClick={toggleAllVisible} disabled={visible.length === 0}>
          {allVisibleSelected ? 'Deselect all' : needle ? 'Select all shown' : 'Select all'}
        </button>
        {selectedIds.length > 0 && (
          <button type="button" className="rpm-btn rpm-btn--quiet" onClick={() => setSelectedIds([])}>Clear</button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="rpm-none">No products match "{query}".</p>
      ) : (
        <div className="rpm-grid">
          {visible.map((product) => {
            const isSelected = selectedIds.includes(product.id);
            return (
              <button type="button" key={product.id} className="rpm-card" data-selected={isSelected} aria-pressed={isSelected} onClick={() => toggle(product.id)}>
                <span className="rpm-img" style={product.image ? { backgroundImage: `url("${product.image}")` } : undefined}>
                  {!product.image && <span className="rpm-ph">{(product.title || '?').charAt(0).toUpperCase()}</span>}
                  <span className="rpm-check" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9" /></svg>
                  </span>
                </span>
                <span className="rpm-title">{product.title}</span>
                <span className="rpm-price">{currencySymbol}{product.price}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
