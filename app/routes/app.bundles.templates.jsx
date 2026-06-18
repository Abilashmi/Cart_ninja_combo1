import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useNavigation,
} from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { Text, Popover, ActionList, Modal } from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { getDb, sendToPhp } from '../utils/api-helpers';
import prisma from '../db.server';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';

// ── Layout preset metadata ────────────────────────────────────────────────────
const layoutMetadata = [
  {
    id: 1,
    title: 'The Guided Architect',
    description: 'Conversion-focused multi-step builder with progress tracking and tiered discount logic.',
    img: '/combo-design-one-preview.png',
    fallbackImg: 'https://placehold.co/400x300/5B47FB/ffffff?text=Guided+Architect',
    badge: 'Core',
    blockName: 'combo_main',
    accent: '#5B47FB',
    features: ['Visual progress tracking', 'Tiered discount engine', 'Step-by-step flow', 'Sticky summary bar'],
    bestFor: 'Complex bundles & high-value kits',
  },
  {
    id: 2,
    title: 'The Velocity Stream',
    description: 'Immersive motion-driven experience with an auto-scrolling carousel for maximum engagement.',
    img: '/combo-design-two-preview.png',
    fallbackImg: 'https://placehold.co/400x300/8B5CF6/ffffff?text=Velocity+Stream',
    badge: 'Trending',
    blockName: 'combo_design_two',
    accent: '#8B5CF6',
    features: ['Smooth auto-scroll motion', 'Touch-optimized swiping', 'Infinite loop', 'Visual-first discovery'],
    bestFor: 'Visual storytelling & featured promos',
  },
  {
    id: 3,
    title: 'The Editorial Split',
    description: 'Premium split layout pairing high-impact imagery with detailed product storytelling.',
    img: '/combo-design-four-preview.png',
    fallbackImg: 'https://placehold.co/400x300/0F0F23/ffffff?text=Editorial+Split',
    badge: 'Premium',
    blockName: 'combo_design_four',
    accent: '#0F0F23',
    features: ['Luxe split-screen', 'Detail-rich narratives', 'High-contrast callouts', 'Dark mode elegance'],
    bestFor: 'Luxury items & brand storytelling',
  },
  {
    id: 6,
    title: 'Custom Bundle Layout',
    description: 'Build your own custom bundle layout with fully flexible configuration options.',
    img: '/combo-design-one-preview.png',
    fallbackImg: 'https://placehold.co/400x300/10B981/ffffff?text=Custom+Bundle',
    badge: 'Flexible',
    blockName: 'custom_bundle_layout',
    accent: '#10B981',
    features: ['Drag-and-drop builder', 'Custom CSS support', 'Dynamic pricing rules', 'A/B testing ready'],
    bestFor: 'Advanced & experimental setups',
  },
];

