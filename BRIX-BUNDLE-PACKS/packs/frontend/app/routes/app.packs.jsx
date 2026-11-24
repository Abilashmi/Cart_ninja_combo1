import { Outlet, isRouteErrorResponse, useRouteError, useNavigate } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { Page, Card, BlockStack, Text, Button, Banner } from '@shopify/polaris';
import { authenticate } from '../shopify.server';

// Layout route for /app/packs/*. It renders <Outlet /> so the nested routes
// (app.packs._index = list, app.packs.new = builder, app.packs.$id = detail)
// actually mount — a flat-route parent WITHOUT an Outlet swallows its children
// and only ever shows itself. Mirrors app.bundles.jsx.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export default function AppPacksLayout() {
  return <Outlet />;
}

const FRIENDLY_STATUSES = new Set([400, 404, 500, 502, 503]);

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  // Auth / expired-session responses keep Shopify's own handling.
  if (!isRouteErrorResponse(error) || !FRIENDLY_STATUSES.has(error.status)) return boundary.error(error);
  const message = typeof error.data === 'string' && error.data ? error.data : 'This page could not be loaded.';
  return (
    <Page title="Packs" backAction={{ content: 'Packs', onAction: () => navigate('/app/packs') }}>
      <Card>
        <BlockStack gap="300">
          <Banner tone="critical" title={error.status === 404 ? 'Pack not found' : 'Packs could not be loaded'}><p>{message}</p></Banner>
          <Text as="p" tone="subdued">If this keeps happening, contact BRIX support with the time it occurred.</Text>
          <div><Button onClick={() => navigate('/app/packs')}>Back to Packs</Button> <Button variant="plain" onClick={() => navigate(0)}>Try again</Button></div>
        </BlockStack>
      </Card>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
