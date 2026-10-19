// FBT widget (<ps-fbt-widget>, rendered by snippets/fbt-widget-render.liquid).
// Kept out of the snippet: a theme app extension's Liquid may total at most
// 100 KB, and this script has no Liquid in it (the snippet passes everything
// as data-* attributes).
(function(){
  if(customElements.get('ps-fbt-widget'))return;

  /* Downloads shared by every copy of the widget for this page visit. Themes
     that re-render the product section on a size change (Dawn and its kin)
     throw the widget away and create a new one; with these it draws again at
     once instead of hiding, re-downloading and popping back in. Stock and
     prices are kept 60 s; the Add button always checks stock fresh. */
  var CACHE=window.__brixFbtCache||(window.__brixFbtCache={});
  function cachedJson(url,ttl){
    var hit=CACHE[url];
    if(hit&&Date.now()-hit.at<(ttl||60000))return hit.promise;
    var promise=fetch(url,{headers:{Accept:'application/json'}}).then(function(r){if(!r.ok)throw new Error('http '+r.status);return r.json();});
    CACHE[url]={at:Date.now(),promise:promise};
    promise.catch(function(){if(CACHE[url]&&CACHE[url].promise===promise)delete CACHE[url];});
    return promise;
  }

  /* Placeholder cards while the products load, shaped like the widget that's
     coming: the real heading, cards (picture, title, price, button) or list
     rows, and the total + Add bar. The grey blocks are spans styled as blocks
     with !important: themes such as Dawn hide every empty div (div:empty),
     which left only a white box. */
  function renderSkeleton(el,config,count,isList){
    if(!document.getElementById('ps-fbt-skel-css')){
      var st=document.createElement('style');st.id='ps-fbt-skel-css';
      st.textContent='@keyframes ps-fbt-shimmer{0%{background-position:150% 0}100%{background-position:-50% 0}}'
        +'.ps-fbt-skel{display:block!important;visibility:visible!important;background-color:#e6e8ec!important;background-image:linear-gradient(100deg,rgba(255,255,255,0) 30%,rgba(255,255,255,.75) 50%,rgba(255,255,255,0) 70%)!important;background-size:200% 100%!important;background-repeat:no-repeat!important;animation:ps-fbt-shimmer 1.2s ease-in-out infinite;border-radius:6px;}'
        +'@media (prefers-reduced-motion:reduce){.ps-fbt-skel{animation:none}}';
      document.head.appendChild(st);
    }
    var bar=function(css){return '<span class="ps-fbt-skel" aria-hidden="true" style="'+css+'"></span>';};
    var n=Math.max(1,Math.min(count,isList?3:4));
    var cards='';
    for(var i=0;i<n;i++){
      cards+=isList
        ?'<span style="display:flex!important;align-items:center;gap:'+fbtGap(config.imageTextGap,12)+'px;padding:'+(config.cardPadding+2)+'px 4px;'+(i<n-1?'border-bottom:1px solid '+config.borderColor+';':'')+'">'
          +bar('width:'+Math.round(config.imageSize*0.75)+'px;height:'+Math.round(config.imageSize*0.75)+'px;flex-shrink:0;border-radius:'+config.imageRadius+'px;')
          +'<span style="display:block!important;flex:1;min-width:0;">'+bar('height:12px;width:75%;')+bar('height:12px;width:45%;margin-top:8px;')+'</span>'
          +bar('width:58px;height:28px;flex-shrink:0;')+'</span>'
        :'<span style="display:flex!important;flex-direction:column;align-items:center;gap:'+fbtGap(config.imageTextGap,8)+'px;flex:0 0 '+config.cardWidth+'px;width:'+config.cardWidth+'px;padding:'+config.cardPadding+'px;border:1px solid '+config.borderColor+';border-radius:'+config.borderRadius+'px;box-sizing:border-box;background:'+config.bgColor+';">'
          +bar('width:100%;height:'+config.imageSize+'px;border-radius:'+config.imageRadius+'px;')
          +bar('height:11px;width:85%;')+bar('height:11px;width:55%;')
          +bar('height:13px;width:40%;margin-top:2px;')
          +bar('height:26px;width:60%;margin-top:4px;')+'</span>';
    }
    el.innerHTML='<div class="ps-fbt-wrapper" aria-busy="true" aria-label="Loading suggestions" style="background:'+config.bgColor+';border-radius:'+config.borderRadius+'px;border:1px solid '+config.borderColor+';padding:var(--ps-fbt-pad,'+config.widgetPadding+'px);">'
      +'<div class="ps-fbt-title" style="color:'+config.headingColor+';letter-spacing:-0.5px;margin-bottom:16px;">Frequently Bought Together</div>'
      +'<span style="display:flex!important;'+(isList?'flex-direction:column;gap:'+config.rowGap+'px;':'gap:'+config.gap+'px;overflow:hidden;')+'">'+cards+'</span>'
      +'<span style="display:flex!important;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid '+config.borderColor+';">'
        +'<span style="display:block!important;">'+bar('height:10px;width:70px;')+bar('height:18px;width:90px;margin-top:6px;')+'</span>'
        +bar('height:40px;width:150px;border-radius:999px;')+'</span>'
      +'</div>';
  }

  // Drawn checkmark (the text glyph renders thin and uneven across fonts).
  function checkIcon(size,gap){
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="display:inline-block;vertical-align:-0.15em;flex-shrink:0;'+(gap?'margin-right:'+gap+'px;':'')+'"><path d="M3.5 8.4l2.9 2.9 6.1-6.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function getCurrencySymbol(code){
    var symbols={USD:'$',EUR:'€',GBP:'£',INR:'₹',JPY:'¥',AUD:'A$',CAD:'C$',CHF:'CHF',CNY:'¥',SEK:'kr',NZD:'NZ$',MXN:'$',SGD:'S$',HKD:'HK$',NOK:'kr',KRW:'₩',TRY:'₺',RUB:'₽',BRL:'R$',ZAR:'R',THB:'฿',MYR:'RM',PHP:'₱',IDR:'Rp',VND:'₫',KES:'KSh',NGN:'₦',PKR:'₨',BDT:'৳',AED:'د.إ',SAR:'﷼',QAR:'﷼'};
    return symbols[code]||code;
  }

  function normalizeRules(source){
    var parsed=source;
    if(typeof parsed==='string'){try{parsed=JSON.parse(parsed);}catch(e){parsed=[];}}
    if(!Array.isArray(parsed))return[];
    return parsed.filter(function(r){return r&&typeof r==='object';}).map(function(rule,i){
      /* offer: only on rules the BRIX server confirmed live at checkout (fbt-offer-shopify.server.js). */
      var offer=rule.offer&&typeof rule.offer==='object'&&(rule.offer.type==='percentage'||rule.offer.type==='fixed_amount')&&Number(rule.offer.value)>0?{type:rule.offer.type,value:Number(rule.offer.value),text:String(rule.offer.text||''),min:Math.floor(Number(rule.offer.min))>=2?Math.min(20,Math.floor(Number(rule.offer.min))):0}:null;
      return{id:rule.id||rule.ruleId||('rule-'+i),displayScope:rule.displayScope||'all',triggerProducts:Array.isArray(rule.triggerProducts)?rule.triggerProducts:[],triggerProductId:rule.triggerProductId||null,fbtProducts:Array.isArray(rule.fbtProducts)?rule.fbtProducts:[],backupProducts:Array.isArray(rule.backupProducts)?rule.backupProducts:[],offer:offer};
    }).filter(function(r){return r.fbtProducts.length>0;});
  }

  /* #rgb / #rrggbb → #rrggbb, else null. */
  function fbtHex(v){
    var m=typeof v==='string'&&v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if(!m)return null;
    var h=m[1].toLowerCase();
    return'#'+(h.length===3?h.replace(/(.)/g,'$1$1'):h);
  }
  function fbtDarken(hex){
    var h=fbtHex(hex);if(!h)return hex;
    var n=parseInt(h.slice(1),16);
    return'#'+[16,8,0].map(function(sh){var c=Math.max(0,Math.round(((n>>sh)&255)*0.88));return(c<16?'0':'')+c.toString(16);}).join('');
  }

  /* Heading / title / hover / selected / loading / success colours: an
     empty value follows a base colour, so widgets saved before these
     existed look the same. Same rules as app/utils/fbt-style.shared.js. */
  /* "Buy all {count} together and save {discount}" (app/utils/fbt-offer.shared.js fbtOfferText). */
  function fbtOfferText(offer,symbol){
    var v=Number(offer.value);
    var discount=offer.type==='percentage'?v+'%':symbol+(v%1===0?String(v):window.__brixWholePrices===true?String(Math.round(v)):v.toFixed(2));
    return String(offer.text||'Buy all {count} together and save {discount}').replace(/\{\{?\s*count\s*\}?\}/g,String(offer.count)).replace(/\{\{?\s*discount\s*\}?\}/g,discount);
  }

  /* Image and spacing settings (app/utils/fbt-style.shared.js pickFbtLayout): bad or missing = what the widget always drew. */
  function fbtGap(v,def){return v===null||v===undefined?def:v;}
  function fbtNum(v,def,min,max){if(v===''||v===null||v===undefined)return def;var n=Math.round(Number(v));return isFinite(n)?Math.max(min,Math.min(max,n)):def;}
  function normalizeConfig(config,currencySymbol){
    if(!config||typeof config!=='object')return null;
    var br=Number(config.borderRadius);
    var rawLayout=config.layout;
    var normalizedLayout=rawLayout==='horizontal'?'carousel':(rawLayout||'carousel');
    var textColor=config.textColor||'#111827';
    var buttonColor=config.buttonColor||'#111827';
    var buttonTextColor=config.buttonTextColor||config.buttonText||'#ffffff';
    return{layout:normalizedLayout,interactionType:config.interactionType||'classic',bgColor:config.bgColor||'#ffffff',textColor:textColor,priceColor:config.priceColor||'#059669',buttonColor:buttonColor,buttonTextColor:buttonTextColor,borderColor:config.borderColor||'#e5e7eb',borderRadius:Number.isFinite(br)?br:8,showPrices:config.showPrices!==false,showAddAllButton:config.showAddAllButton!==false,currencySymbol:currencySymbol,
      headingColor:fbtHex(config.headingColor)||textColor,
      titleColor:fbtHex(config.titleColor)||textColor,
      buttonHoverColor:fbtHex(config.buttonHoverColor)||fbtDarken(buttonColor),
      selectedBgColor:fbtHex(config.selectedBgColor)||'#008060',
      selectedTextColor:fbtHex(config.selectedTextColor)||'#ffffff',
      checkboxColor:fbtHex(config.checkboxColor)||buttonColor,
      loadingBgColor:fbtHex(config.loadingBgColor)||buttonColor,
      successBgColor:fbtHex(config.successBgColor)||buttonColor,
      successTextColor:fbtHex(config.successTextColor)||buttonTextColor,
      imageSize:fbtNum(config.imageSize,64,40,200),
      imageFit:config.imageFit==='cover'?'cover':'contain',
      imageRadius:fbtNum(config.imageRadius,8,0,100),
      imageBg:fbtHex(config.imageBg)||'',
      cardWidth:fbtNum(config.cardWidth,140,100,280),
      gap:fbtNum(config.gap,10,0,40),
      cardPadding:fbtNum(config.cardPadding,10,0,30),
      widgetPadding:fbtNum(config.widgetPadding,20,0,48),
      startSelected:config.startSelected===true?true:config.startSelected===false?false:null,
      marginTop:fbtNum(config.marginTop,16,0,80),
      marginBottom:fbtNum(config.marginBottom,16,0,80),
      /* Inside each product (null = the old 8 / 12 px image to text, 4 / 2 px title to price) and between list rows. */
      imageTextGap:fbtNum(config.imageTextGap,null,0,40),
      textGap:fbtNum(config.textGap,null,0,24),
      rowGap:fbtNum(config.rowGap,0,0,40),
      /* A tap on a product's image opens all its pictures (openFbtGallery); off only when saved false. */
      imagePopup:config.imagePopup!==false,
      /* "Buy all together" text look (app/utils/fbt-style.shared.js pickFbtOfferStyle); '' = price colour / its tint. */
      offerTextColor:fbtHex(config.offerTextColor)||'',
      offerBgColor:fbtHex(config.offerBgColor)||'',
      offerFontSize:fbtNum(config.offerFontSize,13,10,24),
      offerFontWeight:[400,500,600,700,800].indexOf(Number(config.offerFontWeight))!==-1?Number(config.offerFontWeight):700,
      offerItalic:config.offerItalic===true,
      /* With the offer live and the whole set picked (app/utils/fbt-style.shared.js pickFbtOfferStyle). */
      offerShowSavings:config.offerShowSavings===true,
      offerStrikeTotal:config.offerStrikeTotal===true,
      offerProductPrices:config.offerProductPrices===true,
      showVariantPicker:config.showVariantPicker===true,
      /* "Match the shopper's size": saved live only in AI-Powered mode (sizeMatchLive). */
      sizeMatch:config.sizeMatchLive===true,
      sizeMatchMissing:config.sizeMatchMissing==='note'||config.sizeMatchMissing==='hide'?config.sizeMatchMissing:'replace',
      sizeMatchOption:typeof config.sizeMatchOption==='string'?config.sizeMatchOption.trim().slice(0,40):'',
      offerAlign:['left','center','right'].indexOf(config.offerAlign)!==-1?config.offerAlign:'center',
      offerFontFamily:typeof config.offerFontFamily==='string'&&config.offerFontFamily!=='inherit'&&/^[A-Za-z0-9 -]{1,40}$/.test(config.offerFontFamily.trim())?config.offerFontFamily.trim():''};
  }

  /* The offer text's inline style; a Google font is loaded once when chosen. */
  function fbtOfferCss(config){
    var family=config.offerFontFamily;
    if(family&&!document.getElementById('ps-fbt-font-'+family.replace(/[^a-z0-9]/gi,'-'))){
      var link=document.createElement('link');link.id='ps-fbt-font-'+family.replace(/[^a-z0-9]/gi,'-');link.rel='stylesheet';
      link.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(family)+':wght@400;500;600;700;800&display=swap';
      document.head.appendChild(link);
    }
    return 'background:'+(config.offerBgColor||config.priceColor+'14')+';color:'+(config.offerTextColor||config.priceColor)+';font-size:'+config.offerFontSize+'px;font-weight:'+config.offerFontWeight+';font-style:'+(config.offerItalic?'italic':'normal')+';text-align:'+config.offerAlign+';'+(family?"font-family:'"+family+"',sans-serif;":'');
  }

  function toPriceNumber(v){var p=parseFloat(v);return isNaN(p)?0:p;}

  function escapeHtml(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  /* Styling → "Open pictures on image tap" (imagePopup): a popup with every
     picture of the product (/products/<handle>.js, shared cache), a big one
     with arrows / swipe / ← →, thumbnails, title, price and a link to the
     product. Shows the card's picture at once; phones get a bottom sheet. */
  function fbtImgUrl(u,w){
    u=String(u||'');if(!u)return '';
    if(u.indexOf('//')===0)u='https:'+u;
    if(!/cdn\.shopify\.com|\/cdn\/shop\//.test(u))return u;
    u=u.replace(/([?&])width=\d+&?/,'$1').replace(/[?&]$/,'');
    return u+(u.indexOf('?')===-1?'?':'&')+'width='+w;
  }
  /* Same picture whatever the domain (cdn.shopify.com or the shop's /cdn/shop) or size suffix. */
  function fbtImgKey(u){return String(u||'').split('?')[0].split('/').pop().replace(/_\d*x\d*(?=\.)/,'').toLowerCase();}
  function openFbtGallery(o){
    var config=o.config;
    var old=document.getElementById('ps-fbt-pop');if(old&&old.parentNode)old.parentNode.removeChild(old);
    if(!document.getElementById('ps-fbt-pop-css')){
      var st=document.createElement('style');st.id='ps-fbt-pop-css';
      st.textContent='#ps-fbt-pop{position:fixed;inset:0;z-index:2147483000;display:flex!important;align-items:center;justify-content:center;background:rgba(17,24,39,.55);padding:16px;box-sizing:border-box;animation:ps-fbt-pop-in .15s ease-out}'
        +'@keyframes ps-fbt-pop-in{from{opacity:0}to{opacity:1}}'
        +'#ps-fbt-pop .ps-fbt-pop-panel{position:relative;display:flex;flex-direction:column;width:100%;max-width:560px;max-height:calc(100vh - 32px);overflow:auto;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.3);box-sizing:border-box;padding:16px}'
        +'#ps-fbt-pop .ps-fbt-pop-main{position:relative;display:flex!important;align-items:center;justify-content:center;width:100%;aspect-ratio:1/1;max-height:62vh;border-radius:10px;overflow:hidden;touch-action:pan-y}'
        +'#ps-fbt-pop .ps-fbt-pop-main img{width:100%;height:100%;object-fit:contain;display:block}'
        +'#ps-fbt-pop button{font:inherit;margin:0;min-width:0;min-height:0;box-shadow:none;text-transform:none;letter-spacing:normal}'
        +'#ps-fbt-pop .ps-fbt-pop-arrow{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.92);color:#111827;box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}'
        +'#ps-fbt-pop .ps-fbt-pop-prev{left:8px}#ps-fbt-pop .ps-fbt-pop-next{right:8px}'
        +'#ps-fbt-pop .ps-fbt-pop-count{position:absolute;bottom:8px;right:8px;padding:2px 8px;border-radius:10px;background:rgba(17,24,39,.6);color:#fff;font-size:11px;font-weight:600}'
        +'#ps-fbt-pop .ps-fbt-pop-close{position:absolute;top:8px;right:8px;z-index:2;width:34px;height:34px;border-radius:50%;border:none;background:rgba(255,255,255,.95);color:#111827;box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}'
        +'#ps-fbt-pop .ps-fbt-pop-thumbs{display:flex!important;gap:8px;overflow-x:auto;margin-top:10px;padding-bottom:2px;scrollbar-width:thin}'
        +'#ps-fbt-pop .ps-fbt-pop-thumb{flex:0 0 56px;width:56px;height:56px;padding:0;border-radius:8px;overflow:hidden;cursor:pointer;background:transparent;border:2px solid transparent}'
        +'#ps-fbt-pop .ps-fbt-pop-thumb img{width:100%;height:100%;object-fit:cover;display:block}'
        +'#ps-fbt-pop .ps-fbt-pop-title{margin:12px 0 0;font-size:16px;font-weight:700;line-height:1.35}'
        +'#ps-fbt-pop .ps-fbt-pop-price{margin-top:4px;font-size:15px;font-weight:700}'
        +'#ps-fbt-pop .ps-fbt-pop-link{display:inline-block;margin-top:10px;font-size:13px;font-weight:600;text-decoration:underline}'
        +'@media (max-width:640px){#ps-fbt-pop{align-items:flex-end;padding:0}#ps-fbt-pop .ps-fbt-pop-panel{max-width:none;border-radius:16px 16px 0 0;max-height:92vh;padding:14px 14px calc(14px + env(safe-area-inset-bottom))}#ps-fbt-pop .ps-fbt-pop-main{max-height:52vh}}'
        +'@media (prefers-reduced-motion:reduce){#ps-fbt-pop{animation:none}}';
      document.head.appendChild(st);
    }
    var images=[],idx=0;
    function addImage(u){if(!u)return;var k=fbtImgKey(u);for(var i=0;i<images.length;i++)if(fbtImgKey(images[i])===k)return;images.push(u);}
    addImage(o.image);
    var arrow=function(d){return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(d<0?'M15 18l-6-6 6-6':'M9 18l6-6-6-6')+'"/></svg>';};
    var root=(window.Shopify&&window.Shopify.routes&&window.Shopify.routes.root)||'/';
    var pop=document.createElement('div');pop.id='ps-fbt-pop';
    pop.setAttribute('role','dialog');pop.setAttribute('aria-modal','true');
    pop.innerHTML='<div class="ps-fbt-pop-panel" style="background:'+config.bgColor+';color:'+config.textColor+';">'
      +'<button type="button" class="ps-fbt-pop-close" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
      +'<div class="ps-fbt-pop-main" style="background:'+(config.imageBg||config.borderColor+'22')+';"></div>'
      +'<div class="ps-fbt-pop-thumbs"></div>'
      +'<div class="ps-fbt-pop-title" style="color:'+config.titleColor+';">'+(o.title||'')+'</div>'
      +(o.priceHtml?'<div class="ps-fbt-pop-price" style="color:'+config.priceColor+';">'+o.priceHtml+'</div>':'')
      +(o.handle?'<a class="ps-fbt-pop-link" style="color:'+config.textColor+';" href="'+root.replace(/\/?$/,'/')+'products/'+encodeURIComponent(o.handle)+'">View full details</a>':'')
      +'</div>';
    var main=pop.querySelector('.ps-fbt-pop-main'),thumbs=pop.querySelector('.ps-fbt-pop-thumbs');
    pop.setAttribute('aria-label',pop.querySelector('.ps-fbt-pop-title').textContent||'Product pictures');
    function draw(){
      if(!images.length){main.innerHTML='<span style="font-size:12px;color:#9ca3af;">No image</span>';thumbs.style.display='none';return;}
      idx=(idx+images.length)%images.length;
      var many=images.length>1;
      main.innerHTML='<img src="'+escapeHtml(fbtImgUrl(images[idx],1000))+'" alt="'+(idx+1)+' of '+images.length+'">'
        +(many?'<button type="button" class="ps-fbt-pop-arrow ps-fbt-pop-prev" aria-label="Previous picture">'+arrow(-1)+'</button><button type="button" class="ps-fbt-pop-arrow ps-fbt-pop-next" aria-label="Next picture">'+arrow(1)+'</button><span class="ps-fbt-pop-count">'+(idx+1)+' / '+images.length+'</span>':'');
      thumbs.style.setProperty('display',many?'flex':'none','important');
      thumbs.innerHTML=many?images.map(function(u,i){return '<button type="button" class="ps-fbt-pop-thumb" data-i="'+i+'" aria-label="Picture '+(i+1)+'" style="border-color:'+(i===idx?config.checkboxColor:config.borderColor)+';"><img src="'+escapeHtml(fbtImgUrl(u,160))+'" alt="" loading="lazy"></button>';}).join(''):'';
      var cur=thumbs.querySelector('[data-i="'+idx+'"]');if(cur&&thumbs.scrollWidth>thumbs.clientWidth)thumbs.scrollLeft=Math.max(0,cur.offsetLeft-thumbs.clientWidth/2+28);
    }
    function go(d){if(images.length>1){idx+=d;draw();}}
    var prevOverflow=document.documentElement.style.overflow;
    function close(){
      document.removeEventListener('keydown',onKey,true);
      document.documentElement.style.overflow=prevOverflow;
      if(pop.parentNode)pop.parentNode.removeChild(pop);
      if(o.opener&&o.opener.focus)try{o.opener.focus({preventScroll:true});}catch(e){}
    }
    function onKey(e){
      if(!pop.parentNode)return;
      if(e.key==='Escape'){e.preventDefault();close();}
      else if(e.key==='ArrowLeft'){e.preventDefault();go(-1);}
      else if(e.key==='ArrowRight'){e.preventDefault();go(1);}
    }
    pop.addEventListener('click',function(e){
      var t=e.target;
      if(t===pop||t.closest('.ps-fbt-pop-close')){close();return;}
      if(t.closest('.ps-fbt-pop-prev')){go(-1);return;}
      if(t.closest('.ps-fbt-pop-next')){go(1);return;}
      var th=t.closest('.ps-fbt-pop-thumb');if(th){idx=Number(th.getAttribute('data-i'))||0;draw();}
    });
    var startX=null;
    main.addEventListener('touchstart',function(e){startX=e.touches[0].clientX;},{passive:true});
    main.addEventListener('touchend',function(e){if(startX===null)return;var dx=e.changedTouches[0].clientX-startX;startX=null;if(Math.abs(dx)>40)go(dx<0?1:-1);},{passive:true});
    document.addEventListener('keydown',onKey,true);
    document.documentElement.style.overflow='hidden';
    document.body.appendChild(pop);
    draw();
    var closeBtn=pop.querySelector('.ps-fbt-pop-close');if(closeBtn)try{closeBtn.focus({preventScroll:true});}catch(e){}
    if(o.handle){
      cachedJson('/products/'+encodeURIComponent(o.handle)+'.js').then(function(p){
        if(!pop.parentNode)return;
        /* The product's own order; the picture on the card stays in view (first if the product doesn't list it). */
        var shown=images[idx],list=(p&&p.images)||[];
        if(!list.length&&p&&p.media)list=p.media.filter(function(m){return m.media_type==='image';}).map(function(m){return m.src;});
        if(!list.length)return;
        images=[];list.forEach(addImage);
        var at=-1;for(var i=0;i<images.length;i++)if(shown&&fbtImgKey(images[i])===fbtImgKey(shown))at=i;
        if(shown&&at===-1){images.unshift(shown);at=0;}
        idx=Math.max(0,at);
        draw();
      }).catch(function(){});
    }
  }

  function extractNumericId(v){var s=String(v||'');var m=s.match(/(\d+)(?!.*\d)/);return m?m[1]:'';}

  function normalizeVariantId(v){return extractNumericId(v)||'';}

  function dedupe(products){var map=new Map();products.forEach(function(p){map.set(p.id,p);});return Array.from(map.values());}

  function openCartDrawerFast(detail){
    var payload=detail||{};
    try{if(window.__CC_DRAWER_API&&typeof window.__CC_DRAWER_API.openNow==='function'){window.__CC_DRAWER_API.openNow(payload);return;}}catch(e){}
    ['cc:open-now','theme:cart:open','cart:open','cart:refresh'].forEach(function(n){try{document.dispatchEvent(new CustomEvent(n,{detail:payload}));window.dispatchEvent(new CustomEvent(n,{detail:payload}));}catch(e){}});
  }

  async function buildVariantLookup(products){
    var variantByProductId=new Map();
    (products||[]).forEach(function(product){
      var explicitVariant=normalizeVariantId(product&&(product.variantId||product.variant_id||(product.variant&&product.variant.id)));
      var idFromGid=String(product&&product.id||'').includes('ProductVariant')?normalizeVariantId(product&&product.id):'';
      var variantId=explicitVariant||idFromGid;
      if(variantId)variantByProductId.set(String(product.id),variantId);
    });
    var unresolved=(products||[]).filter(function(p){return!variantByProductId.has(String(p.id));});
    if(unresolved.length){
      try{
        var res=await fetch('/products.json?limit=250');
        if(res.ok){
          var json=await res.json();
          var ajaxProducts=Array.isArray(json&&json.products)?json.products:[];
          var firstVariantMap=new Map();
          ajaxProducts.forEach(function(ap){
            var pid=String(ap&&ap.id||'');
            var variants=Array.isArray(ap&&ap.variants)?ap.variants:[];
            var fv=variants.find(function(v){return v&&v.available;})||variants[0];
            var fvid=normalizeVariantId(fv&&fv.id);
            if(pid&&fvid)firstVariantMap.set(pid,fvid);
          });
          unresolved.forEach(function(product){
            var numId=extractNumericId(product&&product.id);
            var vid=firstVariantMap.get(numId);
            if(vid)variantByProductId.set(String(product.id),vid);
          });
        }
      }catch(e){}
    }
    unresolved=(products||[]).filter(function(p){return!variantByProductId.has(String(p.id));});
    for(var i=0;i<unresolved.length;i++){
      var product=unresolved[i];
      var handle=String(product&&product.handle||'').trim();
      if(!handle)continue;
      try{
        var hr=await fetch('/products/'+encodeURIComponent(handle)+'.js');
        if(!hr.ok)continue;
        var hj=await hr.json();
        var hvariants=Array.isArray(hj&&hj.variants)?hj.variants:[];
        var hfv=hvariants.find(function(v){return v&&v.available;})||hvariants[0];
        var hvid=normalizeVariantId(hfv&&hfv.id);
        if(hvid)variantByProductId.set(String(product.id),hvid);
      }catch(e){}
    }
    return variantByProductId;
  }

  // Never suggest a product that's fully out of stock — a saved FBT rule's
  // products are a point-in-time snapshot and stock changes far more often
  // than a merchant edits a rule, so this always re-checks live. Only
  // excludes a product when the live storefront catalog positively says
  // every variant is unavailable; a product simply missing from the bulk
  // /products.json page (e.g. beyond its limit) or whose handle lookup
  // fails is left in rather than guessed at. "Live"/published is already
  // guaranteed separately: /products.json never lists an unpublished
  // product, and a per-handle fetch 404s for one.
  // Live price + compare-at price of the variant the widget will add (the
  // rule's own variant, else the first available one, as buildVariantLookup
  // picks). /products.json gives "19.99" strings, /products/<handle>.js cents.
  function withLivePrice(product,variants,inCents,options){
    var wanted=normalizeVariantId(product&&(product.variantId||product.variant_id||(product.variant&&product.variant.id)));
    var v=(wanted&&variants.find(function(x){return normalizeVariantId(x&&x.id)===wanted;}))||variants.find(function(x){return x&&x.available;})||variants[0];
    if(!v)return product;
    var div=inCents?100:1;
    var price=toPriceNumber(v.price)/div;
    var compareAt=toPriceNumber(v.compare_at_price)/div;
    /* Every variant, for the widget's variant picker (sold-out ones shown but not pickable). */
    var list=variants.filter(function(x){return x&&x.id;}).slice(0,100).map(function(x){var p=toPriceNumber(x.price)/div,c=toPriceNumber(x.compare_at_price)/div;return{id:normalizeVariantId(x.id),title:String(x.title||''),price:p,compareAt:c>p?c:0,available:x.available!==false,opts:[x.option1==null?null:String(x.option1),x.option2==null?null:String(x.option2),x.option3==null?null:String(x.option3)]};});
    /* Option names (Size, Color...): /products.json gives objects, older .js plain strings. */
    var optionNames=(options||[]).map(function(o){return String(o&&typeof o==='object'?o.name||'':o||'');});
    return Object.assign({},product,{price:price,compareAt:compareAt>price?compareAt:0,variants:list,liveVariantId:normalizeVariantId(v.id),optionNames:optionNames});
  }

  async function filterAvailableFbtProducts(products){
    var variantsById=new Map();
    var optionsById=new Map();
    try{
      var json=await cachedJson('/products.json?limit=250');
      var ajaxProducts=Array.isArray(json&&json.products)?json.products:[];
      ajaxProducts.forEach(function(ap){
        var pid=String(ap&&ap.id||'');
        if(pid){variantsById.set(pid,Array.isArray(ap&&ap.variants)?ap.variants:[]);optionsById.set(pid,ap&&ap.options);}
      });
    }catch(e){}

    function isAvailable(variants){return variants.some(function(v){return v&&v.available;});}

    var out=[];
    for(var i=0;i<(products||[]).length;i++){
      var product=products[i];
      var numId=extractNumericId(product&&product.id);
      if(variantsById.has(numId)){
        var listed=variantsById.get(numId);
        if(isAvailable(listed))out.push(withLivePrice(product,listed,false,optionsById.get(numId)));
        continue;
      }
      var handle=String(product&&product.handle||'').trim();
      if(!handle){out.push(product);continue;}
      try{
        var hj=await cachedJson('/products/'+encodeURIComponent(handle)+'.js');
        var hvariants=Array.isArray(hj&&hj.variants)?hj.variants:[];
        if(isAvailable(hvariants))out.push(withLivePrice(product,hvariants,true,hj&&hj.options));
      }catch(e){out.push(product);}
    }
    return out;
  }

  /* ── "Match the shopper's size" (AI-Powered mode). Same rules as
     app/utils/fbt-size.shared.js (unit-tested there); keep them in step. ── */
  var SIZE_NAME_RE=/size|age|year|yrs/i;
  function sizeOptionIndex(names,preferred){
    var list=(names||[]).map(function(n){return String(n&&typeof n==='object'?n.name||'':n||'').trim();});
    var want=String(preferred||'').trim().toLowerCase();
    for(var i=0;i<list.length;i++){if(want?list[i].toLowerCase()===want:SIZE_NAME_RE.test(list[i]))return i;}
    return -1;
  }
  function parseSize(value){
    var s=String(value==null?'':value).toLowerCase().replace(/\s+/g,' ').trim();
    if(!s)return null;
    var nums=(s.match(/\d+(?:\.\d+)?/g)||[]).map(Number);
    if(!nums.length)return{text:s.replace(/[^a-z0-9]/g,'')};
    var unit=/\d\s*(m|mo|mos|mon|mth|mths|month|months)\b/.test(s)||/\bmonths?\b/.test(s)?'m':/\d\s*(y|yr|yrs|year|years)\b/.test(s)||/\b(years?|yrs?)\b/.test(s)?'y':'';
    return{lo:Math.min.apply(null,nums),hi:Math.max.apply(null,nums),unit:unit};
  }
  function sizeScore(a,b){
    if(!a||!b)return 0;
    if(a.text!=null||b.text!=null)return a.text!=null&&a.text===b.text?2:0;
    if(a.unit&&b.unit&&a.unit!==b.unit)return 0;
    if(a.lo===b.lo&&a.hi===b.hi)return 2;
    return a.lo<=b.hi&&b.lo<=a.hi?1:0;
  }
  function pickSizeVariant(product,pageSize,preferred){
    var idx=sizeOptionIndex(product&&product.optionNames,preferred);
    var want=parseSize(pageSize);
    if(idx<0||!want)return{status:'none'};
    var variants=product.variants||[];
    var base=null;for(var b=0;b<variants.length;b++)if(variants[b].id===product.liveVariantId)base=variants[b];
    var best=null,bestScore=0;
    for(var i=0;i<variants.length;i++){
      var v=variants[i];if(!v.available)continue;
      var score=sizeScore(parseSize(v.opts&&v.opts[idx]),want)*10;if(!score)continue;
      if(base)for(var k=0;k<3;k++)if(k!==idx&&((v.opts&&v.opts[k])==null?null:v.opts[k])===((base.opts&&base.opts[k])==null?null:base.opts[k]))score+=1;
      if(score>bestScore){best=v;bestScore=score;}
    }
    return best?{status:'match',variant:best}:{status:'missing'};
  }
  /* The size picked on the product page: the page product's own data (.js,
     fetched once) and the variant chosen in its form (or ?variant=). */
  function pageVariantId(){
    var input=document.querySelector('form[action*="/cart/add"] [name="id"]');
    var id=input&&normalizeVariantId(input.value);
    if(id)return id;
    try{return normalizeVariantId(new URLSearchParams(location.search).get('variant'));}catch(e){return '';}
  }
  async function currentPageSize(el,config){
    var handle=el.dataset.productHandle;
    if(!handle)return null;
    var p;
    try{p=await cachedJson('/products/'+encodeURIComponent(handle)+'.js');}catch(e){p={};}
    p=p||{};
    var variants=Array.isArray(p.variants)?p.variants:[];
    var idx=sizeOptionIndex(p.options,config.sizeMatchOption);
    if(idx<0||!variants.length)return null;
    var vid=pageVariantId();
    var v=variants.find(function(x){return normalizeVariantId(x.id)===vid;})||variants.find(function(x){return x.available;})||variants[0];
    var value=v&&v['option'+(idx+1)];
    if(!value)return null;
    /* The viewed product is in the offer's set: price the picked variant. */
    if(v.price!=null)config.viewedPrice=toPriceNumber(v.price)/100;
    return{value:String(value),variantId:normalizeVariantId(v.id)};
  }
  /* Each product in the shopper's size: that size picked (in stock); without
     it replaced in its place by a spare AI pick in that size (else one with no
     size option), hidden, or marked "Not in <size>"; products with no size
     option as they are. Spares never join a bundle offer. */
  function applySizeMatch(products,size,config,spares){
    var take=function(p,r){return Object.assign({},p,{variantId:r.variant.id,liveVariantId:r.variant.id,price:r.variant.price,compareAt:r.variant.compareAt});};
    var shown={};products.forEach(function(p){shown[String(p.id)]=true;});
    var queue={match:[],none:[]};
    if(config.sizeMatchMissing==='replace'){
      (spares||[]).forEach(function(s){
        if(shown[String(s.id)])return;
        var r=pickSizeVariant(s,size,config.sizeMatchOption);
        if(r.status==='match')queue.match.push(Object.assign(take(s,r),{replacement:true}));
        else if(r.status==='none')queue.none.push(Object.assign({},s,{replacement:true}));
      });
    }
    var out=[];
    products.forEach(function(p){
      var r=pickSizeVariant(p,size,config.sizeMatchOption);
      if(r.status==='match')out.push(take(p,r));
      else if(r.status==='none')out.push(p);
      else if(config.sizeMatchMissing==='note')out.push(Object.assign({},p,{sizeMissing:size}));
      else if(config.sizeMatchMissing==='replace'){var next=queue.match.shift()||queue.none.shift();if(next)out.push(next);}
    });
    return out;
  }

  customElements.define('ps-fbt-widget',class extends HTMLElement{
    connectedCallback(){
      if(this._psInit)return;
      this._psInit=true;
      var el=this;
      var shop=el.dataset.shop;
      var currencyCode=el.dataset.currency||'USD';
      var productId='gid://shopify/Product/'+el.dataset.productId;
      var currencySymbol=getCurrencySymbol(currencyCode);

      function findAtcBtn(){
        var selectors=[
          'form[action*="/cart/add"] [type="submit"]',
          'button[name="add"]',
          '[type="submit"][name="add"]',
          '.product-form__submit',
          '.product-form__buttons [type="submit"]',
          '#AddToCart','#ProductSubmitButton',
          '[id^="ProductSubmitButton"]','[id^="AddToCart"]',
          '.add-to-cart','.add_to_cart','.btn--add-to-cart',
          '[data-add-to-cart]','button[data-product-form-submit]',
          '.product__submit button[type="submit"]',
          'product-form button[type="submit"]',
          '.shopify-payment-button__button',
          'button[type="submit"].btn',
        ];
        /* Prefer a visible button (themes often have hidden duplicate forms) */
        for(var i=0;i<selectors.length;i++){var b=document.querySelector(selectors[i]);if(b&&b.offsetParent!==null)return b;}
        for(var j=0;j<selectors.length;j++){var b2=document.querySelector(selectors[j]);if(b2)return b2;}
        return null;
      }

      function doPlace(apiPlacement){
        var atcBtn=findAtcBtn();
        el.style.display='block';
        el.style.width='100%';
        el.style.margin=el.__psMargin||'16px 0';
        el.style.boxSizing='border-box';
        if(apiPlacement==='custom'||!atcBtn)return false;
        /* Anchor as close to the Add-to-Cart button as possible so "above/below the
           add to cart" is precise (not above the whole form / variant pickers).
           Prefer a known buy-buttons wrapper, else the button's block parent. */
        var anchor=
          atcBtn.closest('.product-form__buttons') ||
          atcBtn.closest('.product-form__buy-buttons') ||
          atcBtn.closest('[class*="buy-buttons"]') ||
          atcBtn.closest('[class*="buy_buttons"]') ||
          atcBtn.closest('.product-form__submit') ||
          atcBtn;
        if(apiPlacement==='above_cart'){
          anchor.parentNode.insertBefore(el,anchor);
        } else {
          anchor.parentNode.insertBefore(el,anchor.nextSibling);
        }
        return true;
      }

      function placeWidget(apiPlacement){
        /* Try immediately; if the ATC button isn't in the DOM yet, observe until it is. */
        if(doPlace(apiPlacement)||apiPlacement==='custom')return;
        var done=false;
        var obs=new MutationObserver(function(){
          if(done)return;
          if(findAtcBtn()){done=true;obs.disconnect();doPlace(apiPlacement);}
        });
        obs.observe(document.body,{childList:true,subtree:true});
        /* Safety: stop observing after 6s and place wherever we can */
        setTimeout(function(){if(!done){done=true;obs.disconnect();doPlace(apiPlacement);}},6000);
      }

      if(!shop){el.style.display='none';return;}

      /* Direct call to the PHP backend (not the Shopify App Proxy). Relies on
         config.php's Access-Control-Allow-Origin: * — no custom headers here,
         since those trigger a CORS preflight config.php doesn't allowlist. */
      var API_URL='https://int.thebrix.io/save_fbt_widget.php?shopdomain='+encodeURIComponent(shop);
      cachedJson(API_URL,300000)
        .then(async function(response){
          if(!response||response.status!=='success')return;
          var data=response.data;
          /* Plan gating: on Free, FBT is Preview Only — the backend already
             forces `publishable`/`isEnabled` off, but never trust the client
             alone. On the live storefront, bail out before rendering anything.
             In the theme editor (design mode), show an upgrade placeholder so
             the merchant understands why the app embed is empty. */
          if(data.publishable===false||data.isEnabled===false){
            if(el.dataset.designMode==='true'){
              el.style.display='block';
              el.style.width='100%';
              el.style.margin='16px 0';
              el.innerHTML='<div style="padding:16px;border:1.5px dashed #d1d5db;border-radius:8px;color:#6b7280;font-size:13px;text-align:center;">🔒 FBT Widget is not available on your current plan.<br>Upgrade to enable this widget on your storefront.</div>';
            }
            return;
          }
          var selectedTemplate=data.selectedTemp||data.selectedTemplate||data.activeTemplate||'fbt1';
          var templateMap={fbt1:data.temp1||(data.templates&&data.templates.fbt1),fbt2:data.temp2||(data.templates&&data.templates.fbt2),fbt3:data.temp3||(data.templates&&data.templates.fbt3)};
          var TEMPLATE_STYLE_MAP={fbt1:'classic-grid',fbt2:'modern-cards',fbt3:'vertical-list'};
          var templateStyle=TEMPLATE_STYLE_MAP[selectedTemplate]||'classic-grid';
          var config=normalizeConfig(templateMap[selectedTemplate],currencySymbol);
          if(!config)return;
          var apiPlacement=(templateMap[selectedTemplate]&&templateMap[selectedTemplate].widgetPlacement)||data.widgetPlacement||'below_cart';
          var rules=normalizeRules(data.condition||data.manualRules||data.manualConfiguration||[]);
          var currentNumId=extractNumericId(productId);
          var matchedProducts=[];
          var matchedSpares=[]; /* AI rules' spare picks, for size matching → Replace */
          var offerRule=null; /* the rule whose "buy all together" offer the widget shows */
          rules.forEach(function(rule){
            var triggerCandidates=(rule.triggerProducts||[]).length?(rule.triggerProducts||[]):(rule.triggerProductId?[{id:rule.triggerProductId}]:[]);
            var scope=rule.displayScope||'all';
            if(scope==='all'){matchedProducts=matchedProducts.concat(rule.fbtProducts);matchedSpares=matchedSpares.concat(rule.backupProducts);if(rule.offer&&!offerRule)offerRule=rule;return;}
            /* single / specific / per_product → only on the trigger product's page.
               Compare by numeric id since GID formats vary across sources. */
            var match=triggerCandidates.some(function(p){return extractNumericId(p.id)===currentNumId;});
            if(match){matchedProducts=matchedProducts.concat(rule.fbtProducts);matchedSpares=matchedSpares.concat(rule.backupProducts);if(rule.offer&&(!offerRule||offerRule.displayScope==='all'))offerRule=rule;}
          });
          if(!matchedProducts.length)return;
          matchedProducts=dedupe(matchedProducts);
          var placed=false,drawToken=0;
          var placeOnce=function(){
            if(placed)return;
            placed=true;
            el.__psMargin=config.marginTop+'px 0 '+config.marginBottom+'px';
            placeWidget(apiPlacement);
            el.style.margin=el.__psMargin;
          };
          /* Placeholders in place while stock and prices load (with everything
             already downloaded this visit, the real widget replaces them before
             the screen even paints). */
          renderSkeleton(el,config,matchedProducts.length,config.interactionType==='checkboxQty'||config.layout==='vertical');
          placeOnce();
          var liveProducts=await filterAvailableFbtProducts(matchedProducts);
          if(!liveProducts.length){el.style.display='none';el.innerHTML='';return;}
          config.currentProductId=currentNumId;
          /* The viewed product's price (cents, from Liquid): it's part of the offer's set. */
          var viewedCents=Number(el.dataset.productPrice);
          config.viewedPrice=isFinite(viewedCents)&&viewedCents>0?viewedCents/100:0;
          var liveSpares=null;
          async function draw(){
            var token=++drawToken;
            var products=liveProducts;
            if(config.sizeMatch){
              var pageSize=await currentPageSize(el,config);
              if(token!==drawToken)return;
              if(pageSize){
                /* Spares (stock and sizes) are loaded once, only when a suggestion needs replacing. */
                var spares=[];
                if(config.sizeMatchMissing==='replace'&&matchedSpares.length&&liveProducts.some(function(p){return pickSizeVariant(p,pageSize.value,config.sizeMatchOption).status==='missing';})){
                  if(!liveSpares)liveSpares=filterAvailableFbtProducts(dedupe(matchedSpares).filter(function(s){return extractNumericId(s.id)!==currentNumId;}));
                  spares=await liveSpares;
                  if(token!==drawToken)return;
                }
                products=applySizeMatch(liveProducts,pageSize.value,config,spares);
              }
            }
            /* The offer needs every one of its products shown (sold out, or not
               in the shopper's size = no offer). */
            config.offer=null;
            if(offerRule){
              var shownIds=products.filter(function(p){return!p.sizeMissing;}).map(function(p){return extractNumericId(p.id);});
              /* Show only with a minimum (the store's own "any N" discount): any
                 shown products count, spares too, from `min` items picked. */
              var minItems=offerRule.offer.min||0;
              if(minItems){
                var anyIds=shownIds.filter(function(id){return id&&id!==currentNumId;});
                if(anyIds.length+1>=minItems)config.offer={type:offerRule.offer.type,value:offerRule.offer.value,text:offerRule.offer.text||'Buy any {count} together and save {discount}',count:minItems,productIds:anyIds,min:minItems};
              }else{
              var setIds=offerRule.fbtProducts.map(function(p){return extractNumericId(p.id);}).filter(function(id){return id&&id!==currentNumId;});
              if(setIds.length&&setIds.every(function(id){return shownIds.indexOf(id)!==-1;}))config.offer={type:offerRule.offer.type,value:offerRule.offer.value,text:offerRule.offer.text,count:setIds.length+1,productIds:setIds};
              }
            }
            if(!products.length){el.style.display='none';el.innerHTML='';return;}
            /* Keep the height while it redraws (a new size), so the page doesn't jump. */
            var keepHeight=el.offsetHeight;
            if(keepHeight)el.style.minHeight=keepHeight+'px';
            renderFBT(el,config,products,currencySymbol,templateStyle,buildVariantLookup,openCartDrawerFast,toPriceNumber,escapeHtml,normalizeVariantId,extractNumericId);
            el.style.display='block';
            placeOnce();
            if(keepHeight)requestAnimationFrame(function(){el.style.minHeight='';});
          }
          await draw();
          /* A new size picked on the page: draw again for it (themes change the
             form's variant without events, so it's checked twice a second). */
          if(config.sizeMatch){
            var lastVariant=pageVariantId();
            var watch=setInterval(function(){
              if(!el.isConnected){clearInterval(watch);return;}
              var now=pageVariantId();
              if(now!==lastVariant){lastVariant=now;draw();}
            },500);
          }
        })
        .catch(function(){});
    }
  });

  function renderFBT(container,config,products,currencySymbol,templateStyle,buildVariantLookup,openCartDrawerFast,toPriceNumber,escapeHtml,normalizeVariantId,extractNumericId){
    /* Templates are a color/border "skin" only — Layout Alignment
       (config.layout: carousel/grid/vertical) is the single universal
       arrangement control across all 3 templates, so the same value always
       means the same physical arrangement no matter which template is
       selected. Checkbox + Quantity still always forces the stacked list,
       since that interaction needs the left-side checkbox column regardless
       of Layout Alignment. Classic Grid keeps its signature "+" connector as
       a skin flourish, shown only in the carousel arrangement — a true
       2-col grid has no natural slot for an inline connector between cells. */
    // Price with the compare-at price struck through before it, when higher.
    /* Account → Price display → "Hide decimals in prices" (window.__brixWholePrices). */
    function money(n){return currencySymbol+(window.__brixWholePrices===true?Math.round(n):n).toLocaleString('en-IN');}
    function priceHtml(price,compareAt,strikeSize){
      return (compareAt>price?'<s class="ps-compare-price" style="color:'+config.textColor+';opacity:.5;font-weight:500;margin-right:4px;'+(strikeSize?'font-size:'+strikeSize+'px;':'')+'">'+money(compareAt)+'</s>':'')+money(price);
    }

    var useCheckboxLeft=config.interactionType==='checkboxQty';
    var isListStyle=useCheckboxLeft||config.layout==='vertical';
    var isGridLayout=!isListStyle&&config.layout==='grid';
    var isCarouselLayout=!isListStyle&&!isGridLayout;
    var isModernStyle=templateStyle==='modern-cards';
    var showPlusSeparators=templateStyle==='classic-grid'&&isCarouselLayout;
    container.innerHTML=
      '<div class="ps-fbt-wrapper" style="--ps-fbt-hover:'+config.buttonHoverColor+';--ps-fbt-pad:'+config.widgetPadding+'px;--ps-fbt-pad-m:'+Math.round(config.widgetPadding*0.7)+'px;background:'+config.bgColor+';border-radius:'+config.borderRadius+'px;'+(isModernStyle?'border:none;box-shadow:0 4px 20px rgba(0,0,0,0.08);':'border:1px solid '+config.borderColor+';')+'">'
        +'<div class="ps-fbt-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;">'
          +'<div class="ps-fbt-title" style="color:'+config.headingColor+';letter-spacing:-0.5px;margin-bottom:0;">Frequently Bought Together</div>'
          +(isCarouselLayout?(
            '<div class="ps-fbt-nav-group" style="display:flex;gap:6px;flex-shrink:0;">'
              +'<button type="button" class="ps-fbt-nav ps-fbt-nav-prev" aria-label="Show previous products" style="background:'+config.bgColor+';color:'+config.textColor+';border:1px solid '+config.borderColor+';">&#8249;</button>'
              +'<button type="button" class="ps-fbt-nav ps-fbt-nav-next" aria-label="Show more products" style="background:'+config.bgColor+';color:'+config.textColor+';border:1px solid '+config.borderColor+';">&#8250;</button>'
            +'</div>'
          ):'')
        +'</div>'
        +'<div class="ps-fbt-products"></div>'
        +(config.offer?'<div class="ps-fbt-offer" style="margin-top:14px;padding:9px 12px;border-radius:'+Math.min(config.borderRadius,12)+'px;'+fbtOfferCss(config)+'">'+escapeHtml(fbtOfferText(config.offer,currencySymbol))+(config.offerShowSavings?'<div class="ps-fbt-savings" style="display:none;margin-top:3px;font-size:'+Math.max(10,config.offerFontSize-1)+'px;font-weight:800;"></div>':'')+'</div>':'')
        +'<div class="ps-fbt-footer" style="border-color:'+config.borderColor+';justify-content:'+(config.showPrices?'space-between':'flex-end')+';">'
          +(config.showPrices?'<div><div class="ps-total-label" style="font-size:13px;opacity:.6;color:'+config.textColor+'">Select items</div><div class="ps-total-price" style="font-size:22px;font-weight:900;color:'+config.priceColor+'">'+currencySymbol+'0</div></div>':'')
          +(config.showAddAllButton?'<button class="ps-fbt-addall" style="background:'+config.buttonColor+';color:'+config.buttonTextColor+';display:none;">Add to Cart</button>':'')
        +'</div>'
      +'</div>';

    var wrapper=container.querySelector('.ps-fbt-products');
    var savingsEl=container.querySelector('.ps-fbt-savings');
    var totalLabelEl=container.querySelector('.ps-total-label');
    var totalEl=container.querySelector('.ps-total-price');
    var addBtn=container.querySelector('.ps-fbt-addall');
    var navPrev=container.querySelector('.ps-fbt-nav-prev');
    var navNext=container.querySelector('.ps-fbt-nav-next');

    if(isListStyle){
      wrapper.style.cssText='display:flex;flex-direction:column;gap:'+config.rowGap+'px;';
    }else if(isGridLayout){
      wrapper.style.cssText='display:grid;grid-template-columns:repeat(2,1fr);gap:'+config.gap+'px;';
    }else{
      wrapper.style.cssText='display:flex;flex-direction:row;gap:'+config.gap+'px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:4px;-webkit-overflow-scrolling:touch;';
    }
    wrapper.dataset.interaction=config.interactionType;
    wrapper.dataset.layout=config.layout;
    wrapper.classList.add(isListStyle?'list':(isGridLayout?'grid':'carousel'));

    if(isCarouselLayout&&navPrev&&navNext){
      var scrollByAmount=function(){return Math.max(wrapper.clientWidth*0.8,150);};
      var updateNavState=function(){
        var maxScroll=wrapper.scrollWidth-wrapper.clientWidth;
        if(maxScroll<=4){navPrev.setAttribute('disabled','');navNext.setAttribute('disabled','');return;}
        if(wrapper.scrollLeft<=4)navPrev.setAttribute('disabled','');else navPrev.removeAttribute('disabled');
        if(wrapper.scrollLeft>=maxScroll-4)navNext.setAttribute('disabled','');else navNext.removeAttribute('disabled');
      };
      navPrev.onclick=function(){wrapper.scrollBy({left:-scrollByAmount(),behavior:'smooth'});};
      navNext.onclick=function(){wrapper.scrollBy({left:scrollByAmount(),behavior:'smooth'});};
      wrapper.addEventListener('scroll',updateNavState,{passive:true});
      window.addEventListener('resize',updateNavState);
      setTimeout(updateNavState,50);
    }

    var selectedProductIds=new Set();
    var productQuantities=new Map();
    var cardEntries=new Map();
    /* The variant picked on each card (variant picker); none = the one the widget always adds. */
    var chosenVariants=new Map();
    function variantOf(p){var id=chosenVariants.get(String(p.id));if(!id)return null;return(p.variants||[]).find(function(v){return v.id===id;})||null;}
    function unitPrice(p){var v=variantOf(p);return v?v.price:toPriceNumber(p.price);}
    function unitCompare(p){var v=variantOf(p);return v?v.compareAt:toPriceNumber(p.compareAt);}
    function round2(n){return Math.round(n*100)/100;}
    /* What the offer takes off once the whole set is picked (one unit each, as
       the checkout Function): { total, per: {productId: amount}, base } or null.
       The viewed product is in the set; a fixed amount is split by price. */
    function offerSavings(){
      if(!config.offer)return null;
      var set=products.filter(function(p){return config.offer.productIds.indexOf(extractNumericId(p.id))!==-1;});
      /* "Any N": the picked ones, once there are N with the viewed product. */
      if(config.offer.min){set=set.filter(function(p){return getProductQuantity(p.id)>0;});if(set.length+1<config.offer.min)return null;}
      else if(!set.length||!set.every(function(p){return getProductQuantity(p.id)>0;}))return null;
      var viewed=config.viewedPrice||0;
      var base=viewed+set.reduce(function(sum,p){return sum+unitPrice(p);},0);
      if(!(base>0))return null;
      var value=Number(config.offer.value)||0;
      var pct=config.offer.type==='percentage';
      var total=round2(pct?base*value/100:Math.min(value,base));
      var per={};
      set.forEach(function(p){per[String(p.id)]=round2(pct?unitPrice(p)*value/100:total*unitPrice(p)/base);});
      return{total:total,per:per,base:base,count:set.length+1};
    }

    var usesQuantityMap=config.interactionType==='quickAdd'||config.interactionType==='checkboxQty';
    /* Not in the shopper's size (sizeMatchMissing 'note'): shown greyed, never picked. */
    var missingIds=new Set(products.filter(function(p){return p.sizeMissing;}).map(function(p){return String(p.id);}));
    /* Start with every product selected (a bundle) or let shoppers pick:
       Bundle always; else the merchant's startSelected; else the style's
       default (Classic yes, Quick Add / Checkbox + Quantity no).
       app/utils/fbt-style.shared.js fbtStartsSelected. */
    var startPicked=config.interactionType==='bundle'?true:(config.startSelected===true||config.startSelected===false?config.startSelected:!usesQuantityMap);
    if(usesQuantityMap){products.forEach(function(p){productQuantities.set(String(p.id),startPicked&&!missingIds.has(String(p.id))?1:0);});}
    else if(startPicked){products.forEach(function(p){if(!missingIds.has(String(p.id)))selectedProductIds.add(String(p.id));});}

    function getProductQuantity(pid){var id=String(pid);if(missingIds.has(id))return 0;if(usesQuantityMap)return productQuantities.get(id)||0;return selectedProductIds.has(id)?1:0;}
    function getSelectedCount(){if(usesQuantityMap)return products.reduce(function(c,p){return c+(getProductQuantity(p.id)>0?1:0);},0);return selectedProductIds.size;}

    function updateCardStyle(entry){
      var pid=String(entry.product.id);var qty=getProductQuantity(pid);var isActive=qty>0;
      if(isListStyle){
        var rowIdx=products.findIndex(function(p){return String(p.id)===pid;});
        var isLastRow=rowIdx===products.length-1;
        /* CSS Grid with explicit column widths (image fixed, text flexible,
           button auto-sized) instead of flexbox — guarantees the middle
           text column always gets real space regardless of how wide the
           button/theme container happen to be, and keeps the button a fixed
           gutter away from the edge instead of hugging it. */
        var rowImg=Math.round(config.imageSize*0.75);
        var rowColumns=useCheckboxLeft?'20px '+rowImg+'px 1fr auto':rowImg+'px 1fr auto';
        var rowPad=config.cardPadding+2;
        entry.card.style.cssText='display:grid;grid-template-columns:'+rowColumns+';align-items:center;gap:'+fbtGap(config.imageTextGap,12)+'px;width:100%;padding:'+rowPad+'px 16px '+rowPad+'px 4px;'+(isLastRow?'':'border-bottom:1px solid '+config.borderColor+';')+'background:'+config.bgColor+';color:'+config.textColor+';box-sizing:border-box;';
        return;
      }
      var cardWidth=isCarouselLayout?config.cardWidth+'px':'1 1 120px';
      var snapAlign=isCarouselLayout?'scroll-snap-align:start;':'';
      var borderStyle=isModernStyle
        ?'border:none;box-shadow:0 6px 18px rgba(0,0,0,0.14);'
        :'border:1px solid '+(isActive?config.checkboxColor:config.borderColor)+';box-shadow:0 1px 4px rgba(0,0,0,0.06);';
      entry.card.style.cssText=(isCarouselLayout?'width:':'flex:')+cardWidth+';min-width:'+Math.min(120,config.cardWidth)+'px;max-width:'+Math.max(220,config.cardWidth)+'px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:'+fbtGap(config.imageTextGap,8)+'px;padding:'+config.cardPadding+'px '+Math.max(0,config.cardPadding-2)+'px;border-radius:'+config.borderRadius+'px;background:'+config.bgColor+';'+borderStyle+'transition:border-color 0.2s ease;position:relative;overflow:visible;box-sizing:border-box;color:'+config.textColor+';'+snapAlign;
    }

    function renderControl(entry){
      var product=entry.product;var pid=String(product.id);var actionSlot=entry.actionSlot;
      var qty=getProductQuantity(pid);var isSelected=qty>0;
      actionSlot.innerHTML='';
      if(entry.requiredBadge){entry.requiredBadge.remove();entry.requiredBadge=null;}
      if(missingIds.has(pid)){
        actionSlot.innerHTML='<span class="ps-fbt-nosize" style="font-size:11px;font-weight:600;opacity:.75;color:'+config.textColor+';">Not in '+escapeHtml(product.sizeMissing)+'</span>';
        entry.card.style.opacity='0.55';
        return;
      }

      if(config.interactionType==='classic'){
        var btn=document.createElement('button');btn.className='ps-classic-btn'+(isSelected?' is-selected':'');
        btn.textContent=isSelected?'Added':'Add';
        btn.style.cssText='padding:6px 14px;border-radius:6px;border:none;background:'+(isSelected?config.selectedBgColor:config.buttonColor)+';color:'+(isSelected?config.selectedTextColor:config.buttonTextColor)+';font-size:11px;font-weight:700;cursor:pointer;transition:all 0.2s;white-space:nowrap;';
        btn.onclick=function(){if(selectedProductIds.has(pid))selectedProductIds.delete(pid);else selectedProductIds.add(pid);updateUI();};
        actionSlot.appendChild(btn);return;
      }

      if(config.interactionType==='bundle'){
        var isRequired=selectedProductIds.has(pid)&&selectedProductIds.size<=1;
        var check=document.createElement('div');check.className='ps-bundle-check';
        check.style.cssText='width:20px;height:20px;border-radius:4px;border:2px solid '+(isRequired?config.checkboxColor+'66':config.checkboxColor)+';background:'+(isSelected?config.checkboxColor:'transparent')+';display:flex;align-items:center;justify-content:center;cursor:'+(isRequired?'not-allowed':'pointer')+';transition:all 0.2s;opacity:'+(isRequired?'0.7':'1')+';color:'+(isSelected?config.buttonTextColor:config.checkboxColor)+';';
        check.innerHTML=isSelected?checkIcon(13):'';
        check.onclick=function(){if(isRequired)return;if(selectedProductIds.has(pid))selectedProductIds.delete(pid);else selectedProductIds.add(pid);updateUI();};
        if(isRequired){var badge=document.createElement('div');badge.className='ps-required';badge.textContent='REQUIRED';badge.style.cssText='position:absolute;top:-8px;right:-4px;padding:2px 6px;border-radius:4px;background:'+config.buttonColor+';color:'+config.buttonTextColor+';font-size:9px;font-weight:700;letter-spacing:0.5px;';entry.card.appendChild(badge);entry.requiredBadge=badge;}
        actionSlot.appendChild(check);return;
      }

      if(config.interactionType==='checkboxQty'){
        if(entry.checkboxSlot){
          entry.checkboxSlot.innerHTML='';
          var qCheck=document.createElement('div');qCheck.className='ps-bundle-check';
          qCheck.style.cssText='width:20px;height:20px;border-radius:4px;border:2px solid '+config.checkboxColor+';background:'+(isSelected?config.checkboxColor:'transparent')+';display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;color:'+(isSelected?config.buttonTextColor:config.checkboxColor)+';flex-shrink:0;';
          qCheck.innerHTML=isSelected?checkIcon(13):'';
          qCheck.onclick=function(){productQuantities.set(pid,isSelected?0:1);updateUI();};
          entry.checkboxSlot.appendChild(qCheck);
        }
        if(isSelected){
          var qStepper=document.createElement('div');qStepper.style.cssText='display:flex;align-items:center;gap:0;border-radius:6px;overflow:hidden;border:1px solid '+config.buttonColor+';';
          var qMinus=document.createElement('button');qMinus.textContent='−';qMinus.style.cssText='width:24px;height:24px;border:none;background:'+config.buttonColor+';color:'+config.buttonTextColor+';font-size:13px;font-weight:700;cursor:pointer;';
          qMinus.onclick=function(){productQuantities.set(pid,Math.max(0,(productQuantities.get(pid)||0)-1));updateUI();};
          var qText=document.createElement('span');qText.textContent=String(qty);qText.style.cssText='width:24px;text-align:center;font-size:12px;font-weight:700;color:'+config.textColor+';';
          var qPlus=document.createElement('button');qPlus.textContent='+';qPlus.style.cssText='width:24px;height:24px;border:none;background:'+config.buttonColor+';color:'+config.buttonTextColor+';font-size:13px;font-weight:700;cursor:pointer;';
          qPlus.onclick=function(){productQuantities.set(pid,(productQuantities.get(pid)||0)+1);updateUI();};
          qStepper.appendChild(qMinus);qStepper.appendChild(qText);qStepper.appendChild(qPlus);
          actionSlot.appendChild(qStepper);
        }
        return;
      }

      var currentQty=productQuantities.get(pid)||0;
      if(currentQty<=0){
        var addButton=document.createElement('button');addButton.className='ps-classic-btn ps-outline-btn';addButton.textContent='Add';
        addButton.style.cssText='padding:5px 14px;border-radius:6px;border:1px solid '+config.buttonColor+';background:transparent;color:'+config.buttonColor+';font-size:11px;font-weight:700;cursor:pointer;transition:all 0.2s;';
        addButton.onclick=function(){productQuantities.set(pid,1);updateUI();};
        actionSlot.appendChild(addButton);return;
      }
      var stepper=document.createElement('div');stepper.style.cssText='display:flex;align-items:center;gap:0;border-radius:6px;overflow:hidden;border:1px solid '+config.buttonColor+';';
      var minus=document.createElement('button');minus.textContent='−';minus.style.cssText='width:26px;height:26px;border:none;background:'+config.buttonColor+';color:'+config.buttonTextColor+';font-size:14px;font-weight:700;cursor:pointer;';
      minus.onclick=function(){productQuantities.set(pid,Math.max(0,(productQuantities.get(pid)||0)-1));updateUI();};
      var qtyText=document.createElement('span');qtyText.textContent=String(currentQty);qtyText.style.cssText='width:26px;text-align:center;font-size:12px;font-weight:700;color:'+config.textColor+';';
      var plus=document.createElement('button');plus.textContent='+';plus.style.cssText='width:26px;height:26px;border:none;background:'+config.buttonColor+';color:'+config.buttonTextColor+';font-size:14px;font-weight:700;cursor:pointer;';
      plus.onclick=function(){productQuantities.set(pid,(productQuantities.get(pid)||0)+1);updateUI();};
      stepper.appendChild(minus);stepper.appendChild(qtyText);stepper.appendChild(plus);
      actionSlot.appendChild(stepper);
    }

    function updateFooter(){
      var total=0,compareTotal=0;
      products.forEach(function(p){
        var q=getProductQuantity(p.id),price=unitPrice(p),cmp=unitCompare(p);
        total+=q*price;
        compareTotal+=q*(cmp>price?cmp:price);
      });
      var saving=offerSavings();
      /* Bundle total with the offer: the set (the viewed product too) before and after it. */
      if(totalEl){
        if(saving&&config.offerStrikeTotal){var before=total+(config.viewedPrice||0);totalEl.innerHTML=priceHtml(round2(before-saving.total),before,15);}
        else totalEl.innerHTML=priceHtml(total,compareTotal,15);
      }
      if(savingsEl){savingsEl.style.display=saving?'block':'none';savingsEl.textContent=saving?'You save '+money(saving.total):'';}
      cardEntries.forEach(function(entry){
        if(!entry.priceEl)return;
        var p=entry.product,price=unitPrice(p),off=saving&&config.offerProductPrices?saving.per[String(p.id)]||0:0;
        entry.priceEl.innerHTML=off>0?priceHtml(round2(price-off),price):priceHtml(price,unitCompare(p));
      });
      var selectedCount=getSelectedCount();
      if(totalLabelEl)totalLabelEl.textContent=saving&&config.offerStrikeTotal?'Bundle total ('+(saving.count||config.offer.count)+' items)':selectedCount>0?'Total ('+selectedCount+' item'+(selectedCount>1?'s':'')+')'  :'Select items';
      if(addBtn){addBtn.classList.remove('is-done');addBtn.style.background=config.buttonColor;addBtn.style.color=config.buttonTextColor;if(selectedCount>0){addBtn.style.display='inline-flex';addBtn.style.alignItems='center';addBtn.style.justifyContent='center';var fullSet=config.offer&&!config.offer.min&&config.offer.productIds.every(function(id){return products.some(function(p){return extractNumericId(p.id)===id&&getProductQuantity(p.id)>0;});});addBtn.textContent=fullSet?'Add all '+config.offer.count+' to Cart':'Add '+selectedCount+' to Cart';}else{addBtn.style.display='none';}}
    }

    function updateUI(){cardEntries.forEach(function(entry){updateCardStyle(entry);renderControl(entry);});updateFooter();}

    /* A product's variant dropdown (Styling → "Variant picker on each product"),
       only for products with real options; starts on the variant the widget adds. */
    function variantPicker(product){
      var list=(product&&product.variants)||[];
      if(!config.showVariantPicker||list.length<2||product.sizeMissing)return '';
      var current=product.liveVariantId||'';
      var opts=list.map(function(v){return '<option value="'+escapeHtml(v.id)+'"'+(v.id===current?' selected':'')+(v.available?'':' disabled')+'>'+escapeHtml(v.title+(v.available?'':' - Sold out'))+'</option>';}).join('');
      return '<select class="ps-fbt-variant" aria-label="Choose an option" style="display:block;width:100%;max-width:100%;margin-top:'+fbtGap(config.textGap,4)+'px;padding:3px 6px;font-size:11px;border:1px solid '+config.borderColor+';border-radius:6px;background:'+config.bgColor+';color:'+config.textColor+';">'+opts+'</select>';
    }

    products.forEach(function(product,idx){
      var handleFallback=String((product&&product.handle)||'').replace(/[-_]+/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});
      var safeTitle=escapeHtml((product&&(product.title||product.name||product.productTitle||product.product_title))||handleFallback||'Product');
      var imageUrl=String((product&&product.image)||'').replace(/'/g,'%27');
      var price=toPriceNumber(product&&product.price);
      var compareAt=toPriceNumber(product&&product.compareAt);
      var card=document.createElement('div');
      if(isListStyle){
        card.className='ps-product-row';
        card.innerHTML=
          (useCheckboxLeft?'<div class="ps-product-checkbox-slot" style="display:flex;align-items:center;justify-content:center;"></div>':'')
          +'<div class="ps-product-row-image"'+(config.imagePopup?' data-fbt-zoom role="button" tabindex="0" aria-label="View pictures of '+safeTitle+'"':'')+' style="'+(config.imagePopup?'cursor:zoom-in;':'')+'width:'+Math.round(config.imageSize*0.75)+'px;height:'+Math.round(config.imageSize*0.75)+'px;border-radius:'+config.imageRadius+'px;background:'+(config.imageBg||config.borderColor+'22')+';overflow:hidden;display:flex;align-items:center;justify-content:center;">'+(imageUrl?'<img src="'+imageUrl+'" alt="" loading="lazy" style="width:100%;height:100%;object-fit:'+config.imageFit+';display:block;">':'<span style="font-size:8px;color:#9ca3af;">No image</span>')+'</div>'
          /* NOTE: intentionally NOT reusing the .ps-product-title/.ps-product-price
             classes here — those carry -webkit-line-clamp:2 + display:-webkit-box
             from the grid-card style below, which conflicts with this row's
             single-line white-space:nowrap and silently collapses the text to
             zero visible height. Distinct class names + fully inline styles
             avoid that collision entirely. Parent row is CSS Grid
             (48px / 1fr / auto columns), so this middle cell just needs
             min-width:0 to allow the ellipsis to kick in instead of
             overflowing — its actual width comes from the grid track. */
          +'<div style="min-width:0;">'
            +'<div class="ps-product-row-title" style="display:block;color:'+config.titleColor+';font-size:13px;font-weight:600;line-height:1.35;white-space:normal;word-break:break-word;">'+safeTitle+'</div>'
            +variantPicker(product)
            +(config.showPrices?'<div class="ps-product-row-price" style="display:block;margin-top:'+fbtGap(config.textGap,2)+'px;color:'+config.priceColor+';font-size:12px;font-weight:700;">'+priceHtml(price,compareAt)+'</div>':'')
          +'</div>'
          +'<div class="ps-product-action" style="display:flex;align-items:center;justify-content:flex-end;"></div>';
      }else{
        card.className='ps-product-card';
        card.innerHTML=
          '<div class="ps-product-image"'+(config.imagePopup?' data-fbt-zoom role="button" tabindex="0" aria-label="View pictures of '+safeTitle+'"':'')+' style="'+(config.imagePopup?'cursor:zoom-in;':'')+'width:100%;height:'+config.imageSize+'px;background:'+(config.imageBg||config.borderColor+'22')+';border-radius:'+config.imageRadius+'px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+(imageUrl?'<img src="'+imageUrl+'" alt="" loading="lazy" style="width:100%;height:100%;object-fit:'+config.imageFit+';display:block;">':'<span style="font-size:9px;color:#9ca3af;">No image</span>')+'</div>'
          +'<div class="ps-product-meta" style="width:100%;min-width:0;text-align:center;">'
            +'<div class="ps-product-title" style="color:'+config.titleColor+';font-size:12px;font-weight:600;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;">'+safeTitle+'</div>'
            +variantPicker(product)
            +(config.showPrices?'<div class="ps-product-price" style="margin-top:'+fbtGap(config.textGap,4)+'px;color:'+config.priceColor+';font-size:12px;font-weight:700;">'+priceHtml(price,compareAt)+'</div>':'')
          +'</div>'
          +'<div class="ps-product-action" style="display:flex;align-items:center;justify-content:center;gap:8px;flex-shrink:0;width:100%;margin-top:auto;"></div>';
      }
      wrapper.appendChild(card);
      if(showPlusSeparators&&idx<products.length-1){
        var plus=document.createElement('span');
        plus.setAttribute('aria-hidden','true');
        plus.textContent='+';
        plus.style.cssText='display:flex;align-items:center;justify-content:center;flex-shrink:0;width:16px;font-size:18px;font-weight:700;color:'+config.textColor+';opacity:0.4;align-self:center;';
        wrapper.appendChild(plus);
      }
      var entry={product:product,card:card,actionSlot:card.querySelector('.ps-product-action'),checkboxSlot:card.querySelector('.ps-product-checkbox-slot'),priceEl:card.querySelector('.ps-product-row-price,.ps-product-price'),requiredBadge:null};
      cardEntries.set(String(product.id),entry);
      var zoomEl=config.imagePopup&&card.querySelector('[data-fbt-zoom]');
      if(zoomEl){
        var openZoom=function(){openFbtGallery({title:safeTitle,handle:product.handle,image:(zoomEl.querySelector('img')&&zoomEl.querySelector('img').getAttribute('src'))||product.image,priceHtml:config.showPrices?priceHtml(unitPrice(product),unitCompare(product)):'',config:config,opener:zoomEl});};
        zoomEl.addEventListener('click',openZoom);
        zoomEl.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openZoom();}});
      }
      var picker=card.querySelector('.ps-fbt-variant');
      if(picker){
        picker.addEventListener('change',function(){
          chosenVariants.set(String(product.id),picker.value);
          updateFooter();
        });
      }
    });

    updateUI();

    /* Responsive: re-apply card sizing when the viewport crosses the mobile breakpoint */
    var _psResizeT;
    window.addEventListener('resize',function(){
      clearTimeout(_psResizeT);
      _psResizeT=setTimeout(function(){cardEntries.forEach(updateCardStyle);},150);
    });

    if(addBtn){
      addBtn.onclick=async function(){
        var defaultLabel=addBtn.textContent||'Add to Cart';
        addBtn.disabled=true;addBtn.textContent='Adding...';addBtn.style.background=config.loadingBgColor;
        try{
          var variantLookup=await buildVariantLookup(products);
          var items=[];var skipped=[];
          var productById=new Map((products||[]).map(function(p){return[String(p.id),p];}));
          products.forEach(function(product){
            var id=String(product.id);var qty=getProductQuantity(id);
            if(qty<=0){skipped.push({id:id,title:product.title,reason:'not-selected'});return;}
            var variantId=chosenVariants.get(id)||variantLookup.get(id);
            if(!variantId){skipped.push({id:id,title:product.title,reason:'variant-lookup-failed'});return;}
            var fullProduct=productById.get(id);
            items.push({id:String(variantId),quantity:qty,productId:id,productTitle:(fullProduct&&fullProduct.title)||'Product'});
          });
          if(!items.length){var reasons=skipped.map(function(p){return p.title+'('+p.reason+')';}).join(', ');throw new Error('Unable to add any products. Skipped: '+reasons);}
          /* With a "buy all together" offer, the product being viewed is part of
             the set: add the variant chosen on the page too, unless it's in the cart. */
          if(config.offer&&config.currentProductId){
            try{
              var pageForm=document.querySelector('form[action*="/cart/add"] [name="id"]');
              var pageVariant=pageForm&&normalizeVariantId(pageForm.value);
              if(pageVariant){
                var cartNow=await fetch('/cart.js',{headers:{Accept:'application/json'}}).then(function(r){return r.json();}).catch(function(){return{items:[]};});
                var inCart=(cartNow.items||[]).some(function(it){return String(it.product_id)===String(config.currentProductId);});
                if(!inCart)items.unshift({id:String(pageVariant),quantity:1,productId:config.currentProductId,productTitle:'This product'});
              }
            }catch(e){}
          }
          var result=await(async function(items){
            async function postAdd(its){var r=await fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:its})});if(!r.ok)throw new Error('cart add failed');return r;}
            try{await postAdd(items);return{addedItems:items,failedItems:[]};}
            catch(batchErr){
              var settled=await Promise.all(items.map(async function(item){try{await postAdd([{id:item.id,quantity:item.quantity}]);return{ok:true,item:item};}catch(e){return{ok:false,item:item,error:e&&e.message};}}));
              return{addedItems:settled.filter(function(s){return s.ok;}).map(function(s){return s.item;}),failedItems:settled.filter(function(s){return!s.ok;}).map(function(s){return Object.assign({},s.item,{error:s.error});})};
            }
          })(items);
          if(!result.addedItems.length)throw new Error('Failed to add selected products to cart.');
          openCartDrawerFast({source:'fbt',items:result.addedItems});
          var totalQty=result.addedItems.reduce(function(s,item){return s+(Number(item.quantity)||0);},0);
          addBtn.textContent=totalQty>1?'Added '+totalQty:'Added';
          addBtn.classList.add('is-done');addBtn.style.background=config.successBgColor;addBtn.style.color=config.successTextColor;
          setTimeout(function(){updateFooter();},1200);
        }catch(err){addBtn.textContent=defaultLabel;addBtn.style.background=config.buttonColor;addBtn.style.color=config.buttonTextColor;}
        finally{addBtn.disabled=false;}
      };
    }
  }
})();
