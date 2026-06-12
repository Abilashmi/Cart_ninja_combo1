import { authenticate } from "../shopify.server";
import { getTools, seedTools } from "../services/ai-data.server";

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    await seedTools();
    const tools = await getTools();
    return Response.json({ success: true, tools });
  } catch (e) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}
