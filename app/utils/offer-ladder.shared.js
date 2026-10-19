// Offer ladder (Coupon Banner → Coupon Selection → "Add an offer ladder"):
// an announcement-style bar of offers ("Buy any 2 Get 10% Off | Buy any 3
// Get 15% Off") with an optional subtext. Just text by default; two extras
// the merchant switches on:
//   - a button that copies a coupon code or applies it to the shopper's cart;
//   - auto-apply: each offer gets an item count and a code, and once the cart
//     holds enough items the storefront puts that code on the Shopify cart
//     (taking the ladder's other codes off, never the shopper's own codes).
//
// Stored like any banner item: its id ("ladder:<random>") in the selected
// list, its settings in the per-coupon style (temp<N>CouponStyle[id]).
//
// Everything between the begin/end markers is copied VERBATIM into
// extensions/cart-drawer/snippets/coupon-slider-render.liquid (ES5, no
// imports); tests/coupon-banner/offer-ladder.test.mjs fails if they differ.

/* offer-ladder:begin */
function createOfferLadder(){
  var LOOKS=['strip','ticker','rotate'];
  var SEPARATORS=['|','•','/','✦'];
  var ACTIONS=['copy','apply'];
  var DIRECTIONS=['row','column'];
  /* right = button at the right edge, center = text + button side by side in the middle, below = button under the text */
  var BUTTON_PLACES=['right','center','below'];
  /* full = the widget's width, atc = the theme's Add to cart button (width, and at least its height), custom = boxWidth px */
  var BOX_SIZES=['full','atc','custom'];
  /* plain = a rounded box; ticket = a coupon: half-circle cut-outs in the middle of both sides, and a right-hand stub (the button, else empty) behind a light strip */
  var SHAPES=['plain','ticket'];
  var ALIGNS=['center','left'];
  var MAX_TIERS=5;
  var DEFAULTS={look:'strip',separator:'|',interval:4,textSize:14,boxWidth:400,padY:10,padX:14,buttonText:{copy:'Copy code',apply:'Apply coupon'},buttonDoneText:{copy:'Copied!',apply:'Applied!'}};
  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function hex(v,d){return typeof v==='string'&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())?v.trim():d;}
  function num(v,min,max,d){var n=parseInt(v,10);return isFinite(n)?Math.max(min,Math.min(max,n)):d;}
  function text(v,max,d){var s=String(v==null?'':v).trim();return s?s.slice(0,max):d;}
  /* A code goes into /cart/update.js as a comma list: no commas, no line breaks. */
  function code(v){var c=String(v==null?'':v).trim();return c&&c.length<=255&&!/[,\r\n]/.test(c)?c:'';}
  function upper(v){return String(v||'').toUpperCase();}

  /* Saved per-coupon style → clean ladder. Offers keep the merchant's order. */
  function normalize(s){
    s=s||{};
    var tiers=[];
    (Array.isArray(s.tiers)?s.tiers:[]).forEach(function(t){
      if(!t||typeof t!=='object'||tiers.length>=MAX_TIERS)return;
      var label=text(t.text,80,''),q=parseInt(t.qty,10);
      if(!label)return;
      /* sub = a smaller line under this offer, e.g. "(On all Orders)" */
      tiers.push({text:label,sub:text(t.sub,60,''),qty:q>=1?Math.min(99,q):0,code:code(t.code)});
    });
    var action=ACTIONS.indexOf(s.buttonAction)!==-1?s.buttonAction:'copy';
    var btnCode=code(s.buttonCode);
    var shape=SHAPES.indexOf(s.shape)!==-1?s.shape:'plain';
    return {
      tiers:tiers,
      look:LOOKS.indexOf(s.look)!==-1?s.look:DEFAULTS.look,
      separator:SEPARATORS.indexOf(s.separator)!==-1?s.separator:DEFAULTS.separator,
      interval:num(s.interval,2,15,DEFAULTS.interval),
      textSize:num(s.textSize,11,24,DEFAULTS.textSize),
      radius:num(s.borderRadius,0,24,8),
      subtext:text(s.subtextText,120,''),
      direction:DIRECTIONS.indexOf(s.direction)!==-1?s.direction:'row',
      buttonPlace:BUTTON_PLACES.indexOf(s.buttonPlace)!==-1?s.buttonPlace:'right',
      boxSize:BOX_SIZES.indexOf(s.boxSize)!==-1?s.boxSize:'full',
      boxWidth:num(s.boxWidth,200,800,DEFAULTS.boxWidth),
      padY:num(s.padY,4,32,DEFAULTS.padY),
      padX:num(s.padX,6,40,DEFAULTS.padX),
      minHeight:num(s.minHeight,0,200,0),
      shape:shape,
      /* A ticket reads left-aligned unless the merchant picks centre. */
      align:ALIGNS.indexOf(s.align)!==-1?s.align:(shape==='ticket'?'left':'center'),
      autoApply:s.autoApply===true,
      /* A button needs a code to copy or apply. */
      button:s.buttonShow===true&&btnCode?{action:action,code:btnCode,text:text(s.buttonText,30,DEFAULTS.buttonText[action]),doneText:text(s.buttonDoneText,30,DEFAULTS.buttonDoneText[action])}:null,
      bg:hex(s.bgColor,'#111827'),
      fg:hex(s.textColor,'#ffffff'),
      accent:hex(s.accentColor,'#facc15')
    };
  }

  /* Items that count: every cart line except BRIX's free reward gifts. */
  function cartCount(cart){
    var n=0;
    (cart&&Array.isArray(cart.items)?cart.items:[]).forEach(function(it){
      if(!it||(it.properties&&it.properties._brixReward))return;
      n+=Math.max(0,parseInt(it.quantity,10)||0);
    });
    return n;
  }

  /* Auto-apply: the best offer (with an item count) the cart has reached. */
  function reached(L,count){
    var best=null;
    L.tiers.forEach(function(t){if(t.qty&&count>=t.qty&&(!best||t.qty>best.qty))best=t;});
    return best;
  }

  /* Codes the cart should carry for this count: the reached offer's code (if
     it has one) instead of any other code of this ladder; codes the shopper
     entered (or the ladder's button applied) stay. null = nothing to change. */
  function codesFor(L,count,cartCodes){
    if(!L.autoApply)return null;
    var own={};
    L.tiers.forEach(function(t){if(t.code&&t.qty)own[upper(t.code)]=true;});
    var current=(cartCodes||[]).filter(Boolean).map(String);
    var keep=current.filter(function(c){return !own[upper(c)];});
    var best=reached(L,count);
    var want=best&&best.code?keep.concat([best.code]):keep;
    var a=current.map(upper).sort().join(','),b=want.map(upper).sort().join(',');
    return a===b?null:want;
  }

  function tierHtml(t,cls){return '<span class="psl-tier'+(cls?' '+cls:'')+'">'+esc(t.text)+(t.sub?'<span class="psl-tier-sub">'+esc(t.sub)+'</span>':'')+'</span>';}
  function rowHtml(L){
    return L.tiers.map(function(t,i){return (i?'<span class="psl-sep" aria-hidden="true">'+esc(L.separator)+'</span>':'')+tierHtml(t);}).join('');
  }

  /* opts: show = index of the offer a rotating ladder is on, done = the button was tapped. */
  function html(L,opts){
    opts=opts||{};
    if(!L.tiers.length)return '';
    var body='';
    if(L.look==='ticker'){
      var chars=0;L.tiers.forEach(function(t){chars+=t.text.length+4;});
      var row=rowHtml(L)+'<span class="psl-sep" aria-hidden="true">'+esc(L.separator)+'</span>';
      body='<div class="psl-ticker"><div class="psl-move" style="animation-duration:'+Math.max(10,Math.round(chars*0.32))+'s"><span class="psl-run">'+row+'</span><span class="psl-run" aria-hidden="true">'+row+'</span></div></div>';
    }else if(L.look==='rotate'){
      var show=((parseInt(opts.show,10)||0)%L.tiers.length+L.tiers.length)%L.tiers.length;
      body='<div class="psl-rotate">'+L.tiers.map(function(t,i){return tierHtml(t,'psl-slide'+(i===show?' is-show':''));}).join('')+'</div>';
    }else{
      body='<div class="psl-row">'+rowHtml(L)+'</div>';
    }
    var b=L.button,btn='';
    if(b)btn='<button type="button" class="psl-btn'+(opts.done?' is-done':'')+'" data-psl-action="'+b.action+'" data-psl-code="'+esc(b.code)+'">'+esc(opts.done?b.doneText:b.text)+'</button>';
    var sub=L.subtext?'<div class="psl-sub">'+esc(L.subtext)+'</div>':'';
    var ticket=L.shape==='ticket';
    var cls='psl psl--'+L.look+' psl--size-'+L.boxSize+(L.look==='strip'&&L.direction==='column'?' psl--col':'')+(b&&!ticket?' psl--btn psl--btn-'+L.buttonPlace:'')+(ticket?' psl--ticket':'')+(L.align==='left'?' psl--left':'');
    var box='--psl-py:'+L.padY+'px;--psl-px:'+L.padX+'px;'+(L.minHeight?'--psl-mh:'+L.minHeight+'px;':'')+(L.boxSize==='custom'?'max-width:'+L.boxWidth+'px;':'');
    /* A ticket's button sits in its stub, right of the strip. */
    return '<div class="'+cls+'" style="--psl-bg:'+L.bg+';--psl-fg:'+L.fg+';--psl-accent:'+L.accent+';--psl-fs:'+L.textSize+'px;--psl-r:'+L.radius+'px;'+box+'">'
      +'<div class="psl-main"><div class="psl-offers">'+body+sub+'</div>'+(ticket?'':btn)+'</div>'
      +(ticket?'<div class="psl-stub'+(b?' psl-stub--btn':'')+'">'+btn+'</div>':'')+'</div>';
  }

  var css=''
    +'.psl{background:var(--psl-bg);color:var(--psl-fg);border-radius:var(--psl-r);padding:var(--psl-py,10px) var(--psl-px,14px);min-height:var(--psl-mh,0px);display:flex;flex-direction:column;justify-content:center;font-size:var(--psl-fs);line-height:1.35;box-sizing:border-box;width:100%;overflow:hidden;text-align:center}'
    +'.psl--size-atc{min-height:max(var(--psl-mh,0px),var(--psl-atc-h,0px))}'
    +'.psl *{box-sizing:border-box}'
    +'.psl-main{display:flex;align-items:center;justify-content:center;gap:8px 12px;flex-wrap:wrap}'
    +'.psl-offers{flex:1 1 220px;min-width:0}'
    +'.psl--btn-center .psl-offers{flex:0 1 auto}'
    +'.psl--btn-below .psl-main{flex-direction:column}'
    +'.psl--btn-below .psl-offers{flex:none;width:100%}'
    +'.psl--col .psl-row{flex-direction:column;gap:4px}'
    +'.psl--col .psl-row>.psl-sep{display:none}'
    +'.psl-row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px 10px;font-weight:700}'
    +'.psl-sep{opacity:.45;font-weight:400}'
    +'.psl-tier{display:inline-flex;flex-direction:column;align-items:center;white-space:normal;overflow-wrap:anywhere}'
    +'.psl-tier-sub{display:block;font-size:.78em;font-weight:500;opacity:.92;line-height:1.3}'
    +'.psl-run .psl-tier{flex-direction:row;align-items:baseline;gap:6px}'
    +'.psl--left{text-align:left}'
    +'.psl--left .psl-main,.psl--left .psl-row{justify-content:flex-start}'
    +'.psl--left .psl-tier,.psl--left.psl--col .psl-row{align-items:flex-start}'
    +'.psl--col .psl-row{gap:8px}'
    /* Two full-size layers kept where both are (intersect): half-width layers left a nick where they met. */
    +'.psl--ticket{--psl-notch:11px;flex-direction:row;align-items:stretch;padding:0;-webkit-mask:radial-gradient(circle at 0 50%,transparent var(--psl-notch),#000 calc(var(--psl-notch) + .5px)),radial-gradient(circle at 100% 50%,transparent var(--psl-notch),#000 calc(var(--psl-notch) + .5px));-webkit-mask-composite:source-in;mask:radial-gradient(circle at 0 50%,transparent var(--psl-notch),#000 calc(var(--psl-notch) + .5px)),radial-gradient(circle at 100% 50%,transparent var(--psl-notch),#000 calc(var(--psl-notch) + .5px));mask-composite:intersect}'
    +'.psl--ticket>.psl-main{flex:1 1 auto;min-width:0;padding:var(--psl-py,10px) 10px var(--psl-py,10px) calc(var(--psl-px,14px) + var(--psl-notch))}'
    /* Empty stub: about a quarter of the ticket (less on phones); with a button, as wide as the button needs.
       .psl> outranks themes' div:empty{display:none} (Dawn and copies), which hid the empty stub and its strip. */
    +'.psl>.psl-stub{flex:0 0 auto;width:clamp(48px,26%,240px);display:flex;align-items:center;justify-content:center;padding:var(--psl-py,10px) calc(var(--psl-px,14px) + var(--psl-notch)) var(--psl-py,10px) 10px;border-left:clamp(10px,3.5vw,22px) solid rgba(255,255,255,.32)}'
    +'.psl>.psl-stub--btn{width:auto;min-width:clamp(48px,26%,240px)}'
    +'.psl-stub .psl-btn{white-space:nowrap}'
    +'.psl-ticker{overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent);mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent)}'
    +'.psl-move{display:inline-flex;font-weight:700;animation:psl-scroll linear infinite;will-change:transform}'
    +'.psl-run{display:inline-flex;align-items:center;gap:10px;padding-right:10px;flex-shrink:0}'
    +'.psl-run .psl-tier{white-space:nowrap}'
    +'.psl:hover .psl-move{animation-play-state:paused}'
    +'@keyframes psl-scroll{to{transform:translateX(-50%)}}'
    +'.psl-rotate{font-weight:700;min-height:1.4em}'
    +'.psl-slide{display:none}'
    +'.psl-slide.is-show{display:inline-flex;animation:psl-in .35s ease}'
    +'@keyframes psl-in{from{opacity:0;transform:translateY(6px)}}'
    +'.psl-sub{opacity:.75;font-size:.85em;margin-top:4px}'
    +'.psl-btn{flex:0 0 auto;background:var(--psl-accent);color:var(--psl-bg);border:none;border-radius:999px;padding:7px 16px;font:inherit;font-size:.86em;font-weight:700;line-height:1.2;cursor:pointer;max-width:100%;white-space:normal;overflow-wrap:anywhere}'
    +'.psl-btn:hover{filter:brightness(1.06)}'
    +'.psl-btn:disabled{opacity:.7;cursor:default}'
    +'@media (prefers-reduced-motion:reduce){.psl-move{animation:none;white-space:normal;flex-wrap:wrap;justify-content:center;width:100%}.psl-run[aria-hidden]{display:none}.psl-run{flex-wrap:wrap;justify-content:center;flex-shrink:1}.psl-run>.psl-sep:last-child{display:none}.psl-ticker{-webkit-mask-image:none;mask-image:none;white-space:normal}.psl-slide.is-show{animation:none}}';

  return {LOOKS:LOOKS,SEPARATORS:SEPARATORS,ACTIONS:ACTIONS,DIRECTIONS:DIRECTIONS,BUTTON_PLACES:BUTTON_PLACES,BOX_SIZES:BOX_SIZES,SHAPES:SHAPES,ALIGNS:ALIGNS,MAX_TIERS:MAX_TIERS,DEFAULTS:DEFAULTS,normalize:normalize,cartCount:cartCount,reached:reached,codesFor:codesFor,html:html,css:css};
}
/* offer-ladder:end */

export { createOfferLadder };
export const offerLadder = createOfferLadder();

export const isLadderId = (id) => typeof id === "string" && id.indexOf("ladder:") === 0;
export const newLadderId = () => "ladder:" + Math.random().toString(36).slice(2, 10);

// A new ladder: two offers, plain text, dark announcement colours.
export const NEW_LADDER_STYLE = {
    tiers: [
        { text: "Buy any 2 Get 10% Off", qty: 2, code: "" },
        { text: "Buy any 3 Get 15% Off", qty: 3, code: "" },
    ],
    look: "strip",
    separator: "|",
    bgColor: "#111827",
    textColor: "#ffffff",
    accentColor: "#facc15",
};

// Keys a ladder saves in its per-coupon style (besides subtextText and the colours).
export const LADDER_STYLE_KEYS = ["tiers", "look", "separator", "interval", "textSize", "direction", "buttonPlace", "boxSize", "boxWidth", "padY", "padX", "minHeight", "shape", "align", "autoApply", "buttonShow", "buttonAction", "buttonCode", "buttonText", "buttonDoneText"];
