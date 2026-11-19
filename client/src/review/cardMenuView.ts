/**
 * THE CARD MENU, DRAWN (YAZ-5697 round 2): the one list (`shared/cardMenu.ts`) as the rows of the Mac's two menu
 * renderers — `ContextMenu`'s sections (the card window, a card file's tab, the Inbox) and the page's DOM menu
 * (`openMenuAt`: a card in a page, a card embed) — and the one way to run a row. A place gives its doors: a door that
 * is there puts its row in the menu (Open card, Move to its own file, …); `change` writes the card line its own way
 * (a page's transaction, the file, the Inbox's marks). Both renderers ask in place first on a row with `ask` (the file
 * rows), and run a row with `twice` on a second click, the first saying "Click again to …" (YAZ-5966: the review rows).
 */
import { cardMenu, type CardMenuItem, type CardMenuMarks } from '@shared/cardMenu'
import { withoutCardReviews, type CardLine } from '@shared/cardLine'
import type { MenuRow } from '../editor/blockHandleMenu'
import type { MenuAction, MenuSection } from '../sidebar/menuSections'
import type { CardAtPage } from './cardRead'
import { titleShowFor } from './useReviewSettings'

/** The card's marks for the one card menu (`shared/cardMenu.ts`, YAZ-5697 round 2); null for a card with no ID yet. */
export function cardMarksOf(card: Pick<CardAtPage, 'id' | 'off' | 'next' | 'fix' | 'notitle' | 'titleAt' | 'reviews'> | null): CardMenuMarks | null {
  if (card === null || card.id === null) return null
  return { off: card.off, next: card.next, fix: card.fix === true, notitle: card.notitle === true, titleAt: card.notitle === true ? 'never' : (card.titleAt ?? 'default'), reviews: card.reviews.length }
}

export interface CardMenuDoors {
  /** The card's marks; null: no review rows (a card with no ID yet). */
  marks: CardMenuMarks | null
  /** The card's file: its vault's Show card titles names Default ("Default (Always)", YAZ-5696 round 2). */
  path?: string | null
  /** Move to Up next: the vault reviews. */
  upNext: boolean
  /** Fix later (default true): never in the Inbox. */
  fix?: boolean
  /** The review rows and Reset history wait (a read-only page that cannot write the file). */
  locked?: boolean
  copyId: string | null
  copyLink?: boolean
  /** Reset history (the card's reviews, by typing first); the Inbox has none. */
  reset?: boolean
  unit?: (text: string) => string
  /** One write of the card line (a review row, Reset history). */
  change: (change: (line: CardLine) => CardLine) => void
  onNotice: (message: string) => void
  openCard?: () => void
  openPage?: () => void
  openTab?: () => void
  preview?: () => void
  showAsLink?: () => void
  moveOut?: () => void
  putBack?: () => void
  toPage?: () => void
  /** A row of the place's own that goes first (the Inbox's Undo last review). */
  first?: MenuAction
  /** The place runs a review row its own way (the Inbox: Archive card on the Undo stack). True: it did. */
  runOwn?: (item: CardMenuItem) => boolean
}

/** The groups of this place's ⋯. */
export function cardMenuOf(d: CardMenuDoors): CardMenuItem[][] {
  return cardMenu({
    open: d.openCard !== undefined ? 'card' : d.openPage !== undefined ? 'page' : undefined,
    preview: d.preview !== undefined,
    showAsLink: d.showAsLink !== undefined,
    moveOut: d.moveOut !== undefined,
    putBack: d.putBack !== undefined,
    toPage: d.toPage !== undefined,
    marks: d.marks,
    upNext: d.upNext,
    fix: d.fix,
    locked: d.locked,
    copyId: d.copyId,
    copyLink: d.copyLink,
    reset: d.reset,
    unit: d.unit,
    titleGlobal: d.path == null ? undefined : titleShowFor(d.path),
  })
}

/** Runs one row. A choice already picked (Title in review's ✓) does nothing. */
export function runCardMenuItem(item: CardMenuItem, d: CardMenuDoors): void {
  if (item.checked === true) return
  if (d.runOwn?.(item) === true) return
  if (item.change !== undefined) return d.change(item.change)
  const id = d.copyId
  switch (item.action) {
    case 'open-card':
      return d.openCard?.()
    case 'open-page':
      return d.openPage?.()
    case 'open-tab':
      return d.openTab?.()
    case 'preview':
      return d.preview?.()
    case 'show-link':
      return d.showAsLink?.()
    case 'move-out':
      return d.moveOut?.()
    case 'put-back':
      return d.putBack?.()
    case 'to-page':
      return d.toPage?.()
    // The copy and Reset history's typed ask are the editor's: loaded when a row runs, so the Inbox (YAZ-5067) stays
    // without the editor's modules.
    case 'copy-id':
      if (id !== null) void import('../editor/linkMenu').then(({ copyText }) => copyText(id, 'card ID', d.onNotice, undefined, true))
      return
    case 'copy-link':
      if (id !== null) void import('../editor/linkMenu').then(({ copyText }) => copyText(`[[${id}]]`, 'card link', d.onNotice, undefined, true))
      return
    case 'reset':
      return void import('../editor/card/askResetHistory').then(({ askResetHistory }) => askResetHistory(id, () => d.change(withoutCardReviews)))
  }
}

/** For `ContextMenu`: one section per group; Title in review › a parent whose choices are a radio set. */
export function cardMenuSections(d: CardMenuDoors): MenuSection[] {
  const sections: MenuSection[] = cardMenuOf(d).map((group) =>
    group.map((item) =>
      item.children !== undefined
        ? {
            id: 'title-review',
            label: item.label,
            hint: item.hint,
            children: [item.children.map((c) => ({ id: `title-${c.label}`, label: c.label, radio: { group: 'title-review', on: c.checked === true }, ask: c.ask, confirm: c.twice?.words, confirmAdd: c.twice !== undefined && c.twice.danger !== true ? true : undefined, disabled: c.disabled, onSelect: () => runCardMenuItem(c, d) }))],
          }
        : { id: item.action, label: item.label, hint: item.hint, tour: item.tour, danger: item.danger, disabled: item.disabled, ask: item.ask, confirm: item.twice?.words, confirmAdd: item.twice !== undefined && item.twice.danger !== true ? true : undefined, onSelect: () => runCardMenuItem(item, d) },
    ),
  )
  if (d.first !== undefined) sections.unshift([d.first])
  return sections
}

/** For the page's DOM menu (`openMenuAt`): a line above each group but the first; Title in review › a flyout, its pick with ✓. */
export function cardMenuRows(d: CardMenuDoors): MenuRow[] {
  return cardMenuOf(d).flatMap((group, g) =>
    group.map(
      (item, i): MenuRow => ({
        label: item.label,
        hint: item.hint,
        danger: item.danger,
        disabled: item.disabled,
        ask: item.ask,
        twice: item.twice,
        divider: g > 0 && i === 0 ? true : undefined,
        run: () => runCardMenuItem(item, d),
        ...(item.children !== undefined && {
          children: [item.children.map((c): MenuRow => ({ label: c.label, hint: c.checked === true ? '✓' : undefined, ask: c.ask, twice: c.twice, disabled: c.disabled, run: () => runCardMenuItem(c, d) }))],
        }),
      }),
    ),
  )
}
