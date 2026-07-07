import { authenticate } from '../shopify.server';
import { getCreditStatus } from '../services/ai-credits.server';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const status = await getCreditStatus(session.shop);
  return Response.json({ success: true, credits: status });
}
