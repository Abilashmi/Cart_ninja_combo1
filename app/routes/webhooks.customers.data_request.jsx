// Older per-topic route; shopify.app.toml sends all three privacy webhooks to
// /webhooks/compliance. Kept so this URL does the same work if ever used.
export { action } from "./webhooks.compliance";
