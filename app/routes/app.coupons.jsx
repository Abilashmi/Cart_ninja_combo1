import {
    Page,
    Card,
    BlockStack,
    Text,
    Badge,
    Tabs,
    IndexTable,
    TextField,
    useIndexResourceState,
    EmptyState,
    Banner,
} from "@shopify/polaris";
import { useLoaderData, useNavigate, useSubmit, useActionData } from "react-router";
import { useState, useMemo, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { PlusIcon } from "@shopify/polaris-icons";
import { FeatureHeaderBar } from "../components/feature/FeatureHeaderBar";
import { BrowserTabStrip } from "../components/feature/BrowserTabStrip";
import BrixBar from "../components/ai-agent/BrixBar";

/* ─── ACTION ──────────────────────────────────────────────────────────────── */
// A single generic mutation per operation handles every discount code type
// (basic, bxgy, free shipping) — there's no per-type discountCode*Delete /
// *Activate / *Deactivate mutation in the Admin API (a per-type name was a
// hallucinated guess in an earlier fix and didn't exist on the schema;
// these three were confirmed against the live Admin GraphQL schema).
// Automatic discounts (BRIX-created free-shipping/amount-off promotions,
// discountAutomatic*Create) are a different ID type (DiscountAutomaticNode,
// not DiscountCodeNode) and need the *Automatic* variant of each mutation —
// same distinction app.discount.jsx's action already makes.
const BULK_OPS = {
    bulkDelete: {
        code: { query: `mutation discountCodeDelete($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }`, field: "discountCodeDelete" },
        automatic: { query: `mutation discountAutomaticDelete($id: ID!) { discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { field message } } }`, field: "discountAutomaticDelete" },
    },
    bulkActivate: {
        code: { query: `mutation discountCodeActivate($id: ID!) { discountCodeActivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`, field: "discountCodeActivate" },
        automatic: { query: `mutation discountAutomaticActivate($id: ID!) { discountAutomaticActivate(id: $id) { userErrors { field message } } }`, field: "discountAutomaticActivate" },
    },
    bulkDeactivate: {
        code: { query: `mutation discountCodeDeactivate($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`, field: "discountCodeDeactivate" },
        automatic: { query: `mutation discountAutomaticDeactivate($id: ID!) { discountAutomaticDeactivate(id: $id) { userErrors { field message } } }`, field: "discountAutomaticDeactivate" },
    },
};

export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const op = BULK_OPS[actionType];
    if (!op) return null;

    let ids = [];
    try {
        ids = JSON.parse(formData.get("ids") || "[]");
    } catch {
        return { status: "error", error: "Invalid request." };
    }
    if (!ids.length) return null;

    // Sequential rather than Promise.all — Shopify's Billing/Admin API rate
    // limits bulk mutation bursts from a single app per shop; this mirrors
    // the sequential pattern already used for subscription mutations
    // elsewhere in this app rather than risking throttling on a large
    // selection.
    const errors = [];
    for (const itemId of ids) {
        const variant = itemId.includes("DiscountCodeNode") ? op.code : op.automatic;
        const response = await admin.graphql(variant.query, { variables: { id: itemId } });
        const json = await response.json();
        const userErrors = json.data?.[variant.field]?.userErrors;
        if (userErrors?.length > 0) errors.push(userErrors[0].message);
    }

    return errors.length > 0
        ? { status: "error", error: errors.join("; ") }
        : { status: "done" };
};

