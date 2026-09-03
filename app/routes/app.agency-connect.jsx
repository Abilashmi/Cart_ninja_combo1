import { useActionData, useLoaderData, useNavigate, useNavigation, useRevalidator, useSubmit } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Page, Text, Icon } from "@shopify/polaris";
import { TeamIcon, StoreIcon, ShieldCheckMarkIcon, CheckCircleIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

// Two separate hosts hold this shared secret + base URL: the PHP backend
// at int.thebrix.io (php_backend/install_shop.php, uninstall_shop.php)
// and this Node app's own environment (Fly.io secrets) — configured
// independently since they're different runtimes/deployments, but must
// carry the exact same values on both sides for the Agency Dashboard to
// trust either caller.
function agencyDashboardHeaders() {
    return {
        "Content-Type": "application/json",
        Accept: "application/json",
        // eslint-disable-next-line no-undef
        "X-Internal-Secret": process.env.AGENCY_DASHBOARD_INTERNAL_SECRET || "",
    };
}

function agencyDashboardUrl(path) {
    // eslint-disable-next-line no-undef
    const base = (process.env.AGENCY_DASHBOARD_URL || "").replace(/\/+$/, "");
    return `${base}${path}`;
}

export async function loader({ request }) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    try {
        const res = await fetch(
            agencyDashboardUrl(`/internal/shopify/agency/store-status?shop_domain=${encodeURIComponent(shop)}`),
            { headers: agencyDashboardHeaders() }
        );
        const body = await res.json();
        if (!res.ok || !body?.success) {
            return { stage: "ERROR", shop };
        }
        return { ...body.data, shop };
    } catch {
        // Agency Dashboard unreachable (not configured yet, network blip,
        // etc.) — never break the embedded app over this; just show a
        // friendly state the merchant can retry from.
        return { stage: "ERROR", shop };
    }
}

export async function action({ request }) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    const endpoint = intent === "activate" ? "/internal/shopify/agency/store-activate" : "/internal/shopify/agency/store-authorize";

    try {
        const res = await fetch(agencyDashboardUrl(endpoint), {
            method: "POST",
            headers: agencyDashboardHeaders(),
            body: JSON.stringify({ shop_domain: shop }),
        });
        const body = await res.json();

        if (!res.ok || !body?.success) {
            return { error: body?.message || "Something went wrong. Please try again.", intent };
        }

        if (intent === "activate") {
            return { redirectUrl: body.data?.redirect_url || null };
        }

        return { stage: body.data?.relationship_status === "AUTHORIZED" ? "ACTIVATION_REQUIRED" : "AUTHORIZATION_REQUIRED" };
    } catch {
        return { error: "Could not reach the Agency Dashboard. Please try again.", intent };
    }
}

/* ─── Presentation ───
 * Styled to match the rest of the embedded app (app._index.jsx): white
 * rounded cards, #1a1a1a primary buttons, #1a9de0 / #2ecc71 brand accents,
 * #e5e7eb borders, plain inline-styled elements rather than default
 * Polaris Card/Button/Banner (which read as generic Shopify grey/blue and
 * would clash with Brix's own black-button, white-card look).
 */

