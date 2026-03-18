import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Make request to the remote DB to mark the shop as inactive
  try {
    const response = await fetch("https://blueviolet-clam-512487.hostingersite.com/uninstall_shop.php", {
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
