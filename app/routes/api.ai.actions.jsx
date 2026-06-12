import { authenticate } from "../shopify.server";
import { createAction } from "../services/ai-data.server";

export async function action({ request }) {
  try {
    await authenticate.admin(request);

    if (request.method === "POST") {
      const body = await request.json();
      const action = await createAction(body);
      return Response.json({ success: true, action });
    }

    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}