// ── Action ────────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const contentType = request.headers.get('content-type') || '';
  let data;
  try {
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      data = Object.fromEntries(form.entries());
    }
  } catch {
    return Response.json({ error: 'Failed to parse request data' }, { status: 400 });
  }

  const { intent, id } = data;

  if (intent === 'delete') {
    try {
      const dbResult = await sendToPhp(
        { event: 'delete', resource: 'templates', shop, data: { id } },
        'templates.php'
      );
      if (!dbResult?.success) {
        return Response.json(
          { success: false, error: dbResult?.error || 'PHP rejected the delete' },
          { status: 500 }
        );
      }
      return Response.json({ success: true, message: 'Template deleted' });
    } catch (dbError) {
      return Response.json({ success: false, error: dbError.message }, { status: 500 });
    }
  }

  if (intent === 'toggle_active') {
    const active = data.active === 'true' || data.active === true;
    try {
      const dbResult = await sendToPhp(
        { event: 'update', resource: 'templates', shop, data: { id, active } },
        'templates.php'
      );
      if (!dbResult?.success) {
        return Response.json(
          { success: false, error: dbResult?.error || 'PHP rejected the update' },
          { status: 500 }
        );
      }
      return Response.json({
        success: true,
        message: `Template marked as ${active ? 'active' : 'inactive'}`,
      });
    } catch (dbError) {
      return Response.json({ success: false, error: dbError.message }, { status: 500 });
    }
  }

  // Default — template creation
  try {
    const db = await getDb(shop);
    const templates = db.templates || [];
    let { title, config, layout } = data;
    if (!title) title = 'Untitled Template';
    if (!config) config = { layout: layout || 'layout1' };
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { config = { layout: layout || 'layout1' }; }
    }
    if (!config.layout && layout) config.layout = layout;
    if (!config.layout) {
      return Response.json({ error: 'Invalid configuration: Missing Layout' }, { status: 400 });
    }

    const newTemplate = {
      id: Math.max(...templates.map((t) => t.id), 0) + 1,
      title, config, active: true, shop,
      createdAt: new Date().toISOString(),
    };

    try {
      await sendToPhp(
        { event: 'create', resource: 'templates', shop, data: newTemplate },
        'templates.php'
      );
    } catch (dbError) {
      console.error('[Templates Sync] MySQL Create Error:', dbError.message);
    }
    return Response.json({ success: true, message: 'Template created successfully', newTemplateId: newTemplate.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
};

// ── Loader ────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let templates = [];
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC`,
      shop
    );
    templates = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: Number(r.id),
      title: r.name || 'Untitled',
      active: r.is_active === 1,
      config: (() => { try { return JSON.parse(r.customization_data || '{}'); } catch { return {}; } })(),
      template_type: r.template_type || 'grid',
      slug: r.slug,
      status: r.status,
      page_url: r.page_handle,
      created_at: r.created_at,
      updated_at: r.updated_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (e) {
    console.error('[Templates] SQLite read error:', e);
  }

  return Response.json({ templates, shop });
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function TemplatesPage() {
  const fetcher                 = useFetcher();
  const { templates: initialTemplates, shop } = useLoaderData();
  const navigate                = useNavigate();
  const shopify                 = useAppBridge();
  const navigation              = useNavigation();
  const deletedIds              = useRef(new Set());
  const [isClient, setIsClient] = useState(false);
  const [templates, setTemplates] = useState(initialTemplates || []);
  const [searchValue, setSearchValue] = useState('');
  const [filterTab, setFilterTab]     = useState('all'); // all | active | inactive
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteModalOpen, setDeleteModalOpen]   = useState(false);
  const [toggleModalOpen, setToggleModalOpen]   = useState(false);
  const [targetTemplate, setTargetTemplate]     = useState(null);
  const [activePopoverId, setActivePopoverId]   = useState(null);
  const itemsPerPage = 9;

  const isMainNavigating =
    navigation.state !== 'idle' &&
    navigation.location?.pathname?.includes('/app/bundles/customize');

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    if (fetcher.data?.success) shopify.toast.show(fetcher.data.message || 'Success');
    else if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    setTemplates((initialTemplates || []).filter(t => !deletedIds.current.has(String(t.id))));
  }, [initialTemplates]);

  useEffect(() => { setCurrentPage(1); }, [searchValue, filterTab]);

  const handleEditNavigate  = (id) => navigate(`/app/bundles/customize?templateId=${id}`);
  const handlePreview       = (t)  => window.open(`/preview/${t.id}?shop=${encodeURIComponent(shop)}`, '_blank');
  const handleCreateTemplate = ()  => navigate('/app/bundles/customize');

  const confirmDelete = () => {
    if (!targetTemplate) return;
    const deletedId = String(targetTemplate.id);
    deletedIds.current.add(deletedId);
    setTemplates(prev => prev.filter(t => String(t.id) !== deletedId));
    fetcher.submit({ id: targetTemplate.id, intent: 'delete' }, { method: 'post', action: '/app/bundles/templates' });
    setDeleteModalOpen(false);
    setTargetTemplate(null);
  };

  const confirmToggleStatus = () => {
    if (!targetTemplate) return;
    const toggledId  = String(targetTemplate.id);
    const newActive  = !targetTemplate.active;
    setTemplates(prev => prev.map(t => String(t.id) === toggledId ? { ...t, active: newActive } : t));
    fetcher.submit(
      { id: targetTemplate.id, active: newActive, intent: 'toggle_active' },
      { method: 'post', action: '/app/bundles/templates' }
    );
    setToggleModalOpen(false);
    setTargetTemplate(null);
  };

  const getLayoutMeta = (config) => {
    const layoutMap = { layout1: 'combo_main', layout2: 'combo_design_two', layout3: 'combo_design_three', layout4: 'combo_design_four' };
    const blockName = layoutMap[config?.layout] || 'combo_main';
    return layoutMetadata.find(m => m.blockName === blockName) || layoutMetadata[0];
  };

  const filteredTemplates = templates.filter(t => {
    const matchSearch = (t.title || '').toLowerCase().includes((searchValue || '').toLowerCase());
    const matchTab    = filterTab === 'all' || (filterTab === 'active' && t.active) || (filterTab === 'inactive' && !t.active);
    return matchSearch && matchTab;
  });

  const totalTemplates    = filteredTemplates.length;
  const totalPages        = Math.ceil(totalTemplates / itemsPerPage) || 1;
  const validPage         = Math.max(1, Math.min(currentPage, totalPages));
  const startIdx          = (validPage - 1) * itemsPerPage;
  const paginatedTemplates = filteredTemplates.slice(startIdx, startIdx + itemsPerPage);

  const counts = {
    all:      templates.length,
    active:   templates.filter(t => t.active).length,
    inactive: templates.filter(t => !t.active).length,
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', color: '#0F0F23' }}>
      <TitleBar title="Template Library" />

      {/* Loading bar */}
      {isMainNavigating && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: '3px',
          background: 'linear-gradient(90deg, #5B47FB, #8B5CF6)',
          zIndex: 9999, animation: 'loadingSlide 1.5s ease-in-out infinite',
        }} />
      )}

      <style>{`
        @keyframes loadingSlide { 0%{transform:scaleX(0);transform-origin:left} 50%{transform:scaleX(0.7);transform-origin:left} 100%{transform:scaleX(1);transform-origin:left} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .tpl-card         { background:#fff; border-radius:14px; border:1px solid rgba(15,15,35,0.07); box-shadow:0 1px 3px rgba(0,0,0,0.04); overflow:hidden; transition:box-shadow 0.18s, transform 0.18s; }
        .tpl-card:hover   { box-shadow:0 6px 20px rgba(0,0,0,0.10); transform:translateY(-2px); }
        .preset-card      { background:#fff; border-radius:14px; border:1px solid rgba(15,15,35,0.08); overflow:hidden; transition:box-shadow 0.18s, transform 0.18s, border-color 0.18s; cursor:pointer; }
        .preset-card:hover{ box-shadow:0 8px 24px rgba(0,0,0,0.12); transform:translateY(-3px); border-color:rgba(91,71,251,0.30); }
        .filter-pill      { padding:6px 14px; border-radius:20px; border:1.5px solid rgba(15,15,35,0.10); background:#fff; font-size:12.5px; font-weight:550; color:#64748B; cursor:pointer; transition:all 0.13s; white-space:nowrap; font-family:inherit; }
        .filter-pill:hover{ border-color:#5B47FB; color:#5B47FB; }
        .filter-pill.active{ background:#5B47FB; border-color:#5B47FB; color:#fff; }
        .tpl-action-btn   { width:30px; height:30px; border-radius:7px; border:1px solid rgba(15,15,35,0.08); background:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#64748B; transition:all 0.13s; }
        .tpl-action-btn:hover{ border-color:#5B47FB; color:#5B47FB; background:rgba(91,71,251,0.06); }
        .search-input-cs  { padding:9px 14px 9px 36px; border-radius:8px; border:1.5px solid rgba(15,15,35,0.10); background:#fff; font-size:13px; width:220px; outline:none; color:#0F0F23; font-family:inherit; transition:border-color 0.15s; }
        .search-input-cs::placeholder{ color:#94A3B8; }
        .search-input-cs:focus{ border-color:#5B47FB; }
        .tpl-img-area { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; }
        .tpl-img-placeholder { width:100%; aspect-ratio:16/9; display:flex; align-items:center; justify-content:center; font-size:32px; }
        @media(max-width:768px){ .tpl-grid-3{ grid-template-columns:1fr !important; } .preset-grid{ grid-template-columns:1fr 1fr !important; } }
        @media(max-width:540px){ .preset-grid{ grid-template-columns:1fr !important; } }
      `}</style>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '28px', gap: '16px', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '750', color: '#0F0F23', letterSpacing: '-0.5px' }}>
            Template Library
          </h1>
          <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '4px' }}>
            {templates.length} template{templates.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
            {counts.active} active &nbsp;·&nbsp; {counts.inactive} inactive
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Filter pills */}
          {['all', 'active', 'inactive'].map(tab => (
            <button
              key={tab}
              className={`filter-pill${filterTab === tab ? ' active' : ''}`}
              onClick={() => setFilterTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              <span style={{ marginLeft: '5px', opacity: 0.7 }}>({counts[tab]})</span>
            </button>
          ))}

          <div style={{ width: '1px', height: '22px', background: 'rgba(0,0,0,0.08)' }} />

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <svg style={{ position:'absolute', left:'11px', top:'50%', transform:'translateY(-50%)', color:'#94A3B8', pointerEvents:'none' }}
              width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M9 17C13.4 17 17 13.4 17 9S13.4 1 9 1 1 4.6 1 9s3.6 8 8 8zM19 19l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              className="search-input-cs"
              placeholder="Search templates…"
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
            />
          </div>

          {/* Create button */}
          <button
            onClick={handleCreateTemplate}
            style={{
              padding: '9px 18px', borderRadius: '9px',
              background: '#5B47FB', color: '#fff',
              border: 'none', fontWeight: '650', fontSize: '13.5px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px',
              boxShadow: '0 2px 8px rgba(91,71,251,0.28)',
              fontFamily: 'inherit',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
            New Template
          </button>
        </div>
      </div>

      {/* ── Layout Presets ───────────────────────────────────────────── */}
      <div style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: '650', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            Built-in Layout Styles
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>Click to start building</div>
        </div>

        <div className="preset-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          {layoutMetadata.map(meta => (
            <div
              key={meta.id}
              className="preset-card"
              onClick={() => navigate(`/app/bundles/customize?layout=${meta.blockName}`)}
            >
              {/* Preview image */}
              <div style={{
                width: '100%', aspectRatio: '16/9',
                background: `linear-gradient(135deg, ${meta.accent}22 0%, ${meta.accent}10 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', overflow: 'hidden',
              }}>
                <img
                  src={meta.img}
                  alt={meta.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
                {/* Badge */}
                <div style={{
                  position: 'absolute', top: '10px', left: '10px',
                  padding: '3px 9px', borderRadius: '20px',
                  background: meta.accent, color: '#fff',
                  fontSize: '10px', fontWeight: '700', letterSpacing: '0.4px',
                  textTransform: 'uppercase',
                }}>
                  {meta.badge}
                </div>
              </div>

              {/* Content */}
              <div style={{ padding: '14px 16px 16px' }}>
                <div style={{ fontSize: '13.5px', fontWeight: '700', color: '#0F0F23', marginBottom: '4px' }}>
                  {meta.title}
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', lineHeight: 1.5, marginBottom: '12px' }}>
                  {meta.description}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '14px' }}>
                  {meta.features.slice(0, 3).map(f => (
                    <span key={f} style={{
                      padding: '3px 8px', borderRadius: '6px',
                      background: `${meta.accent}10`, color: meta.accent,
                      fontSize: '11px', fontWeight: '550',
                    }}>
                      {f}
                    </span>
                  ))}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); navigate(`/app/bundles/customize?layout=${meta.blockName}`); }}
                  style={{
                    width: '100%', padding: '8px', borderRadius: '8px',
                    background: `${meta.accent}12`, color: meta.accent,
                    border: `1px solid ${meta.accent}25`,
                    fontWeight: '650', fontSize: '12.5px', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = `${meta.accent}22`; }}
                  onMouseOut={e => { e.currentTarget.style.background = `${meta.accent}12`; }}
                >
                  Use This Layout →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── My Templates grid ────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: '650', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            My Templates
            {totalTemplates > 0 && (
              <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(91,71,251,0.1)', color: '#5B47FB', fontSize: '11px', fontWeight: '700' }}>
                {totalTemplates}
              </span>
            )}
          </div>
          {totalTemplates > 0 && (
            <span style={{ fontSize: '12px', color: '#94A3B8' }}>
              Showing {Math.min(startIdx + 1, totalTemplates)}–{Math.min(startIdx + itemsPerPage, totalTemplates)} of {totalTemplates}
            </span>
          )}
        </div>

        {isClient && paginatedTemplates.length > 0 ? (
          <div className="tpl-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
            {paginatedTemplates.map((t) => {
              const meta        = getLayoutMeta(t.config);
              const imgSrc      = t.config?.banner_image_url || meta.img;
              const dateStr     = t.createdAt
                ? new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—';

              return (
                <div key={t.id} className="tpl-card">
                  {/* Thumbnail */}
                  <div style={{ position: 'relative' }}>
                    <div style={{
                      width: '100%', aspectRatio: '16/9',
                      background: `linear-gradient(135deg, ${meta.accent}18, ${meta.accent}08)`,
                      overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <img
                        src={imgSrc}
                        alt={t.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    {/* Status dot */}
                    <div style={{
                      position: 'absolute', top: '10px', right: '10px',
                      padding: '3px 9px', borderRadius: '20px',
                      background: t.active ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                      backdropFilter: 'blur(4px)',
                      border: `1px solid ${t.active ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.25)'}`,
                      color: t.active ? '#10B981' : '#64748B',
                      fontSize: '10.5px', fontWeight: '700',
                      display: 'flex', alignItems: 'center', gap: '5px',
                    }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                      {t.active ? 'Active' : 'Inactive'}
                    </div>
                  </div>

                  {/* Card body */}
                  <div style={{ padding: '14px 16px 16px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#0F0F23', marginBottom: '3px', lineHeight: 1.3 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '14px' }}>
                      {meta.title} &nbsp;·&nbsp; {dateStr}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleEditNavigate(t.id)}
                        style={{
                          flex: 1, padding: '8px 12px', borderRadius: '8px',
                          background: '#5B47FB', color: '#fff',
                          border: 'none', fontWeight: '600', fontSize: '12.5px',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Edit
                      </button>
                      <div
                        className="tpl-action-btn"
                        onClick={() => handlePreview(t)}
                        title="Preview"
                      >
                        <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                          <path d="M9 3C5 3 2 7.5 2 9s3 6 7 6 7-4.5 7-6-3-6-7-6zm0 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor"/>
                        </svg>
                      </div>
                      <div className="tpl-action-btn" style={{ position: 'relative' }}>
                        <Popover
                          active={activePopoverId === t.id}
                          activator={
                            <div
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}
                              onClick={e => { e.stopPropagation(); setActivePopoverId(activePopoverId === t.id ? null : t.id); }}
                            >
                              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                                <circle cx="10" cy="5" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="15" r="1.5"/>
                              </svg>
                            </div>
                          }
                          onClose={() => setActivePopoverId(null)}
                        >
                          <ActionList
                            actionRole="menuitem"
                            items={[
                              {
                                content: t.active ? 'Deactivate' : 'Activate',
                                onAction: () => { setTargetTemplate(t); setToggleModalOpen(true); setActivePopoverId(null); },
                              },
                              {
                                content: 'Delete',
                                destructive: true,
                                onAction: () => { setTargetTemplate(t); setDeleteModalOpen(true); setActivePopoverId(null); },
                              },
                            ]}
                          />
                        </Popover>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : isClient && templates.length === 0 ? (
          /* Empty state — no templates at all */
          <div style={{
            textAlign: 'center', padding: '72px 24px',
            background: '#fff', borderRadius: '16px',
            border: '1.5px dashed rgba(91,71,251,0.22)',
            marginBottom: '24px',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>✦</div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#0F0F23', marginBottom: '7px' }}>
              No templates yet
            </div>
            <div style={{ fontSize: '13.5px', color: '#64748B', marginBottom: '22px', maxWidth: '360px', margin: '0 auto 22px' }}>
              Choose a layout preset above or create a custom bundle from scratch.
            </div>
            <button
              onClick={handleCreateTemplate}
              style={{
                padding: '11px 24px', borderRadius: '9px',
                background: '#5B47FB', color: '#fff',
                border: 'none', fontWeight: '650', fontSize: '13.5px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              + Create Your First Template
            </button>
          </div>
        ) : isClient && paginatedTemplates.length === 0 ? (
          /* No results for search */
          <div style={{ textAlign: 'center', padding: '56px 24px', background: '#fff', borderRadius: '16px', border: '1px solid rgba(15,15,35,0.07)', marginBottom: '24px' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔍</div>
            <div style={{ fontSize: '15px', fontWeight: '650', color: '#0F0F23', marginBottom: '6px' }}>No results</div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>Try a different search term or switch the filter.</div>
          </div>
        ) : null}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: '12.5px', color: '#94A3B8' }}>
              Page {validPage} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                <button
                  key={pg}
                  onClick={() => setCurrentPage(pg)}
                  style={{
                    width: '34px', height: '34px', borderRadius: '8px',
                    border: pg === validPage ? 'none' : '1px solid rgba(15,15,35,0.10)',
                    background: pg === validPage ? '#5B47FB' : '#fff',
                    color: pg === validPage ? '#fff' : '#64748B',
                    fontWeight: '600', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {pg}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mobile FAB */}
      <button
        onClick={handleCreateTemplate}
        style={{
          position: 'fixed', bottom: '24px', right: '24px',
          width: '54px', height: '54px', borderRadius: '50%',
          background: '#5B47FB', color: '#fff',
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(91,71,251,0.45)',
          display: 'none', alignItems: 'center', justifyContent: 'center',
          zIndex: 99, fontFamily: 'inherit',
        }}
        className="mobile-fab-cs"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>

      {/* ── Delete confirmation modal ─── */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Template"
        primaryAction={{ content: 'Delete', destructive: true, onAction: confirmDelete }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete <strong>{targetTemplate?.title}</strong>? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* ── Toggle status confirmation modal ─── */}
      <Modal
        open={toggleModalOpen}
        onClose={() => setToggleModalOpen(false)}
        title={targetTemplate?.active ? 'Deactivate Template' : 'Activate Template'}
        primaryAction={{ content: targetTemplate?.active ? 'Deactivate' : 'Activate', onAction: confirmToggleStatus }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setToggleModalOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to mark <strong>{targetTemplate?.title}</strong> as{' '}
            {targetTemplate?.active ? 'inactive' : 'active'}?
          </Text>
        </Modal.Section>
      </Modal>
    </div>
  );
}
