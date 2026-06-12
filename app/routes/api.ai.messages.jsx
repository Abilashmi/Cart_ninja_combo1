import { authenticate } from "../shopify.server";
import { listMessages, createMessage } from "../services/ai-data.server";

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    if (!conversationId) {
      return Response.json({ success: false, error: "conversationId required" }, { status: 400 });
    }
    const messages = await listMessages(conversationId);
    return Response.json({ success: true, messages });
  } catch (e) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}

export async function action({ request }) {
  try {
    await authenticate.admin(request);

    if (request.method === "POST") {
      const body = await request.json();
      const { conversationId, role, message } = body;
      if (!conversationId || !role || !message) {
        return Response.json({ success: false, error: "conversationId, role, message required" }, { status: 400 });
      }
      const msg = await createMessage(conversationId, role, message);
      return Response.json({ success: true, message: msg });
    }

    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}
