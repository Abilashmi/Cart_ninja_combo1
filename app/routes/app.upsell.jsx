import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    await authenticate.admin(request);
    return {};
};

export default function UpsellPage() {
    return null;
}
