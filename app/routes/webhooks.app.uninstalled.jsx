import { authenticate } from "../shopify.server";
import sessionDb from "../session-db.server";
import { BASE_PHP_URL } from "../utils/api-helpers";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  // Guarded so a transient DB error doesn't 500 this handler — Shopify
  // retries app/uninstalled aggressively on non-2xx, and there's nothing to
  // gain from a retry storm over what's likely already a stale/deleted row.
  if (session) {
    try {
      await sessionDb.session.deleteMany({ where: { shop } });
    } catch (error) {
      console.error("Error deleting session on uninstall", error);
    }
  }

  // Make request to the remote DB to mark the shop as inactive
  try {
    const response = await fetch(`${BASE_PHP_URL}/uninstall_shop.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ shop }),
    });
    
    if (!response.ok) {
        console.error(`Failed to mark shop inactive in remote DB: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error calling uninstall_shop.php", error);
  }

  return new Response();
};
