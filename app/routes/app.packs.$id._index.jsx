import { useEffect, useState } from 'react';
import { useLoaderData, useLocation, useNavigate, useFetcher } from 'react-router';
import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Banner, Divider, Modal, Thumbnail, InlineGrid } from '@shopify/polaris';
import { packsRouteContext, throwPackResponse } from '../services/packs-loader.server';
import { getPack, listActivePacks } from '../services/packs.server';
import { hydratePacks, getCheckoutDiscountStatus } from '../services/packs-shopify.server';
import PackPreview from '../components/packs/PackPreview';
import { PACK_TEMPLATES } from '../utils/packs.shared.js';
import { formatMoney } from '../utils/currency.shared';

export async function loader({ request, params }) {
  const { admin, shop, planState, currency } = await packsRouteContext(request);
  try {
    const stored = await getPack(shop, params.id);
    if (!stored) throw new Response('This Pack does not exist or belongs to a different store.', { status: 404 });
    const [pack] = await hydratePacks(admin, [stored], currency);
    const checkoutDiscount = planState === 'enabled' && pack.status === 'active' ? await getCheckoutDiscountStatus(admin, await listActivePacks(shop)) : null;
    return { pack, planState, currency, checkoutDiscount };
  } catch (error) {
    return throwPackResponse(error);
  }
}

const statusTone = { active: 'success', inactive: 'attention', draft: 'info', configuration_error: 'critical' };
const statusLabel = { active: 'Active', inactive: 'Inactive', draft: 'Draft', configuration_error: 'Configuration error' };

