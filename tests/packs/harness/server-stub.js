// Stand-in for every `*.server` module when the admin pages are bundled for the
// browser harness — the pages only import them for their loaders, which the
// harness replaces with mock loaders.
export class PackError extends Error {}
export const packsRouteContext = null;
export const throwPackResponse = null;
export const listPacks = null;
export const getPack = null;
export const listActivePacks = null;
export const hydratePacks = null;
export const getCheckoutDiscountStatus = null;