/* ─── LOADER ──────────────────────────────────────────────────────────────── */
export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    const query = `
    query DiscountList {
      discountNodes(first: 50, reverse: true) {
        edges {
          node {
            id
            discount {
              __typename
              ... on DiscountCodeBasic {
                title
                codes(first: 1) { edges { node { code } } }
                startsAt endsAt status
                usageLimit appliesOncePerCustomer asyncUsageCount summary
              }
              ... on DiscountCodeBxgy {
                title
                codes(first: 1) { edges { node { code } } }
                startsAt endsAt status
                usageLimit appliesOncePerCustomer asyncUsageCount summary
              }
              ... on DiscountCodeFreeShipping {
                title
                codes(first: 1) { edges { node { code } } }
                startsAt endsAt status
                usageLimit appliesOncePerCustomer asyncUsageCount summary
              }
              ... on DiscountAutomaticBasic {
                title
                startsAt endsAt status
                asyncUsageCount summary
              }
              ... on DiscountAutomaticBxgy {
                title
                startsAt endsAt status
                asyncUsageCount summary
              }
              ... on DiscountAutomaticFreeShipping {
                title
                startsAt endsAt status
                asyncUsageCount summary
              }
            }
            metafield(namespace: "cart_app", key: "source") { value }
          }
        }
      }
    }`;

    const response = await admin.graphql(query);
    const responseJson = await response.json();

    const discounts =
        responseJson.data?.discountNodes?.edges.map((edge) => {
            const node = edge.node;
            const discount = node.discount;
            const isAppCreated = node.metafield?.value === "app";
            const isAutomatic = discount?.__typename?.startsWith("DiscountAutomatic");
            const code = isAutomatic ? "Automatic" : (discount?.codes?.edges?.[0]?.node?.code || "No Code");

            const now = new Date();
            const start = new Date(discount.startsAt);
            const end = discount.endsAt ? new Date(discount.endsAt) : null;
            let calculatedStatus = discount.status;

            if (discount.status === "ACTIVE") {
                if (start > now) calculatedStatus = "SCHEDULED";
                if (end && end < now) calculatedStatus = "EXPIRED";
            }

            return {
                id: node.id,
                title: discount.title,
                code,
                status: calculatedStatus,
                startsAt: discount.startsAt,
                endsAt: discount.endsAt,
                usageCount: discount.asyncUsageCount || 0,
                usageLimit: discount.usageLimit,
                type: discount.__typename,
                source: isAppCreated ? "App" : "Native",
            };
        }) || [];

    return { discounts };
};

/* ─── HELPERS ─────────────────────────────────────────────────────────────── */
function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
    });
}

function statusTone(status) {
    if (status === "ACTIVE") return "success";
    if (status === "SCHEDULED") return "info";
    return undefined;
}

function statusLabel(status) {
    if (!status) return "—";
    return status.charAt(0) + status.slice(1).toLowerCase();
}

function typeLabel(type) {
    if (!type) return "—";
    const isAutomatic = type.startsWith("DiscountAutomatic");
    const base = type.replace("DiscountAutomatic", "").replace("DiscountCode", "");
    const spaced = base.replace(/([A-Z])/g, " $1").trim();
    return (isAutomatic ? `Automatic ${spaced}` : spaced) || "—";
}

