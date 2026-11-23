/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// COD → Customize → OTP SMS → "View OTP activity": the OTP wallet's full history
// (every code sent, refund and recharge), newest first, 25 at a time, with a filter.
// Data: cod.server.js getOtpWalletLedger → php_backend/otp_wallet.php `ledger`.
import { useEffect, useState } from 'react';
import { useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { Page, Card, BlockStack, InlineStack, Text, Banner, Button, ButtonGroup, Box, Divider } from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { getOtpWalletLedger, getShopTimezone, OTP_WALLET_TYPES } from '../services/cod.server';
import { otpWalletOn, otpWalletRechargeOn } from '../services/cod-sms.server';

const PAGE_SIZE = 25;

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'debit', label: 'Codes sent' },
  { id: 'refund', label: 'Refunds' },
  { id: 'credit', label: 'Money added' },
];

const LABELS = { debit: 'OTP sent', refund: 'OTP not sent, refunded', credit: 'Money added' };
// A credit's own note ("Free credit from BRIX") names it, except a paid recharge.
const labelOf = (e) => (e.type === 'credit' && e.note && e.note !== 'Recharge' ? e.note : LABELS[e.type] || e.note || e.type);

// An entry's time in the shop's zone ("20 Nov 2026, 2:32 pm"); null = show the stored text.
function shopTime(ms, timeZone) {
  if (!ms) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return null;
  }
}

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const type = OTP_WALLET_TYPES.includes(url.searchParams.get('type')) ? url.searchParams.get('type') : '';
  const beforeId = Number(url.searchParams.get('before')) || 0;
  if (!otpWalletOn(shop)) return { available: false, type, beforeId };
  try {
    const [ledger, timeZone] = await Promise.all([
      getOtpWalletLedger(shop, { type, beforeId, limit: PAGE_SIZE }),
      getShopTimezone(admin, shop),
    ]);
    return {
      available: true, type, beforeId, ...ledger,
      // Same switch as the wallet card's "Add money" (app.cod_.customize.jsx).
      rechargeOn: otpWalletRechargeOn(),
      entries: ledger.entries.map((e) => ({ ...e, when: shopTime(e.atMs, timeZone) })),
    };
  } catch (error) {
    console.warn('[app.cod.otp-activity] OTP wallet could not be loaded:', String(error?.message || error).slice(0, 200));
    return { available: true, type, beforeId, error: true, entries: [], hasMore: false, nextBefore: null };
  }
}

const rupees = (paise) => `₹${((Number(paise) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ActivityRow({ entry }) {
  const adds = entry.type !== 'debit';
  return (
    <Box paddingBlock="300" paddingInline="400">
      <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
        <BlockStack gap="050">
          <Text as="span" fontWeight="medium">{labelOf(entry)}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{entry.when || String(entry.at || '').slice(0, 16)}</Text>
        </BlockStack>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <Text as="p" fontWeight="semibold" tone={adds ? 'success' : undefined}>{adds ? '+' : '−'}{rupees(entry.amountPaise)}</Text>
          <Text as="p" variant="bodySm" tone="subdued">Balance {rupees(entry.balanceAfterPaise)}</Text>
        </div>
      </InlineStack>
    </Box>
  );
}

// Keyed by filter: a new filter starts again from its newest entries.
function ActivityList({ data }) {
  const more = useFetcher();
  const [entries, setEntries] = useState(data.entries);
  const [next, setNext] = useState({ hasMore: data.hasMore, before: data.nextBefore });
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const page = more.data;
    if (!page || more.state !== 'idle') return;
    if (page.error) { setLoadFailed(true); return; }
    setLoadFailed(false);
    setEntries((list) => {
      const seen = new Set(list.map((e) => e.id));
      return [...list, ...page.entries.filter((e) => !seen.has(e.id))];
    });
    setNext({ hasMore: page.hasMore, before: page.nextBefore });
  }, [more.data, more.state]);

  if (!entries.length) {
    return (
      <Box padding="600">
        <BlockStack gap="100" inlineAlign="center">
          <Text as="p" fontWeight="medium">{data.type ? 'Nothing of this kind yet' : 'No activity yet'}</Text>
          <Text as="p" tone="subdued">Codes sent, refunds and money added will show here.</Text>
        </BlockStack>
      </Box>
    );
  }
  return (
    <BlockStack>
      {entries.map((e, i) => (
        <div key={e.id || `${e.at}-${i}`}>
          {i > 0 && <Divider />}
          <ActivityRow entry={e} />
        </div>
      ))}
      {loadFailed && (
        <Box paddingInline="400" paddingBlockEnd="300"><Banner tone="critical">More activity could not be loaded. Please try again.</Banner></Box>
      )}
      {next.hasMore && (
        <>
          <Divider />
          <Box padding="300">
            <InlineStack align="center">
              <Button
                loading={more.state !== 'idle'}
                onClick={() => more.load(`/app/cod/otp-activity?${new URLSearchParams({ ...(data.type ? { type: data.type } : {}), before: String(next.before) })}`)}
              >
                Load more
              </Button>
            </InlineStack>
          </Box>
        </>
      )}
    </BlockStack>
  );
}

export default function OtpActivityPage() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const back = () => navigate('/app/cod/customize?section=sms');

  if (!data.available) {
    return (
      <Page backAction={{ content: 'Customize COD', onAction: back }} title="OTP activity">
        <Banner tone="info">BRIX&apos;s OTP wallet isn&apos;t set up on this server, so there is no activity to show.</Banner>
      </Page>
    );
  }
  return (
    <Page
      backAction={{ content: 'Customize COD', onAction: back }}
      title="OTP activity"
      subtitle="Every code sent, refund and recharge of your OTP wallet."
      primaryAction={data.rechargeOn ? { content: 'Recharge', onAction: back } : undefined}
    >
      <BlockStack gap="400">
        {data.error && <Banner tone="critical">The OTP wallet could not be loaded. Reload the page.</Banner>}
        {!data.error && (
          <Card>
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">Balance</Text>
                <Text as="p" tone="subdued">Each code costs {rupees(data.pricePaise)}.</Text>
              </BlockStack>
              <div style={{ textAlign: 'right' }}>
                <Text as="p" variant="headingXl">{rupees(data.balancePaise)}</Text>
                <Text as="p" variant="bodySm" tone="subdued">about {data.messagesLeft} codes</Text>
              </div>
            </InlineStack>
          </Card>
        )}
        <Card padding="0">
          <Box padding="400">
            <ButtonGroup variant="segmented">
              {FILTERS.map((f) => (
                <Button
                  key={f.id || 'all'}
                  pressed={data.type === f.id}
                  onClick={() => setSearchParams(f.id ? { type: f.id } : {}, { replace: true })}
                >
                  {f.label}
                </Button>
              ))}
            </ButtonGroup>
          </Box>
          <Divider />
          {!data.error && <ActivityList key={data.type || 'all'} data={data} />}
        </Card>
        {/* Room above the Sidekick bar and the support chat button. */}
        <div style={{ height: 'var(--brix-bar-clearance, 160px)' }} />
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