export default function PackDetail() {
  const { pack, planState, currency, checkoutDiscount } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const statusFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fmt = (value) => formatMoney(value, { currencyCode: currency.code, locale: currency.locale });
  const isActive = pack.status === 'active';
  const canPublish = planState === 'enabled';
  const justSaved = location.state?.saved ? location.state : null;

  // Navigate away ONLY after the server confirmed the delete.
  useEffect(() => {
    if (deleteFetcher.state === 'idle' && deleteFetcher.data?.success === true) navigate('/app/packs', { replace: true });
  }, [deleteFetcher.state, deleteFetcher.data, navigate]);

  const statusResult = statusFetcher.data;
  const statusError = statusResult?.success === false ? statusResult.error : null;
  const deleteError = deleteFetcher.data?.success === false ? deleteFetcher.data.error : null;
  const liveDiscount = statusResult?.checkoutDiscount || justSaved?.checkoutDiscount || checkoutDiscount;
  const syncWarning = statusResult?.warning?.message || justSaved?.warning || null;
  const submit = (fetcher, payload) => fetcher.submit(payload, { method: 'post', action: '/api/packs', encType: 'application/json' });

  return (
    <Page
      title={pack.productTitle}
      subtitle={pack.variantTitle}
      backAction={{ content: 'Packs', onAction: () => navigate('/app/packs') }}
      titleMetadata={<Badge tone={statusTone[pack.displayStatus]}>{statusLabel[pack.displayStatus] || pack.displayStatus}</Badge>}
      primaryAction={{ content: 'Edit', onAction: () => navigate(`/app/packs/${pack.id}/edit`) }}
      secondaryActions={[
        { content: 'Customize', onAction: () => navigate(`/app/packs/${pack.id}/edit?step=customization`) },
        isActive
          ? { content: 'Disable', destructive: true, loading: statusFetcher.state !== 'idle', onAction: () => submit(statusFetcher, { action: 'status', id: pack.id, status: 'inactive' }) }
          : { content: 'Enable', disabled: !canPublish, loading: statusFetcher.state !== 'idle', onAction: () => submit(statusFetcher, { action: 'status', id: pack.id, status: 'active' }) },
        { content: 'Delete', destructive: true, onAction: () => setConfirmDelete(true) },
      ]}
    >
      <BlockStack gap="400">
        {justSaved && <Banner tone="success" title="Pack saved"><p>{isActive ? 'Your changes are live once the checkout discount below is active.' : 'Your Pack is saved.'}</p></Banner>}
        {statusError && <Banner tone="critical" title="Couldn’t update this Pack"><p>{statusError}</p></Banner>}
        {statusResult?.success && !statusError && <Banner tone="success"><p>{statusResult.pack.status === 'active' ? 'Pack enabled.' : 'Pack disabled.'}</p></Banner>}
        {syncWarning && <Banner tone="warning" title="Checkout discount needs attention"><p>{syncWarning}</p></Banner>}
        {!canPublish && <Banner tone="info" title="Preview mode"><p>Your plan lets you build and preview Packs. Enabling them on your storefront requires Starter or Pro.</p></Banner>}
        {pack.issue && <Banner tone="critical" title="Configuration error"><p>{pack.issue}</p></Banner>}
        {isActive && liveDiscount && (
          <Banner tone={liveDiscount.verified ? 'success' : 'warning'} title={liveDiscount.verified ? 'Checkout discount is active' : 'Checkout discount isn’t active yet'}>
            <p>{liveDiscount.verified ? 'Shoppers see this Pack and its savings are applied at checkout.' : `${liveDiscount.message} Shoppers won’t see this Pack until the discount is verified.`}</p>
          </Banner>
        )}
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    {pack.productImage && <Thumbnail source={pack.productImage} alt="" size="small" />}
                    <Text as="h2" variant="headingMd">Pack tiers</Text>
                  </InlineStack>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#6d7175' }}>{['Tier', 'Qty', 'Subtotal', 'Discount', 'Pack price', 'Savings', 'Per item'].map((heading) => <th key={heading} style={{ padding: '6px 8px', fontWeight: 500 }}>{heading}</th>)}</tr></thead>
                      <tbody>
                        {pack.tiers.map((tier) => (
                          <tr key={tier.quantity} style={{ borderTop: '1px solid #e1e3e5' }}>
                            <td style={{ padding: 8 }}>{tier.name || `Buy ${tier.quantity}`} {tier.badge ? <Badge tone="info">{tier.badge}</Badge> : null}</td>
                            <td style={{ padding: 8 }}>{tier.quantity}</td>
                            <td style={{ padding: 8 }}>{tier.formatted.subtotal}</td>
                            <td style={{ padding: 8 }}>{tier.discountType === 'none' ? '—' : tier.discountType === 'percentage' ? `${tier.discountValue}%` : tier.formatted.discountAmount}</td>
                            <td style={{ padding: 8, fontWeight: 600 }}>{tier.formatted.price}</td>
                            <td style={{ padding: 8 }}>{tier.savings > 0 ? tier.formatted.savings : '—'}</td>
                            <td style={{ padding: 8 }}>{tier.formatted.effectiveUnitPrice}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">{pack.priceVerified ? `Calculated from the live Shopify price of ${fmt(pack.basePrice)} per unit.` : 'Prices below use the last known price because Shopify could not be reached or the variant is missing.'}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Details</Text>
                  <Divider />
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Template</Text><Text as="span">{PACK_TEMPLATES.find((template) => template.id === pack.template)?.name || pack.template}</Text></BlockStack>
                    <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Availability</Text><Text as="span">{pack.available ? 'In stock' : 'Out of stock'}{pack.maxQuantity ? ` · max ${pack.maxQuantity} per order` : ''}</Text></BlockStack>
                    <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Version</Text><Text as="span">{pack.version}</Text></BlockStack>
                    <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Last updated</Text><Text as="span">{pack.updatedAt ? new Date(pack.updatedAt).toLocaleString() : '—'}</Text></BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">Storefront preview</Text>
                <PackPreview template={pack.template} customization={pack.customization} tiers={pack.tiers} productImage={pack.productImage} formatMoney={fmt} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
      <Modal
        open={confirmDelete}
        onClose={() => { if (deleteFetcher.state === 'idle') setConfirmDelete(false); }}
        title="Delete this Pack?"
        primaryAction={{ content: 'Delete Pack', destructive: true, loading: deleteFetcher.state !== 'idle', onAction: () => submit(deleteFetcher, { action: 'delete', id: pack.id }) }}
        secondaryActions={[{ content: 'Cancel', disabled: deleteFetcher.state !== 'idle', onAction: () => setConfirmDelete(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">This removes the BRIX Pack configuration for “{pack.productTitle} — {pack.variantTitle}”. The Shopify product itself is not affected.</Text>
            {deleteError && <Banner tone="critical" title="Couldn’t delete this Pack"><p>{deleteError}</p></Banner>}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
