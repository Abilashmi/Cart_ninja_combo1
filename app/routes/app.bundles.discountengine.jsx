import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLoaderData, useActionData, useNavigation, useSubmit, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Card, Layout, BlockStack, InlineStack, Text, Button, Badge, Icon,
  TextField, Select, Checkbox, Divider, Toast, Frame, Box,
  Banner, List, Popover, DatePicker, ButtonGroup,
} from '@shopify/polaris';
import {
  DiscountIcon, DeliveryIcon, GiftCardIcon, RefreshIcon, CalendarIcon,
} from '@shopify/polaris-icons';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';

// ─── Server Action ────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let discounts = [];
  try {
    const res = await admin.graphql(`
      query {
        codeDiscountNodes(first: 25, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            codeDiscount {
              __typename
              ... on DiscountCodeBasic {
                title status startsAt endsAt
                codes(first: 1) { nodes { code } }
              }
              ... on DiscountCodeBxgy {
                title status startsAt
                codes(first: 1) { nodes { code } }
              }
              ... on DiscountCodeFreeShipping {
                title status startsAt endsAt
                codes(first: 1) { nodes { code } }
              }
            }
          }
        }
      }
    `);
    const json = await res.json();
    discounts = (json.data?.codeDiscountNodes?.nodes || []).map(n => ({
      id: n.id,
      type: n.codeDiscount?.__typename?.replace('DiscountCode', '') || '—',
      title: n.codeDiscount?.title || '—',
      status: n.codeDiscount?.status || 'UNKNOWN',
      code: n.codeDiscount?.codes?.nodes?.[0]?.code || '—',
      startsAt: n.codeDiscount?.startsAt,
      endsAt: n.codeDiscount?.endsAt,
    }));
  } catch {}

  return { discounts };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const type = formData.get('type');
  const title = formData.get('title');
  const code = formData.get('code');
  const valueType = formData.get('valueType');
  const value = parseFloat(formData.get('value') || '0');
  const startDate = formData.get('startDate');
  const endDate = formData.get('endDate');
  const selectionType = formData.get('selectionType');
  const selectedResources = JSON.parse(formData.get('selectedResources') || '[]');
  const minimumRequirementValue = formData.get('minimumRequirement');
  const minimumPurchaseAmount = parseFloat(formData.get('minimumPurchaseAmount') || '0');
  const minimumQuantity = parseInt(formData.get('minimumQuantity') || '0', 10);
  const limitTotalUses = formData.get('limitTotalUses') === 'true';
  const totalUsesLimit = parseInt(formData.get('totalUsesLimit') || '0', 10);
  const limitOnePerCustomer = formData.get('limitOnePerCustomer') === 'true';
  const combineProduct = formData.get('combineProduct') === 'true';
  const combineOrder = formData.get('combineOrder') === 'true';
  const combineShipping = formData.get('combineShipping') === 'true';
  const oncePerOrder = formData.get('oncePerOrder') === 'true';

  const startsAt = startDate ? new Date(startDate).toISOString() : new Date().toISOString();
  const endsAt = endDate ? new Date(endDate).toISOString() : null;

  const combinesWith = { productDiscounts: combineProduct, orderDiscounts: combineOrder, shippingDiscounts: combineShipping };

  const buildMinimumRequirement = () => {
    if (minimumRequirementValue === 'amount') return { subtotal: { greaterThanOrEqualToSubtotal: minimumPurchaseAmount } };
    if (minimumRequirementValue === 'quantity') return { quantity: { greaterThanOrEqualToQuantity: minimumQuantity } };
    return undefined;
  };

  const buildCustomerGetsItems = () => {
    if (selectionType === 'collections') return { collections: { add: selectedResources.map(r => r.id) } };
    if (selectionType === 'products') return { products: { productsToAdd: selectedResources.map(r => r.id) } };
    return { all: true };
  };

  let mutation = '';
  let variables = {};

  try {
    if (type === 'amount_off_products' || type === 'amount_off_order') {
      const discountInput = {
        title: title || code,
        code,
        startsAt,
        ...(endsAt && { endsAt }),
        customerSelection: { all: true },
        customerGets: {
          value: {
            [valueType === 'percentage' ? 'percentage' : 'discountAmount']:
              valueType === 'percentage'
                ? value / 100
                : { amount: value, appliesOnEachItem: !oncePerOrder },
          },
          items: buildCustomerGetsItems(),
        },
        appliesOncePerCustomer: limitOnePerCustomer,
        ...(limitTotalUses && totalUsesLimit > 0 && { usageLimit: totalUsesLimit }),
        combinesWith,
        ...(buildMinimumRequirement() && { minimumRequirement: buildMinimumRequirement() }),
      };
      mutation = `#graphql
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }`;
      variables = { basicCodeDiscount: discountInput };
    } else if (type === 'free_shipping') {
      const countriesType = formData.get('countriesType');
      const selectedCountries = JSON.parse(formData.get('selectedCountries') || '[]');
      const shippingInput = {
        title: title || code,
        code,
        startsAt,
        ...(endsAt && { endsAt }),
        customerSelection: { all: true },
        destinationSelection: countriesType === 'all' ? { all: true } : { countries: { add: selectedCountries } },
        appliesOncePerCustomer: limitOnePerCustomer,
        ...(limitTotalUses && { usageLimit: totalUsesLimit }),
        combinesWith,
        ...(buildMinimumRequirement() && { minimumRequirement: buildMinimumRequirement() }),
      };
      mutation = `#graphql
        mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
          discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }`;
      variables = { freeShippingCodeDiscount: shippingInput };
    } else if (type === 'bxgy') {
      const buysQty = parseInt(formData.get('bxgyBuysQuantity') || '1', 10);
      const getsQty = parseInt(formData.get('bxgyGetsQuantity') || '1', 10);
      const getsValueType = formData.get('bxgyGetsValueType') || 'free';
      const getsValue = parseFloat(formData.get('bxgyGetsValue') || '0');
      const bxgyInput = {
        title: title || code,
        code,
        startsAt,
        ...(endsAt && { endsAt }),
        customerSelection: { all: true },
        appliesOncePerCustomer: limitOnePerCustomer,
        ...(limitTotalUses && totalUsesLimit > 0 && { usageLimit: totalUsesLimit }),
        customerBuys: { items: { all: true }, value: { quantity: { quantity: String(buysQty) } } },
        customerGets: {
          items: { all: true },
          value: { discountOnQuantity: { quantity: { quantity: String(getsQty) }, effect: { percentage: getsValueType === 'free' ? 1.0 : getsValue / 100 } } },
        },
        combinesWith,
      };
      mutation = `#graphql
        mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
          discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }`;
      variables = { bxgyCodeDiscount: bxgyInput };
    } else {
      return { errors: [{ message: 'Unknown discount type' }] };
    }

    const response = await admin.graphql(mutation, { variables });
    const responseJson = await response.json();
    if (responseJson.errors) return { errors: responseJson.errors };
    const mutKey = Object.keys(responseJson.data || {})[0];
    const result = responseJson.data[mutKey];
    if (result?.userErrors?.length > 0) return { errors: result.userErrors };
    return { success: true, discountId: result?.codeDiscountNode?.id };
  } catch (err) {
    return { errors: [{ message: err.message }] };
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

const STATUS_TONE = { ACTIVE: 'success', EXPIRED: 'critical', SCHEDULED: 'warning', DEACTIVATED: 'info' };

export default function AppBundlesDiscountEngine() {
  const { discounts } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === 'submitting';

  // ── Form state ──
  const [type, setType] = useState(['amount_off_products']);
  const [discountValueType, setDiscountValueType] = useState('percentage');
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [value, setValue] = useState('');
  const [oncePerOrder, setOncePerOrder] = useState(false);

  // applies to
  const [appliesTo, setAppliesTo] = useState('all_products');
  const [selectedResources, setSelectedResources] = useState([]);

  // BXGY
  const [bxgyBuysQuantity, setBxgyBuysQuantity] = useState('1');
  const [bxgyGetsQuantity, setBxgyGetsQuantity] = useState('1');
  const [bxgyGetsValueType, setBxgyGetsValueType] = useState('free');
  const [bxgyGetsValue, setBxgyGetsValue] = useState('');

  // free shipping countries
  const [countriesType, setCountriesType] = useState(['all']);

  // minimum
  const [minimumRequirement, setMinimumRequirement] = useState(['none']);
  const [minimumPurchaseAmount, setMinimumPurchaseAmount] = useState('');
  const [minimumQuantity, setMinimumQuantity] = useState('');

  // usage limits
  const [limitTotalUses, setLimitTotalUses] = useState(false);
  const [totalUsesLimit, setTotalUsesLimit] = useState('');
  const [limitOnePerCustomer, setLimitOnePerCustomer] = useState(false);

  // combinations
  const [combineProduct, setCombineProduct] = useState(false);
  const [combineOrder, setCombineOrder] = useState(false);
  const [combineShipping, setCombineShipping] = useState(false);

  // dates
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState('00:00');
  const [{ startMonth, startYear }, setStartMonthYear] = useState({ startMonth: today.getMonth(), startYear: today.getFullYear() });
  const [startPopoverActive, setStartPopoverActive] = useState(false);
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState('23:59');
  const [{ endMonth, endYear }, setEndMonthYear] = useState({ endMonth: today.getMonth(), endYear: today.getFullYear() });
  const [endPopoverActive, setEndPopoverActive] = useState(false);
  const [hasEndDate, setHasEndDate] = useState(false);

  // toast
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (actionData?.success) {
      setToastMsg('Bundle discount created successfully!');
      setShowToast(true);
      setCode('');
      setTitle('');
      setValue('');
    }
  }, [actionData]);

  const formatDate = useCallback((d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), []);
  const combineDateAndTime = useCallback((d, t) => { const [h, m] = t.split(':').map(Number); const r = new Date(d); r.setHours(h, m, 0, 0); return r.toISOString(); }, []);

  const generateCode = useCallback(() => setCode(Math.random().toString(36).substring(2, 10).toUpperCase()), []);

  const selectResources = async () => {
    const resourceType = appliesTo === 'specific_collections' ? 'collection' : 'product';
    const selected = await shopify.resourcePicker({ type: resourceType, multiple: true, selectionIds: selectedResources.map(r => ({ id: r.id })) });
    if (selected) setSelectedResources(selected.map(i => ({ id: i.id, title: i.title, image: i.images?.[0]?.originalSrc })));
  };

  const handleSave = () => {
    if (!code) { setToastMsg('Discount code is required'); setShowToast(true); return; }
    const formData = new FormData();
    formData.append('type', type[0]);
    formData.append('title', title || code);
    formData.append('code', code);
    formData.append('startDate', combineDateAndTime(startDate, startTime));
    if (hasEndDate) formData.append('endDate', combineDateAndTime(endDate, endTime));
    if (type[0] === 'bxgy') {
      formData.append('bxgyBuysQuantity', bxgyBuysQuantity);
      formData.append('bxgyGetsQuantity', bxgyGetsQuantity);
      formData.append('bxgyGetsValueType', bxgyGetsValueType);
      formData.append('bxgyGetsValue', bxgyGetsValue);
    } else if (type[0] === 'free_shipping') {
      formData.append('countriesType', countriesType[0]);
      formData.append('selectedCountries', '[]');
      formData.append('minimumRequirement', minimumRequirement[0]);
      formData.append('minimumPurchaseAmount', minimumPurchaseAmount);
      formData.append('minimumQuantity', minimumQuantity);
    } else {
      formData.append('valueType', discountValueType);
      formData.append('value', value);
      const selType = type[0] === 'amount_off_order' ? 'all' : appliesTo === 'all_products' ? 'all' : appliesTo === 'specific_collections' ? 'collections' : 'products';
      formData.append('selectionType', selType);
      formData.append('selectedResources', JSON.stringify(selectedResources));
      formData.append('minimumRequirement', minimumRequirement[0]);
      formData.append('minimumPurchaseAmount', minimumPurchaseAmount);
      formData.append('minimumQuantity', minimumQuantity);
      formData.append('oncePerOrder', oncePerOrder);
    }
    formData.append('limitTotalUses', limitTotalUses);
    formData.append('totalUsesLimit', totalUsesLimit);
    formData.append('limitOnePerCustomer', limitOnePerCustomer);
    formData.append('combineProduct', combineProduct);
    formData.append('combineOrder', combineOrder);
    formData.append('combineShipping', combineShipping);
    submit(formData, { method: 'post' });
  };

  // ── Summary ──
  const summaryItems = useMemo(() => {
    const items = [];
    const labels = { amount_off_products: 'Amount off products', amount_off_order: 'Amount off order', bxgy: 'Buy X Get Y', free_shipping: 'Free shipping' };
    items.push(`Type: ${labels[type[0]] || type[0]}`);
    if (type[0] === 'bxgy') items.push(`Buy ${bxgyBuysQuantity} get ${bxgyGetsQuantity} ${bxgyGetsValueType === 'free' ? 'free' : bxgyGetsValueType === 'percentage' ? bxgyGetsValue + '% off' : '$' + bxgyGetsValue + ' off'}`);
    else if (type[0] !== 'free_shipping') { if (value) items.push(discountValueType === 'percentage' ? `${value}% off` : `$${value} off`); }
    else items.push('Free shipping');
    items.push(`Code: ${code || 'Not set'}`);
    items.push(`Starts ${formatDate(startDate)} at ${startTime}`);
    if (hasEndDate) items.push(`Ends ${formatDate(endDate)} at ${endTime}`);
    return items;
  }, [type, value, discountValueType, code, startDate, startTime, endDate, endTime, hasEndDate, formatDate, bxgyBuysQuantity, bxgyGetsQuantity, bxgyGetsValueType, bxgyGetsValue]);

  return (
    <Frame>
      <Page
        title="Bundle Discount Engine"
        subtitle="Create native Shopify discount codes linked to your bundle templates"
        primaryAction={{ content: 'Create Discount', onAction: handleSave, loading: isSubmitting }}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">

              {/* Errors */}
              {actionData?.errors && (
                <Banner tone="critical" title="Failed to create discount">
                  <List>{actionData.errors.map((e, i) => <List.Item key={i}>{e.message}</List.Item>)}</List>
                </Banner>
              )}

              {/* ── Discount Type Card ── */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Discount type</Text>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {[
                      { id: 'pct',   label: 'Percentage',    icon: DiscountIcon,  desc: '% off products or entire order',    t: 'amount_off_products', vt: 'percentage'   },
                      { id: 'fixed', label: 'Fixed amount',  icon: DiscountIcon,  desc: 'Fixed $ amount off products/order', t: 'amount_off_products', vt: 'fixed_amount'  },
                      { id: 'ship',  label: 'Free shipping', icon: DeliveryIcon,  desc: 'Free delivery on eligible orders',  t: 'free_shipping',       vt: null            },
                      { id: 'bxgy',  label: 'Buy X Get Y',   icon: GiftCardIcon,  desc: 'Free or discounted products',       t: 'bxgy',                vt: null            },
                    ].map(opt => {
                      const active = type[0] === opt.t && (opt.vt == null || discountValueType === opt.vt);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => { setType([opt.t]); if (opt.vt) setDiscountValueType(opt.vt); }}
                          style={{
                            padding: '16px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                            border: `2px solid ${active ? '#667eea' : '#e5e7eb'}`,
                            background: active ? 'rgba(102,126,234,0.06)' : '#fff',
                            display: 'flex', gap: '12px', alignItems: 'flex-start', transition: 'all 0.15s',
                          }}
                        >
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
                            background: active ? 'linear-gradient(135deg,#667eea,#764ba2)' : '#f3f4f6',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Icon source={opt.icon} tone={active ? 'base' : 'subdued'} />
                          </div>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: active ? '#667eea' : '#111827', marginBottom: '2px' }}>{opt.label}</div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>{opt.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <Divider />
                  <InlineStack gap="200" blockAlign="end">
                    <div style={{ flex: 1 }}>
                      <TextField label="Discount code" value={code} onChange={setCode} autoComplete="off" placeholder="e.g. BUNDLE20" helpText="Customers enter this at checkout" />
                    </div>
                    <Button icon={RefreshIcon} onClick={generateCode}>Generate</Button>
                  </InlineStack>
                  <TextField label="Internal title (optional)" value={title} onChange={setTitle} autoComplete="off" helpText="For your reference only — not shown to customers" />
                </BlockStack>
              </Card>

              {/* ── Discount Value ── */}
              {type[0] !== 'bxgy' && type[0] !== 'free_shipping' && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Discount value</Text>
                    <Select
                      label="Value type"
                      options={[{ label: 'Percentage', value: 'percentage' }, { label: 'Fixed amount', value: 'fixed_amount' }]}
                      value={discountValueType}
                      onChange={setDiscountValueType}
                    />
                    <TextField
                      label={discountValueType === 'percentage' ? 'Percentage' : 'Amount'}
                      type="number"
                      value={value}
                      onChange={setValue}
                      suffix={discountValueType === 'percentage' ? '%' : undefined}
                      prefix={discountValueType === 'fixed_amount' ? '$' : undefined}
                      autoComplete="off"
                    />
                    {type[0] === 'amount_off_products' && discountValueType === 'fixed_amount' && (
                      <Checkbox label="Apply once per order" checked={oncePerOrder} onChange={setOncePerOrder} helpText="If unchecked, applies to each eligible item" />
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* ── BXGY ── */}
              {type[0] === 'bxgy' && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Buy X Get Y configuration</Text>
                    <InlineStack gap="400">
                      <div style={{ flex: 1 }}>
                        <TextField label="Customer buys (quantity)" type="number" value={bxgyBuysQuantity} onChange={setBxgyBuysQuantity} autoComplete="off" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField label="Customer gets (quantity)" type="number" value={bxgyGetsQuantity} onChange={setBxgyGetsQuantity} autoComplete="off" />
                      </div>
                    </InlineStack>
                    <Select
                      label="Discount on 'gets' items"
                      options={[{ label: 'Free (100% off)', value: 'free' }, { label: 'Percentage off', value: 'percentage' }]}
                      value={bxgyGetsValueType}
                      onChange={setBxgyGetsValueType}
                    />
                    {bxgyGetsValueType !== 'free' && (
                      <TextField label="Percentage off gets items" type="number" value={bxgyGetsValue} onChange={setBxgyGetsValue} suffix="%" autoComplete="off" />
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* ── Applies to (non-BXGY, non-shipping) ── */}
              {(type[0] === 'amount_off_products' || type[0] === 'amount_off_order') && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Applies to</Text>
                    <Select
                      label=""
                      options={[
                        { label: type[0] === 'amount_off_order' ? 'Entire order' : 'All products', value: 'all_products' },
                        { label: 'Specific collections', value: 'specific_collections' },
                        { label: 'Specific products', value: 'specific_products' },
                      ]}
                      value={appliesTo}
                      onChange={v => { setAppliesTo(v); setSelectedResources([]); }}
                    />
                    {(appliesTo === 'specific_collections' || appliesTo === 'specific_products') && (
                      <BlockStack gap="300">
                        <Button onClick={selectResources}>Browse {appliesTo === 'specific_collections' ? 'Collections' : 'Products'}</Button>
                        {selectedResources.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {selectedResources.map(res => (
                              <div key={res.id} style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '4px 10px', borderRadius: '20px', background: '#f3f4f6',
                              }}>
                                <span style={{ fontSize: '13px' }}>{res.title}</span>
                                <button onClick={() => setSelectedResources(p => p.filter(r => r.id !== res.id))}
                                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '14px', lineHeight: 1 }}>×</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* ── Free Shipping Countries ── */}
              {type[0] === 'free_shipping' && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Countries</Text>
                    <ButtonGroup segmented>
                      <Button pressed={countriesType[0] === 'all'} onClick={() => setCountriesType(['all'])}>All countries</Button>
                      <Button pressed={countriesType[0] === 'specific'} onClick={() => setCountriesType(['specific'])}>Specific countries</Button>
                    </ButtonGroup>
                    {countriesType[0] === 'specific' && (
                      <Text variant="bodySm" tone="subdued">Country picker coming soon — all countries will be used for now.</Text>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* ── Minimum Requirements ── */}
              {type[0] !== 'bxgy' && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Minimum purchase requirements</Text>
                    <ButtonGroup segmented>
                      <Button pressed={minimumRequirement[0] === 'none'} onClick={() => setMinimumRequirement(['none'])}>No minimum</Button>
                      <Button pressed={minimumRequirement[0] === 'amount'} onClick={() => setMinimumRequirement(['amount'])}>Purchase amount</Button>
                      <Button pressed={minimumRequirement[0] === 'quantity'} onClick={() => setMinimumRequirement(['quantity'])}>Quantity</Button>
                    </ButtonGroup>
                    {minimumRequirement[0] === 'amount' && (
                      <TextField label="Minimum purchase amount ($)" type="number" value={minimumPurchaseAmount} onChange={setMinimumPurchaseAmount} prefix="$" autoComplete="off" />
                    )}
                    {minimumRequirement[0] === 'quantity' && (
                      <TextField label="Minimum quantity of items" type="number" value={minimumQuantity} onChange={setMinimumQuantity} autoComplete="off" />
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* ── Usage Limits ── */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Maximum discount uses</Text>
                  <Checkbox label="Limit number of times this discount can be used in total" checked={limitTotalUses} onChange={setLimitTotalUses} />
                  {limitTotalUses && (
                    <Box paddingInlineStart="800">
                      <TextField label="Total usage limit" type="number" value={totalUsesLimit} onChange={setTotalUsesLimit} autoComplete="off" />
                    </Box>
                  )}
                  <Checkbox label="Limit to one use per customer" checked={limitOnePerCustomer} onChange={setLimitOnePerCustomer} />
                </BlockStack>
              </Card>

              {/* ── Combinations ── */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Combinations</Text>
                  <Text variant="bodySm" tone="subdued">This bundle discount can be combined with:</Text>
                  <Checkbox label="Product discounts" checked={combineProduct} onChange={setCombineProduct} />
                  <Checkbox label="Order discounts" checked={combineOrder} onChange={setCombineOrder} />
                  <Checkbox label="Shipping discounts" checked={combineShipping} onChange={setCombineShipping} />
                </BlockStack>
              </Card>

              {/* ── Active Dates ── */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Active dates</Text>
                  <InlineStack gap="300" blockAlign="end">
                    <Box minWidth="220px">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" as="label" fontWeight="medium">Start date</Text>
                        <Popover
                          active={startPopoverActive}
                          activator={<Button onClick={() => setStartPopoverActive(p => !p)} icon={CalendarIcon} fullWidth textAlign="left">{formatDate(startDate)}</Button>}
                          onClose={() => setStartPopoverActive(false)}
                          preferredAlignment="left"
                        >
                          <div style={{ padding: '16px' }}>
                            <DatePicker month={startMonth} year={startYear} onChange={r => { setStartDate(r.start); setStartPopoverActive(false); }} onMonthChange={(m, y) => setStartMonthYear({ startMonth: m, startYear: y })} selected={startDate} />
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
                            activator={<Button onClick={() => setEndPopoverActive(p => !p)} icon={CalendarIcon} fullWidth textAlign="left">{formatDate(endDate)}</Button>}
                            onClose={() => setEndPopoverActive(false)}
                            preferredAlignment="left"
                          >
                            <div style={{ padding: '16px' }}>
                              <DatePicker month={endMonth} year={endYear} onChange={r => { setEndDate(r.start); setEndPopoverActive(false); }} onMonthChange={(m, y) => setEndMonthYear({ endMonth: m, endYear: y })} selected={endDate} disableDatesBefore={startDate} />
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

            </BlockStack>
          </Layout.Section>

          {/* ── Sidebar ── */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">

              {/* Summary */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Summary</Text>
                  {code && (
                    <div style={{
                      padding: '8px 14px', background: '#f9fafb', borderRadius: '8px',
                      display: 'flex', alignItems: 'center', gap: '8px', width: 'fit-content',
                      border: '1px solid #e5e7eb',
                    }}>
                      <span style={{ fontSize: '22px', fontWeight: '700', fontFamily: 'monospace', color: '#667eea' }}>{code}</span>
                    </div>
                  )}
                  <Divider />
                  <List type="bullet">
                    {summaryItems.map(item => <List.Item key={item}>{item}</List.Item>)}
                  </List>
                </BlockStack>
              </Card>

              {/* Existing discounts */}
              <Card>
                <BlockStack gap="300">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text variant="headingMd" as="h2">Existing Discounts</Text>
                    <Badge tone="info">{discounts.length}</Badge>
                  </div>
                  {discounts.length === 0 ? (
                    <Text variant="bodyXs" tone="subdued">No discounts created yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {discounts.map(d => (
                        <div key={d.id} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <BlockStack gap="50">
                              <Text variant="bodySm" as="p" fontWeight="semibold">{d.title}</Text>
                              <span style={{
                                fontFamily: 'monospace', fontSize: '12px', padding: '2px 8px',
                                borderRadius: '4px', background: '#f3f4f6', color: '#374151',
                              }}>{d.code}</span>
                              <Text variant="bodyXs" as="p" tone="subdued">{d.type}</Text>
                            </BlockStack>
                            <Badge tone={STATUS_TONE[d.status] || 'info'}>{d.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <Banner tone="info" title="Bundle discount tip">
                <p>Use <strong>Percentage</strong> discounts for bundles — they scale with order value and work best when linked to a template.</p>
              </Banner>

            </BlockStack>
          </Layout.Section>
        </Layout>

        {showToast && <Toast content={toastMsg} onDismiss={() => setShowToast(false)} />}
      </Page>
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
