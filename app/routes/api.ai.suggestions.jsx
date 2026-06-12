import { authenticate } from "../shopify.server";
import { getSuggestions, seedSuggestions } from "../services/ai-data.server";

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    await seedSuggestions();
    const url = new URL(request.url);
    const page = url.searchParams.get("page") || "";
    const suggestions = await getSuggestions(page);
    return Response.json({ success: true, suggestions });
  } catch (e) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
}
