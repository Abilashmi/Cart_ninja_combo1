import { Icon } from '@shopify/polaris';
import { AlertCircleIcon } from '@shopify/polaris-icons';

export function ValidationPanel({ issues = [], onFix }) {
  if (!issues.length) return null;

  return (
    <div style={{ marginBottom: 12, border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon source={AlertCircleIcon} tone="warning" />
        <strong style={{ fontSize: 13, color: '#9a2c00' }}>
          {issues.length} {issues.length === 1 ? 'issue' : 'issues'} to fix before publishing
        </strong>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {issues.map((issue, index) => (
          <button
            key={`${issue.section}-${index}`}
            type="button"
            onClick={() => onFix?.(issue)}
            style={{ textAlign: 'left', border: '1px solid #fdba74', background: '#fffbeb', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 13, color: '#9a2c00', fontWeight: 600 }}>{issue.title}</div>
            <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>{issue.message}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
