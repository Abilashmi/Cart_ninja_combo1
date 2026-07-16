import { memo, useCallback, useMemo, useState } from 'react';
import { Icon, Combobox, Listbox } from '@shopify/polaris';
import {
  LayoutColumns3Icon,
  PaintBrushFlatIcon,
  MobileIcon,
  SettingsIcon,
  SearchIcon,
} from '@shopify/polaris-icons';
import { GeneralSection } from './GeneralSection';
import { BannerSection } from './BannerSection';
import { ProductsSection } from './ProductsSection';
import { ContentSection } from './ContentSection';
import { StylingSection } from './StylingSection';
import { BehaviorSection } from './BehaviorSection';
import { AdvancedSection } from './AdvancedSection';
import { ThemePresets } from './ThemePresets';

const SETTINGS_INDEX = [
  { label: 'Steps & collections', category: 'layout', section: 'general', kw: 'step collection bundle rule combo size' },
  { label: 'Collection tabs', category: 'layout', section: 'general', kw: 'tab switch collection' },
  { label: 'Total products limit', category: 'layout', section: 'general', kw: 'max products limit' },
  { label: 'Banner image & slider', category: 'layout', section: 'banner', kw: 'banner image slider hero rotate' },
  { label: 'Products grid & columns', category: 'layout', section: 'products', kw: 'grid columns image ratio arrows scrollbar' },
  { label: 'Title & description', category: 'style', section: 'content', kw: 'title description heading copy text' },
  { label: 'Product card style', category: 'style', section: 'productCard', kw: 'card padding radius hover' },
  { label: 'Collection tab styling', category: 'style', section: 'collectionTabsStyles', kw: 'tab color active styling premium' },
  { label: 'Preview bar', category: 'style', section: 'previewBar', kw: 'preview bar checkout sticky footer' },
  { label: 'Variant selector', category: 'style', section: 'variants', kw: 'variant dropdown select' },
  { label: 'Buttons (add / checkout)', category: 'style', section: 'buttons', kw: 'button add to cart checkout buy color reset' },
  { label: 'Progress bar', category: 'advanced', section: 'progressBar', kw: 'progress bar discount threshold motivation' },
  { label: 'Coupon / discount', category: 'advanced', section: 'discount', kw: 'coupon discount offer' },
  { label: 'AI suggestions', category: 'advanced', section: 'aiSettings', kw: 'ai suggestion smart' },
  { label: 'Custom CSS', category: 'advanced', section: 'customCss', kw: 'css custom code style' },
];

