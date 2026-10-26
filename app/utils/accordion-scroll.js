import { useEffect, useLayoutEffect } from 'react';

// useLayoutEffect warns during server rendering; it only matters in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// The editor sidebars (Cart Editor, COD Customize) open one section at a time.
// Opening a section closes the one above it, which left the view near the end
// of the new section; this puts the opened section's header at the top of the
// list (before paint) so it reads from its start. Items carry data-section="<id>".
export function useScrollOpenSectionToTop(listRef, openId) {
  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !openId) return;
    const head = list.querySelector(`[data-section="${openId}"]`);
    if (!head) return;
    const top = head.getBoundingClientRect().top;
    if (list.scrollHeight > list.clientHeight) {
      list.scrollTop += top - list.getBoundingClientRect().top;
    } else if (top < 0) {
      // Narrow screens: the list grows with its sections and the page scrolls.
      window.scrollBy(0, top);
    }
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
}
