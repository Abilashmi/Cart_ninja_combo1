/**
 * Guided setup API (components/guide/GuideProvider.jsx). The store is always
 * the signed-in shop (authenticate.admin); nothing from the browser names it.
 *   GET                         → { state, modules, existing }
 *                                 modules = each feature's { configured, active }
 *   POST { intent: 'patch', patch }
 *                               → the merchant's answers and tour position, merged
 *                                 onto the saved state (can't mark a feature set up)
 *   POST { intent: 'verify', module }
 *                               → reads the feature's own settings; only when they
 *                                 are saved does its tour become completed and the
 *                                 guide move on to the next picked feature
 */
import { authenticate } from '../shopify.server';
import { getGuideState, saveGuidePatch } from '../services/guide-state.server';
import { isModuleConfigured, loadGuideStatus } from '../services/guide-status.server';
import { GUIDE_MODULE_IDS, completeModulePatch } from '../utils/guide.shared.js';

const json = (body, status = 200) => Response.json(body, { status });

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const [state, status] = await Promise.all([
    getGuideState(admin),
    loadGuideStatus(session.shop, { admin, full: true }),
  ]);
  return json({ ok: true, state, modules: status.modules, existing: status.existing });
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad request.' }, 400); }

  try {
    if (body?.intent === 'patch') {
      if (!body.patch || typeof body.patch !== 'object') return json({ ok: false, error: 'Nothing to save.' }, 400);
      const state = await saveGuidePatch(admin, body.patch);
      return json({ ok: true, state });
    }

    if (body?.intent === 'verify') {
      const module = body.module;
      if (!GUIDE_MODULE_IDS.includes(module)) return json({ ok: false, error: 'Unknown feature.' }, 400);
      const configured = await isModuleConfigured(session.shop, module, { admin });
      if (configured !== true) return json({ ok: true, verified: false, unknown: configured === null });
      const state = await saveGuidePatch(admin, (current) => completeModulePatch(current, module), { trusted: true });
      return json({ ok: true, verified: true, state });
    }

    return json({ ok: false, error: 'Unknown request.' }, 400);
  } catch (error) {
    console.error('[api.onboarding]', String(error?.message || error).slice(0, 300));
    return json({ ok: false, error: 'Could not save your setup progress. Please try again.' }, 500);
  }
}
