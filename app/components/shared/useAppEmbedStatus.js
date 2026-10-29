import { useEffect, useState } from 'react';
import { CART_DRAWER_EMBED_HANDLE } from '../../config/theme-extension';

// Whether the "Custom Cart Drawer" app embed is on in the store's published
// theme, from App Bridge's shopify.app.extensions() (Built for Shopify 4.2.3:
// the home page shows whether the app is set up). 'loading' until it answers,
// 'active' | 'off', or 'unknown' when App Bridge isn't there (test harnesses)
// or the call fails. The embed renders the cart drawer, COD, FBT/Packs
// scripts and combo pages, so it's the one switch that makes BRIX live.
export function embedStatusFrom(extensions, handle = CART_DRAWER_EMBED_HANDLE) {
  const blocks = (extensions || [])
    .filter((ext) => ext?.type === 'theme_app_extension')
    .flatMap((ext) => ext.activations || []);
  const embed = blocks.find((block) => block?.handle === handle);
  if (!embed) return 'off';
  return embed.status === 'active' ? 'active' : 'off';
}

export function useAppEmbedStatus(handle = CART_DRAWER_EMBED_HANDLE) {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    let cancelled = false;
    const app = typeof window !== 'undefined' ? window.shopify?.app : null;
    if (!app?.extensions) {
      setStatus('unknown');
      return undefined;
    }
    app.extensions()
      .then((extensions) => { if (!cancelled) setStatus(embedStatusFrom(extensions, handle)); })
      .catch(() => { if (!cancelled) setStatus('unknown'); });
    return () => { cancelled = true; };
  }, [handle]);
  return status;
}
