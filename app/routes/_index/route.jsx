import { redirect } from "react-router";

// This app is embedded-only — there's no standalone marketing site to show
// at "/". Shopify Admin's nav header (the app icon/name row) does a
// top-level navigation straight to this route, and it can do so without any
// "shop"/"host" query params at all (relying on the existing embedded
// session instead), so checking for those params isn't reliable. Always
// hand off to /app — its loader calls authenticate.admin(), which checks the
// real session/cookies and handles both the logged-in case and the
// OAuth/install case correctly.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  throw redirect(`/app${url.search}`);
};
