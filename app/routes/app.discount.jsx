import {
  Page,
  Card,
  IndexTable,
  IndexFilters,
  useSetIndexFiltersMode,
  useIndexResourceState,
  Text,
  Badge,
  BlockStack,
  Spinner,
  EmptyState,
  Icon,
  ChoiceList,
  Modal,
  RadioButton,
  InlineStack,
  Box,
  Toast,
  Frame,
} from "@shopify/polaris";
import {
  ExportIcon,
  DiscountIcon,
} from "@shopify/polaris-icons";
import { useLoaderData, useNavigate, useSubmit, useActionData, useNavigation } from "react-router";
import { useMemo, useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { useCurrency } from "../components/CurrencyContext";

/* ---------------- LOADER & ACTION ---------------- */
export { loader } from "./api.shopify-coupons";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const ids = JSON.parse(formData.get("ids") || "[]");
  const intent = formData.get("intent");

  if (!ids.length) return { success: false, message: "No items selected" };

  const errors = [];
  let successCount = 0;

  for (const id of ids) {
    if (id.startsWith("sample-")) {
      errors.push(`Cannot ${intent} sample discount: ${id}`);
      continue;
    }

    const isCode = id.includes("DiscountCodeNode");

    let mutation = "";
    if (intent === "activate") {
      mutation = isCode
        ? `mutation ActivateCode($id: ID!) { discountCodeActivate(id: $id) { userErrors { message } } }`
        : `mutation ActivateAuto($id: ID!) { discountAutomaticActivate(id: $id) { userErrors { message } } }`;
    } else if (intent === "deactivate") {
      mutation = isCode
        ? `mutation DeactivateCode($id: ID!) { discountCodeDeactivate(id: $id) { userErrors { message } } }`
        : `mutation DeactivateAuto($id: ID!) { discountAutomaticDeactivate(id: $id) { userErrors { message } } }`;
    } else if (intent === "delete") {
      mutation = isCode
        ? `mutation DeleteCode($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { message } } }`
        : `mutation DeleteAuto($id: ID!) { discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { message } } }`;
    }

    if (mutation) {
      const response = await admin.graphql(mutation, { variables: { id } });
      const resJson = await response.json();
      const dataKey = Object.keys(resJson.data || {})[0];
      const userErrors = resJson.data?.[dataKey]?.userErrors || [];

      if (userErrors.length > 0) {
        errors.push(...userErrors.map(e => e.message));
      } else {
        successCount++;
      }
    }
  }

  return {
    success: successCount > 0,
    message: successCount > 0
      ? `Successfully ${intent}d ${successCount} discount${successCount !== 1 ? 's' : ''}`
      : "Failed to perform action",
    errors,
    intent,
  };
}

/* ---------------- HELPERS ---------------- */

function statusBadge(status) {
  const badgeMap = {
    ACTIVE: { tone: "success", label: "Active" },
    SCHEDULED: { tone: "attention", label: "Scheduled" },
    EXPIRED: { tone: "subdued", label: "Expired" },
  };
  const { tone, label } = badgeMap[status] || { tone: "default", label: status };
  return <Badge tone={tone}>{label}</Badge>;
}

function discountTypeLabel(type) {
  if (!type) return "-";
  if (type.includes("FreeShipping")) return "Free shipping";
  if (type.includes("Bxgy")) return "Buy X Get Y";
  if (type.includes("Basic")) return "Amount off";
  return type;
}