const AGENCY_CONNECT_STYLES = `
@keyframes brix-ac-spin { to { transform: rotate(360deg); } }
@keyframes brix-ac-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes brix-ac-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.brix-ac-shell { min-height: calc(100vh - 140px); display: flex; align-items: center; justify-content: center; padding: 40px 16px; box-sizing: border-box; }
.brix-ac-card { width: 100%; max-width: 560px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 44px 40px 36px; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 20px 48px rgba(17,24,39,0.06); box-sizing: border-box; animation: brix-ac-fade-up 280ms ease; }
.brix-ac-logo { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #1a9de0, #2ecc71); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(26,157,224,0.35); margin: 0 auto 22px; flex-shrink: 0; }
.brix-ac-spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #e5e7eb; border-top-color: #1a9de0; animation: brix-ac-spin 800ms linear infinite; margin: 0 auto; }
.brix-ac-spinner-sm { width: 15px; height: 15px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); border-top-color: #ffffff; animation: brix-ac-spin 700ms linear infinite; flex-shrink: 0; }
.brix-ac-icon-circle { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; animation: brix-ac-pop 380ms ease; flex-shrink: 0; }
.brix-ac-rows { display: flex; flex-direction: column; gap: 8px; margin: 20px 0; }
.brix-ac-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: #f9fafb; border: 1px solid #f0f0f0; border-radius: 10px; }
.brix-ac-row-label { display: flex; align-items: center; gap: 8px; color: #6b7280; }
.brix-ac-trust { display: flex; align-items: center; justify-content: center; gap: 6px; color: #6b7280; margin: 18px 0 26px; }
.brix-ac-btn-primary { width: 100%; padding: 13px 20px; background: #1a1a1a; color: #ffffff; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: opacity 150ms ease, transform 150ms ease; font-family: inherit; }
.brix-ac-btn-primary:not(:disabled):hover { transform: translateY(-1px); }
.brix-ac-btn-primary:disabled { opacity: 0.65; cursor: default; }
.brix-ac-btn-ghost { width: 100%; padding: 11px 20px; margin-top: 6px; background: none; color: #6b7280; border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.brix-ac-btn-ghost:hover { color: #1a1a1a; }
@media (max-width: 480px) {
  .brix-ac-card { padding: 32px 22px 28px; border-radius: 16px; }
  .brix-ac-row { flex-direction: column; align-items: flex-start; gap: 4px; }
}
`;

function LogoMark() {
    return (
        <div className="brix-ac-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h9a4 4 0 0 1 0 8H4z" />
                <path d="M4 12h10a4 4 0 0 1 0 8H4z" />
            </svg>
        </div>
    );
}

function Spinner() {
    return <div className="brix-ac-spinner" role="status" aria-label="Loading" />;
}

// eslint-disable-next-line react/prop-types
function IconCircle({ tone, icon }) {
    const tones = {
        success: { background: "#d1fae5", color: "#059669" },
        error: { background: "#fee2e2", color: "#dc2626" },
        neutral: { background: "#f3f4f6", color: "#6b7280" },
    };
    const t = tones[tone] || tones.neutral;
    return (
        <div className="brix-ac-icon-circle" style={{ background: t.background }}>
            <span style={{ width: 26, height: 26, display: "flex", color: t.color }}>
                <Icon source={icon} tone={tone === "error" ? "critical" : tone === "success" ? "success" : "subdued"} />
            </span>
        </div>
    );
}

// eslint-disable-next-line react/prop-types
function InfoRow({ icon, label, value }) {
    return (
        <div className="brix-ac-row">
            <span className="brix-ac-row-label">
                <span style={{ width: 16, height: 16, display: "flex" }}><Icon source={icon} tone="subdued" /></span>
                <Text as="span" variant="bodySm" fontWeight="medium">{label}</Text>
            </span>
            <Text as="span" variant="bodySm" fontWeight="semibold">{value}</Text>
        </div>
    );
}

// eslint-disable-next-line react/prop-types
function Heading({ children }) {
    return (
        <div style={{ textAlign: "center", marginBottom: 10 }}>
            <Text as="h1" variant="headingLg" fontWeight="bold">{children}</Text>
        </div>
    );
}

// eslint-disable-next-line react/prop-types
function Subtext({ children }) {
    return (
        <div style={{ textAlign: "center", marginBottom: 4 }}>
            <Text as="p" variant="bodyMd" tone="subdued">{children}</Text>
        </div>
    );
}

