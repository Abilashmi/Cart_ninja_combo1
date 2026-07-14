import {
    Page,
    Card,
    TextField,
    Button,
    BlockStack,
    InlineStack,
    Text,
    Toast,
    Layout,
    Box,
    Divider,
    Icon,
    Banner,
    List,
    Thumbnail,
    DatePicker,
    Popover,
    Checkbox,
    Select,
    Modal,
    Scrollable,
    ButtonGroup,
    Frame,
    Badge,
} from "@shopify/polaris";
import {
    DiscountIcon,
    DeliveryIcon,
    GiftCardIcon,
    RefreshIcon,
    ProductIcon,
    CollectionIcon,
    CalendarIcon,
} from "@shopify/polaris-icons";
import {
    useNavigate,
    useActionData,
    useNavigation,
    useSubmit,
    useLoaderData,
    useSearchParams,
} from "react-router";
import { useCallback, useState, useMemo, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getStoredCoupons } from "../services/coupon-sample.server";
import { useCurrency } from "../components/CurrencyContext";

const COUNTRIES = [
    { label: "India", value: "IN", flag: "🇮🇳" },
    { label: "United States", value: "US", flag: "🇺🇸" },
    { label: "United Kingdom", value: "GB", flag: "🇬🇧" },
    { label: "Canada", value: "CA", flag: "🇨🇦" },
    { label: "Australia", value: "AU", flag: "🇦🇺" },
    { label: "Germany", value: "DE", flag: "🇩🇪" },
    { label: "France", value: "FR", flag: "🇫🇷" },
    { label: "Japan", value: "JP", flag: "🇯🇵" },
    { label: "China", value: "CN", flag: "🇨🇳" },
    { label: "Brazil", value: "BR", flag: "🇧🇷" },
];

/* ─────────────────────────────────────────────────────────── */
/*                     SERVER ACTION                           */
/* ─────────────────────────────────────────────────────────── */

export const action = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const intent   = formData.get("intent");   // "create" | "update"
    const shopifyId = formData.get("shopifyId") || null;

    const title    = formData.get("title");
    const code     = formData.get("code");
    const type     = formData.get("type");
    const valueType = formData.get("valueType");
    const value    = parseFloat(formData.get("value") || "0");
    const startDate = formData.get("startDate");
    const endDate  = formData.get("endDate");

    const selectionType       = formData.get("selectionType");
    const selectedResources   = JSON.parse(formData.get("selectedResources") || "[]");
    const minimumRequirementValue  = formData.get("minimumRequirement");
    const minimumPurchaseAmount    = parseFloat(formData.get("minimumPurchaseAmount") || "0");
    const minimumQuantity          = parseInt(formData.get("minimumQuantity") || "0");
    const limitTotalUses           = formData.get("limitTotalUses") === "true";
    const totalUsesLimit           = parseInt(formData.get("totalUsesLimit") || "0");
    const limitOnePerCustomer      = formData.get("limitOnePerCustomer") === "true";
    const combineProduct           = formData.get("combineProduct") === "true";
    const combineOrder             = formData.get("combineOrder") === "true";
    const combineShipping          = formData.get("combineShipping") === "true";
    const oncePerOrder             = formData.get("oncePerOrder") === "true";

    const startsAt = new Date(startDate).toISOString();
    const endsAt   = endDate ? new Date(endDate).toISOString() : null;

    const isCode   = shopifyId ? shopifyId.includes("DiscountCodeNode") : true;
    const isUpdate = intent === "update" && !!shopifyId;

    /* ── Shared minimum requirement builder ── */
    const buildMinimumRequirement = () => {
        if (minimumRequirementValue === "amount") {
            return { subtotal: { greaterThanOrEqualToSubtotal: { amount: minimumPurchaseAmount, currencyCode: "INR" } } };
        }
        if (minimumRequirementValue === "quantity") {
            return { quantity: { greaterThanOrEqualToQuantity: minimumQuantity } };
        }
        return undefined;
    };

    const combinesWith = {
        productDiscounts: combineProduct,
        orderDiscounts:   combineOrder,
        shippingDiscounts: combineShipping,
    };

    /* ── Shared customerGets items ── */
    const buildCustomerGetsItems = () => {
        if (type === "amount_off_order" && selectionType === "all") return { all: true };
        if (selectionType === "collections") return { collections: { add: selectedResources.map(r => r.id) } };
        if (selectionType === "products")    return { products: { productsToAdd: selectedResources.map(r => r.id) } };
        return { all: true };
    };

    let mutation = "";
    let variables = {};

    /* ════════════════════════════════════════════════════════════
       AMOUNT OFF PRODUCTS / ORDER
    ════════════════════════════════════════════════════════════ */
    if (type === "amount_off_products" || type === "amount_off_order") {
        const discountInput = {
            title: title || code,
            code,
            startsAt,
            ...(endsAt && { endsAt }),
            customerSelection: { all: true },
            customerGets: {
                value: {
                    [valueType === "percentage" ? "percentage" : "discountAmount"]:
                        valueType === "percentage"
                            ? value / 100
                            : { amount: value, appliesOnEachItem: type === "amount_off_order" ? false : !oncePerOrder },
                },
                items: buildCustomerGetsItems(),
            },
            appliesOncePerCustomer: limitOnePerCustomer,
            ...(limitTotalUses && totalUsesLimit > 0 && { usageLimit: totalUsesLimit }),
            combinesWith,
            ...(buildMinimumRequirement() && { minimumRequirement: buildMinimumRequirement() }),
        };

        if (isUpdate) {
            mutation = `#graphql
                mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
                    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
                        codeDiscountNode { id }
                        userErrors { field message }
                    }
                }
            `;
            variables = { id: shopifyId, basicCodeDiscount: discountInput };
        } else {
            mutation = `#graphql
                mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
                    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
                        codeDiscountNode { id }
                        userErrors { field message }
                    }
                }
            `;
            variables = { basicCodeDiscount: discountInput };
        }
    }

    /* ════════════════════════════════════════════════════════════
       FREE SHIPPING
    ════════════════════════════════════════════════════════════ */
    else if (type === "free_shipping") {
        const countriesType      = formData.get("countriesType");
        const selectedCountries  = JSON.parse(formData.get("selectedCountries") || "[]");

        const shippingInput = {
            title: title || code,
            code,
            startsAt,
            ...(endsAt && { endsAt }),
            customerSelection: { all: true },
            destinationSelection:
                countriesType === "all" ? { all: true } : { countries: { add: selectedCountries } },
            appliesOncePerCustomer: limitOnePerCustomer,
            ...(limitTotalUses && { usageLimit: totalUsesLimit }),
            combinesWith,
            ...(buildMinimumRequirement() && { minimumRequirement: buildMinimumRequirement() }),
        };

        if (isUpdate) {
            mutation = `#graphql
                mutation discountCodeFreeShippingUpdate($id: ID!, $freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
                    discountCodeFreeShippingUpdate(id: $id, freeShippingCodeDiscount: $freeShippingCodeDiscount) {
                        codeDiscountNode { id }
                        userErrors { field message }
                    }
                }
            `;
            variables = { id: shopifyId, freeShippingCodeDiscount: shippingInput };
        } else {
            mutation = `#graphql
                mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
                    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
                        codeDiscountNode { id }
                        userErrors { field message }
                    }
                }
            `;
            variables = { freeShippingCodeDiscount: shippingInput };
        }
    }

    /* ════════════════════════════════════════════════════════════
       BUY X GET Y
    ════════════════════════════════════════════════════════════ */
    else if (type === "bxgy") {
        const buysType         = formData.get("bxgyBuysType") === "collections" ? "collections" : "products";
        const buysResources    = JSON.parse(formData.get("bxgyBuysResources") || "[]");
        const buysQuantity     = parseInt(formData.get("bxgyBuysQuantity") || "1");
        const getsType         = formData.get("bxgyGetsType");
        const getsResources    = JSON.parse(formData.get("bxgyGetsResources") || "[]");
        const getsValueType    = formData.get("bxgyGetsValueType");
        const getsValue        = parseFloat(formData.get("bxgyGetsValue") || "0");
        const getsQuantity     = parseInt(formData.get("bxgyGetsQuantity") || "1");
        const repeatOncePerOrder = formData.get("bxgyRepeatOncePerOrder") === "true";

        const buysItems = buysType === "collections"
            ? { collections: { add: buysResources.map(r => r.id) } }
            : { products: { productsToAdd: buysResources.map(r => r.id) } };

        const getsItems = getsType === "same"
            ? buysItems
            : getsType === "collections"
                ? { collections: { add: getsResources.map(r => r.id) } }
                : { products: { productsToAdd: getsResources.map(r => r.id) } };

        // customerGets.value: quantity is now inside discountOnQuantity, not top-level
        let customerGetsValue;
        if (getsValueType === "free" || getsValueType === "percentage") {
            customerGetsValue = {
                discountOnQuantity: {
                    quantity: { quantity: getsQuantity },
                    effect: { percentage: getsValueType === "free" ? 1.0 : getsValue / 100 },
                },
            };
        } else {
            // fixed_amount — discountAmount doesn't carry a quantity in the current API
            customerGetsValue = {
                discountAmount: { amount: getsValue, appliesOnEachItem: true },
            };
        }

        const bxgyInput = {
            title: title || code,
            code,
            startsAt,
            ...(endsAt && { endsAt }),
            customerSelection: { all: true },
            appliesOncePerCustomer: limitOnePerCustomer,
            ...(limitTotalUses && totalUsesLimit > 0 && { usageLimit: totalUsesLimit }),
            customerBuys: { items: buysItems, value: { quantity: { quantity: buysQuantity } } },
            customerGets: { items: getsItems, value: customerGetsValue },
            ...(repeatOncePerOrder && { usesPerOrderLimit: 1 }),
            combinesWith,
        };

        if (isUpdate) {
            mutation = `#graphql
                mutation discountCodeBxgyUpdate($id: ID!, $bxgyCodeDiscount: DiscountCodeBxgyInput!) {
                    discountCodeBxgyUpdate(id: $id, bxgyCodeDiscount: $bxgyCodeDiscount) {
                        codeDiscountNode { id }
                        userErrors { field message }
                    }
                }
            `;
            variables = { id: shopifyId, bxgyCodeDiscount: bxgyInput };
        } else {
            mutation = `#graphql
                mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
                    discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
                        codeDiscountNode { id }
                        userErrors { field message }
                    }
                }
            `;
            variables = { bxgyCodeDiscount: bxgyInput };
        }
    }

    /* ── Run mutation ── */
    try {
        const response     = await admin.graphql(mutation, { variables });
        const responseJson = await response.json();

        if (responseJson.errors) return { errors: responseJson.errors };
        if (!responseJson.data)  return { errors: [{ message: "Unexpected response from Shopify" }] };

        const mutationKey = Object.keys(responseJson.data)[0];
        const result      = responseJson.data[mutationKey];

        if (!result)                            return { errors: [{ message: "Mutation result not found" }] };
        if (result.userErrors?.length > 0)      return { errors: result.userErrors };

        const discountId = result.codeDiscountNode?.id || shopifyId;

        /* ── Persist locally ── */
        if (!isUpdate) {
            try {
                const samplePayload = {
                    shopDomain: session.shop,
                    title, code, type, valueType, value, startDate, endDate,
                    selectionType, selectedResources,
                    minimumRequirementValue, minimumPurchaseAmount, minimumQuantity,
                    limitTotalUses, totalUsesLimit, limitOnePerCustomer,
                    combineProduct, combineOrder, combineShipping, oncePerOrder,
                    countriesType:         formData.get("countriesType"),
                    selectedCountries:     JSON.parse(formData.get("selectedCountries") || "[]"),
                    bxgyBuysType:          formData.get("bxgyBuysType"),
                    bxgyBuysResources:     JSON.parse(formData.get("bxgyBuysResources") || "[]"),
                    bxgyBuysQuantity:      formData.get("bxgyBuysQuantity"),
                    bxgyGetsType:          formData.get("bxgyGetsType"),
                    bxgyGetsResources:     JSON.parse(formData.get("bxgyGetsResources") || "[]"),
                    bxgyGetsValueType:     formData.get("bxgyGetsValueType"),
                    bxgyGetsValue:         formData.get("bxgyGetsValue"),
                    bxgyGetsQuantity:      formData.get("bxgyGetsQuantity"),
                    bxgyRepeatOncePerOrder: formData.get("bxgyRepeatOncePerOrder") === "true",
                    shopifyId:             discountId,
                };

                const apiUrl = new URL("/api/create_coupon-sample", request.url).href;
                const apiResponse = await fetch(apiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(samplePayload),
                });

                if (!apiResponse.ok) {
                    console.error("API responded with status:", apiResponse.status);
                } else {
                    console.log("Coupon saved via API:", await apiResponse.json());
                }
            } catch (err) {
                console.error("Error sending to coupon API:", err);
            }
        }

        return { success: true, discountId, intent };
    } catch (error) {
        console.error("Error saving discount:", error);
        return { errors: [{ message: error.message || "Failed to save discount" }] };
    }
};

