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
} from "@shopify/polaris";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { useState, useMemo } from "react";
import { authenticate } from "../shopify.server";
import { PlusIcon } from "@shopify/polaris-icons";

/* ─── ACTION ──────────────────────────────────────────────────────────────── */
export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const id = formData.get("id");

    if (actionType === "delete" && id) {
        const type = formData.get("type");
        let mutation = "";

        if (type === "DiscountCodeBasic") {
            mutation = `mutation discountCodeBasicDelete($id: ID!) { discountCodeBasicDelete(id: $id) { deletedDiscountCodeId userErrors { field message } } }`;
        } else if (type === "DiscountCodeBxgy") {
            mutation = `mutation discountCodeBxgyDelete($id: ID!) { discountCodeBxgyDelete(id: $id) { deletedDiscountCodeId userErrors { field message } } }`;
        } else if (type === "DiscountCodeFreeShipping") {
            mutation = `mutation discountCodeFreeShippingDelete($id: ID!) { discountCodeFreeShippingDelete(id: $id) { deletedDiscountCodeId userErrors { field message } } }`;
        }

        if (mutation) {
            await admin.graphql(mutation, { variables: { id } });
        }

        return { status: "deleted" };
    }
    return null;
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
            const code = discount?.codes?.edges?.[0]?.node?.code || "No Code";

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
    return (type || "").replace("DiscountCode", "").replace(/([A-Z])/g, " $1").trim() || "—";
}

/* ─── COMPONENT ───────────────────────────────────────────────────────────── */
export default function CouponsPage() {
    const { discounts } = useLoaderData();
    const navigate = useNavigate();
    const submit = useSubmit();

    const [selectedTab, setSelectedTab] = useState(0);
    const [searchValue, setSearchValue] = useState("");

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

    const handleDelete = () => {
        for (const id of selectedResources) {
            const discount = discounts.find((d) => d.id === id);
            const formData = new FormData();
            formData.append("actionType", "delete");
            formData.append("id", id);
            formData.append("type", discount?.type || "");
            submit(formData, { method: "post" });
        }
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
            title="Coupon Creator"
            subtitle="Manage, create, and view your store coupons in one place"
            primaryAction={{
                content: "Create Coupon",
                icon: PlusIcon,
                onAction: () => navigate("/app/discounts/create"),
            }}
            secondaryActions={[{ content: "Export", disabled: true }]}
        >
            <BlockStack gap="400">
                <Card padding="0">
                    <Tabs tabs={TABS} selected={selectedTab} onSelect={setSelectedTab}>
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
                                heading={searchValue ? "No coupons match your search" : "No coupons yet"}
                                image=""
                                action={{
                                    content: "Create Coupon",
                                    onAction: () => navigate("/app/discounts/create"),
                                }}
                            >
                                <p>
                                    {searchValue
                                        ? "Try adjusting your search."
                                        : "Create your first coupon to start driving more conversions."}
                                </p>
                            </EmptyState>
                        ) : (
                            <IndexTable
                                resourceName={{ singular: "coupon", plural: "coupons" }}
                                itemCount={filteredDiscounts.length}
                                selectedItemsCount={
                                    allResourcesSelected ? "All" : selectedResources.length
                                }
                                onSelectionChange={handleSelectionChange}
                                promotedBulkActions={[
                                    { content: "Delete", onAction: handleDelete },
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
                    </Tabs>
                </Card>
            </BlockStack>
        </Page>
    );
}