/* ─── COMPONENT ───────────────────────────────────────────────────────────── */
export default function CouponsPage() {
    const { discounts } = useLoaderData();
    const navigate = useNavigate();
    const submit = useSubmit();
    const actionData = useActionData();

    const [selectedTab, setSelectedTab] = useState(0);
    const [searchValue, setSearchValue] = useState("");
    const [actionError, setActionError] = useState(null);

    useEffect(() => {
        if (actionData?.status === "error") setActionError(actionData.error);
        else if (actionData?.status === "done") setActionError(null);
    }, [actionData]);

    const counts = useMemo(() => ({
        all: discounts.length,
        active: discounts.filter((d) => d.status === "ACTIVE").length,
        scheduled: discounts.filter((d) => d.status === "SCHEDULED").length,
        expired: discounts.filter((d) => d.status === "EXPIRED").length,
    }), [discounts]);

    const TABS = [
        { id: "all",       content: `All (${counts.all})` },
        { id: "ACTIVE",    content: `Active (${counts.active})` },
        { id: "SCHEDULED", content: `Scheduled (${counts.scheduled})` },
        { id: "EXPIRED",   content: `Expired (${counts.expired})` },
    ];

    const tabId = TABS[selectedTab].id;

    const filteredDiscounts = useMemo(() => {
        return discounts.filter((d) => {
            if (tabId !== "all" && d.status !== tabId) return false;
            if (searchValue) {
                const q = searchValue.toLowerCase();
                return (
                    d.code.toLowerCase().includes(q) ||
                    d.title.toLowerCase().includes(q)
                );
            }
            return true;
        });
    }, [discounts, tabId, searchValue]);

    const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
        useIndexResourceState(filteredDiscounts);

    const runBulkAction = (actionType) => {
        const formData = new FormData();
        formData.append("actionType", actionType);
        formData.append("ids", JSON.stringify(selectedResources));
        submit(formData, { method: "post" });
        clearSelection();
    };

    const rowMarkup = filteredDiscounts.map((discount, index) => (
        <IndexTable.Row
            id={discount.id}
            key={discount.id}
            position={index}
            selected={selectedResources.includes(discount.id)}
            onClick={() => navigate(`/app/discounts/create?discountId=${encodeURIComponent(discount.id)}&code=${encodeURIComponent(discount.code)}`)}
        >
            <IndexTable.Cell>
                <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {discount.title !== discount.code ? discount.title : <Text as="span" variant="bodyMd" tone="subdued">—</Text>}
                    </Text>
                    {discount.title !== discount.code && (
                        <Text as="span" variant="bodySm" tone="subdued">Internal title</Text>
                    )}
                </BlockStack>
            </IndexTable.Cell>
            <IndexTable.Cell>
                <span style={{
                    fontFamily: "monospace", fontWeight: 700,
                    background: "#f3f4f6", padding: "2px 8px",
                    borderRadius: "4px", fontSize: "13px",
                }}>
                    {discount.code}
                </span>
            </IndexTable.Cell>
            <IndexTable.Cell>
                <Text as="span" variant="bodySm" tone="subdued">
                    {typeLabel(discount.type)}
                </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
                <Badge tone={statusTone(discount.status)}>
                    {statusLabel(discount.status)}
                </Badge>
            </IndexTable.Cell>
            <IndexTable.Cell>
                {discount.usageCount} / {discount.usageLimit ?? "∞"}
            </IndexTable.Cell>
            <IndexTable.Cell>{formatDate(discount.startsAt)}</IndexTable.Cell>
            <IndexTable.Cell>{formatDate(discount.endsAt)}</IndexTable.Cell>
        </IndexTable.Row>
    ));

    return (
        <Page
            fullWidth
            primaryAction={{
                content: "Create Discount",
                icon: PlusIcon,
                onAction: () => navigate("/app/discounts/create"),
            }}
            secondaryActions={[{ content: "Export", disabled: true }]}
        >
            <BlockStack gap="400">
                <FeatureHeaderBar
                    feature="coupon"
                    title="Discount Creator"
                    subtitle="Create and manage discount codes for your store"
                />
                {actionError && (
                    <Banner tone="critical" title="Couldn't update discounts" onDismiss={() => setActionError(null)}>
                        {actionError}
                    </Banner>
                )}
                <BrixBar size="md" floating />
                <BrowserTabStrip tabs={TABS} selected={selectedTab} onSelect={setSelectedTab} accent="#e11d48" />
                <Card padding="0">
                    <div>
                        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e1e3e5" }}>
                            <TextField
                                placeholder="Search by title or code…"
                                value={searchValue}
                                onChange={setSearchValue}
                                clearButton
                                onClearButtonClick={() => setSearchValue("")}
                                autoComplete="off"
                                label=""
                                labelHidden
                            />
                        </div>

                        {filteredDiscounts.length === 0 ? (
                            <EmptyState
                                heading={searchValue ? "No discounts match your search" : "No discounts yet"}
                                image=""
                                action={{
                                    content: "Create Discount",
                                    onAction: () => navigate("/app/discounts/create"),
                                }}
                            >
                                <p>
                                    {searchValue
                                        ? "Try adjusting your search."
                                        : "Create your first discount to start driving more conversions."}
                                </p>
                            </EmptyState>
                        ) : (
                            <IndexTable
                                resourceName={{ singular: "discount", plural: "discounts" }}
                                itemCount={filteredDiscounts.length}
                                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                                onSelectionChange={handleSelectionChange}
                                promotedBulkActions={[
                                    { content: "Activate discounts", onAction: () => runBulkAction("bulkActivate") },
                                    { content: "Deactivate discounts", onAction: () => runBulkAction("bulkDeactivate") },
                                    { content: "Delete discounts", destructive: true, onAction: () => runBulkAction("bulkDelete") },
                                ]}
                                headings={[
                                    { title: "Title" },
                                    { title: "Code" },
                                    { title: "Type" },
                                    { title: "Status" },
                                    { title: "Used / Limit" },
                                    { title: "Start Date" },
                                    { title: "End Date" },
                                ]}
                            >
                                {rowMarkup}
                            </IndexTable>
                        )}
                    </div>
                </Card>
            </BlockStack>
            <div style={{ height: 100 }} aria-hidden="true" />
        </Page>
    );
}
