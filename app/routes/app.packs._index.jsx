/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useState, useCallback } from 'react';
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from 'react-router';
import { Page, Card, BlockStack, InlineStack, Text, Button, Badge, EmptyState, IndexTable, Select, TextField, Banner, Thumbnail, Box, Modal, useIndexResourceState } from '@shopify/polaris';
import { packsRouteContext } from '../services/packs-loader.server';
import { PackError, listPacks } from '../services/packs.server';
import { hydratePacks, getCheckoutDiscountStatus } from '../services/packs-shopify.server';
import { PACK_DESIGNS, packTypeOf, summarizeTiers } from '../utils/packs.shared.js';
import { formatMoney } from '../utils/currency.shared';

export async function loader({ request }) {
  const { admin, shop, planState, currency } = await packsRouteContext(request);
  try {
    const stored = await listPacks(shop);
    const packs = await hydratePacks(admin, stored, currency);
    const active = packs.filter((pack) => pack.status === 'active');
    const checkoutDiscount = planState === 'enabled' && active.length ? await getCheckoutDiscountStatus(admin, active, { shop }) : null;
    return { packs, planState, currency, checkoutDiscount, loadError: null };
  } catch (error) {
    if (error instanceof Response) throw error;
    const message = error instanceof PackError ? error.message : 'Packs could not be loaded. Please try again.';
    if (!(error instanceof PackError)) console.error('[app.packs._index]', String(error?.message || error).slice(0, 300));
    return { packs: [], planState, currency, checkoutDiscount: null, loadError: message };
  }
}

const designLabels = Object.fromEntries(PACK_DESIGNS.map((design) => [design.id, design.name]));
const statusTone = { active: 'success', inactive: 'attention', draft: 'info', configuration_error: 'critical' };
const statusLabel = { active: 'Active', inactive: 'Inactive', draft: 'Draft', configuration_error: 'Configuration error' };

function PackActions({ pack, canPublish, onDeleteRequest }) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const busy = fetcher.state !== 'idle';
  const isActive = pack.status === 'active';
  const toggleDisabled = busy || (!isActive && !canPublish);
  const failure = fetcher.data && fetcher.data.success === false ? fetcher.data.error : null;
  // Actions live inside a selectable IndexTable row — stop clicks from bubbling
  // up and toggling row selection instead of firing the intended action.
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- InlineStack/BlockStack don't forward onClick; this div only guards bubbling into the selectable IndexTable row
    <div onClick={(e) => e.stopPropagation()}>
      <BlockStack gap="100">
        <InlineStack gap="200" wrap={false} blockAlign="center">
          <Button size="slim" onClick={() => navigate(`/app/packs/${pack.id}`)}>View</Button>
          <Button size="slim" onClick={() => navigate(`/app/packs/${pack.id}/edit`)}>Edit</Button>
          <button
            type="button"
            disabled={toggleDisabled}
            aria-label={`${isActive ? 'Deactivate' : 'Activate'} Pack for ${pack.productTitle}`}
            style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: toggleDisabled ? 'not-allowed' : 'pointer', opacity: toggleDisabled ? 0.6 : 1 }}
            onClick={() => fetcher.submit({ action: 'status', id: pack.id, status: isActive ? 'inactive' : 'active' }, { method: 'post', action: '/api/packs', encType: 'application/json' })}
          >
            <Badge tone={isActive ? 'success' : 'attention'}>{busy ? '…' : (isActive ? 'Active' : 'Inactive')}</Badge>
          </button>
          <Button size="slim" tone="critical" onClick={() => onDeleteRequest(pack)}>Delete</Button>
        </InlineStack>
        {failure && <Text as="span" tone="critical" variant="bodySm">{failure}</Text>}
      </BlockStack>
    </div>
  );
}

