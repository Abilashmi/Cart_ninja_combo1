import { memo } from 'react';

function SectionCardComponent({ title, expanded, onToggle, badge, children }) {
  return (
    <div className="cst-section-card">
      <button
        type="button"
        className="cst-section-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="cst-section-header-left">
          <svg
            className={`cst-chevron ${expanded ? 'expanded' : ''}`}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4 2L8 6L4 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="cst-section-title">{title}</span>
        </div>
        {badge && <span className="cst-section-badge">{badge}</span>}
      </button>
      {expanded && <div className="cst-section-body">{children}</div>}
    </div>
  );
}

export const SectionCard = memo(SectionCardComponent);
