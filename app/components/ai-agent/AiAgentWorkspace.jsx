import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Toast, Icon, Text } from "@shopify/polaris";
import { MagicIcon, ChatIcon, SendIcon, XIcon } from "@shopify/polaris-icons";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import QuickActionChips from "./QuickActionChips";
import OnboardingModal from "./OnboardingModal";
import PlanPreviewCard from "./PlanPreviewCard";
import HelpAndLearnSection from "./HelpAndLearnSection";
import HistoryPanel from "./HistoryPanel";
import { ONBOARDING_STORAGE_KEY } from "./constants";

const WELCOME = "Connected to Store. Awaiting instructions.";
const SAMPLE_CHART_DATA = [
  { name: "Mon", value: 400 }, { name: "Tue", value: 300 }, { name: "Wed", value: 600 },
  { name: "Thu", value: 800 }, { name: "Fri", value: 500 }, { name: "Sat", value: 900 },
  { name: "Sun", value: 700 },
];

export default function AiAgentWorkspace() {
  const { themeColors, currentSettings, history: initialHistory } = useLoaderData();
  const revalidator = useRevalidator();

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [previewResult, setPreviewResult] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [history, setHistory] = useState(initialHistory || []);
  const [restoringId, setRestoringId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);

  const chatBodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try { if (!localStorage.getItem(ONBOARDING_STORAGE_KEY)) setShowOnboarding(true); } catch { /* */ }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, "1"); } catch { /* */ }
  }, []);

  useEffect(() => {
    if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [messages, planLoading]);

  useEffect(() => {
    if (chatOpen && inputRef.current) inputRef.current.focus();
  }, [chatOpen]);

  const resetPlanState = useCallback(() => {
    setPlan(null); setPlanError(""); setPreviewResult(null); setApplyResult(null); setActionLoading("");
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setMessages((p) => [...p, { role: "user", content: trimmed }]);
    setInputValue("");
    setPlanLoading(true);
    setPlanError("");

    const hasDataQuery = /conversion|rate|aov|revenue|analytics|chart|graph|data|performance|trend/i.test(trimmed);

    try {
      const res = await fetch("/api/ai-agent/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);

      setPlan(data.plan);
      setMessages((p) => [...p, { role: "assistant", content: data.plan.summary, plan: data.plan }]);

      if (hasDataQuery && data.plan?.summary) {
        setActiveDetail({ type: "chart", data: SAMPLE_CHART_DATA, summary: data.plan.summary });
      } else if (data.plan && !data.plan?.off_topic) {
        setActiveDetail({ type: "plan", plan: data.plan });
      }
    } catch (e) {
      setPlanError(e?.message || "Couldn't generate a plan.");
      setMessages((p) => [...p, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setPlanLoading(false);
    }
  }, [inputValue]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleUsePrompt = useCallback((text) => {
    setInputValue(text);
    if (!chatOpen) setChatOpen(true);
    else if (inputRef.current) inputRef.current.focus();
  }, [chatOpen]);

  const handleSelectOnboardingGoal = useCallback((goal) => {
    setInputValue(goal.prompt); dismissOnboarding(); if (!chatOpen) setChatOpen(true);
  }, [dismissOnboarding, chatOpen]);

  const runApplyRequest = useCallback(async (mode) => {
    if (!plan) return;
    setActionLoading(mode);
    try {
      const res = await fetch("/api/ai-agent/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: inputValue.trim(), plan, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
      if (mode === "preview") {
        setPreviewResult(data);
        setToast({ message: "Preview ready — review the before/after below.", error: false });
      } else {
        setApplyResult(data);
        if (data.history) setHistory((p) => [data.history, ...p]);
        setToast({ message: data.synced ? "Changes applied to your cart!" : "Changes saved locally.", error: false });
        revalidator.revalidate();
      }
    } catch (e) {
      setToast({ message: e?.message || "Something went wrong.", error: true });
    } finally { setActionLoading(""); }
  }, [plan, inputValue, revalidator]);

  const handleCancel = useCallback(() => {
    resetPlanState();
    setToast({ message: "Discarded — nothing was changed.", error: false });
  }, [resetPlanState]);

  const handleRestore = useCallback(async (entryId) => {
    setRestoringId(entryId);
    try {
      const res = await fetch("/api/ai-agent/history", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
      if (data.history) setHistory((p) => [data.history, ...p]);
      setToast({ message: "Previous AI changes restored.", error: false });
      revalidator.revalidate();
    } catch (e) {
      setToast({ message: e?.message || "Couldn't restore those changes.", error: true });
    } finally { setRestoringId(""); }
  }, [revalidator]);

  return (
    <>
      {toast && <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />}
      <OnboardingModal open={showOnboarding} onClose={dismissOnboarding} onSelectGoal={handleSelectOnboardingGoal} />

      <div className="ai-agent-layout">
        <div className="ai-agent-main">
          <div className="ai-agent-toolbar">
            <button
              className={`toolbar-btn ${showHistory ? "active" : ""}`}
              onClick={() => setShowHistory((v) => !v)}
              title="History"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <path d="M10 6v4l3 2" />
              </svg>
            </button>
          </div>

          <div className="ai-agent-content">
            {activeDetail?.type === "chart" ? (
              <div className="detail-panel">
                <div className="detail-panel-header">
                  <Text as="h2" variant="headingLg">Analytics Overview</Text>
                  <button className="close-detail-btn" onClick={() => setActiveDetail(null)}>
                    <Icon source={XIcon} />
                  </button>
                </div>
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={activeDetail.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#008060" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="detail-summary">
                  <Text as="p" variant="bodyMd">{activeDetail.summary}</Text>
                </div>
              </div>
            ) : activeDetail?.type === "plan" ? (
              <div className="detail-panel">
                <div className="detail-panel-header">
                  <Text as="h2" variant="headingLg">AI Recommendations</Text>
                  <button className="close-detail-btn" onClick={() => setActiveDetail(null)}>
                    <Icon source={XIcon} />
                  </button>
                </div>
                <PlanPreviewCard
                  plan={activeDetail.plan}
                  loading={actionLoading}
                  applying={actionLoading === "apply"}
                  previewResult={previewResult}
                  applyResult={applyResult}
                  onPreview={() => runApplyRequest("preview")}
                  onApply={() => runApplyRequest("apply")}
                  onCancel={handleCancel}
                />
              </div>
            ) : (
              <>
                <div className="content-header">
                  <div>
                    <Text as="h1" variant="heading2xl">The Cart Ninja AI</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">Describe what you want and let AI optimize your cart.</Text>
                  </div>
                </div>

                <div className="content-section">
                  <div className="section-label">
                    <Icon source={MagicIcon} tone="magic" />
                    <Text as="h3" variant="headingMd">Quick actions</Text>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">Pick a suggestion or type your own in the chat.</Text>
                  <QuickActionChips onSelect={handleUsePrompt} disabled={planLoading} />
                </div>

                <div className="content-section">
                  <HelpAndLearnSection onUsePrompt={handleUsePrompt} />
                </div>

                {plan && (
                  <div className="content-section">
                    <PlanPreviewCard
                      plan={plan}
                      loading={actionLoading}
                      applying={actionLoading === "apply"}
                      previewResult={previewResult}
                      applyResult={applyResult}
                      onPreview={() => runApplyRequest("preview")}
                      onApply={() => runApplyRequest("apply")}
                      onCancel={handleCancel}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="ai-agent-chat">
          {!chatOpen ? (
            <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Open chat">
              <Icon source={ChatIcon} />
            </button>
          ) : (
            <div className="chat-window">
              <div className="chat-header">
                <div className="chat-header-left">
                  <div className="chat-avatar">
                    <Icon source={MagicIcon} tone="magic" />
                  </div>
                  <div>
                    <Text as="span" variant="headingSm" fontWeight="bold">Cart Ninja AI</Text>
                    <Text as="p" variant="bodyXs" tone="subdued">Online</Text>
                  </div>
                </div>
                <div className="chat-header-actions">
                  <button className="chat-header-btn" onClick={() => setChatOpen(false)} aria-label="Close">
                    <Icon source={XIcon} />
                  </button>
                </div>
              </div>

              <div className="chat-body" ref={chatBodyRef}>
                <div className="msg assistant">
                  <div className="msg-avatar">
                    <Icon source={MagicIcon} tone="magic" />
                  </div>
                  <div className="msg-bubble">{WELCOME}</div>
                </div>
                {messages.map((msg, i) => (
                  <div key={i} className={`msg ${msg.role}`}>
                    {msg.role === "assistant" && (
                      <div className="msg-avatar">
                        <Icon source={MagicIcon} tone="magic" />
                      </div>
                    )}
                    <div className="msg-bubble">{msg.content}</div>
                  </div>
                ))}
                {planLoading && (
                  <div className="msg assistant">
                    <div className="msg-avatar">
                      <Icon source={MagicIcon} tone="magic" />
                    </div>
                    <div className="msg-bubble thinking">
                      <span className="dot-pulse" />
                    </div>
                  </div>
                )}
              </div>

              <div className="chat-footer">
                <div className="chat-input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message..."
                    rows={1}
                    disabled={planLoading}
                  />
                  <button
                    className="chat-send-btn"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || planLoading}
                    aria-label="Send"
                  >
                    <Icon source={SendIcon} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`history-overlay ${showHistory ? "visible" : ""}`} onClick={() => setShowHistory(false)} />
      <div className={`history-slide-panel ${showHistory ? "open" : ""}`}>
        <div className="history-slide-header">
          <Text as="h3" variant="headingMd">AI History</Text>
          <button className="history-close-btn" onClick={() => setShowHistory(false)}>
            <Icon source={XIcon} />
          </button>
        </div>
        <div className="history-slide-body">
          <HistoryPanel history={history} restoringId={restoringId} onRestore={handleRestore} />
        </div>
      </div>
    </>
  );
}
