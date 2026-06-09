import { memo, useCallback } from 'react';
import { Icon } from '@shopify/polaris';
import {
  LayoutColumns3Icon,
  PaintBrushFlatIcon,
  MobileIcon,
  SettingsIcon,
} from '@shopify/polaris-icons';
import { GeneralSection } from './GeneralSection';
import { BannerSection } from './BannerSection';
import { ProductsSection } from './ProductsSection';
import { ContentSection } from './ContentSection';
import { StylingSection } from './StylingSection';
import { BehaviorSection } from './BehaviorSection';
import { AdvancedSection } from './AdvancedSection';

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
}) {
  const handleTabClick = useCallback((catId) => {
    if (catId === 'layout') {
      setActiveCategory('layout');
    } else if (catId === 'style') {
      setActiveCategory('style');
      setStyleDevice?.('desktop');
      setPreviewDevice?.('desktop');
    } else if (catId === 'mobile') {
      setActiveCategory('style');
      setStyleDevice?.('mobile');
      setPreviewDevice?.('mobile');
    } else if (catId === 'advanced') {
      setActiveCategory('advanced');
    }
  }, [setActiveCategory, setStyleDevice, setPreviewDevice]);

  const tabs = [
    { id: 'layout', label: 'Layout', icon: LayoutColumns3Icon },
    { id: 'style', label: 'Style', icon: PaintBrushFlatIcon },
    { id: 'mobile', label: 'Mobile', icon: MobileIcon },
    { id: 'advanced', label: 'Advanced', icon: SettingsIcon },
  ];

  const isTabActive = (tabId) => {
    if (tabId === 'layout') return activeCategory === 'layout';
    if (tabId === 'style') return activeCategory === 'style' && styleDevice === 'desktop';
    if (tabId === 'mobile') return activeCategory === 'style' && styleDevice === 'mobile';
    if (tabId === 'advanced') return activeCategory === 'advanced';
    return false;
  };

  return (<>
    <style>{`
.cst-section-card{border:1px solid #e1e3e5;border-radius:10px;margin-bottom:12px;overflow:hidden;background:#fff;transition:box-shadow .2s ease}
.cst-section-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.04)}
.cst-section-header{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px 16px;background:#fafbfb;border:none;cursor:pointer;font-family:inherit;text-align:left;transition:background .15s ease;color:#202223}
.cst-section-header:hover{background:#f0f1f2}
.cst-section-header-left{display:flex;align-items:center;gap:10px;min-width:0}
.cst-chevron{flex-shrink:0;color:#8c9196;transition:transform .2s ease}
.cst-chevron.expanded{transform:rotate(90deg)}
.cst-section-title{font-size:13px;font-weight:600;color:#202223;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cst-section-badge{flex-shrink:0;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:#e8eaed;color:#5c5f62;letter-spacing:.3px;text-transform:uppercase}
.cst-section-body{padding:16px;border-top:1px solid #e1e3e5}
.cst-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cst-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.cst-full-width{grid-column:1 / -1}
.cst-inline-group{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.cst-row{display:flex;flex-direction:row;gap:8px;overflow-x:auto;padding-bottom:4px}
.cst-row>div{flex:1 1 120px;min-width:0}
.cst-nested-block{background:#f6f8fa;border:1px solid #e1e3e5;border-radius:8px;padding:16px;margin-top:12px}
.cst-nested-title{margin-bottom:14px}
.cst-step-block{background:#f6f8fa;border:1px solid #e1e3e5;border-radius:10px;padding:16px;margin-bottom:12px}
.cst-step-fields{display:flex;flex-direction:column;gap:12px;margin-top:10px}
.cst-bundle-rule-box{background:#f4f6f8;border:1px solid #e1e3e5;border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-bottom:16px}
.cst-section-divider{border-top:1px solid #e1e3e5;padding-top:14px;margin-top:14px}
.cst-group{margin-bottom:16px}
.cst-field-with-ai{margin-bottom:4px}
.cst-ai-btn{border-color:#00c9a7!important;background:linear-gradient(180deg,#fff 0%,#ebfff8 100%)!important;box-shadow:0 0 0 1px rgba(0,201,167,.35),0 0 10px rgba(0,201,167,.55),inset 0 0 8px rgba(0,201,167,.18)!important}
.cst-slider-item{margin-top:12px;padding-top:12px;border-top:1px solid #e1e3e5}
.cst-sidebar-wrapper{background:#fff;border:1px solid #e1e3e5;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;height:calc(100vh - 40px);max-height:calc(100vh - 40px);box-shadow:0 2px 12px rgba(0,0,0,.04)}
.cst-sidebar-tabs{display:flex;border-bottom:1px solid #e1e3e5;background:#fff;user-select:none;flex-shrink:0}
.cst-sidebar-tab{flex:1;padding:12px 4px 10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;border-bottom:3px solid transparent;color:#6d7175;transition:all .2s ease;background:none;border-top:none;border-left:none;border-right:none;font-family:inherit}
.cst-sidebar-tab:hover{background:#fafbfb}
.cst-sidebar-tab.active{border-bottom-color:#000;color:#000}
.cst-sidebar-tab.active .cst-tab-icon{color:#000}
.cst-tab-icon{color:#8c9196;transition:color .2s ease;display:flex;align-items:center;justify-content:center}
.cst-tab-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.cst-sidebar-content{padding:16px;flex:1;overflow-y:auto;overflow-x:hidden;min-height:0}
.cst-sidebar-content::-webkit-scrollbar{width:4px}
.cst-sidebar-content::-webkit-scrollbar-track{background:transparent}
.cst-sidebar-content::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}
.cst-sidebar-content::-webkit-scrollbar-thumb:hover{background:#9ca3af}
.cst-device-toggle{display:flex;justify-content:center;align-items:center;padding-bottom:16px}
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

      <div className="cst-sidebar-content">
        {activeCategory === 'layout' && (
          <>
            <GeneralSection
              config={config}
              collections={collections}
              updateConfig={updateConfig}
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

        {activeCategory === 'mobile' && (
          <>
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

        {activeCategory === 'advanced' && (
          <AdvancedSection
            config={config}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            updateConfig={updateConfig}
            ColorPickerField={ColorPickerField}
            localActiveDiscounts={localActiveDiscounts}
          />
        )}
      </div>
    </div>
  </>);
}

export const BuilderSidebar = memo(BuilderSidebarComponent);