function BuilderSidebarComponent({
  config,
  activeCategory,
  setActiveCategory,
  styleDevice,
  setStyleDevice,
  expandedSections,
  toggleSection,
  collections,
  updateConfig,
  getStyleKey,
  stepErrors,
  maxProductsError,
  stepFieldAiLoading,
  generateStepFieldSuggestion,
  generatingTitle,
  generatingDescription,
  generateAiSuggestion,
  PxField,
  ColorPickerField,
  setPreviewDevice,
  localActiveDiscounts,
  applyConfigPatch,
  openSection,
  setAllSections,
  onCreateCoupon,
}) {
  const [search, setSearch] = useState('');

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_INDEX.filter(
      (s) => s.label.toLowerCase().includes(q) || s.kw.includes(q)
    ).slice(0, 8);
  }, [search]);

  const jumpToSetting = useCallback((idx) => {
    const item = SETTINGS_INDEX[idx];
    if (!item) return;
    setActiveCategory(item.category);
    openSection?.(item.section);
    setSearch('');
    requestAnimationFrame(() => {
      const el = document.querySelector('.cst-sidebar-content');
      if (el) el.scrollTop = 0;
    });
  }, [setActiveCategory, openSection]);

  const handleTabClick = useCallback((catId) => {
    setActiveCategory(catId);
  }, [setActiveCategory]);

  const setStylePreviewDevice = useCallback((device) => {
    setStyleDevice?.(device);
    setPreviewDevice?.(device);
  }, [setStyleDevice, setPreviewDevice]);

  const tabs = [
    { id: 'layout', label: 'Layout', icon: LayoutColumns3Icon },
    { id: 'style', label: 'Style', icon: PaintBrushFlatIcon },
    { id: 'advanced', label: 'Advanced', icon: SettingsIcon },
  ];

  const isTabActive = (tabId) => activeCategory === tabId;

  return (<>
    <style>{`
.cst-section-card{border:1px solid #e1e3e5;border-radius:10px;margin-bottom:12px;overflow:hidden;background:#fff;transition:box-shadow .2s ease}
.cst-section-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.04)}
.cst-section-header{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px 16px;background:#fafbfb;border:none;cursor:pointer;font-family:inherit;text-align:left;transition:background .15s ease;color:#202223}
.cst-section-header:hover{background:#f0f1f2}
.cst-section-header-left{display:flex;align-items:center;gap:10px;min-width:0}
.cst-chevron{flex-shrink:0;color:#8c9196;transition:transform .2s ease}
.cst-chevron.expanded{transform:rotate(90deg)}
.cst-section-title{font-size:14.5px;font-weight:600;color:#202223;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cst-section-badge{flex-shrink:0;font-size:12px;font-weight:700;padding:2px 10px;border-radius:20px;background:#e8eaed;color:#5c5f62;letter-spacing:.3px;text-transform:uppercase}
.cst-section-body{padding:16px;border-top:1px solid #e1e3e5}
.cst-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cst-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.cst-full-width{grid-column:1 / -1}
.cst-inline-group{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.cst-row{display:flex;flex-direction:row;gap:8px;overflow-x:auto;padding-bottom:4px}
.cst-row>div{flex:1 1 120px;min-width:0}
.cst-row--vertical{flex-direction:column;overflow-x:visible;padding-bottom:0}
.cst-row--vertical>div{flex:0 0 auto;width:100%}
.cst-nested-block{background:#f6f8fa;border:1px solid #e1e3e5;border-radius:8px;padding:16px;margin-top:12px}
.cst-nested-title{margin-bottom:14px}
.cst-step-block{background:#f6f8fa;border:1px solid #e1e3e5;border-radius:10px;padding:16px;margin-bottom:12px;position:relative}
.cst-step-fields{display:flex;flex-direction:column;gap:12px;margin-top:10px}
.cst-bundle-rule-box{background:#f4f6f8;border:1px solid #e1e3e5;border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-bottom:16px}
.cst-section-divider{border-top:1px solid #e1e3e5;padding-top:14px;margin-top:14px}
.cst-group{margin-bottom:16px}
.cst-field-with-ai{margin-bottom:4px}
.cst-ai-btn{border-color:#00c9a7!important;background:linear-gradient(180deg,#fff 0%,#ebfff8 100%)!important;box-shadow:0 0 0 1px rgba(0,201,167,.35),0 0 10px rgba(0,201,167,.55),inset 0 0 8px rgba(0,201,167,.18)!important}
.cst-slider-item{margin-top:12px;padding-top:12px;border-top:1px solid #e1e3e5}
.cst-sidebar-wrapper{background:#fff;border:1px solid #e1e3e5;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 40px);box-shadow:0 2px 12px rgba(0,0,0,.04)}
.cst-sidebar-tabs{display:flex;border-bottom:1px solid #e1e3e5;background:#fff;user-select:none;flex-shrink:0}
.cst-sidebar-tab{flex:1;padding:12px 4px 10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;border-bottom:3px solid transparent;color:#6d7175;transition:all .2s ease;background:none;border-top:none;border-left:none;border-right:none;font-family:inherit}
.cst-sidebar-tab:hover{background:#fafbfb}
.cst-sidebar-tab.active{border-bottom-color:#000;color:#000}
.cst-sidebar-tab.active .cst-tab-icon{color:#000}
.cst-tab-icon{color:#8c9196;transition:color .2s ease;display:flex;align-items:center;justify-content:center}
.cst-tab-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.cst-sidebar-content{padding:16px 16px 100px;flex:1;overflow-y:auto;overflow-x:hidden;min-height:0}
.cst-sidebar-content::-webkit-scrollbar{width:4px}
.cst-sidebar-content::-webkit-scrollbar-track{background:transparent}
.cst-sidebar-content::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}
.cst-sidebar-content::-webkit-scrollbar-thumb:hover{background:#9ca3af}
.cst-device-toggle{display:flex;justify-content:center;align-items:center;padding-bottom:16px}
.cst-device-seg{display:inline-flex;background:#f1f2f4;border:1px solid #e1e3e5;border-radius:10px;padding:3px;gap:3px}
.cst-device-seg-btn{display:inline-flex;align-items:center;gap:6px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:#6d7175;padding:7px 16px;border-radius:8px;cursor:pointer;transition:all .15s ease}
.cst-device-seg-btn:hover{color:#202223}
.cst-device-seg-btn.active{background:#fff;color:#202223;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.cst-sidebar-toolbar{display:flex;flex-direction:column;gap:8px;padding:12px 12px 0}
.cst-toolbar-actions{display:flex;justify-content:flex-end;gap:14px}
.cst-toolbar-link{font-size:11.5px;font-weight:600;color:#5c6ac4;cursor:pointer;background:none;border:none;padding:0}
.cst-toolbar-link:hover{text-decoration:underline}
.cst-drag-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.cst-drag-handle{display:inline-flex;cursor:grab;width:18px;height:18px;align-items:center;justify-content:center;opacity:.6}
.cst-drag-handle:active{cursor:grabbing}
.cst-dragging{opacity:.5;outline:2px dashed #9aa5ff;outline-offset:2px}
.cst-tab-reorder{display:flex;align-items:center;gap:8px;background:#f6f8fa;border:1px solid #e1e3e5;border-radius:8px;padding:8px 10px}
.cst-flash{animation:cstFlash 1.4s ease}
@keyframes cstFlash{0%{box-shadow:0 0 0 0 rgba(245,158,11,0);background:#fffaf0}25%{box-shadow:0 0 0 3px rgba(245,158,11,.5);background:#fff7e6}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}
.cst-sidebar-content .Polaris-Text--headingMd{font-size:14px!important;line-height:1.3}
.cst-sidebar-content .Polaris-Text--headingSm{font-size:13px!important}
.cst-sidebar-content .Polaris-Text--bodySm,.cst-sidebar-content .Polaris-Text--bodyMd{font-size:13px!important}
.cst-sidebar-content .Polaris-Label__Text{font-size:13px!important}
.cst-sidebar-content .Polaris-TextField__Input,.cst-sidebar-content .Polaris-Select__Input{font-size:13px!important}
.cst-sidebar-content .Polaris-Checkbox__Label{font-size:13px!important}
.cst-sidebar-content .Polaris-TextField,.cst-sidebar-content .Polaris-Select{--p-font-size-350:12px;--p-font-size-300:11px}
.cst-section-body{padding:12px!important}
    `}</style>
    <div className="cst-sidebar-wrapper">
      <div className="cst-sidebar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`cst-sidebar-tab ${isTabActive(tab.id) ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <div className="cst-tab-icon">
              <Icon source={tab.icon} color={isTabActive(tab.id) ? 'base' : 'subdued'} />
            </div>
            <span className="cst-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="cst-sidebar-toolbar">
        <Combobox
          activator={
            <Combobox.TextField
              prefix={<Icon source={SearchIcon} tone="subdued" />}
              labelHidden
              label="Find a setting"
              placeholder="Find a setting…"
              value={search}
              onChange={setSearch}
              autoComplete="off"
            />
          }
        >
          {searchMatches.length > 0 ? (
            <Listbox onSelect={(v) => jumpToSetting(Number(v))}>
              {searchMatches.map((m) => {
                const idx = SETTINGS_INDEX.indexOf(m);
                return (
                  <Listbox.Option key={idx} value={String(idx)} accessibilityLabel={m.label}>
                    <Listbox.TextOption>{m.label}</Listbox.TextOption>
                  </Listbox.Option>
                );
              })}
            </Listbox>
          ) : null}
        </Combobox>
        <div className="cst-toolbar-actions">
          <button type="button" className="cst-toolbar-link" onClick={() => setAllSections?.(false)}>Collapse all</button>
        </div>
      </div>

      <div className="cst-sidebar-content">
        {activeCategory === 'layout' && (
          <>
            <GeneralSection
              config={config}
              collections={collections}
              updateConfig={updateConfig}
              applyConfigPatch={applyConfigPatch}
              expanded={expandedSections.general}
              onToggle={() => toggleSection('general')}
              stepErrors={stepErrors}
              maxProductsError={maxProductsError}
              stepFieldAiLoading={stepFieldAiLoading}
              generateStepFieldSuggestion={generateStepFieldSuggestion}
            />
            <BannerSection
              config={config}
              expanded={expandedSections.banner}
              onToggle={() => toggleSection('banner')}
              updateConfig={updateConfig}
              PxField={PxField}
              ColorPickerField={ColorPickerField}
            />
            <ProductsSection
              config={config}
              expanded={expandedSections.products}
              onToggle={() => toggleSection('products')}
              updateConfig={updateConfig}
              PxField={PxField}
              ColorPickerField={ColorPickerField}
            />
          </>
        )}

        {activeCategory === 'style' && (
          <>
            <div className="cst-device-toggle">
              <div className="cst-device-seg" role="tablist" aria-label="Preview device">
                <button
                  type="button"
                  className={`cst-device-seg-btn ${styleDevice !== 'mobile' ? 'active' : ''}`}
                  onClick={() => setStylePreviewDevice('desktop')}
                >
                  <Icon source={LayoutColumns3Icon} color={styleDevice !== 'mobile' ? 'base' : 'subdued'} />
                  Desktop
                </button>
                <button
                  type="button"
                  className={`cst-device-seg-btn ${styleDevice === 'mobile' ? 'active' : ''}`}
                  onClick={() => setStylePreviewDevice('mobile')}
                >
                  <Icon source={MobileIcon} color={styleDevice === 'mobile' ? 'base' : 'subdued'} />
                  Mobile
                </button>
              </div>
            </div>
            <ThemePresets
              config={config}
              applyConfigPatch={applyConfigPatch}
              updateConfig={updateConfig}
            />
            <ContentSection
              config={config}
              expanded={expandedSections.content}
              onToggle={() => toggleSection('content')}
              updateConfig={updateConfig}
              getStyleKey={getStyleKey}
              generatingTitle={generatingTitle}
              generatingDescription={generatingDescription}
              generateAiSuggestion={generateAiSuggestion}
              PxField={PxField}
              ColorPickerField={ColorPickerField}
            />
            <StylingSection
              config={config}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
              updateConfig={updateConfig}
              PxField={PxField}
              ColorPickerField={ColorPickerField}
            />
            <BehaviorSection
              config={config}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
              updateConfig={updateConfig}
              PxField={PxField}
              ColorPickerField={ColorPickerField}
            />
          </>
        )}

        {activeCategory === 'advanced' && (
          <AdvancedSection
            config={config}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            updateConfig={updateConfig}
            ColorPickerField={ColorPickerField}
            localActiveDiscounts={localActiveDiscounts}
            onCreateCoupon={onCreateCoupon}
          />
        )}
      </div>
    </div>
  </>);
}

export const BuilderSidebar = memo(BuilderSidebarComponent);
