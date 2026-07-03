import { Button, ButtonGroup, Tooltip, Icon } from '@shopify/polaris';
import {
  UndoIcon,
  RedoIcon,
  DuplicateIcon,
  ViewIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  MagicIcon,
} from '@shopify/polaris-icons';

const STATUS = {
  saved: { label: 'All changes saved', dot: '#22c55e', text: '#15803d' },
  saving: { label: 'Saving…', dot: '#f59e0b', text: '#b45309' },
  unsaved: { label: 'Unsaved changes', dot: '#f59e0b', text: '#b45309' },
  error: { label: 'Save failed', dot: '#ef4444', text: '#b91c1c' },
};

export function BuilderActionBar({
  saveStatus,
  isActive,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onPreview,
  onDuplicate,
  onToggleActive,
  onReset,
  onAiGenerate,
  canPreview,
  issueCount = 0,
  saveDisabled = false,
}) {
  const status = saveStatus ? STATUS[saveStatus] : null;

  return (
    <div className="bac-actionbar">
      <style>{`
.bac-actionbar{position:sticky;top:10px;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin-bottom:12px;background:linear-gradient(135deg,#ffffff 0%,#f7fbff 100%);backdrop-filter:blur(10px);border:1px solid #dfe3e8;border-radius:14px;box-shadow:0 10px 28px rgba(15,23,42,.06);flex-wrap:wrap}
.bac-ab-left{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}
.bac-ab-status{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;white-space:nowrap}
.bac-ab-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.bac-ab-dot--pulse{animation:bacPulse 1s ease-in-out infinite}
@keyframes bacPulse{0%,100%{opacity:1}50%{opacity:.35}}
.bac-ab-issues{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;border-radius:999px;padding:3px 10px}
.bac-ab-issues svg{width:15px;height:15px;fill:#d97706}
.bac-ab-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bac-ab-divider{width:1px;height:22px;background:#e1e3e5;margin:0 2px}
      `}</style>

      <div className="bac-ab-left">
        <ButtonGroup segmented>
          <Tooltip content="Undo (⌘Z)">
            <Button icon={UndoIcon} disabled={!canUndo} onClick={onUndo} accessibilityLabel="Undo" />
          </Tooltip>
          <Tooltip content="Redo (⌘⇧Z)">
            <Button icon={RedoIcon} disabled={!canRedo} onClick={onRedo} accessibilityLabel="Redo" />
          </Tooltip>
        </ButtonGroup>

        <Button icon={MagicIcon} onClick={onAiGenerate} variant="tertiary">AI Generate</Button>

        <div className="bac-ab-divider" />

        {status ? (
          <span className="bac-ab-status" style={{ color: status.text }}>
            <span
              className={`bac-ab-dot ${saveStatus === 'saving' ? 'bac-ab-dot--pulse' : ''}`}
              style={{ background: status.dot }}
            />
            {status.label}
          </span>
        ) : (
          <span className="bac-ab-status" style={{ color: '#6d7175' }}>
            <span className="bac-ab-dot" style={{ background: '#c4c8cd' }} />
            Not saved yet
          </span>
        )}

        {issueCount > 0 && (
          <span className="bac-ab-issues">
            <Icon source={AlertCircleIcon} />
            {issueCount} {issueCount === 1 ? 'issue' : 'issues'} to fix
          </span>
        )}
        {issueCount === 0 && saveStatus === 'saved' && (
          <span className="bac-ab-status" style={{ color: '#15803d' }}>
            <Icon source={CheckCircleIcon} tone="success" />
            Ready to publish
          </span>
        )}
      </div>

      <div className="bac-ab-right">
        <Button icon={ViewIcon} onClick={onPreview} disabled={!canPreview}>Preview</Button>
        <Button icon={DuplicateIcon} onClick={onDuplicate} disabled={!canPreview}>Duplicate</Button>
        <Button onClick={onReset}>Reset</Button>
        <Button onClick={onToggleActive} tone={isActive ? undefined : 'success'} variant={isActive ? 'secondary' : 'primary'}>
          {isActive ? 'Deactivate' : 'Activate'}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saveDisabled}>Save Template</Button>
      </div>
    </div>
  );
}
