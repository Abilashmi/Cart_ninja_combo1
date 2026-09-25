// Stand-in for every server-only module the Build a Combo builder route imports
// (its loader/action are replaced by mocks in main.jsx, so none of this runs).
export const authenticate = null;
export const getDb = null;
export const sendToPhp = null;
export const checkComboPlanGate = null;
export default {};