/* ─────────────────────────────────────────────────────────── */
/*                     SERVER LOADER                           */
/* ─────────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const discountId = url.searchParams.get("discountId");

    const coupons = await getStoredCoupons(session.shop);

    let shopifyDiscount = null;
    if (discountId) {
        try {
            const res = await admin.graphql(
                `#graphql
                query GetDiscount($id: ID!) {
                    discountNode(id: $id) {
                        id
                        discount {
                            __typename
                            ... on DiscountCodeBasic {
                                title
                                codes(first: 1) { edges { node { code } } }
                                startsAt endsAt usageLimit appliesOncePerCustomer
                                combinesWith { productDiscounts orderDiscounts shippingDiscounts }
                                customerGets {
                                    value {
                                        ... on DiscountPercentage { percentage }
                                        ... on DiscountAmount { amount { amount } appliesOnEachItem }
                                    }
                                    items {
                                        ... on AllDiscountItems { allItems }
                                        ... on DiscountProducts { products(first: 20) { edges { node { id title } } } }
                                        ... on DiscountCollections { collections(first: 20) { edges { node { id title } } } }
                                    }
                                }
                                minimumRequirement {
                                    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
                                    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
                                }
                            }
                            ... on DiscountCodeBxgy {
                                title
                                codes(first: 1) { edges { node { code } } }
                                startsAt endsAt usageLimit appliesOncePerCustomer usesPerOrderLimit
                                combinesWith { productDiscounts orderDiscounts shippingDiscounts }
                                customerBuys {
                                    value { ... on DiscountQuantity { quantity } }
                                    items {
                                        ... on DiscountProducts { products(first: 20) { edges { node { id title } } } }
                                        ... on DiscountCollections { collections(first: 20) { edges { node { id title } } } }
                                    }
                                }
                                customerGets {
                                    value {
                                        ... on DiscountOnQuantity {
                                            effect { ... on DiscountPercentage { percentage } }
                                            quantity { quantity }
                                        }
                                        ... on DiscountAmount { amount { amount } appliesOnEachItem }
                                    }
                                    items {
                                        ... on DiscountProducts { products(first: 20) { edges { node { id title } } } }
                                        ... on DiscountCollections { collections(first: 20) { edges { node { id title } } } }
                                    }
                                }
                            }
                            ... on DiscountCodeFreeShipping {
                                title
                                codes(first: 1) { edges { node { code } } }
                                startsAt endsAt usageLimit appliesOncePerCustomer
                                combinesWith { productDiscounts orderDiscounts shippingDiscounts }
                                destinationSelection {
                                    ... on DiscountCountryAll { allCountries }
                                    ... on DiscountCountries { countries { code } }
                                }
                                minimumRequirement {
                                    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
                                    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
                                }
                            }
                        }
                    }
                }`,
                { variables: { id: discountId } }
            );
            const json = await res.json();
            const node = json.data?.discountNode;
            if (node) shopifyDiscount = { id: node.id, ...node.discount };
        } catch (e) {
            console.error("Failed to fetch discount from Shopify:", e.message);
        }
    }

    return { coupons, shopifyDiscount };
};

/* ─────────────────────────────────────────────────────────── */
/*                      COMPONENT                             */
/* ─────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────── */
/*          SHOPIFY DISCOUNT → FORM STATE NORMALIZER           */
/* ─────────────────────────────────────────────────────────── */

