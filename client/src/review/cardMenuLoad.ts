/**
 * The one card menu's code (`cardMenuView.ts`, `shared/cardMenu.ts`, YAZ-5697 round 2) is its own chunk: a card in a
 * page and a card embed load it as they mount, so the ⋯ opens at once, and the page's first load carries none of it.
 */
type CardMenuView = typeof import('./cardMenuView')

let view: CardMenuView | null = null

export const loadCardMenu = (): Promise<CardMenuView> => import('./cardMenuView').then((m) => (view = m))

/** Runs `use` with the card menu's code: at once once it is loaded, else when it comes. */
export function withCardMenu(use: (m: CardMenuView) => void): void {
  if (view !== null) return use(view)
  void loadCardMenu().then(use)
}
