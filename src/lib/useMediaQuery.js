// Ask the browser a layout question in JavaScript, and re-render when the
// answer changes.
//
// WHY NOT JUST CSS
//
// Hiding one of two layouts with `md:hidden` is simpler and usually right —
// but React still builds both. The transactions page has ten columns, so a
// year of trading is ~3,600 table cells constructed and thrown away on the
// device with the least memory and the slowest processor, to render a card
// list the phone was going to use instead.
//
// So the pages that carry two genuinely different layouts pick one here, and
// the ones where the difference is a padding or a hidden label keep using CSS.
//
// useSyncExternalStore rather than useState + useEffect: the first paint reads
// the real value instead of guessing and correcting, which is the difference
// between a layout that appears and one that flickers.

import { useSyncExternalStore } from 'react'

// One MediaQueryList per query, shared by every component that asks. Creating
// a new one per render would attach a listener per render too.
const cache = new Map()

function listFor(query) {
  if (!cache.has(query)) cache.set(query, window.matchMedia(query))
  return cache.get(query)
}

export function useMediaQuery(query) {
  const mql = listFor(query)
  return useSyncExternalStore(
    (onChange) => {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => mql.matches,
    // Server snapshot. Nothing renders this app on a server today, but the
    // value has to be SOMETHING, and "not narrow" matches the desktop-first
    // layout the CSS falls back to.
    () => false
  )
}

/** Tailwind's `md` breakpoint, from the other side. */
export const NARROW = '(max-width: 767.98px)'
