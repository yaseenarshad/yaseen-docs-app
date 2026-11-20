/**
 * The one card menu's code (`cardMenuView.ts`, `shared/cardMenu.ts`, YAZ-5697 round 2) is its own chunk: a card in a
 * page and a card embed load it as they mount, so the ⋯ opens at once, and the page's first load carries none of it.
 */
type CardMenuView = typeof import('./cardMenuView')

let view: CardMenuView | null = null

let loading: Promise<CardMenuView> | null = null

/** One load for every card (a page of 50 cards asks 50 times); a failed load is forgotten so the next ask tries again,
 * and it never rejects unheard — a card mounting only warms the chunk (YAZ-4965). */
export const loadCardMenu = (): Promise<CardMenuView> => {
  if (loading === null) {
    loading = import('./cardMenuView').then((m) => (view = m))
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** Runs `onLoad` with the card menu's code: at once once it is loaded, else when it comes. */
export function withCardMenu(onLoad: (m: CardMenuView) => void): void {
  if (view !== null) return onLoad(view)
  loadCardMenu().then(onLoad, () => undefined)
}