function normalizeShopifyDiscount(sd, discountId) {
    if (!sd) return null;
    const typename = sd.__typename;
    const code = sd.codes?.edges?.[0]?.node?.code || "";

    let type = "amount_off_products";
    let valueType = "percentage";
    let value = "";
    let selectionType = "all";
    let selectedResources = [];
    let minimumRequirementValue = "none";
    let minimumPurchaseAmount = "";
    let minimumQuantity = "";
    let oncePerOrder = false;
    let bxgyBuysType = "products";
    let bxgyBuysResources = [];
    let bxgyBuysQuantity = "1";
    let bxgyGetsType = "products";
    let bxgyGetsResources = [];
    let bxgyGetsValueType = "free";
    let bxgyGetsValue = "";
    let bxgyGetsQuantity = "1";
    let bxgyRepeatOncePerOrder = false;
    let countriesType = "all";
    let selectedCountries = [];

    const mapProducts = (edges) => (edges || []).map(e => ({ id: e.node.id, title: e.node.title }));

    if (typename === "DiscountCodeBasic") {
        const gv = sd.customerGets?.value;
        const gi = sd.customerGets?.items;

        if (gv?.__typename === "DiscountPercentage") {
            valueType = "percentage";
            value = String(Math.round((gv.percentage || 0) * 100));
        } else if (gv?.__typename === "DiscountAmount") {
            valueType = "fixed_amount";
            value = String(gv.amount?.amount || "");
            oncePerOrder = gv.appliesOnEachItem === false;
        }

        if (gi?.__typename === "AllDiscountItems") {
            selectionType = "all";
            type = (gv?.appliesOnEachItem === false) ? "amount_off_order" : "amount_off_products";
        } else if (gi?.__typename === "DiscountProducts") {
            type = "amount_off_products";
            selectionType = "products";
            selectedResources = mapProducts(gi.products?.edges);
        } else if (gi?.__typename === "DiscountCollections") {
            type = "amount_off_products";
            selectionType = "collections";
            selectedResources = mapProducts(gi.collections?.edges);
        }

        const mr = sd.minimumRequirement;
        if (mr?.__typename === "DiscountMinimumSubtotal") {
            minimumRequirementValue = "amount";
            minimumPurchaseAmount = String(mr.greaterThanOrEqualToSubtotal?.amount || "");
        } else if (mr?.__typename === "DiscountMinimumQuantity") {
            minimumRequirementValue = "quantity";
            minimumQuantity = String(mr.greaterThanOrEqualToQuantity || "");
        }

    } else if (typename === "DiscountCodeBxgy") {
        type = "bxgy";

        const bi = sd.customerBuys?.items;
        if (bi?.__typename === "DiscountProducts") {
            bxgyBuysType = "products";
            bxgyBuysResources = mapProducts(bi.products?.edges);
        } else if (bi?.__typename === "DiscountCollections") {
            bxgyBuysType = "collections";
            bxgyBuysResources = mapProducts(bi.collections?.edges);
        }
        bxgyBuysQuantity = String(sd.customerBuys?.value?.quantity || "1");

        const gi = sd.customerGets?.items;
        if (gi?.__typename === "DiscountProducts") {
            bxgyGetsType = "products";
            bxgyGetsResources = mapProducts(gi.products?.edges);
        } else if (gi?.__typename === "DiscountCollections") {
            bxgyGetsType = "collections";
            bxgyGetsResources = mapProducts(gi.collections?.edges);
        }

        const gv = sd.customerGets?.value;
        if (gv?.__typename === "DiscountOnQuantity") {
            bxgyGetsQuantity = String(gv.quantity?.quantity || "1");
            const pct = gv.effect?.percentage;
            if (pct === 1) { bxgyGetsValueType = "free"; }
            else if (pct) { bxgyGetsValueType = "percentage"; bxgyGetsValue = String(Math.round(pct * 100)); }
        } else if (gv?.__typename === "DiscountAmount") {
            bxgyGetsValueType = "fixed_amount";
            bxgyGetsValue = String(gv.amount?.amount || "");
        }
        bxgyRepeatOncePerOrder = !!(sd.usesPerOrderLimit && Number(sd.usesPerOrderLimit) <= 1);

    } else if (typename === "DiscountCodeFreeShipping") {
        type = "free_shipping";

        const dest = sd.destinationSelection;
        if (dest?.__typename === "DiscountCountryAll") {
            countriesType = "all";
        } else if (dest?.__typename === "DiscountCountries") {
            countriesType = "specific";
            selectedCountries = (dest.countries || []).map(c => c.code);
        }

        const mr = sd.minimumRequirement;
        if (mr?.__typename === "DiscountMinimumSubtotal") {
            minimumRequirementValue = "amount";
            minimumPurchaseAmount = String(mr.greaterThanOrEqualToSubtotal?.amount || "");
        } else if (mr?.__typename === "DiscountMinimumQuantity") {
            minimumRequirementValue = "quantity";
            minimumQuantity = String(mr.greaterThanOrEqualToQuantity || "");
        }
    }

    return {
        shopifyId: discountId,
        title: sd.title || "",
        code,
        type,
        valueType,
        value,
        selectionType,
        selectedResources,
        minimumRequirementValue,
        minimumPurchaseAmount,
        minimumQuantity,
        limitTotalUses: !!sd.usageLimit,
        totalUsesLimit: sd.usageLimit ? String(sd.usageLimit) : "",
        limitOnePerCustomer: !!sd.appliesOncePerCustomer,
        combineProduct: !!sd.combinesWith?.productDiscounts,
        combineOrder: !!sd.combinesWith?.orderDiscounts,
        combineShipping: !!sd.combinesWith?.shippingDiscounts,
        oncePerOrder,
        countriesType,
        selectedCountries,
        bxgyBuysType,
        bxgyBuysResources,
        bxgyBuysQuantity,
        bxgyGetsType,
        bxgyGetsResources,
        bxgyGetsValueType,
        bxgyGetsValue,
        bxgyGetsQuantity,
        bxgyRepeatOncePerOrder,
        startDate: sd.startsAt,
        endDate: sd.endsAt,
    };
}

/* ─────────────────────────────────────────────────────────── */
/*                         COMPONENT                           */
/* ─────────────────────────────────────────────────────────── */

