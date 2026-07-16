export function BundleStackMock() {
  return (
    <div className="cn-bundle" aria-hidden="true">
      <style>{`
.cn-bundle{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);
  border-radius:14px;padding:14px 16px;backdrop-filter:blur(4px)}
.cn-bundle-card{width:60px;background:#fff;border-radius:10px;padding:7px;box-shadow:0 8px 18px rgba(8,11,40,.22)}
.cn-bundle-thumb{height:38px;border-radius:7px;background:#fff;overflow:hidden}
.cn-bundle-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.cn-bundle-line{height:5px;border-radius:999px;background:#ece9f6;margin-top:6px}
.cn-bundle-line.short{width:60%}
.cn-bundle-op{color:#fff;font-size:16px;font-weight:700;opacity:.9}
.cn-bundle-price{display:flex;flex-direction:column;align-items:flex-start;color:#fff;padding-left:2px}
.cn-bundle-price small{font-size:9.5px;letter-spacing:.5px;text-transform:uppercase;opacity:.8}
.cn-bundle-price b{font-size:18px;font-weight:700;line-height:1.1}
.cn-bundle-price s{font-size:11px;opacity:.7}
      `}</style>
      <div className="cn-bundle-card">
        <div className="cn-bundle-thumb"><img src="/bundle-thumb-1.jpg" alt="" /></div>
        <div className="cn-bundle-line" />
        <div className="cn-bundle-line short" />
      </div>
      <span className="cn-bundle-op">+</span>
      <div className="cn-bundle-card">
        <div className="cn-bundle-thumb"><img src="/bundle-thumb-2.jpg" alt="" /></div>
        <div className="cn-bundle-line" />
        <div className="cn-bundle-line short" />
      </div>
      <span className="cn-bundle-op">+</span>
      <div className="cn-bundle-card">
        <div className="cn-bundle-thumb"><img src="/bundle-thumb-3.jpg" alt="" /></div>
        <div className="cn-bundle-line" />
        <div className="cn-bundle-line short" />
      </div>
      <span className="cn-bundle-op">=</span>
      <div className="cn-bundle-price">
        <small>Bundle</small>
        <b>$64</b>
        <s>$96</s>
      </div>
    </div>
  );
}