export default function AgencyConnectPage() {
    const loaderData = useLoaderData();
    const actionData = useActionData();
    const navigation = useNavigation();
    const revalidator = useRevalidator();
    const submit = useSubmit();
    const navigate = useNavigate();

    const lastIntentRef = useRef(null);
    const [redirectStarted, setRedirectStarted] = useState(false);

    const shop = loaderData.shop;
    const agencyName = loaderData.agency_name || null;
    // Whichever the merchant most recently did wins over the page's
    // initial load state, so the UI advances immediately after Authorize
    // without waiting for a full reload.
    const stage = actionData?.stage || loaderData.stage;

    const pendingIntent = navigation.formData?.get("intent") || null;
    const isAuthorizing = pendingIntent === "authorize";
    const isActivating = pendingIntent === "activate";
    const isCheckingFresh = navigation.state !== "idle" && !pendingIntent;

    const hasRedirect = Boolean(actionData?.redirectUrl);

    // The activate action's redirect leaves the embedded app entirely
    // (back to the Agency Dashboard) via the existing signed redirect URL
    // — unchanged mechanism, just given a brief on-screen success beat
    // before firing so "Store Connected" is actually visible to the
    // merchant instead of an instant blank navigation.
    useEffect(() => {
        if (actionData?.redirectUrl && !redirectStarted) {
            setRedirectStarted(true);
            const timer = setTimeout(() => {
                window.top.location.href = actionData.redirectUrl;
            }, 1100);
            return () => clearTimeout(timer);
        }
    }, [actionData, redirectStarted]);

    // Already-active stores never see the authorization screen — send the
    // merchant straight on to the normal Brix Home using existing
    // frontend navigation (no backend redirect involved).
    useEffect(() => {
        if (stage === "COMPLETE" && !actionData?.redirectUrl) {
            navigate("/app", { replace: true });
        }
    }, [stage, actionData, navigate]);

    const handleAuthorize = () => {
        lastIntentRef.current = "authorize";
        submit({ intent: "authorize" }, { method: "POST" });
    };
    const handleActivate = () => {
        lastIntentRef.current = "activate";
        submit({ intent: "activate" }, { method: "POST" });
    };
    const handleRetry = () => {
        const intent = actionData?.intent || lastIntentRef.current;
        if (intent === "authorize" || intent === "activate") {
            submit({ intent }, { method: "POST" });
        } else {
            revalidator.revalidate();
        }
    };
    const goHome = () => navigate("/app");

    let content;

    if (isAuthorizing || isActivating) {
        content = isActivating
            ? renderActivation({ agencyName, shop, activating: true })
            : renderAuthorization({ agencyName, shop, authorizing: true, onAuthorize: handleAuthorize, onCancel: goHome });
    } else if (hasRedirect) {
        content = renderSuccess({ agencyName, shop });
    } else if (isCheckingFresh) {
        content = renderChecking();
    } else if (actionData?.error) {
        content = renderError({ message: actionData.error, onRetry: handleRetry });
    } else if (stage === "NOT_INSTALLED") {
        content = renderNotInstalled({ onRefresh: () => revalidator.revalidate() });
    } else if (stage === "ERROR") {
        content = renderError({
            message: "We couldn't verify your agency connection right now. Please try again in a moment.",
            onRetry: () => revalidator.revalidate(),
        });
    } else if (stage === "AUTHORIZATION_REQUIRED") {
        content = renderAuthorization({ agencyName, shop, authorizing: false, onAuthorize: handleAuthorize, onCancel: goHome });
    } else if (stage === "ACTIVATION_REQUIRED") {
        content = renderActivation({ agencyName, shop, activating: false, onActivate: handleActivate });
    } else if (stage === "COMPLETE") {
        // Redirect effect above is already in flight; render the checking
        // spinner for the brief instant before it takes over.
        content = renderChecking();
    } else {
        content = renderNoConnection({ onGoHome: goHome });
    }

    return (
        <Page fullWidth>
            <style>{AGENCY_CONNECT_STYLES}</style>
            <div className="brix-ac-shell">
                <div className="brix-ac-card">
                    <LogoMark />
                    {content}
                </div>
            </div>
        </Page>
    );
}

function renderChecking() {
    return (
        <>
            <Heading>Checking your agency connection</Heading>
            <Subtext>Please wait while we verify your store connection.</Subtext>
            <div style={{ marginTop: 28 }}>
                <Spinner />
            </div>
        </>
    );
}

function renderNotInstalled({ onRefresh }) {
    return (
        <>
            <Heading>Finishing installation</Heading>
            <Subtext>Brix still needs to finish installing on this store. This page will update automatically once that&apos;s done.</Subtext>
            <div style={{ marginTop: 28, marginBottom: 8 }}>
                <Spinner />
            </div>
            <button className="brix-ac-btn-ghost" onClick={onRefresh} type="button">Refresh status</button>
        </>
    );
}

