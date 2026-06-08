import { useCallback, useEffect, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
    Frame, Toast, Page, Layout, Card, BlockStack, InlineStack, Text, TextField,
    Button, Icon, Banner,
} from "@shopify/polaris";
import { MagicIcon, SendIcon, MicrophoneIcon } from "@shopify/polaris-icons";

import QuickActionChips from "./QuickActionChips";
import OnboardingModal from "./OnboardingModal";
import PlanPreviewCard from "./PlanPreviewCard";
import HelpAndLearnSection from "./HelpAndLearnSection";
import HistoryPanel from "./HistoryPanel";
import { ONBOARDING_STORAGE_KEY } from "./constants";

const PLACEHOLDER = "Example: Enable cart drawer and design it according to my theme.";

export default function AiAgentWorkspace() {
    const { themeColors, currentSettings, history: initialHistory } = useLoaderData();
    const revalidator = useRevalidator();

    const [prompt, setPrompt] = useState("");
    const [plan, setPlan] = useState(null);
    const [planLoading, setPlanLoading] = useState(false);
    const [planError, setPlanError] = useState("");
    const [actionLoading, setActionLoading] = useState(""); // '' | 'preview' | 'apply'
    const [previewResult, setPreviewResult] = useState(null);
    const [applyResult, setApplyResult] = useState(null);
    const [history, setHistory] = useState(initialHistory || []);
    const [restoringId, setRestoringId] = useState("");
    const [toast, setToast] = useState(null);
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        try {
            const seen = localStorage.getItem(ONBOARDING_STORAGE_KEY);
            if (!seen) setShowOnboarding(true);
        } catch { /* ignore storage errors */ }
    }, []);

    const dismissOnboarding = useCallback(() => {
        setShowOnboarding(false);
        try { localStorage.setItem(ONBOARDING_STORAGE_KEY, "1"); } catch { /* ignore */ }
    }, []);

    const handleUsePromptText = useCallback((text) => {
        setPrompt(text);
    }, []);

    const handleSelectOnboardingGoal = useCallback((goal) => {
        setPrompt(goal.prompt);
        dismissOnboarding();
    }, [dismissOnboarding]);

    const resetPlanState = useCallback(() => {
        setPlan(null);
        setPlanError("");
        setPreviewResult(null);
        setApplyResult(null);
        setActionLoading("");
    }, []);

    const handleGenerate = useCallback(async () => {
        const trimmed = prompt.trim();
        if (!trimmed) {
            setPlanError("Describe what you'd like to change first.");
            return;
        }

        setPlanLoading(true);
        setPlanError("");
        setPreviewResult(null);
        setApplyResult(null);
        setPlan(null);

        try {
            const res = await fetch("/api/ai-agent/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: trimmed }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || `Request failed (${res.status})`);
            }
            setPlan(data.plan);
        } catch (e) {
            setPlanError(e?.message || "Couldn't generate a plan. Please try again.");
        } finally {
            setPlanLoading(false);
        }
    }, [prompt]);

    const runApplyRequest = useCallback(async (mode) => {
        if (!plan) return;
        setActionLoading(mode);
        try {
            const res = await fetch("/api/ai-agent/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: prompt.trim(), plan, mode }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || `Request failed (${res.status})`);
            }

            if (mode === "preview") {
                setPreviewResult(data);
                setToast({ message: "Preview ready — review the before/after below.", error: false });
            } else {
                setApplyResult(data);
                if (data.history) setHistory((prev) => [data.history, ...prev]);
                setToast({ message: data.synced ? "Changes applied to your cart!" : "Changes saved locally — will sync shortly.", error: false });
                revalidator.revalidate();
            }
        } catch (e) {
            setToast({ message: e?.message || "Something went wrong. Please try again.", error: true });
        } finally {
            setActionLoading("");
        }
    }, [plan, prompt, revalidator]);

    const handleCancel = useCallback(() => {
        resetPlanState();
        setToast({ message: "Discarded — nothing was changed.", error: false });
    }, [resetPlanState]);

    const handleRestore = useCallback(async (entryId) => {
        setRestoringId(entryId);
        try {
            const res = await fetch("/api/ai-agent/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entryId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || `Request failed (${res.status})`);
            }
            if (data.history) setHistory((prev) => [data.history, ...prev]);
            setToast({ message: "Previous AI changes restored.", error: false });
            revalidator.revalidate();
        } catch (e) {
            setToast({ message: e?.message || "Couldn't restore those changes.", error: true });
        } finally {
            setRestoringId("");
        }
    }, [revalidator]);

    return (
        <Frame>
            {toast && (
                <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />
            )}

            <OnboardingModal
                open={showOnboarding}
                onClose={dismissOnboarding}
                onSelectGoal={handleSelectOnboardingGoal}
            />

            <Page
                title="The Cart Ninja AI"
                subtitle="Describe what you want and let AI optimize your cart automatically."
            >
                <Layout>
                    <Layout.Section>
                        <BlockStack gap="400">
                            <Card>
                                <BlockStack gap="300">
                                    <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                        <Icon source={MagicIcon} tone="magic" />
                                        <Text as="h2" variant="headingMd">Quick actions</Text>
                                    </div>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Tap a suggestion to drop it into the prompt box below — you can edit it before sending.
                                    </Text>
                                    <QuickActionChips onSelect={handleUsePromptText} disabled={planLoading} />
                                </BlockStack>
                            </Card>

                            <Card>
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Tell the AI what you want</Text>
                                    <TextField
                                        label="Prompt"
                                        labelHidden
                                        value={prompt}
                                        onChange={setPrompt}
                                        placeholder={PLACEHOLDER}
                                        multiline={4}
                                        autoComplete="off"
                                    />
                                    {planError && (
                                        <Banner tone="critical" onDismiss={() => setPlanError("")}>
                                            <p>{planError}</p>
                                        </Banner>
                                    )}
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Button icon={MicrophoneIcon} disabled accessibilityLabel="Voice input (coming soon)">
                                            Voice input
                                        </Button>
                                        <Button
                                            variant="primary"
                                            icon={SendIcon}
                                            onClick={handleGenerate}
                                            loading={planLoading}
                                            disabled={!prompt.trim()}
                                        >
                                            Generate Changes
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Card>

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

                            <HelpAndLearnSection onUsePrompt={handleUsePromptText} />
                        </BlockStack>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <BlockStack gap="400">
                            <Card>
                                <BlockStack gap="200">
                                    <Text as="h3" variant="headingSm">Your store at a glance</Text>
                                    <InlineStack gap="150" blockAlign="center">
                                        <div
                                            aria-hidden="true"
                                            style={{ background: themeColors.primaryColor, width: 20, height: 20, borderRadius: 6, border: "1px solid rgba(0,0,0,0.08)", flexShrink: 0 }}
                                        />
                                        <Text as="span" variant="bodySm" tone="subdued">
                                            Theme color {themeColors.primaryColor} · {themeColors.font} · {themeColors.borderRadius}px radius
                                        </Text>
                                    </InlineStack>
                                    <BlockStack gap="100">
                                        <SettingRow label="Cart drawer" enabled={currentSettings.drawerEnabled} />
                                        <SettingRow label="Upsell recommendations" enabled={currentSettings.upsell.enabled} />
                                        <SettingRow label="Frequently bought together" enabled={currentSettings.fbt.enabled} />
                                        <SettingRow label="Free shipping goal bar" enabled={currentSettings.goalBar.enabled} />
                                        <SettingRow label="Trust badges" enabled={currentSettings.trustBadges.enabled} />
                                    </BlockStack>
                                </BlockStack>
                            </Card>

                            <HistoryPanel history={history} restoringId={restoringId} onRestore={handleRestore} />
                        </BlockStack>
                    </Layout.Section>
                </Layout>
            </Page>
        </Frame>
    );
}

function SettingRow({ label, enabled }) {
    return (
        <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm">{label}</Text>
            <Text as="span" variant="bodySm" tone={enabled ? "success" : "subdued"} fontWeight="medium">
                {enabled ? "On" : "Off"}
            </Text>
        </InlineStack>
    );
}
