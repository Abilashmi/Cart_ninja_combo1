import { useState, useMemo } from "react";

const Q_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#FF6B35" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="7" />
    <path d="M6 6a2 2 0 114 0c0 1-2 1.5-2 2.5" />
    <circle cx="8" cy="11.5" r=".5" fill="#FF6B35" stroke="none" />
  </svg>
);

function parseOptions(question) {
  const match = question.match(/\(([^)]+)\)/);
  if (!match) return null;
  return match[1].split(/[,|]|\sor\s/).map((s) => s.trim()).filter(Boolean);
}

function labelForQuestion(question) {
  const lower = question.toLowerCase();
  if (/colou?r|theme/.test(lower)) return "Select option";
  if (/threshold|goal|amount/.test(lower)) return "Enter amount";
  if (/text|message|content/.test(lower)) return "Enter text";
  return "Choose an option";
}

export default function AINeedsInputCard({ question, onSubmit }) {
  const options = useMemo(() => parseOptions(question), [question]);
  const [textVal, setTextVal] = useState("");

  if (options && options.length > 0) {
    return (
      <div className="aif-nic">
        <div className="aif-nic-header">
          {Q_ICON}
          <span className="aif-nic-question">{question}</span>
        </div>
        <div className="aif-nic-options">
          {options.map((opt) => (
            <button key={opt} className="aif-nic-opt" onClick={() => onSubmit(opt)}>
              {opt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="aif-nic">
      <div className="aif-nic-header">
        {Q_ICON}
        <span className="aif-nic-question">{question}</span>
      </div>
      <div className="aif-nic-input-row">
        <input
          className="aif-nic-input"
          type="text"
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          placeholder={labelForQuestion(question)}
        />
        <button
          className="aif-nic-submit"
          disabled={!textVal.trim()}
          onClick={() => { onSubmit(textVal.trim()); setTextVal(""); }}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
