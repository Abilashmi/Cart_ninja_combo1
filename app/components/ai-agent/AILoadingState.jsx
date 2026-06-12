import { useState, useEffect } from "react";

const PHASES = [
  "Analyzing your request...",
  "Scanning Cart Ninja settings...",
  "Applying changes...",
  "Updating your store...",
];

export default function AILoadingState() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 2500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="aif-loading">
      <div className="aif-loading-spinner" />
      <span className="aif-loading-text">{PHASES[phase]}</span>
    </div>
  );
}
