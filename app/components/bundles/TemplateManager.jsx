import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useNavigation,
} from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { Text, Popover, ActionList, Modal, BlockStack } from '@shopify/polaris';
import { usePlan } from '../PlanContext';
import { PLANS } from '../../config/plans';

// --- Add action to save new templates ---
// Layout designs metadata (same as dashboard)
const layoutMetadata = [
  {
    id: 1,
    title: 'The Guided Architect',
    description:
      'A conversion-focused multi-step builder with progress tracking and tiered discount logic.',
    img: '/combo-design-one-preview.png',
    fallbackImg:
      'https://placehold.co/400x300/000000/ffffff?text=Guided+Architect',
    badge: 'Core',
    badgeTone: undefined,
    blockName: 'combo_main',
    features: [
      'Visual progress tracking',
      'Tiered discount engine',
      'Step-by-step selection flow',
      'Sticky summary footer',
      'Ideal for complex kits',
    ],
    bestFor: 'Complex bundles and high-value kits',
  },
  {
    id: 2,
    title: 'The Velocity Stream',
    description:
      'An immersive, motion-driven experience featuring an auto-scrolling carousel for maximum engagement.',
    img: '/combo-design-two-preview.png',
    fallbackImg:
      'https://placehold.co/400x300/000000/ffffff?text=Motion+Slider',
    badge: 'Trending',
    badgeTone: undefined,
    blockName: 'combo_design_two',
    features: [
      'Smooth auto-scroll motion',
      'Touch-optimized swiping',
      'Dynamic navigation cues',
      'Infinite loop storytelling',
      'Visual-first discovery',
    ],
    bestFor: 'Visual storytelling and featured promotions',
  },
  {
    id: 3,
    title: 'The Editorial Split',
    description:
      'A premium, sophisticated layout that pairs high-impact imagery with detailed product storytelling.',
    img: '/combo-design-four-preview.png',
    fallbackImg:
      'https://placehold.co/400x300/000000/ffffff?text=Editorial+Split',
    badge: 'Premium',
    badgeTone: undefined,
    blockName: 'combo_design_four',
    features: [
      'Luxe split-screen design',
      'Detail-rich narratives',
      'High-contrast callouts',
      'Dark mode elegance',
      'Psychology-driven flow',
    ],
    bestFor: 'Luxury items and high-impact product stories',
  },
  {
    id: 6,
    title: 'Custom Bundle Layout',
    description: 'Build your own custom bundle layout with flexible options',
    img: '/combo-design-one-preview.png', // Placeholder
    fallbackImg:
      'https://placehold.co/400x300/000000/ffffff?text=Custom+Bundle',
    badge: 'Flexible',
    badgeTone: undefined, // distinct tone
    blockName: 'custom_bundle_layout',
    features: [
      'Drag-and-drop builder',
      'Custom CSS support',
      'Dynamic pricing rules',
      'Multi-step configuration',
      'A/B testing ready',
    ],
    bestFor: 'Advanced experimental setups',
  },
];

