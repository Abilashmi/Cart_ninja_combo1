import { useLoaderData, useSearchParams } from 'react-router';
import { packsRouteContext, throwPackResponse } from '../services/packs-loader.server';
import { getPack } from '../services/packs.server';
import { hydratePacks } from '../services/packs-shopify.server';
import PackBuilder from '../components/packs/PackBuilder';

const STEP_INDEX = { product: 0, template: 1, tiers: 2, customization: 3, review: 4 };

export async function loader({ request, params }) {
  const { admin, shop, planState, currency } = await packsRouteContext(request);
  try {
    const stored = await getPack(shop, params.id);
    if (!stored) throw new Response('This Pack does not exist or belongs to a different store.', { status: 404 });
    const [pack] = await hydratePacks(admin, [stored], currency);
    return { pack, shop, planState, currency };
  } catch (error) {
    return throwPackResponse(error);
  }
}

export default function EditPack() {
  const { pack, shop, planState, currency } = useLoaderData();
  const [params] = useSearchParams();
  // key={pack.id + version}: a save (which bumps version) remounts the builder on fresh server data.
  return <PackBuilder key={`${pack.id}:${pack.version}`} mode="edit" pack={pack} shop={shop} planState={planState} currency={currency} initialStep={STEP_INDEX[params.get('step')] ?? 0} />;
}