function formatDiscountValue(coupon, currencySymbol) {
  if (coupon.discountType === "percentage" && coupon.discountValue) return `${coupon.discountValue}% off`;
  if (coupon.discountType === "fixed" && coupon.discountValue) return `${currencySymbol}${coupon.discountValue} off`;
  if (coupon.discountType === "free_shipping") return "Free shipping";
  if (coupon.discountType === "bxgy") return "BXGY";
  return "-";
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildCSV(coupons, format, currencySymbol) {
  const headers = ["Title", "Code", "Type", "Discount", "Status", "Used", "Limit", "Start Date", "End Date"];
  const rows = coupons.map((c) => [
    c.heading || c.code || "",
    c.code || "",
    discountTypeLabel(c.type),
    formatDiscountValue(c, currencySymbol),
    c.status || "",
    c.used ?? 0,
    c.limit ?? "Unlimited",
    c.starts_at ? formatDate(c.starts_at) : "",
    c.ends_at ? formatDate(c.ends_at) : "",
  ]);

  const escapeCSV = (val) => {
    const str = String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const bom = format === "excel" ? "\uFEFF" : "";
  const csv = bom + [headers, ...rows].map((row) => row.map(escapeCSV).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coupons-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ========================================== */
/*              MAIN COMPONENT                */
/* ========================================== */

export default function AppDiscounts() {
  const { currencySymbol } = useCurrency();
  const navigate = useNavigate();
  const submit = useSubmit();
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const coupons = data?.coupons || [];

  // Toast state
  const [showToast, setShowToast] = useState(false);
  const [toastContent, setToastContent] = useState("");
  const [isErrorToast, setIsErrorToast] = useState(false);

  useEffect(() => {
    if (actionData && !isLoading) {
      setToastContent(actionData.message || (actionData.success ? "Success" : "Error"));
      setIsErrorToast(!actionData.success);
      setShowToast(true);
      if (actionData.success) clearSelection();
    }
  }, [actionData, isLoading]);

  const toastMarkup = showToast ? (
    <Toast content={toastContent} error={isErrorToast} onDismiss={() => setShowToast(false)} />
  ) : null;

  // ── IndexFilters mode ──
  const { mode, setMode } = useSetIndexFiltersMode();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ── State ──
  const [selected, setSelected] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const [sortSelected, setSortSelected] = useState(["date desc"]);
  const [typeFilter, setTypeFilter] = useState(undefined);
  const [statusFilter, setStatusFilter] = useState(undefined);

  // ── Export modal state ──
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState("current_page");
  const [exportFormat, setExportFormat] = useState("excel");

  // ── Counts ──
  const counts = useMemo(() => {
    const active = coupons.filter((c) => c.status === "ACTIVE").length;
    const scheduled = coupons.filter((c) => c.status === "SCHEDULED").length;
    const expired = coupons.filter((c) => c.status === "EXPIRED").length;
    return { total: coupons.length, active, scheduled, expired };
  }, [coupons]);

  // ── Tabs ──
  const tabs = [
    { id: "all", content: `All (${counts.total})`, index: 0 },
    { id: "active", content: `Active (${counts.active})`, index: 1 },
    { id: "scheduled", content: `Scheduled (${counts.scheduled})`, index: 2 },
    { id: "expired", content: `Expired (${counts.expired})`, index: 3 },
  ];

  // ── Sort Options ──
  const sortOptions = [
    { label: "Date", value: "date asc", directionLabel: "Oldest first" },
    { label: "Date", value: "date desc", directionLabel: "Newest first" },
    { label: "Code", value: "code asc", directionLabel: "A–Z" },
    { label: "Code", value: "code desc", directionLabel: "Z–A" },
    { label: "Usage", value: "usage asc", directionLabel: "Least used" },
    { label: "Usage", value: "usage desc", directionLabel: "Most used" },
    { label: "Value", value: "value asc", directionLabel: "Lowest" },
    { label: "Value", value: "value desc", directionLabel: "Highest" },
  ];

  // ── Filter callbacks ──
  const handleTypeFilterChange = useCallback((value) => setTypeFilter(value), []);
  const handleStatusFilterChange = useCallback((value) => setStatusFilter(value), []);
  const handleTypeFilterRemove = useCallback(() => setTypeFilter(undefined), []);
  const handleStatusFilterRemove = useCallback(() => setStatusFilter(undefined), []);
  const handleQueryChange = useCallback((value) => setQueryValue(value), []);
  const handleQueryClear = useCallback(() => setQueryValue(""), []);
  const handleFiltersClearAll = useCallback(() => {
    handleTypeFilterRemove();
    handleStatusFilterRemove();
    handleQueryClear();
  }, [handleTypeFilterRemove, handleStatusFilterRemove, handleQueryClear]);

  const onHandleCancel = () => {};
  const onHandleSave = async () => { await sleep(1); return true; };

  // ── Filters config ──
  const filters = [
    {
      key: "type",
      label: "Discount type",
      filter: (
        <ChoiceList
          title="Discount type"
          titleHidden
          choices={[
            { label: "Amount off", value: "Basic" },
            { label: "Buy X Get Y", value: "Bxgy" },
            { label: "Free shipping", value: "FreeShipping" },
          ]}
          selected={typeFilter || []}
          onChange={handleTypeFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "Active", value: "ACTIVE" },
            { label: "Scheduled", value: "SCHEDULED" },
            { label: "Expired", value: "EXPIRED" },
          ]}
          selected={statusFilter || []}
          onChange={handleStatusFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  // ── Applied filters ──
  const appliedFilters = [];
  if (typeFilter && typeFilter.length > 0) {
    appliedFilters.push({
      key: "type",
      label: `Type: ${typeFilter.map((t) => {
        if (t === "Basic") return "Amount off";
        if (t === "Bxgy") return "Buy X Get Y";
        if (t === "FreeShipping") return "Free shipping";
        return t;
      }).join(", ")}`,
      onRemove: handleTypeFilterRemove,
    });
  }
  if (statusFilter && statusFilter.length > 0) {
    appliedFilters.push({
      key: "status",
      label: `Status: ${statusFilter.join(", ")}`,
      onRemove: handleStatusFilterRemove,
    });
  }

  // ── Filter + Sort logic ──
  const filteredCoupons = useMemo(() => {
    let result = [...coupons];

    if (selected === 1) result = result.filter((c) => c.status === "ACTIVE");
    if (selected === 2) result = result.filter((c) => c.status === "SCHEDULED");
    if (selected === 3) result = result.filter((c) => c.status === "EXPIRED");

    if (queryValue) {
      const q = queryValue.toLowerCase();
      result = result.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          (c.heading && c.heading.toLowerCase().includes(q))
      );
    }

    if (typeFilter && typeFilter.length > 0) {
      result = result.filter((c) => typeFilter.some((t) => c.type && c.type.includes(t)));
    }

    if (statusFilter && statusFilter.length > 0) {
      result = result.filter((c) => statusFilter.includes(c.status));
    }

    const [sortKey, sortDir] = (sortSelected[0] || "date desc").split(" ");
    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      switch (sortKey) {
        case "date":   return dir * (new Date(a.starts_at) - new Date(b.starts_at));
        case "code":   return dir * (a.code || "").localeCompare(b.code || "");
        case "usage":  return dir * ((a.used || 0) - (b.used || 0));
        case "value":  return dir * ((a.discountValue || 0) - (b.discountValue || 0));
        default:       return dir * (new Date(a.starts_at) - new Date(b.starts_at));
      }
    });

    return result;
  }, [coupons, selected, queryValue, typeFilter, statusFilter, sortSelected]);

  // ── Resource state ──
  const resourceName = { singular: "coupon", plural: "coupons" };
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(filteredCoupons);

  const hasActiveSearch =
    queryValue.length > 0 ||
    (typeFilter && typeFilter.length > 0) ||
    (statusFilter && statusFilter.length > 0) ||
    selected !== 0;

  const selectedCount = selectedResources.length;

  // ── Bulk Actions ──
  const promotedBulkActions = [
    {
      content: "Activate discounts",
      loading: isLoading && navigation.formData?.get("intent") === "activate",
      disabled: isLoading,
      onAction: () =>
        submit({ ids: JSON.stringify(selectedResources), intent: "activate" }, { method: "POST" }),
    },
    {
      content: "Deactivate discounts",
      loading: isLoading && navigation.formData?.get("intent") === "deactivate",
      disabled: isLoading,
      onAction: () =>
        submit({ ids: JSON.stringify(selectedResources), intent: "deactivate" }, { method: "POST" }),
    },
    {
      content: "Delete discounts",
      destructive: true,
      loading: isLoading && navigation.formData?.get("intent") === "delete",
      disabled: isLoading,
      onAction: () =>
        submit({ ids: JSON.stringify(selectedResources), intent: "delete" }, { method: "POST" }),
    },
  ];

  // ── Export handler ──
  const handleExport = useCallback(() => {
    let dataToExport;
    switch (exportScope) {
      case "all":      dataToExport = coupons; break;
      case "selected": dataToExport = filteredCoupons.filter((c) => selectedResources.includes(c.id)); break;
      case "search":   dataToExport = filteredCoupons; break;
      case "current_page":
      default:         dataToExport = filteredCoupons; break;
    }
    buildCSV(dataToExport, exportFormat, currencySymbol);
    setExportModalOpen(false);
  }, [exportScope, exportFormat, coupons, filteredCoupons, selectedResources, currencySymbol]);

  // ── Row markup ──
  const rowMarkup = filteredCoupons.map((coupon, index) => (
    <IndexTable.Row
      id={coupon.id}
      key={coupon.id}
      selected={selectedResources.includes(coupon.id)}
      position={index}
      onClick={() => {
        const encodedId = encodeURIComponent(coupon.id || "");
        const encodedCode = encodeURIComponent(coupon.code || "");
        navigate(`/app/discounts/create?discountId=${encodedId}&code=${encodedCode}`);
      }}
    >
      <IndexTable.Cell>
        <div style={{ padding: "12px 0" }}>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {coupon.heading || coupon.code}
          </Text>
        </div>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <div style={{ padding: "12px 0" }}>
          <span style={{ fontSize: "14px", fontWeight: "600", color: "#334155", letterSpacing: "0.2px" }}>
            {coupon.code}
          </span>
        </div>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" tone="subdued">{discountTypeLabel(coupon.type)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="bold">
          {formatDiscountValue(coupon, currencySymbol)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(coupon.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Text as="span" fontWeight="semibold" numeric>{coupon.used ?? 0}</Text>
          <Text variant="bodySm" tone="subdued">/ {coupon.limit || "∞"}</Text>
        </div>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" tone="subdued">{formatDate(coupon.starts_at)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" tone="subdued">{formatDate(coupon.ends_at)}</Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  // ── Export Modal ──
  const exportModal = (
    <Modal
      open={exportModalOpen}
      onClose={() => setExportModalOpen(false)}
      title="Export discounts"
      primaryAction={{ content: "Export discounts", onAction: handleExport }}
      secondaryActions={[{ content: "Cancel", onAction: () => setExportModalOpen(false) }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Export</Text>
            <RadioButton
              label="Current page"
              checked={exportScope === "current_page"}
              id="export-current"
              name="exportScope"
              onChange={() => setExportScope("current_page")}
            />
            <RadioButton
              label="All discounts"
              checked={exportScope === "all"}
              id="export-all"
              name="exportScope"
              onChange={() => setExportScope("all")}
            />
            <RadioButton
              label={`Selected: ${selectedCount} discount${selectedCount !== 1 ? "s" : ""}`}
              checked={exportScope === "selected"}
              id="export-selected"
              name="exportScope"
              onChange={() => setExportScope("selected")}
              disabled={selectedCount === 0}
            />
            <RadioButton
              label={`${filteredCoupons.length} discount${filteredCoupons.length !== 1 ? "s" : ""} matching your search`}
              checked={exportScope === "search"}
              id="export-search"
              name="exportScope"
              onChange={() => setExportScope("search")}
              disabled={!hasActiveSearch}
            />
          </BlockStack>

          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Export as</Text>
            <RadioButton
              label="CSV for Excel, Numbers, or other spreadsheet programs"
              checked={exportFormat === "excel"}
              id="format-excel"
              name="exportFormat"
              onChange={() => setExportFormat("excel")}
            />
            <RadioButton
              label="Plain CSV file"
              checked={exportFormat === "plain"}
              id="format-plain"
              name="exportFormat"
              onChange={() => setExportFormat("plain")}
            />
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );

  // ── Loading ──
  if (!data) {
    return (
      <Page title="Coupons" fullWidth>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "400px" }}>
          <Spinner accessibilityLabel="Loading coupons" size="large" />
        </div>
      </Page>
    );
  }

  // ── Empty state ──
  if (coupons.length === 0) {
    return (
      <Page
        title="Coupons"
        fullWidth
        primaryAction={{
          content: "Create Coupon",
          onAction: () => navigate("/app/discounts/create"),
        }}
      >
        <Card>
          <EmptyState
            heading="Create your first coupon"
            action={{ content: "Create Coupon", onAction: () => navigate("/app/discounts/create") }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Start offering discounts to boost conversions and drive more sales.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  // ── Render ──
  return (
    <Frame>
      <Page
        title="Coupons"
        fullWidth
        primaryAction={{
          content: "Create Coupon",
          onAction: () => navigate("/app/discounts/create"),
        }}
        secondaryActions={[
          {
            content: "Export",
            icon: ExportIcon,
            onAction: () => setExportModalOpen(true),
          },
        ]}
      >
        {exportModal}
        {toastMarkup}

        <BlockStack gap="600">
          <Card>
            <Box padding="600" background="bg-surface-secondary" borderRadius="300">
              <BlockStack gap="100">
                <Text variant="headingXl" as="h1" fontWeight="bold">Coupon Engine</Text>
                <Text variant="bodyMd" tone="subdued">
                  Manage, create, and view your store coupons in one place.
                </Text>
              </BlockStack>
            </Box>
          </Card>

          <Card padding="0">
            <IndexFilters
              sortOptions={sortOptions}
              sortSelected={sortSelected}
              queryValue={queryValue}
              queryPlaceholder="Search coupons..."
              onQueryChange={handleQueryChange}
              onQueryClear={handleQueryClear}
              onSort={setSortSelected}
              cancelAction={{ onAction: onHandleCancel, disabled: false, loading: false }}
              tabs={tabs}
              selected={selected}
              onSelect={setSelected}
              filters={filters}
              appliedFilters={appliedFilters}
              onClearAll={handleFiltersClearAll}
              mode={mode}
              setMode={setMode}
            />
            <IndexTable
              resourceName={resourceName}
              itemCount={filteredCoupons.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={promotedBulkActions}
              headings={[
                { title: "Title" },
                { title: "Code" },
                { title: "Type" },
                { title: "Discount" },
                { title: "Status" },
                { title: "Used" },
                { title: "Start date" },
                { title: "End date" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </BlockStack>
      </Page>
    </Frame>
  );
}