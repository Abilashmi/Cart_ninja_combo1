import { authenticate } from "../shopify.server";
import {
  getConversation,
  listMessages,
  updateConversation,
  deleteConversation,
} from "../services/ai-data.server";

export async function loader({ request, params }) {
  try {
    const { session } = await authenticate.admin(request);
    const { id } = params;
    const [conv, messages] = await Promise.all([
      getConversation(id),
      listMessages(id),
    ]);
    if (!conv) {
      return Response.json({ success: false, error: "Not found" }, { status: 404 });
    }
    return Response.json({ success: true, conversation: conv, messages });
  } catch (e) {
    console.error("[API] conversation loader:", e);
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}

export async function action({ request, params }) {
  try {
    const { session } = await authenticate.admin(request);
    const { id } = params;

    if (request.method === "PUT") {
      const body = await request.json();
      const allowed = {};
      if (body.title !== undefined) allowed.title = String(body.title).slice(0, 120);
      if (body.pinned !== undefined) allowed.pinned = Boolean(body.pinned);
      if (body.archived !== undefined) allowed.archived = Boolean(body.archived);
      const updated = await updateConversation(id, allowed);
      return Response.json({ success: true, conversation: updated });
    }

    if (request.method === "DELETE") {
      await deleteConversation(id);
      return Response.json({ success: true });
    }

    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    console.error("[API] conversation action:", e);
    return Response.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