async function deletePackRequest(id) {
  const response = await fetch('/api/packs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  });
  const data = await response.json().catch(() => ({ success: false, error: 'Unexpected response.' }));
  if (!data.success) throw new Error(data.error || 'Could not delete Pack.');
  return data;
}

export default function AppPacks() {
  const { packs, planState, currency, checkoutDiscount, loadError } = useLoaderData();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState(null); // single pack | null
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const fmt = (value) => formatMoney(value, { currencyCode: currency.code, locale: currency.locale });
  const visible = packs.filter((pack) => {
    const matches = !query || `${pack.productTitle} ${pack.variantTitle}`.toLowerCase().includes(query.toLowerCase());
    return matches && (status === 'all' || pack.displayStatus === status);
  });
  const canPublish = planState === 'enabled';
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(
    visible.map((pack) => ({ id: String(pack.id) }))
  );

  const runDelete = useCallback(async (ids) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop -- API only supports one delete per request
        await deletePackRequest(id);
      }
      setDeleteTarget(null);
      setBulkDeleteOpen(false);
      clearSelection();
      revalidator.revalidate();
    } catch (error) {
      setDeleteError(error.message || 'Could not delete the selected Pack(s).');
    } finally {
      setDeleting(false);
    }
  }, [clearSelection, revalidator]);

  return (
    <Page title="Packs" subtitle="Quantity-based offers that help your customers save more." primaryAction={{ content: 'Create Pack', onAction: () => navigate('/app/packs/new'), disabled: planState === 'locked' }}>
      <BlockStack gap="400">
        {planState === 'preview' && <Banner tone="info" title="Packs preview mode"><p>You can build, customize and preview Packs, but publishing them to your storefront requires the Starter or Pro plan.</p></Banner>}
        {planState === 'locked' && <Banner tone="warning" title="Packs is locked"><p>Upgrade your BRIX plan to create quantity-based offers.</p></Banner>}
        {loadError && <Banner tone="critical" title="Couldn’t load your Packs" action={{ content: 'Try again', onAction: () => revalidator.revalidate(), loading: revalidator.state === 'loading' }}><p>{loadError}</p></Banner>}
        {checkoutDiscount && !checkoutDiscount.verified && (
          <Banner tone="warning" title="Checkout discount isn’t active yet">
            <p>{checkoutDiscount.message} Until it is, shoppers won’t see your active Packs, because their savings wouldn’t apply at checkout.</p>
          </Banner>
        )}
        {checkoutDiscount?.verified && <Banner tone="success" title="Checkout discount is active"><p>Active Packs apply their savings at checkout.</p></Banner>}
        <Card padding="0">
          <Box padding="400">
            <InlineStack gap="300" wrap blockAlign="end">
              <div style={{ minWidth: 260, flex: 1 }}><TextField label="Search Packs" labelHidden placeholder="Search product or variant" value={query} onChange={setQuery} clearButton onClearButtonClick={() => setQuery('')} autoComplete="off" /></div>
              <Select label="Status" labelInline options={[{ label: 'All', value: 'all' }, { label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }, { label: 'Draft', value: 'draft' }, { label: 'Configuration error', value: 'configuration_error' }]} value={status} onChange={setStatus} />
            </InlineStack>
          </Box>
          {visible.length === 0 ? (
            <EmptyState heading={packs.length ? 'No Packs match your filters' : 'Create your first Pack'} action={packs.length || loadError ? undefined : { content: 'Create Pack', onAction: () => navigate('/app/packs/new') }}>
              <p>{packs.length ? 'Try a different search or status.' : 'Attach quantity-based savings — like Buy 2 save 5% — to an existing Shopify product variant.'}</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: 'Pack', plural: 'Packs' }}
              itemCount={visible.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={[
                { content: 'Delete Packs', destructive: true, onAction: () => setBulkDeleteOpen(true) },
              ]}
              headings={[{ title: 'Product' }, { title: 'Variant' }, { title: 'Offer' }, { title: 'Type' }, { title: 'Design' }, { title: 'Status' }, { title: 'Updated' }, { title: 'Actions' }]}
            >
              {visible.map((pack, index) => (
                <IndexTable.Row id={String(pack.id)} key={pack.id} position={index} selected={selectedResources.includes(String(pack.id))}>
                  <IndexTable.Cell>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      {pack.productImage ? <Thumbnail source={pack.productImage} alt="" size="extraSmall" /> : null}
                      <Button variant="plain" onClick={() => navigate(`/app/packs/${pack.id}`)}>{pack.productTitle}</Button>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{pack.variantScope === 'all' ? 'All variants' : `${(pack.allowedVariantIds || []).length} selected`}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span">{pack.tiers.length} tier{pack.tiers.length === 1 ? '' : 's'} · {summarizeTiers(pack.tiers, pack.tiers)}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">{pack.priceVerified ? `Base price ${fmt(pack.basePrice)}` : 'price not verified'}</Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{packTypeOf(pack.template).name}</IndexTable.Cell>
                  <IndexTable.Cell>{designLabels[pack.customization?.design?.preset] || 'Classic'}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Badge tone={statusTone[pack.displayStatus] || 'new'}>{statusLabel[pack.displayStatus] || pack.displayStatus}</Badge>
                      {pack.issue && <Text as="span" tone="critical" variant="bodySm">{pack.issue}</Text>}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{pack.updatedAt ? new Date(pack.updatedAt).toLocaleDateString() : '—'}</IndexTable.Cell>
                  <IndexTable.Cell><PackActions pack={pack} canPublish={canPublish} onDeleteRequest={setDeleteTarget} /></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null); } }}
        title="Delete Pack"
        primaryAction={{ content: 'Delete', destructive: true, loading: deleting, onAction: () => runDelete([deleteTarget.id]) }}
        secondaryActions={[{ content: 'Cancel', onAction: () => { setDeleteTarget(null); setDeleteError(null); } }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">Are you sure you want to delete the Pack for <b>{deleteTarget?.productTitle}</b>? This can’t be undone.</Text>
            {deleteError && <Text as="p" tone="critical">{deleteError}</Text>}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={bulkDeleteOpen}
        onClose={() => { if (!deleting) { setBulkDeleteOpen(false); setDeleteError(null); } }}
        title="Delete Packs"
        primaryAction={{ content: 'Delete', destructive: true, loading: deleting, onAction: () => runDelete(selectedResources) }}
        secondaryActions={[{ content: 'Cancel', onAction: () => { setBulkDeleteOpen(false); setDeleteError(null); } }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">Are you sure you want to delete {selectedResources.length} selected Pack{selectedResources.length === 1 ? '' : 's'}? This can’t be undone.</Text>
            {deleteError && <Text as="p" tone="critical">{deleteError}</Text>}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
