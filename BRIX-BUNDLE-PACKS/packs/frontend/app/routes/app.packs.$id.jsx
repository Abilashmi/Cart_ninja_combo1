import { Outlet } from 'react-router';
import { authenticate } from '../shopify.server';

// Layout for /app/packs/:id — renders the detail page (app.packs.$id._index)
// or the editor (app.packs.$id.edit) through <Outlet />.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export default function PackIdLayout() {
  return <Outlet />;
}