export default function CreateDiscount() {
    const { currencySymbol } = useCurrency();
    const navigate    = useNavigate();
    const actionData  = useActionData();
    const { coupons, shopifyDiscount } = useLoaderData() || { coupons: [], shopifyDiscount: null };
    const [searchParams] = useSearchParams();
    const discountIdFromQuery = searchParams.get("discountId");
    const codeFromQuery       = searchParams.get("code");
    const navigation  = useNavigation();
    const submit      = useSubmit();
    const shopify     = useAppBridge();
    const isSubmitting = navigation.state === "submitting";

    /* ── Find existing coupon (edit mode) ── */
    const rawExistingCoupon = useMemo(() => {
        if (!discountIdFromQuery && !codeFromQuery) return null;

        // Priority 1: live Shopify data fetched in loader (most reliable)
        if (shopifyDiscount && discountIdFromQuery) {
            return normalizeShopifyDiscount(shopifyDiscount, discountIdFromQuery);
        }

        // Priority 2: locally-stored coupon (has BXGY product selections etc.)
        if (discountIdFromQuery) {
            const byId = coupons.find(c =>
                c.id === discountIdFromQuery ||
                c.shopifyId === discountIdFromQuery ||
                c.shopify_id === discountIdFromQuery
            );
            if (byId) return byId;
        }

        if (codeFromQuery) {
            return coupons.find(c => c.code === codeFromQuery) || null;
        }

        return null;
    }, [coupons, shopifyDiscount, discountIdFromQuery, codeFromQuery]);

    /* ── Normalize coupon fields ── */
    const existingCoupon = useMemo(() => {
        if (!rawExistingCoupon) return null;
        const c = rawExistingCoupon;

        const parseMaybeJsonArray = (val) => {
            if (Array.isArray(val)) return val;
            if (typeof val === "string") {
                try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
                catch { return []; }
            }
            return [];
        };

        return {
            ...c,
            type:                    c.type || c.discount_type || "amount_off_products",
            valueType:               c.valueType || c.value_type || "percentage",
            value:                   c.value ?? c.discount_value ?? "",
            selectionType:           c.selectionType || c.selection_type || "all",
            selectedResources:       parseMaybeJsonArray(c.selectedResources ?? c.selected_resources),
            minimumRequirementValue: c.minimumRequirementValue || c.minimum_requirement_value || "none",
            minimumPurchaseAmount:   c.minimumPurchaseAmount ?? c.minimum_purchase_amount ?? "",
            minimumQuantity:         c.minimumQuantity ?? c.minimum_quantity ?? "",
            limitTotalUses:          c.limitTotalUses ?? c.limit_total_uses ?? false,
            totalUsesLimit:          c.totalUsesLimit ?? c.total_uses_limit ?? "",
            limitOnePerCustomer:     c.limitOnePerCustomer ?? c.limit_one_per_customer ?? false,
            combineProduct:          c.combineProduct ?? c.combine_product ?? false,
            combineOrder:            c.combineOrder ?? c.combine_order ?? false,
            combineShipping:         c.combineShipping ?? c.combine_shipping ?? false,
            oncePerOrder:            c.oncePerOrder ?? c.once_per_order ?? false,
            countriesType:           c.countriesType || c.countries_type || "all",
            selectedCountries:       parseMaybeJsonArray(c.selectedCountries ?? c.selected_countries),
            bxgyBuysType:            c.bxgyBuysType || c.bxgy_buys_type || "products",
            bxgyBuysResources:       parseMaybeJsonArray(c.bxgyBuysResources ?? c.bxgy_buys_resources),
            bxgyBuysQuantity:        c.bxgyBuysQuantity ?? c.bxgy_buys_quantity ?? "1",
            bxgyGetsType:            c.bxgyGetsType || c.bxgy_gets_type || "same",
            bxgyGetsResources:       parseMaybeJsonArray(c.bxgyGetsResources ?? c.bxgy_gets_resources),
            bxgyGetsValueType:       c.bxgyGetsValueType || c.bxgy_gets_value_type || "free",
            bxgyGetsValue:           c.bxgyGetsValue ?? c.bxgy_gets_value ?? "",
            bxgyGetsQuantity:        c.bxgyGetsQuantity ?? c.bxgy_gets_quantity ?? "1",
            bxgyRepeatOncePerOrder:  c.bxgyRepeatOncePerOrder ?? c.bxgy_repeat_once_per_order ?? true,
            startDate:               c.startDate || c.start_date || c.starts_at,
            endDate:                 c.endDate || c.end_date || c.ends_at,
            shopifyId:               c.shopifyId || c.shopify_id || discountIdFromQuery,
        };
    }, [rawExistingCoupon, discountIdFromQuery]);

    const isEditMode = !!existingCoupon;

    /* ── Form State ── */
    const [title, setTitle] = useState(existingCoupon?.title || existingCoupon?.heading || "");
    const [code,  setCode]  = useState(existingCoupon?.code  || "");
    const [type,  setType]  = useState([existingCoupon?.type || "amount_off_products"]);
    const [value, setValue] = useState(existingCoupon?.value !== undefined ? String(existingCoupon.value) : "");
    const [discountValueType, setDiscountValueType] = useState(existingCoupon?.valueType || "percentage");

    /* Applies to */
    const [appliesTo, setAppliesTo] = useState(
        existingCoupon?.selectionType === "collections" ? "specific_collections"
            : existingCoupon?.selectionType === "products" ? "specific_products"
                : "all_products"
    );
    const [selectedResources, setSelectedResources] = useState(existingCoupon?.selectedResources || []);
    const [resourceSearch, setResourceSearch] = useState("");

    /* BXGY */
    const [bxgyBuysType,           setBxgyBuysType]           = useState([existingCoupon?.bxgyBuysType || "products"]);
    const [bxgyBuysResources,      setBxgyBuysResources]      = useState(existingCoupon?.bxgyBuysResources || []);
    const [bxgyBuysQuantity,       setBxgyBuysQuantity]       = useState(existingCoupon?.bxgyBuysQuantity || "1");
    const [bxgyGetsType,           setBxgyGetsType]           = useState([existingCoupon?.bxgyGetsType || "same"]);
    const [bxgyGetsResources,      setBxgyGetsResources]      = useState(existingCoupon?.bxgyGetsResources || []);
    const [bxgyGetsValueType,      setBxgyGetsValueType]      = useState(existingCoupon?.bxgyGetsValueType || "free");
    const [bxgyGetsValue,          setBxgyGetsValue]          = useState(existingCoupon?.bxgyGetsValue || "");
    const [bxgyGetsQuantity,       setBxgyGetsQuantity]       = useState(existingCoupon?.bxgyGetsQuantity || "1");
    const [bxgyRepeatOncePerOrder, setBxgyRepeatOncePerOrder] = useState(existingCoupon?.bxgyRepeatOncePerOrder ?? true);

    /* Minimum requirements */
    const [minimumRequirement,    setMinimumRequirement]    = useState([existingCoupon?.minimumRequirementValue || "none"]);
    const [minimumPurchaseAmount, setMinimumPurchaseAmount] = useState(existingCoupon?.minimumPurchaseAmount !== undefined ? String(existingCoupon.minimumPurchaseAmount) : "");
    const [minimumQuantity,       setMinimumQuantity]       = useState(existingCoupon?.minimumQuantity !== undefined ? String(existingCoupon.minimumQuantity) : "");

    /* Free shipping */
    const [countriesType,        setCountriesType]        = useState([existingCoupon?.countriesType || "all"]);
    const [selectedCountries,    setSelectedCountries]    = useState(existingCoupon?.selectedCountries || []);
    const [countrySearch,        setCountrySearch]        = useState("");
    const [countryModalActive,   setCountryModalActive]   = useState(false);
    const [tempSelectedCountries, setTempSelectedCountries] = useState([]);

    /* Max uses */
    const [limitTotalUses,      setLimitTotalUses]      = useState(!!existingCoupon?.limitTotalUses);
    const [totalUsesLimit,      setTotalUsesLimit]      = useState((existingCoupon?.totalUsesLimit ?? "").toString?.() || "");
    const [limitOnePerCustomer, setLimitOnePerCustomer] = useState(!!existingCoupon?.limitOnePerCustomer);

    /* Combinations */
    const [combineProduct,  setCombineProduct]  = useState(!!existingCoupon?.combineProduct);
    const [combineOrder,    setCombineOrder]    = useState(!!existingCoupon?.combineOrder);
    const [combineShipping, setCombineShipping] = useState(!!existingCoupon?.combineShipping);
    const [oncePerOrder,    setOncePerOrder]    = useState(!!existingCoupon?.oncePerOrder);

    /* Dates */
    const today = useMemo(() => new Date(), []);
    const initialStartDate = existingCoupon?.startDate;
    const initialEndDate   = existingCoupon?.endDate;

    const [startDate, setStartDate] = useState(initialStartDate ? new Date(initialStartDate) : today);
    const [startTime, setStartTime] = useState("00:00");
    const [{ startMonth, startYear }, setStartMonthYear] = useState({
        startMonth: (initialStartDate ? new Date(initialStartDate) : today).getMonth(),
        startYear:  (initialStartDate ? new Date(initialStartDate) : today).getFullYear(),
    });
    const [startPopoverActive, setStartPopoverActive] = useState(false);

    const [endDate, setEndDate] = useState(initialEndDate ? new Date(initialEndDate) : today);
    const [endTime, setEndTime] = useState("23:59");
    const [{ endMonth, endYear }, setEndMonthYear] = useState({
        endMonth: (initialEndDate ? new Date(initialEndDate) : today).getMonth(),
        endYear:  (initialEndDate ? new Date(initialEndDate) : today).getFullYear(),
    });
    const [endPopoverActive, setEndPopoverActive] = useState(false);
    const [hasEndDate, setHasEndDate] = useState(!!initialEndDate);

    /* Toast */
    const [showToast,    setShowToast]    = useState(false);
    const [toastMessage, setToastMessage] = useState("");

    /* ── Redirect after success ── */
    useEffect(() => {
        if (actionData?.success) {
            setToastMessage(isEditMode ? "Discount updated successfully!" : "Discount created successfully!");
            setShowToast(true);
            setTimeout(() => navigate("/app/discount"), 2000);
        }
    }, [actionData, navigate, isEditMode]);

    /* ── Date helpers ── */
    const formatDate = useCallback((date) =>
        date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), []);

    const handleStartDateChange = useCallback((range) => { setStartDate(range.start); setStartPopoverActive(false); }, []);
    const handleEndDateChange   = useCallback((range) => { setEndDate(range.start);   setEndPopoverActive(false);   }, []);
    const handleStartMonthChange = useCallback((month, year) => setStartMonthYear({ startMonth: month, startYear: year }), []);
    const handleEndMonthChange   = useCallback((month, year) => setEndMonthYear({ endMonth: month, endYear: year }),       []);

    const combineDateAndTime = useCallback((date, time) => {
        const [hours, minutes] = time.split(":").map(Number);
        const combined = new Date(date);
        combined.setHours(hours, minutes, 0, 0);
        return combined.toISOString();
    }, []);

    /* ── Resource picker ── */
    const selectResources = async (context = "standard") => {
        let resourceType = appliesTo === "specific_collections" ? "collection" : "product";
        if (context === "buys") resourceType = bxgyBuysType[0] === "collections" ? "collection" : "product";
        if (context === "gets") resourceType = bxgyGetsType[0] === "collections" ? "collection" : "product";

        const selectionIds =
            context === "buys" ? bxgyBuysResources.map(r => ({ id: r.id }))
                : context === "gets" ? bxgyGetsResources.map(r => ({ id: r.id }))
                    : selectedResources.map(r => ({ id: r.id }));

        const selected = await shopify.resourcePicker({ type: resourceType, multiple: true, selectionIds });

        if (selected) {
            const mapped = selected.map(item => ({
                id:     item.id,
                title:  item.title,
                handle: item.handle,
                image:  item.images?.[0]?.originalSrc || item.image?.originalSrc,
            }));
            if (context === "buys")      setBxgyBuysResources(mapped);
            else if (context === "gets") setBxgyGetsResources(mapped);
            else                         setSelectedResources(mapped);
        }
    };

    /* ── Summary ── */
    const summaryItems = useMemo(() => {
        const items = [];
        const typeLabels = {
            amount_off_products: "Amount off products",
            amount_off_order:    "Amount off order",
            bxgy:                "Buy X Get Y",
            free_shipping:       "Free shipping",
        };
        items.push(`Type: ${typeLabels[type[0]]}`);

        if (type[0] === "bxgy") {
            items.push(`Buy ${bxgyBuysQuantity} get ${bxgyGetsQuantity} ${bxgyGetsValueType === "free" ? "free" : bxgyGetsValueType === "percentage" ? bxgyGetsValue + "% off" : currencySymbol + bxgyGetsValue + " off"}`);
        } else if (type[0] === "free_shipping") {
            items.push("Free shipping");
        } else {
            if (discountValueType === "percentage" && value) items.push(`${value}% off`);
            else if (value) items.push(`${currencySymbol}${value} off`);
        }

        if (type[0] === "amount_off_products" || type[0] === "amount_off_order") {
            if (appliesTo === "all_products") {
                items.push(type[0] === "amount_off_order" ? "Applies to entire order" : "Applies to all products");
            } else if (selectedResources.length > 0) {
                items.push(`Applies to ${selectedResources.length} ${appliesTo === "specific_collections" ? "collections" : "products"}`);
            }
        }

        items.push(`Code: ${code || "Not set"}`);
        items.push(`Starts ${formatDate(startDate)} at ${startTime}`);
        if (hasEndDate && endDate) items.push(`Ends ${formatDate(endDate)} at ${endTime}`);

        return items;
    }, [type, value, discountValueType, appliesTo, selectedResources, code, startDate, startTime, endDate, endTime, hasEndDate, formatDate, bxgyBuysQuantity, bxgyGetsQuantity, bxgyGetsValueType, bxgyGetsValue, currencySymbol]);

    /* ── Submit handler ── */
    const handleSave = () => {
        const formData = new FormData();

        // Intent & IDs
        formData.append("intent",    isEditMode ? "update" : "create");
        formData.append("shopifyId", isEditMode ? (existingCoupon.shopifyId || discountIdFromQuery || "") : "");

        // Core fields
        formData.append("title",     title || code);
        formData.append("code",      code);
        formData.append("type",      type[0]);
        formData.append("startDate", combineDateAndTime(startDate, startTime));
        if (hasEndDate) formData.append("endDate", combineDateAndTime(endDate, endTime));

        // Type-specific fields
        if (type[0] === "bxgy") {
            formData.append("bxgyBuysType",          bxgyBuysType[0]);
            formData.append("bxgyBuysResources",     JSON.stringify(bxgyBuysResources));
            formData.append("bxgyBuysQuantity",      bxgyBuysQuantity);
            formData.append("bxgyGetsType",          bxgyGetsType[0]);
            formData.append("bxgyGetsResources",     JSON.stringify(bxgyGetsResources));
            formData.append("bxgyGetsValueType",     bxgyGetsValueType);
            formData.append("bxgyGetsValue",         bxgyGetsValue);
            formData.append("bxgyGetsQuantity",      bxgyGetsQuantity);
            formData.append("bxgyRepeatOncePerOrder", bxgyRepeatOncePerOrder);
        } else if (type[0] === "free_shipping") {
            formData.append("countriesType",     countriesType[0]);
            formData.append("selectedCountries", JSON.stringify(selectedCountries));
            formData.append("minimumRequirement",    minimumRequirement[0]);
            formData.append("minimumPurchaseAmount", minimumPurchaseAmount);
            formData.append("minimumQuantity",       minimumQuantity);
        } else {
            formData.append("valueType", discountValueType);
            formData.append("value",     value);
            const selType =
                type[0] === "amount_off_order" ? "all"
                    : appliesTo === "all_products" ? "all"
                        : appliesTo === "specific_collections" ? "collections"
                            : "products";
            formData.append("selectionType",     selType);
            formData.append("selectedResources", JSON.stringify(selectedResources));
            formData.append("minimumRequirement",    minimumRequirement[0]);
            formData.append("minimumPurchaseAmount", minimumPurchaseAmount);
            formData.append("minimumQuantity",       minimumQuantity);
            formData.append("oncePerOrder",          oncePerOrder);
        }

        // Shared
        formData.append("limitTotalUses",      limitTotalUses);
        formData.append("totalUsesLimit",      totalUsesLimit);
        formData.append("limitOnePerCustomer", limitOnePerCustomer);
        formData.append("combineProduct",      combineProduct);
        formData.append("combineOrder",        combineOrder);
        formData.append("combineShipping",     combineShipping);

        submit(formData, { method: "post" });
    };

    /* ── Save button disabled logic ── */
    const isSaveDisabled =
        !code ||
        (type[0] !== "bxgy" && type[0] !== "free_shipping" && !value) ||
        (type[0] === "amount_off_products" && appliesTo !== "all_products" && selectedResources.length === 0);

    /* ─────────────────────────────────────────────────────────── */
    /*                         RENDER                             */
    /* ─────────────────────────────────────────────────────────── */

    return (
        <Frame>
            <Page
                title={isEditMode ? "Edit discount" : "Create discount"}
                backAction={{ content: "Discounts", onAction: () => navigate("/app/discount") }}
                titleMetadata={isEditMode ? <Badge tone="info">Editing</Badge> : null}
                primaryAction={{
                    content:  isEditMode ? "Save changes" : "Save discount",
                    onAction: handleSave,
                    loading:  isSubmitting,
                    disabled: isSaveDisabled,
                }}
            >
                <Layout>
                    <Layout.Section>
                        <BlockStack gap="400">

                            {/* ── Errors ── */}
                            {actionData?.errors && (
                                <Banner tone="critical" title="There were issues saving this discount">
                                    <List>
                                        {actionData.errors.map((error, i) => (
                                            <List.Item key={i}>{error.message}</List.Item>
                                        ))}
                                    </List>
                                </Banner>
                            )}

                            {/* ── Edit mode notice ── */}
                            {isEditMode && (
                                <Banner tone="info" title="You are editing an existing discount">
                                    <p>Changes will be saved to Shopify immediately when you click "Save changes".</p>
                                </Banner>
                            )}

                            {/* ── Discount type + code ── */}
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">Discount type</Text>

                                    {/* Solaris 2×2 type selector */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        {[
                                            { id: 'pct',   label: 'Percentage',   icon: DiscountIcon,  desc: '% off products or order',        t: 'amount_off_products', vt: 'percentage'  },
                                            { id: 'fixed', label: 'Fixed amount', icon: DiscountIcon,  desc: 'Fixed amount off products',       t: 'amount_off_products', vt: 'fixed_amount' },
                                            { id: 'ship',  label: 'Free shipping',icon: DeliveryIcon,  desc: 'Free delivery on eligible orders', t: 'free_shipping',       vt: null          },
                                            { id: 'bxgy',  label: 'Buy X get Y',  icon: GiftCardIcon,  desc: 'Free or discounted products',      t: 'bxgy',                vt: null          },
                                        ].map((opt) => {
                                            const active =
                                                type[0] === opt.t &&
                                                (opt.vt == null || discountValueType === opt.vt);
                                            return (
                                                <button
                                                    key={opt.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setType([opt.t]);
                                                        if (opt.vt) setDiscountValueType(opt.vt);
                                                    }}
                                                    style={{
                                                        padding: '16px', borderRadius: '8px', cursor: 'pointer',
                                                        border: `2px solid ${active ? '#008060' : '#c9cccf'}`,
                                                        background: active ? '#f1f8f5' : '#ffffff',
                                                        textAlign: 'left', display: 'flex', gap: '12px', alignItems: 'flex-start',
                                                    }}
                                                >
                                                    <div style={{
                                                        width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
                                                        background: active ? '#008060' : '#f3f4f6',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    }}>
                                                        <Icon source={opt.icon} tone={active ? 'base' : 'subdued'} />
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '14px', fontWeight: 600, color: active ? '#008060' : '#111827', marginBottom: '2px' }}>{opt.label}</div>
                                                        <div style={{ fontSize: '12px', color: '#6b7280' }}>{opt.desc}</div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <Divider />

                                    <InlineStack gap="200" blockAlign="end">
                                        <div style={{ flex: 1 }}>
                                            <TextField
                                                label="Discount code"
                                                value={code}
                                                onChange={setCode}
                                                autoComplete="off"
                                                placeholder="e.g. SUMMER2024"
                                                helpText="Customers will enter this code at checkout"
                                            />
                                        </div>
                                        <Button
                                            icon={RefreshIcon}
                                            onClick={() => setCode(Math.random().toString(36).substring(2, 10).toUpperCase())}
                                        >
                                            Generate
                                        </Button>
                                    </InlineStack>

                                    <TextField
                                        label="Internal title (optional)"
                                        value={title}
                                        onChange={setTitle}
                                        autoComplete="off"
                                        helpText="For internal tracking only. Shown in the Title column on the Coupons page. Customers see the code, not this title."
                                    />
                                </BlockStack>
                            </Card>

                            {/* ══════════════════════════════
                                DISCOUNT VALUE
                            ══════════════════════════════ */}
                            {type[0] !== "bxgy" && type[0] !== "free_shipping" && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Discount value</Text>
                                        <Select
                                            label="Discount type"
                                            options={[
                                                { label: "Percentage",    value: "percentage" },
                                                { label: "Fixed amount",  value: "fixed_amount" },
                                            ]}
                                            value={discountValueType}
                                            onChange={setDiscountValueType}
                                        />
                                        {discountValueType === "percentage" ? (
                                            <BlockStack gap="200">
                                                <TextField
                                                    label="Percentage"
                                                    type="number"
                                                    value={value}
                                                    onChange={setValue}
                                                    suffix="%"
                                                    autoComplete="off"
                                                />
                                                <Text variant="bodySm" tone="subdued">
                                                    {type[0] === "amount_off_order"
                                                        ? "Applies a percentage discount to the total order value."
                                                        : "Applies a percentage discount to each eligible product."}
                                                </Text>
                                            </BlockStack>
                                        ) : (
                                            <BlockStack gap="200">
                                                <TextField
                                                    label="Fixed amount"
                                                    type="number"
                                                    value={value}
                                                    onChange={setValue}
                                                    prefix={currencySymbol}
                                                    autoComplete="off"
                                                />
                                                {type[0] === "amount_off_products" && (
                                                    <Checkbox
                                                        label="Once per order"
                                                        helpText="If not selected, the amount will be taken off each eligible item."
                                                        checked={oncePerOrder}
                                                        onChange={setOncePerOrder}
                                                    />
                                                )}
                                                <Text variant="bodySm" tone="subdued">
                                                    {type[0] === "amount_off_order"
                                                        ? `Applies a fixed discount to the total order value.`
                                                        : `Applies a fixed discount to each eligible product.`}
                                                </Text>
                                            </BlockStack>
                                        )}
                                    </BlockStack>
                                </Card>
                            )}

                            {/* ══════════════════════════════
                                BXGY: CUSTOMER BUYS
                            ══════════════════════════════ */}
                            {type[0] === "bxgy" && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Customer buys</Text>
                                        <ButtonGroup segmented>
                                            <Button pressed={bxgyBuysType[0] === "products"}    onClick={() => setBxgyBuysType(["products"])}>Specific products</Button>
                                            <Button pressed={bxgyBuysType[0] === "collections"} onClick={() => setBxgyBuysType(["collections"])}>Specific collections</Button>
                                        </ButtonGroup>
                                        <InlineStack gap="200">
                                            <div style={{ flex: 1 }}>
                                                <TextField placeholder={`Search ${bxgyBuysType[0]}`} value={resourceSearch} onChange={setResourceSearch} autoComplete="off" />
                                            </div>
                                            <Button onClick={() => selectResources("buys")}>Browse</Button>
                                        </InlineStack>
                                        {bxgyBuysResources.length > 0 && (
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "8px" }}>
                                                {bxgyBuysResources.map(res => (
                                                    <Box key={res.id} padding="100" border="divider" borderRadius="200">
                                                        <BlockStack align="center" gap="100">
                                                            <Thumbnail source={res.image || (bxgyBuysType[0] === "collections" ? CollectionIcon : ProductIcon)} size="small" />
                                                            <Text variant="bodyXs" truncate>{res.title}</Text>
                                                        </BlockStack>
                                                    </Box>
                                                ))}
                                            </div>
                                        )}
                                        <TextField
                                            label="Minimum quantity"
                                            type="number"
                                            value={bxgyBuysQuantity}
                                            onChange={setBxgyBuysQuantity}
                                            helpText="The customer must buy at least this quantity to qualify."
                                            autoComplete="off"
                                        />
                                    </BlockStack>
                                </Card>
                            )}

                            {/* ══════════════════════════════
                                BXGY: CUSTOMER GETS
                            ══════════════════════════════ */}
                            {type[0] === "bxgy" && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Customer gets</Text>
                                        <ButtonGroup segmented>
                                            <Button pressed={bxgyGetsType[0] === "same"}        onClick={() => setBxgyGetsType(["same"])}>Same products as X</Button>
                                            <Button pressed={bxgyGetsType[0] === "products"}    onClick={() => setBxgyGetsType(["products"])}>Specific products</Button>
                                            <Button pressed={bxgyGetsType[0] === "collections"} onClick={() => setBxgyGetsType(["collections"])}>Specific collections</Button>
                                        </ButtonGroup>
                                        {bxgyGetsType[0] !== "same" && (
                                            <>
                                                <InlineStack gap="200">
                                                    <div style={{ flex: 1 }}>
                                                        <TextField placeholder={`Search ${bxgyGetsType[0]}`} value={resourceSearch} onChange={setResourceSearch} autoComplete="off" />
                                                    </div>
                                                    <Button onClick={() => selectResources("gets")}>Browse</Button>
                                                </InlineStack>
                                                {bxgyGetsResources.length > 0 && (
                                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "8px" }}>
                                                        {bxgyGetsResources.map(res => (
                                                            <Box key={res.id} padding="100" border="divider" borderRadius="200">
                                                                <BlockStack align="center" gap="100">
                                                                    <Thumbnail source={res.image || (bxgyGetsType[0] === "collections" ? CollectionIcon : ProductIcon)} size="small" />
                                                                    <Text variant="bodyXs" truncate>{res.title}</Text>
                                                                </BlockStack>
                                                            </Box>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        <Divider />
                                        <Select
                                            label="Discount value"
                                            options={[
                                                { label: "Free",           value: "free" },
                                                { label: "Percentage off", value: "percentage" },
                                                { label: "Amount off",     value: "fixed_amount" },
                                            ]}
                                            value={bxgyGetsValueType}
                                            onChange={setBxgyGetsValueType}
                                        />
                                        {bxgyGetsValueType !== "free" && (
                                            <TextField
                                                label={bxgyGetsValueType === "percentage" ? "Percentage off" : "Amount off"}
                                                type="number"
                                                value={bxgyGetsValue}
                                                onChange={setBxgyGetsValue}
                                                suffix={bxgyGetsValueType === "percentage" ? "%" : null}
                                                prefix={bxgyGetsValueType === "fixed_amount" ? currencySymbol : null}
                                                autoComplete="off"
                                            />
                                        )}
                                        <TextField
                                            label="Quantity"
                                            type="number"
                                            value={bxgyGetsQuantity}
                                            onChange={setBxgyGetsQuantity}
                                            helpText="Number of items the customer receives at a discount."
                                            autoComplete="off"
                                        />
                                        <Checkbox
                                            label="Apply discount once per order"
                                            helpText="If unchecked, the discount repeats for every eligible group."
                                            checked={bxgyRepeatOncePerOrder}
                                            onChange={setBxgyRepeatOncePerOrder}
                                        />
                                    </BlockStack>
                                </Card>
                            )}

                            {/* ══════════════════════════════
                                FREE SHIPPING: COUNTRIES
                            ══════════════════════════════ */}
                            {type[0] === "free_shipping" && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Countries</Text>
                                        <ButtonGroup segmented>
                                            <Button pressed={countriesType[0] === "all"}      onClick={() => setCountriesType(["all"])}>All countries</Button>
                                            <Button pressed={countriesType[0] === "specific"} onClick={() => setCountriesType(["specific"])}>Specific countries</Button>
                                        </ButtonGroup>
                                        {countriesType[0] === "specific" && (
                                            <BlockStack gap="300">
                                                <InlineStack gap="200">
                                                    <div style={{ flex: 1 }}>
                                                        <TextField
                                                            placeholder="Search countries"
                                                            value=""
                                                            autoComplete="off"
                                                            readOnly
                                                            onFocus={() => { setTempSelectedCountries(selectedCountries); setCountryModalActive(true); }}
                                                        />
                                                    </div>
                                                    <Button onClick={() => { setTempSelectedCountries(selectedCountries); setCountryModalActive(true); }}>Browse</Button>
                                                </InlineStack>

                                                {selectedCountries.length > 0 && (
                                                    <Box border="divider" borderRadius="200" padding="0">
                                                        <Scrollable style={{ maxHeight: "150px" }}>
                                                            <BlockStack gap="0">
                                                                {selectedCountries.map(c => {
                                                                    const country = COUNTRIES.find(x => x.value === c);
                                                                    return (
                                                                        <div key={c} style={{ padding: "8px 12px", borderBottom: "1px solid #f1f1f1", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                                                            <InlineStack gap="200" blockAlign="center">
                                                                                <Text variant="bodyMd">{country?.flag || "🏳️"}</Text>
                                                                                <Text variant="bodyMd">{country?.label || c}</Text>
                                                                            </InlineStack>
                                                                            <Button variant="tertiary" onClick={() => setSelectedCountries(prev => prev.filter(x => x !== c))}>Remove</Button>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </BlockStack>
                                                        </Scrollable>
                                                    </Box>
                                                )}

                                                <Modal
                                                    open={countryModalActive}
                                                    onClose={() => setCountryModalActive(false)}
                                                    title="Select countries"
                                                    primaryAction={{
                                                        content: `Add (${tempSelectedCountries.length})`,
                                                        onAction: () => { setSelectedCountries(tempSelectedCountries); setCountryModalActive(false); },
                                                    }}
                                                    secondaryActions={[{ content: "Cancel", onAction: () => setCountryModalActive(false) }]}
                                                >
                                                    <Modal.Section>
                                                        <BlockStack gap="400">
                                                            <TextField
                                                                prefix={<Icon source={DiscountIcon} />}
                                                                placeholder="Search countries"
                                                                value={countrySearch}
                                                                onChange={setCountrySearch}
                                                                autoComplete="off"
                                                            />
                                                            <Scrollable style={{ height: "300px" }}>
                                                                <div style={{ padding: "8px 0" }}>
                                                                    {COUNTRIES.filter(c => c.label.toLowerCase().includes(countrySearch.toLowerCase())).map(country => {
                                                                        const isSelected = tempSelectedCountries.includes(country.value);
                                                                        return (
                                                                            <div key={country.value} style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f1f1" }}>
                                                                                <InlineStack gap="200" blockAlign="center">
                                                                                    <Text variant="bodyMd">{country.flag}</Text>
                                                                                    <Text variant="bodyMd">{country.label}</Text>
                                                                                </InlineStack>
                                                                                <Button
                                                                                    variant={isSelected ? "primary" : "secondary"}
                                                                                    onClick={() => {
                                                                                        if (isSelected) setTempSelectedCountries(prev => prev.filter(c => c !== country.value));
                                                                                        else            setTempSelectedCountries(prev => [...prev, country.value]);
                                                                                    }}
                                                                                >
                                                                                    {isSelected ? "Remove" : "Add"}
                                                                                </Button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </Scrollable>
                                                        </BlockStack>
                                                    </Modal.Section>
                                                </Modal>
                                            </BlockStack>
                                        )}
                                    </BlockStack>
                                </Card>
                            )}

                            {/* ══════════════════════════════
                                APPLIES TO
                            ══════════════════════════════ */}
                            {(type[0] === "amount_off_products" || type[0] === "amount_off_order") && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Applies to</Text>
                                        <Select
                                            label="Applies to"
                                            options={[
                                                { label: type[0] === "amount_off_order" ? "Entire order" : "All products", value: "all_products" },
                                                { label: "Specific collections", value: "specific_collections" },
                                                { label: "Specific products",    value: "specific_products" },
                                            ]}
                                            value={appliesTo}
                                            onChange={(val) => { setAppliesTo(val); setSelectedResources([]); }}
                                        />
                                        {appliesTo === "all_products" && (
                                            <Text variant="bodyMd">
                                                {type[0] === "amount_off_order" ? "This discount applies to the entire order." : "This discount applies to all products."}
                                            </Text>
                                        )}
                                        {(appliesTo === "specific_collections" || appliesTo === "specific_products") && (
                                            <BlockStack gap="300">
                                                <InlineStack gap="200">
                                                    <div style={{ flex: 1 }}>
                                                        <TextField
                                                            placeholder={appliesTo === "specific_collections" ? "Search collections" : "Search products"}
                                                            value={resourceSearch}
                                                            onChange={setResourceSearch}
                                                            autoComplete="off"
                                                        />
                                                    </div>
                                                    <Button onClick={() => selectResources()}>Browse</Button>
                                                </InlineStack>
                                                {selectedResources.length > 0 && (
                                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "10px" }}>
                                                        {selectedResources.map(res => (
                                                            <Box key={res.id} padding="100" border="divider" borderRadius="200">
                                                                <BlockStack align="center" gap="100">
                                                                    <Thumbnail source={res.image || (appliesTo === "specific_collections" ? CollectionIcon : ProductIcon)} size="small" />
                                                                    <Text variant="bodyXs" truncate>{res.title}</Text>
                                                                </BlockStack>
                                                            </Box>
                                                        ))}
                                                    </div>
                                                )}
                                            </BlockStack>
                                        )}
                                    </BlockStack>
                                </Card>
                            )}

                            {/* ══════════════════════════════
                                MINIMUM PURCHASE REQUIREMENTS
                            ══════════════════════════════ */}
                            {type[0] !== "bxgy" && (
                                <Card>
                                    <BlockStack gap="400">
                                        <Text variant="headingMd" as="h2">Minimum purchase requirements</Text>
                                        <ButtonGroup segmented>
                                            <Button pressed={minimumRequirement[0] === "none"}     onClick={() => setMinimumRequirement(["none"])}>No minimum</Button>
                                            <Button pressed={minimumRequirement[0] === "amount"}   onClick={() => setMinimumRequirement(["amount"])}>Purchase amount ({currencySymbol})</Button>
                                            <Button pressed={minimumRequirement[0] === "quantity"} onClick={() => setMinimumRequirement(["quantity"])}>Quantity of items</Button>
                                        </ButtonGroup>
                                        {minimumRequirement[0] === "amount" && (
                                            <TextField
                                                label="Minimum purchase amount"
                                                type="number"
                                                value={minimumPurchaseAmount}
                                                onChange={setMinimumPurchaseAmount}
                                                prefix={currencySymbol}
                                                autoComplete="off"
                                            />
                                        )}
                                        {minimumRequirement[0] === "quantity" && (
                                            <TextField
                                                label="Minimum quantity of items"
                                                type="number"
                                                value={minimumQuantity}
                                                onChange={setMinimumQuantity}
                                                autoComplete="off"
                                            />
                                        )}
                                        <Text variant="bodySm" tone="subdued">
                                            The discount is applied only if the order meets the selected requirement.
                                        </Text>
                                    </BlockStack>
                                </Card>
                            )}

                            {/* ══════════════════════════════
                                MAXIMUM DISCOUNT USES
                            ══════════════════════════════ */}
                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Maximum discount uses</Text>
                                    <BlockStack gap="200">
                                        <Checkbox
                                            label="Limit number of times this discount can be used in total"
                                            checked={limitTotalUses}
                                            onChange={setLimitTotalUses}
                                        />
                                        {limitTotalUses && (
                                            <Box paddingInlineStart="800">
                                                <TextField
                                                    label="Total usage limit"
                                                    type="number"
                                                    value={totalUsesLimit}
                                                    onChange={setTotalUsesLimit}
                                                    autoComplete="off"
                                                />
                                            </Box>
                                        )}
                                    </BlockStack>
                                    <Checkbox
                                        label="Limit to one use per customer"
                                        checked={limitOnePerCustomer}
                                        onChange={setLimitOnePerCustomer}
                                    />
                                </BlockStack>
                            </Card>

                            {/* ══════════════════════════════
                                COMBINATIONS
                            ══════════════════════════════ */}
                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Combinations</Text>
                                    <Text variant="bodySm" tone="subdued">This discount can be combined with:</Text>
                                    <Checkbox label="Product discounts"  checked={combineProduct}  onChange={setCombineProduct} />
                                    <Checkbox label="Order discounts"    checked={combineOrder}    onChange={setCombineOrder} />
                                    <Checkbox label="Shipping discounts" checked={combineShipping} onChange={setCombineShipping} />
                                </BlockStack>
                            </Card>

                            {/* ══════════════════════════════
                                ACTIVE DATES
                            ══════════════════════════════ */}
                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Active dates</Text>

                                    {/* Start Date */}
                                    <InlineStack gap="300" blockAlign="end">
                                        <Box minWidth="220px">
                                            <BlockStack gap="100">
                                                <Text variant="bodyMd" as="label" fontWeight="medium">Start date</Text>
                                                <Popover
                                                    active={startPopoverActive}
                                                    activator={
                                                        <Button onClick={() => setStartPopoverActive(p => !p)} icon={CalendarIcon} fullWidth textAlign="left">
                                                            {formatDate(startDate)}
                                                        </Button>
                                                    }
                                                    onClose={() => setStartPopoverActive(false)}
                                                    autofocusTarget="none"
                                                    preferredAlignment="left"
                                                >
                                                    <div style={{ padding: "16px" }}>
                                                        <DatePicker
                                                            month={startMonth}
                                                            year={startYear}
                                                            onChange={handleStartDateChange}
                                                            onMonthChange={handleStartMonthChange}
                                                            selected={startDate}
                                                        />
                                                    </div>
                                                </Popover>
                                            </BlockStack>
                                        </Box>
                                        <Box minWidth="140px">
                                            <TextField label="Start time" type="time" value={startTime} onChange={setStartTime} />
                                        </Box>
                                    </InlineStack>

                                    <Checkbox label="Set end date" checked={hasEndDate} onChange={setHasEndDate} />

                                    {hasEndDate && (
                                        <InlineStack gap="300" blockAlign="end">
                                            <Box minWidth="220px">
                                                <BlockStack gap="100">
                                                    <Text variant="bodyMd" as="label" fontWeight="medium">End date</Text>
                                                    <Popover
                                                        active={endPopoverActive}
                                                        activator={
                                                            <Button onClick={() => setEndPopoverActive(p => !p)} icon={CalendarIcon} fullWidth textAlign="left">
                                                                {formatDate(endDate)}
                                                            </Button>
                                                        }
                                                        onClose={() => setEndPopoverActive(false)}
                                                        autofocusTarget="none"
                                                        preferredAlignment="left"
                                                    >
                                                        <div style={{ padding: "16px" }}>
                                                            <DatePicker
                                                                month={endMonth}
                                                                year={endYear}
                                                                onChange={handleEndDateChange}
                                                                onMonthChange={handleEndMonthChange}
                                                                selected={endDate}
                                                                disableDatesBefore={startDate}
                                                            />
                                                        </div>
                                                    </Popover>
                                                </BlockStack>
                                            </Box>
                                            <Box minWidth="140px">
                                                <TextField label="End time" type="time" value={endTime} onChange={setEndTime} />
                                            </Box>
                                        </InlineStack>
                                    )}
                                </BlockStack>
                            </Card>

                            {/* Bottom error repeat */}
                            {actionData?.errors && (
                                <Banner tone="critical">
                                    <List>
                                        {actionData.errors.map((error, i) => (
                                            <List.Item key={i}>{error.message}</List.Item>
                                        ))}
                                    </List>
                                </Banner>
                            )}
                        </BlockStack>
                    </Layout.Section>

                    {/* ══════════════════════════════
                        SIDEBAR SUMMARY
                    ══════════════════════════════ */}
                    <Layout.Section variant="oneThird">
                        <BlockStack gap="400">
                            <Card>
                                <BlockStack gap="300">
                                    <Text variant="headingMd" as="h2">Summary</Text>
                                    {code && (
                                        <div style={{ padding: "8px 12px", background: "var(--p-color-bg-surface-secondary)", borderRadius: "8px", display: "flex", flexDirection: "row", alignItems: "center", gap: "8px", width: "fit-content" }}>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0 }}>
                                                <path fillRule="evenodd" d="M11.013 2.513a1.75 1.75 0 0 1 2.475 0l3.999 4a1.75 1.75 0 0 1 0 2.474l-5.47 5.47a3.25 3.25 0 0 1-2.298.952H5.25A1.75 1.75 0 0 1 3.5 13.66V9.68a3.25 3.25 0 0 1 .952-2.298l5.47-5.47h1.09ZM7.25 11a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" clipRule="evenodd" />
                                            </svg>
                                            <span style={{ fontSize: "20px", fontWeight: "700", lineHeight: "1" }}>{code}</span>
                                        </div>
                                    )}
                                    <Divider />
                                    <List type="bullet">
                                        {summaryItems.map((item, i) => (
                                            <List.Item key={i}>{item}</List.Item>
                                        ))}
                                    </List>
                                </BlockStack>
                            </Card>

                            <Banner title={isEditMode ? "Editing discount" : "Discount tip"} tone={isEditMode ? "warning" : "info"}>
                                <p>
                                    {isEditMode
                                        ? "You are modifying an existing discount. Shopify will reflect the changes immediately after saving."
                                        : "Code-based discounts allow you to track specific marketing campaigns."}
                                </p>
                            </Banner>
                        </BlockStack>
                    </Layout.Section>
                </Layout>10

                {showToast && (
                    <Toast content={toastMessage} onDismiss={() => setShowToast(false)} />
                )}
            </Page>
        </Frame>
    );
}