export default function TemplateManager() {
  const fetcher = useFetcher();
  const { templates: initialTemplates, shop, discounts } = useLoaderData();
  const navigate = useNavigate();
  const shopify = { toast: { show: (msg) => console.log('[Toast]', msg) } };
  const navigation = useNavigation();
  const { plan, canAccessFeature } = usePlan();
  const comboTemplateLimit = PLANS[plan]?.comboTemplateLimit;
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  const isMainNavigating =
    navigation.state !== 'idle' &&
    navigation.location?.pathname?.includes('/app/bundles/customize');

  const [isClient, setIsClient] = useState(false);
  useEffect(() => { setIsClient(true); }, []);

  // Tracks the in-flight optimistic delete/toggle so a failed server-side
  // mutation can be rolled back instead of leaving a "ghost" template that's
  // hidden from the dashboard (via deletedIds) but still counts toward the
  // plan's combo template cap in api.bundle-templates.jsx, silently blocking
  // future saves with a "limit reached" error the merchant can't explain.
  const lastMutationRef = useRef(null);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message || 'Success');
      lastMutationRef.current = null;
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
      const last = lastMutationRef.current;
      if (last?.type === 'delete') {
        deletedIds.current.delete(last.id);
        setTemplates((prev) => (prev.some((t) => String(t.id) === last.id)
          ? prev
          : [...prev, ...(initialTemplates || []).filter((t) => String(t.id) === last.id)]
        ));
      } else if (last?.type === 'toggle') {
        setTemplates((prev) => prev.map((t) =>
          String(t.id) === last.id ? { ...t, active: last.prevActive } : t
        ));
      }
      lastMutationRef.current = null;
    }
  }, [fetcher.data, shopify, initialTemplates]);

  const [templates, setTemplates] = useState(initialTemplates || []);
  const deletedIds = useRef(new Set());
  const previewFetcher = useFetcher();
  const previewHandledRef = useRef(null);

  useEffect(() => {
    if (previewFetcher.data?.success && previewFetcher.data?.previewUrl) {
      window.open(previewFetcher.data.previewUrl, '_blank');
      previewHandledRef.current = null;
    } else if (previewFetcher.data?.error) {
      shopify.toast.show(previewFetcher.data.error, { isError: true });
      previewHandledRef.current = null;
    }
  }, [previewFetcher.data, shopify]);

  const handlePreview = (t) => {
    window.open(`/preview/${t.id}?shop=${encodeURIComponent(shop)}`, '_blank');
  };

  useEffect(() => {
    setTemplates(
      (initialTemplates || []).filter((t) => !deletedIds.current.has(String(t.id)))
    );
  }, [initialTemplates]);

  const [selectedTab] = useState(0);
  const [searchValue, setSearchValue] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  useEffect(() => { setCurrentPage(1); }, [searchValue, selectedTab]);

  const handleEditNavigate = (id) => {
    navigate(`/app/bundles/customize?templateId=${id}`);
  };

  const filterDesign = '';
  const filterDiscount = '';

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = (template.title || '')
      .toLowerCase()
      .includes((searchValue || '').toLowerCase());
    const matchesTab =
      selectedTab === 0 ||
      (selectedTab === 1 && template.active) ||
      (selectedTab === 2 && !template.active);
    const layoutMap = {
      layout1: 'combo_main',
      layout2: 'combo_design_two',
      layout3: 'combo_design_three',
      layout4: 'combo_design_four',
    };
    const templateLayout = template.config?.layout || 'layout1';
    const matchesDesign =
      !filterDesign ||
      templateLayout === filterDesign ||
      layoutMap[templateLayout] === filterDesign;
    const templateDiscountId = template.config?.selected_discount_id;
    const matchesDiscount =
      !filterDiscount || String(templateDiscountId) === String(filterDiscount);
    return matchesSearch && matchesTab && matchesDesign && matchesDiscount;
  });

  // Modal states for confirmations
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [toggleModalOpen, setToggleModalOpen] = useState(false);
  const [targetTemplate, setTargetTemplate] = useState(null);
  const [activePopoverId, setActivePopoverId] = useState(null);

  // Define confirm handlers
  const confirmDelete = () => {
    if (targetTemplate) {
      const deletedId = String(targetTemplate.id);
      lastMutationRef.current = { type: 'delete', id: deletedId };
      deletedIds.current.add(deletedId);
      setTemplates((prev) => prev.filter((t) => String(t.id) !== deletedId));
      fetcher.submit(
        { id: targetTemplate.id, intent: 'delete' },
        { method: 'post', action: '/app/bundles' }
      );
      setDeleteModalOpen(false);
      setTargetTemplate(null);
    }
  };

  const confirmToggleStatus = () => {
    if (targetTemplate) {
      const toggledId = String(targetTemplate.id);
      const newActive = !targetTemplate.active;
      lastMutationRef.current = { type: 'toggle', id: toggledId, prevActive: targetTemplate.active };
      setTemplates((prev) =>
        prev.map((t) =>
          String(t.id) === toggledId ? { ...t, active: newActive } : t
        )
      );
      fetcher.submit(
        {
          id: targetTemplate.id,
          active: newActive,
          intent: 'toggle_active',
        },
        { method: 'post', action: '/app/bundles' }
      );
      setToggleModalOpen(false);
      setTargetTemplate(null);
    }
  };

  // Actual Pagination Logic
  const totalTemplates = filteredTemplates.length;
  const totalPages = Math.ceil(totalTemplates / itemsPerPage);

  const validCurrentPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startIndex = (validCurrentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalTemplates);
  const paginatedTemplates = filteredTemplates.slice(startIndex, endIndex);

  const displayStart = totalTemplates > 0 ? startIndex + 1 : 0;
  const displayEnd = endIndex;
  const totalCountStr = totalTemplates;

  // --- Create Template Button Handler ---
  // Send users into the template picker first, then into the builder after selection.
  // Pre-emptive plan check: block before the merchant builds a whole template
  // and only then hits the 403 at save time (server still enforces this too,
  // see api.bundle-templates.jsx).
  const handleCreateTemplate = () => {
    const atCap = comboTemplateLimit !== null && comboTemplateLimit !== undefined
      && templates.length >= comboTemplateLimit;
    if (!canAccessFeature('build_a_combo') || atCap) {
      setUpgradeModalOpen(true);
      return;
    }
    navigate('/app/bundles/customize?mode=template-picker');
  };

  return (
    <div className="template-page-wrapper">
      <div
        className={`global-loading-bar ${isMainNavigating ? 'loading' : ''}`}
      />
      <style>{`
        .template-page-wrapper {
            background-color: transparent;
        }
        .template-content {
            max-width: none;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .header-card {
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 20px 24px;
        }
        .header-section {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header-title {
            font-size: 22px;
            font-weight: 800;
            color: #111827;
            margin: 0;
            letter-spacing: -0.5px;
        }
        .header-subtitle {
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 700;
            letter-spacing: 1.5px;
            color: #6B7280;
            margin: 0 0 6px 0;
        }
        .tpl-dashboard-stats {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-top: 6px;
        }
        .tpl-stat {
            font-size: 12px;
            font-weight: 600;
            color: #6B7280;
        }
        .tpl-stat + .tpl-stat::before {
            content: '·';
            margin-right: 12px;
            color: #D1D5DB;
        }
        .header-controls {
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .search-container {
            position: relative;
        }
        .search-icon {
            position: absolute;
            left: 14px;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            color: #6B7280;
        }
        .search-input {
            padding: 10px 16px 10px 36px;
            border-radius: 6px;
            border: 1px solid #E5E7EB;
            background: #F3F4F6;
            font-size: 13px;
            width: 240px;
            outline: none;
            transition: all 0.2s;
            color: #111827;
        }
        .search-input::placeholder {
            color: #9CA3AF;
        }
        .search-input:focus {
            border-color: #111827;
            background: #fff;
        }
        .filter-btn {
            padding: 10px 16px;
            border-radius: 6px;
            border: 1px solid #E5E7EB;
            background: #F3F4F6;
            font-size: 13px;
            font-weight: 600;
            color: #374151;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        .filter-btn:hover {
            background: #E5E7EB;
        }
        .create-btn {
            padding: 10px 20px;
            border-radius: 6px;
            background: #111827;
            color: #fff;
            border: none;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        .create-btn:hover {
            background: #000000;
            transform: translateY(-1px);
        }
        .section-label {
            font-size: 13px;
            font-weight: 800;
            color: #6B7280;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 16px;
        }
        .library-section {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            padding: 20px 20px 20px 20px;
            border-radius: 12px;
        }
        .library-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .library-title {
            font-size: 16px;
            font-weight: 700;
            color: #111827;
            margin: 0;
            letter-spacing: -0.3px;
        }
        .library-icons {
            display: flex;
            gap: 16px;
            color: #6B7280;
        }
        .library-icon-btn {
            cursor: pointer;
            color: #6B7280;
            transition: color 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .library-icon-btn:hover { color: #111827; }
        .library-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 12px;
        }
        .library-table th {
            text-align: left;
            font-size: 13px;
            font-weight: 800;
            color: #4B5563;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            padding: 0 24px 4px;
            border: none;
        }
        .library-table td {
            background: #fff;
            padding: 12px 20px;
            vertical-align: middle;
        }
        .library-table tr {
            box-shadow: 0 2px 8px rgba(0,0,0,0.02);
            transition: transform 0.2s;
        }
        .library-table tr:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0,0,0,0.06);
        }
        .library-table tr td:first-child {
            border-top-left-radius: 12px;
            border-bottom-left-radius: 12px;
        }
        .library-table tr td:last-child {
            border-top-right-radius: 12px;
            border-bottom-right-radius: 12px;
        }
        .template-name-wrap {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .template-avatar {
            width: 44px;
            height: 44px;
            border-radius: 8px;
            background: #F3F4F6;
            object-fit: cover;
        }
        .template-name-text {
            font-size: 13px;
            font-weight: 700;
            color: #111827;
        }
        .date-text {
            font-size: 13px;
            color: #4B5563;
            font-weight: 500;
        }
        .discount-text {
            font-size: 13px;
            font-weight: 700;
        }
        .discount-active { color: #111827; }
        .discount-none { color: #111827; }
        .status-pill {
            display: inline-block;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .status-pill.active {
            background: #dcfce7;
            color: #15803d;
            border: 1px solid #bbf7d0;
        }
        .status-pill.inactive {
            background: #f3f4f6;
            color: #6b7280;
            border: 1px solid #e5e7eb;
        }
        .status-pill.draft {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fde68a;
        }
        .actions-flex {
            display: flex;
            gap: 20px;
            align-items: center;
        }
        .action-btn {
            cursor: pointer;
            color: #6B7280;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }
        .action-btn.edit:hover { color: #111827; }
        .action-btn.view:hover { color: #111827; }
        .action-btn.more:hover { color: #111827; }
        
        .pagination-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 8px;
            padding: 0 4px;
        }
        .pagination-info {
            font-size: 13px;
            color: #6B7280;
            font-weight: 500;
        }
        .pagination-controls {
            display: flex;
            gap: 8px;
        }
        .page-btn {
            padding: 8px 16px;
            background: #fff;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 700;
            color: #111827;
            cursor: pointer;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            transition: all 0.2s;
        }
        .page-btn:hover { background: #F9FAFB; }
        .page-btn.active {
            background: #111827;
            color: #fff;
        }
        .page-btn.active:hover { background: #000000; }
        
        .tpl-empty-state {
            text-align: center;
            padding: 48px 20px;
        }
        .tpl-empty-icon {
            margin: 0 auto 16px;
            display: block;
            color: #D1D5DB;
            width: 56px;
            height: 56px;
        }
        .tpl-empty-title {
            font-size: 16px;
            font-weight: 700;
            color: #111827;
            margin: 0 0 6px;
        }
        .tpl-empty-desc {
            font-size: 13px;
            color: #6B7280;
            margin: 0 0 24px;
        }

        /* Loading Bar */
        .global-loading-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: #111827;
          z-index: 9999;
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.2s ease;
        }
        .global-loading-bar.loading {
          transform: scaleX(1);
          animation: loadingBar 2s infinite linear;
        }
        @keyframes loadingBar {
          0% { transform: scaleX(0); }
          50% { transform: scaleX(0.7); }
          100% { transform: scaleX(1); }
        }

        .mobile-fab {
            display: none;
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: #111827;
            color: #fff;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            align-items: center;
            justify-content: center;
            z-index: 99;
            border: none;
            cursor: pointer;
        }

        @media (max-width: 768px) {
            .template-page-wrapper {
                padding: 16px;
            }
            .header-section {
                flex-direction: column;
                gap: 16px;
                margin-bottom: 32px;
            }
            .header-title {
                font-size: 15px;
            }
            .header-controls {
                width: 100%;
            }
            .search-container, .search-input {
                width: 100%;
            }
            .create-btn {
                display: none;
            }
            .mobile-fab {
                display: flex;
            }

            .library-table {
                display: block;
            }
            .library-table thead {
                display: none;
            }
            .library-table tbody {
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding-bottom: 80px;
            }
            .library-table tr {
                display: grid;
                grid-template-areas: 
                   "avatar title    title   actions"
                   "avatar discount status  actions";
                grid-template-columns: 48px max-content minmax(0, 1fr) auto;
                gap: 4px 10px;
                align-items: center;
                padding: 16px;
                background: #fff;
                border-radius: 12px;
                border: 1px solid rgba(0,0,0,0.04);
                width: 100%;
                box-sizing: border-box;
            }
            .library-table td, .template-name-wrap {
                display: contents;
            }
            .template-avatar {
                grid-area: avatar;
                width: 48px;
                height: 48px;
                border-radius: 8px;
            }
            .template-name-text {
                grid-area: title;
                align-self: end;
                font-size: 13px;
                font-weight: 700;
                color: #111827;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .library-table td:nth-child(2) { display: none; }
            .library-table td:nth-child(3) {
                grid-area: discount;
                align-self: start;
                white-space: nowrap;
            }
            .library-table td:nth-child(4) {
                grid-area: status;
                align-self: start;
                display: flex;
                align-items: center;
                white-space: nowrap;
                min-width: 0;
            }
            .library-table td:nth-child(4)::before {
                content: "•";
                margin-right: 6px;
                font-size: 13px;
                color: #D1D5DB;
            }
            .library-table td:nth-child(5) {
                grid-area: actions;
                justify-self: end;
                display: flex;
            }
            .library-table .discount-text {
                font-size: 13px;
                padding: 2px 6px;
                margin: 0;
                background: #f3f4f6;
                color: #111827;
                border-radius: 4px;
                font-weight: 600;
                display: inline-block;
            }
            .library-table .discount-text.discount-none {
                background: #F3F4F6;
                color: #4B5563;
            }
            .library-table .status-pill, 
            .library-table .status-pill.active,
            .library-table .status-pill.inactive {
                font-size: 13px;
                padding: 0;
                margin: 0;
                background: transparent;
                color: #6B7280;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .actions-flex { justify-content: flex-end; gap: 0; }
            .action-btn.edit, .action-btn.view { display: none; }
        }
        
      `}</style>

      <div className="template-content">
        {/* Header Section */}
        <div className="header-card">
        <div className="header-section">
          <div>
            <p className="header-subtitle">BUNDLES</p>
            <h1 className="header-title">Template page</h1>
            <div className="tpl-dashboard-stats">
              <span className="tpl-stat tpl-stat-total">{templates.length} total</span>
              <span className="tpl-stat tpl-stat-active">{templates.filter((t) => t.active).length} active</span>
              <span className="tpl-stat tpl-stat-inactive">{templates.filter((t) => !t.active).length} inactive</span>
            </div>
          </div>
          <div className="header-controls">
            <div className="search-container">
              <svg
                className="search-icon"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19 19L14.65 14.65"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <input
                type="text"
                className="search-input"
                placeholder="Search templates..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </div>
            <button className="create-btn" onClick={handleCreateTemplate}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 1V15M1 8H15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Create Template
            </button>
          </div>
        </div>
        </div>

        {/* Template Library */}
        <div className="library-section">
          <div className="library-header">
            <h2 className="library-title">Full Library</h2>
            <div className="library-icons">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h10M4 18h6" />
              </svg>
              <span>Recent</span>
            </div>
          </div>

          <table className="library-table">
            <thead>
              <tr>
                <th>TEMPLATE NAME</th>
                <th>CREATED AT</th>
                <th>DISCOUNT</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTemplates.map((t) => {
                const layoutMap = {
                  layout1: 'combo_design_one',
                  layout2: 'combo_design_two',
                  layout3: 'combo_design_three',
                  layout4: 'combo_design_four',
                };
                const blockName =
                  layoutMap[t.config?.layout] || 'combo_design_one';
                const meta = layoutMetadata.find(
                  (m) => m.blockName === blockName
                );
                const avatarSrc =
                  t.config?.banner_image_url || meta?.fallbackImg;

                const discountId = t.config?.selected_discount_id;
                const resolvedDiscount = discountId
                  ? discounts?.find((d) => String(d.id) === String(discountId))
                  : null;
                const discountDisplay =
                  resolvedDiscount?.title || t.config?.discountName;

                // Mapped Status to match design: Active, Inactive, Draft
                const statusState = t.active ? 'ACTIVE' : 'INACTIVE'; // Need draft logic? In design, there is "DRAFT". If t.active is false and no page_url, maybe draft? Let's just use INACTIVE unless it's explicitly designated as draft in real logic. But design shows 3 states. We can randomly assign one 'DRAFT' based on ID to perfectly match the design if needed visually, or just respect real active boolean. We'll respect real active boolean.
                const statusClass = t.active ? 'active' : 'inactive';

                return (
                  <tr key={t.id}>
                    <td>
                      <div className="template-name-wrap">
                        <img
                          src={avatarSrc}
                          alt="Thumb"
                          className="template-avatar"
                        />
                        <span className="template-name-text">{t.title}</span>
                      </div>
                    </td>
                    <td>
                      <span className="date-text">
                        {new Date(t.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: '2-digit',
                          year: 'numeric',
                        })}
                      </span>
                    </td>
                    <td>
                      {discountDisplay ? (
                        <span className="discount-text discount-active">
                          {discountDisplay}
                        </span>
                      ) : (
                        <span className="discount-text discount-none">
                          No Discount
                        </span>
                      )}
                    </td>
                    <td>
                      <div className={`status-pill ${statusClass}`}>
                        {statusState}
                      </div>
                    </td>
                    <td>
                      <div className="actions-flex">
                        <div
                          className="action-btn edit"
                          onClick={() => handleEditNavigate(t.id)}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M11 2L14 5L5 14H2V11L11 2Z"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <div
                          className="action-btn view"
                          onClick={() => handlePreview(t)}
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 18 18"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M9 3C5 3 2 7.5 2 9C2 10.5 5 15 9 15C13 15 16 10.5 16 9C16 7.5 13 3 9 3ZM9 12C7.34315 12 6 10.6569 6 9C6 7.34315 7.34315 6 9 6C10.6569 6 12 7.34315 12 9C12 10.6569 10.6569 12 9 12Z"
                              fill="currentColor"
                            />
                            <path
                              d="M9 11C10.1046 11 11 10.1046 11 9C11 7.89543 10.1046 7 9 7C7.89543 7 7 7.89543 7 9C7 10.1046 7.89543 11 9 11Z"
                              fill="currentColor"
                            />
                          </svg>
                        </div>
                        <div className="action-btn more">
                          <Popover
                            active={activePopoverId === t.id}
                            activator={
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActivePopoverId(
                                    activePopoverId === t.id ? null : t.id
                                  );
                                }}
                              >
                                <svg
                                  width="20"
                                  height="20"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <circle
                                    cx="10"
                                    cy="5"
                                    r="1.5"
                                    fill="currentColor"
                                  />
                                  <circle
                                    cx="10"
                                    cy="10"
                                    r="1.5"
                                    fill="currentColor"
                                  />
                                  <circle
                                    cx="10"
                                    cy="15"
                                    r="1.5"
                                    fill="currentColor"
                                  />
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
                                  onAction: () => {
                                    setTargetTemplate(t);
                                    setToggleModalOpen(true);
                                    setActivePopoverId(null);
                                  },
                                },
                                {
                                  content: 'Delete',
                                  destructive: true,
                                  onAction: () => {
                                    setTargetTemplate(t);
                                    setDeleteModalOpen(true);
                                    setActivePopoverId(null);
                                  },
                                },
                              ]}
                            />
                          </Popover>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginatedTemplates.length === 0 && (
                <tr>
                  <td colSpan="5">
                    <div className="tpl-empty-state">
                      <svg className="tpl-empty-icon" viewBox="0 0 48 48" fill="none">
                        <rect x="8" y="12" width="32" height="28" rx="4" stroke="currentColor" strokeWidth="2.5"/>
                        <path d="M16 12V9a8 8 0 0 1 16 0v3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                        <path d="M18 24h12M18 31h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                      <p className="tpl-empty-title">
                        {searchValue ? 'No templates match your search' : 'No templates yet'}
                      </p>
                      <p className="tpl-empty-desc">
                        {searchValue
                          ? 'Try a different search term or clear the search.'
                          : 'Create your first bundle template to get started.'}
                      </p>
                      {!searchValue && (
                        <button className="create-btn" onClick={handleCreateTemplate} style={{ margin: '0 auto' }}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M8 1V15M1 8H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Create Template
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="pagination-row">
            <span className="pagination-info">
              Showing {displayStart}-{displayEnd} of {totalCountStr} templates
            </span>
            <div className="pagination-controls">
              <button
                className={`page-btn ${validCurrentPage === 1 ? 'disabled' : ''}`}
                style={
                  validCurrentPage === 1
                    ? { opacity: 0.5, cursor: 'not-allowed' }
                    : {}
                }
                disabled={validCurrentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                className={`page-btn ${validCurrentPage >= totalPages || totalTemplates === 0 ? 'disabled' : 'active'}`}
                style={
                  validCurrentPage >= totalPages || totalTemplates === 0
                    ? { opacity: 0.5, cursor: 'not-allowed' }
                    : {}
                }
                disabled={
                  validCurrentPage >= totalPages || totalTemplates === 0
                }
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
      <button className="mobile-fab" onClick={handleCreateTemplate}>
        <svg fill="currentColor" width="24" height="24" viewBox="0 0 24 24">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
      </button>

      {/* Confirmation Modals Rendered Outside Layout */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Template"
        primaryAction={{
          content: 'Delete',
          destructive: true,
          onAction: confirmDelete,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setDeleteModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete <b>{targetTemplate?.title}</b>? This
            action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={toggleModalOpen}
        onClose={() => setToggleModalOpen(false)}
        title={
          targetTemplate?.active ? 'Deactivate Template' : 'Activate Template'
        }
        primaryAction={{
          content: targetTemplate?.active ? 'Deactivate' : 'Activate',
          onAction: confirmToggleStatus,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setToggleModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to mark <b>{targetTemplate?.title}</b> as{' '}
            {targetTemplate?.active ? 'inactive' : 'active'}?
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        title="Upgrade to build more combos"
        primaryAction={{ content: 'View plans', onAction: () => navigate('/app/subscribe?highlight=build_a_combo') }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setUpgradeModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              {!canAccessFeature('build_a_combo')
                ? 'Build a Combo is available on the Starter plan and above.'
                : `Your ${PLANS[plan]?.label || 'Starter'} plan allows up to ${comboTemplateLimit} combo template${comboTemplateLimit === 1 ? '' : 's'}. Upgrade to Pro for unlimited templates.`}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

    </div>
  );
}