function renderAuthorization({ agencyName, shop, authorizing, onAuthorize, onCancel }) {
    return (
        <>
            <Heading>Connect your agency</Heading>
            <Subtext>
                {agencyName ? `${agencyName} wants to connect this store to Brix.` : "Your agency wants to connect this store to Brix."}
            </Subtext>

            <div className="brix-ac-rows">
                <InfoRow icon={TeamIcon} label="Agency" value={agencyName || "Your agency"} />
                <InfoRow icon={StoreIcon} label="Store" value={shop} />
            </div>

            <Subtext>By authorizing this connection, you allow your agency to manage this store through the Brix agency dashboard.</Subtext>

            <div className="brix-ac-trust">
                <span style={{ width: 15, height: 15, display: "flex" }}><Icon source={ShieldCheckMarkIcon} tone="subdued" /></span>
                <Text as="span" variant="bodySm" fontWeight="medium">Secure agency connection</Text>
            </div>

            <button className="brix-ac-btn-primary" onClick={onAuthorize} disabled={authorizing} type="button">
                {authorizing && <span className="brix-ac-spinner-sm" />}
                {authorizing ? "Authorizing agency…" : "Authorize Agency"}
            </button>
            <button className="brix-ac-btn-ghost" onClick={onCancel} disabled={authorizing} type="button">Cancel</button>
        </>
    );
}

function renderActivation({ agencyName, shop, activating, onActivate }) {
    return (
        <>
            <IconCircle tone="success" icon={CheckCircleIcon} />
            <Heading>Agency Authorized</Heading>
            <Subtext>
                {agencyName ? `${agencyName} is now authorized to connect with this store.` : "Your agency is now authorized to connect with this store."}
            </Subtext>

            <div className="brix-ac-rows">
                <InfoRow icon={TeamIcon} label="Agency" value={agencyName || "Your agency"} />
                <InfoRow icon={StoreIcon} label="Store" value={shop} />
            </div>

            <div style={{ marginBottom: 22 }}>
                <Subtext>Activate your store to complete the connection.</Subtext>
            </div>

            <button className="brix-ac-btn-primary" onClick={onActivate} disabled={activating} type="button">
                {activating && <span className="brix-ac-spinner-sm" />}
                {activating ? "Activating your store…" : "Activate Store"}
            </button>
            {activating && (
                <div style={{ marginTop: 12, textAlign: "center" }}>
                    <Text as="p" variant="bodyXs" tone="subdued">
                        {agencyName ? `Connecting your store to ${agencyName}.` : "Connecting your store to your agency."}
                    </Text>
                </div>
            )}
        </>
    );
}

function renderSuccess({ agencyName, shop }) {
    return (
        <>
            <IconCircle tone="success" icon={CheckCircleIcon} />
            <Heading>Store Connected</Heading>
            <Subtext>
                {agencyName ? `Your store is now connected to ${agencyName}.` : "Your store is now connected to your agency."}
            </Subtext>
            <div className="brix-ac-rows">
                <InfoRow icon={StoreIcon} label="Store" value={shop} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                <div className="brix-ac-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                <Text as="span" variant="bodyXs" tone="subdued">Redirecting to your agency dashboard…</Text>
            </div>
        </>
    );
}

function renderNoConnection({ onGoHome }) {
    return (
        <>
            <IconCircle tone="neutral" icon={AlertCircleIcon} />
            <Heading>No agency connection found</Heading>
            <Subtext>This store does not currently have a pending agency connection.</Subtext>
            <Subtext>Please use the connection request provided by your agency.</Subtext>
            <div style={{ marginTop: 22 }}>
                <button className="brix-ac-btn-primary" onClick={onGoHome} type="button">Go to Brix Home</button>
            </div>
        </>
    );
}

function renderError({ message, onRetry }) {
    return (
        <>
            <IconCircle tone="error" icon={AlertCircleIcon} />
            <Heading>Something went wrong</Heading>
            <Subtext>{message || "We couldn't complete the agency connection."}</Subtext>
            <div style={{ marginTop: 22 }}>
                <button className="brix-ac-btn-primary" onClick={onRetry} type="button">Try Again</button>
            </div>
        </>
    );
}
