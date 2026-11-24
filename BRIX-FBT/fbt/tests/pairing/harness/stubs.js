// Stand-ins for the server-only imports of the FBT page and Cart Editor.
// Loaders/actions are replaced by the harness router.
export const boundary = { headers: () => ({}), error: () => null };
export const authenticate = null;
export const getDb = null;
export const getShopPlan = null;
export const ensureFbtRulesSourceColumn = null;
export const rebuildFbtLegacyConditionForMode = null;
export const generateAiFbtRules = null;
export const ensureFbtAiInstructionColumns = null;
export const resolveFbtInstructions = null;
export const checkAndConsumeCredit = null;
export default function BrixBarStub() { return null; }
export const ensureFbtOfferColumns = null;
export const ensureFbtInteractionColumn = null;
export const cleanFbtInteraction = null;
export const syncFbtOfferDiscount = null;
