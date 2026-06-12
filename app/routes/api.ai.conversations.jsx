import { authenticate } from "../shopify.server";
import { listConversations, createConversation } from "../services/ai-data.server";

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session?.shop || "";
    const conversations = await listConversations(shop);
    return Response.json({ success: true, conversations });
  } catch (e) {
    console.error("[API] conversations loader:", e);
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}

export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session?.shop || "";

    if (request.method === "POST") {
      const body = await request.json();
      const conv = await createConversation(shop, body.title || "New Chat");
      return Response.json({ success: true, conversation: conv });
    }

    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    console.error("[API] conversations action:", e);
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}
