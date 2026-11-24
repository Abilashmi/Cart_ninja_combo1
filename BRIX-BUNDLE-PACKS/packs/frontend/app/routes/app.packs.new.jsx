import { useLoaderData } from 'react-router';
import { packsRouteContext } from '../services/packs-loader.server';
import PackBuilder from '../components/packs/PackBuilder';

// /app/packs/new — create a Pack. Authentication + plan + currency come from
// the shared prelude; there is no draft-by-id loading here (edit lives at
// /app/packs/:id/edit), so refreshing this page is always safe.
export async function loader({ request }) {
  const { shop, planState, currency } = await packsRouteContext(request);
  return { shop, planState, currency };
}

export default function NewPack() {
  const { shop, planState, currency } = useLoaderData();
  return <PackBuilder mode="create" pack={null} shop={shop} planState={planState} currency={currency} />;
}
