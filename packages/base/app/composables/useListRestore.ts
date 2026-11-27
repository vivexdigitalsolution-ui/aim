/**
 * Back from a car to the list: the list comes back at the same place. Without this the cars load again from the top and the dealer scrolls all over.
 *   const listBack = useListRestore('lite-cars', () => cars.value.length, () => total.value, more)
 *   ... after the first load:  await listBack.restore()
 * It remembers how far the list was scrolled and how many cars were loaded ("Show more" included) when a car was opened. It restores only when the
 * page is reached by going BACK from a car (the browser's back, the phone's back, or the "‹ All cars" link), never when the list is opened from the menu.
 */
const DETAIL = /^\/(car|cars|one-price)\/[^/]+/

export function useListRestore(key: string, count: () => number, total: () => number, loadMore: () => Promise<void>) {
  const k = 'list-scroll-' + key
  const forward = import.meta.client ? String((window.history.state as any)?.forward || '') : ''
  const comingBack = DETAIL.test(forward)

  // aim scrolls inside its own .main box, lite scrolls the page
  const scroller = (): HTMLElement | null => {
    if (!import.meta.client) return null
    const el = document.querySelector('.main') as HTMLElement | null
    return el && /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight ? el : null
  }
  const getY = () => { const el = scroller(); return el ? el.scrollTop : window.scrollY }
  const setY = (y: number) => { const el = scroller(); if (el) el.scrollTop = y; else window.scrollTo(0, y) }

  onBeforeRouteLeave((to) => {
    if (!DETAIL.test(to.path)) return
    try { sessionStorage.setItem(k, JSON.stringify({ y: getY(), n: count(), t: Date.now() })) } catch { /* private mode: no memory */ }
  })

  async function restore() {
    if (!comingBack) return
    let saved: { y: number; n: number; t: number } | null = null
    try { saved = JSON.parse(sessionStorage.getItem(k) || 'null'); sessionStorage.removeItem(k) } catch { /* nothing saved */ }
    if (!saved || Date.now() - saved.t > 3600_000) return
    for (let guard = 0; count() < saved.n && count() < total() && guard < 40; guard++) await loadMore()      // load the "Show more" pages that were open
    await nextTick()
    setY(saved.y)
    setTimeout(() => setY(saved!.y), 150)      // once more after the photos settle
  }
  return { restore }
}
