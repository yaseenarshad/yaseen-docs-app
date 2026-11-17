/**
 * THE CARD MENU (YAZ-5697 round 2, Yaseen: "shouldnt it use the same right menu? why are they different?"): ONE list of
 * a card's ⋯ rows, for every place that shows a card's ⋯ — a card in a page, a card embed, the card window (Explore),
 * a card file's tab, the Inbox's ⋯ (Review) and the phone's card actions. Each place says which rows fit it
 * (`CardMenuPlace`); the order, the words and the asks are this file's, the same everywhere.
 *
 *   1. Open: Open card (a card in a page or an embed) or Open page / Open page in a new tab (the card window); Preview.
 *   2. The file: Show as link, Move to its own file, Put back into this page, Turn into a page.
 *   3. The review: Move to Up next (YAZ-5697, Yaseen: one word, the Mac and the phone), Archive card, Fix later,
 *      Title in review › (YAZ-5696 round 2: Default (Always) · Never · Always · After the first click · With Side 2, and
 *      the eye's help; the phone too).
 *   4. Copy card ID, Copy card link.
 *   5. Reset history, alone (it asks by typing, `askResetHistory`).
 *
 * THE ONE ASK RULE: a row that changes the card or its file, and that the same row does not take back, asks in place
 * first (`ask`, Cancel first). Archive card (only Unarchive takes it back), a Title in review choice, Move to its own file and
 * Put back into this page (two files change, no Undo), Turn into a page (the file is rewritten and renamed). Move to Up
 * next and Fix later do not ask: the same row says "Remove …" and takes it back. Show as link does not ask: it only
 * changes the page's text, and ⌘Z takes it back. Unarchive card does not ask: it only brings a card back.
 *
 * The rows are data: the place runs a row by its `action` (its own writes: a page's transaction, the file, the Inbox's
 * Undo stack) and draws them with its menu (`ContextMenu`, or the page's DOM menu).
 */
import { ARCHIVE_ASK, titleChoiceAsk, type CardAsk } from './cardAsks'
import { withCardFix, withCardNext, withCardOff, withCardTitleChoice, type CardLine, type CardTitleChoice, type CardTitleShow } from './cardLine'
import { CARD_TITLE_CHOICES, cardTitleChoiceLabel } from './cardTitleAt'

export type CardMenuAction =
  | 'open-card'
  | 'open-page'
  | 'open-tab'
  | 'preview'
  | 'show-link'
  | 'move-out'
  | 'put-back'
  | 'to-page'
  | 'next'
  | 'off'
  | 'fix'
  | 'title'
  | 'title-choice'
  | 'copy-id'
  | 'copy-link'
  | 'reset'

/** The card's marks now (off its card line); `reviews`: how many reviews it has (Reset history needs one). */
export interface CardMenuMarks {
  off: boolean
  next: boolean
  fix: boolean
  notitle: boolean
  /** Title in review's choice now (`cardTitleChoiceOf`); absent: from `notitle` (never, else default). */
  titleAt?: CardTitleChoice
  reviews: number
}

export interface CardMenuItem {
  action: CardMenuAction
  label: string
  /** The right-hand word: a key, the card's ID, or Title in review's choice now. */
  hint?: string
  /** It asks in place first (the one ask rule). */
  ask?: CardAsk
  danger?: boolean
  /** Waits: the place cannot change the card line now (a read-only page, a card with no ID). */
  disabled?: boolean
  /** The course's tour mark (YAZ-5123). */
  tour?: string
  /** A review row: the change of the card line, the shared writer's (`shared/cardLine.ts`). */
  change?: (line: CardLine) => CardLine
  /** A review row: the mark after it (true sets the word). */
  on?: boolean
  /** Title in review ›: the small eye by its name, whose help says each choice in one line (`CARD_TITLE_HELP`). */
  help?: true
  /** Title in review ›: its choices, one picked (`checked`); a pick of another asks first. */
  children?: CardMenuItem[]
  checked?: boolean
}

/** The rows a place shows. A row that is not named (or false) is not there. */
export interface CardMenuPlace {
  /** 'card': Open card (a card in a page, an embed, the Inbox); 'page': Open page and Open page in a new tab (the card window). */
  open?: 'card' | 'page'
  preview?: boolean
  showAsLink?: boolean
  moveOut?: boolean
  putBack?: boolean
  toPage?: boolean
  /** The card's marks: the review rows (none for a card with no ID yet). */
  marks: CardMenuMarks | null
  /** Move to Up next: the vault reviews. */
  upNext?: boolean
  /** Fix later (default true): never in the Inbox (YAZ-5430, YAZ-5625). */
  fix?: boolean
  /** The title row (default true): Title in review ›. */
  title?: boolean
  /** The vault's Show card titles (review.json `titleAt`): Default says it, "Default (Always)". Absent: "Default". */
  titleGlobal?: CardTitleShow
  /** The review rows wait (a read-only page that cannot write the file). */
  locked?: boolean
  /** Copy card ID: the ID, once the card has one. */
  copyId?: string | null
  copyLink?: boolean
  /** Reset history (with marks that hold a review). */
  reset?: boolean
  /** The vault's word for a page (YAZ-4938): "Open page", "Turn into a page". Default: the word "page". */
  unit?: (text: string) => string
}

const same = (text: string) => text

/** The card's ⋯, in groups (a line between two). Empty groups are left out. */
export function cardMenu(place: CardMenuPlace): CardMenuItem[][] {
  const unit = place.unit ?? same
  const open: CardMenuItem[] = []
  if (place.open === 'card') open.push({ action: 'open-card', label: 'Open card', hint: '⌘↵' })
  if (place.open === 'page') open.push({ action: 'open-page', label: unit('Open page') }, { action: 'open-tab', label: unit('Open page in a new tab'), hint: '⌘↵' })
  if (place.preview === true) open.push({ action: 'preview', label: 'Preview', hint: 'P' })

  const file: CardMenuItem[] = []
  if (place.showAsLink === true) file.push({ action: 'show-link', label: 'Show as link' })
  if (place.moveOut === true) file.push({ action: 'move-out', label: 'Move to its own file', ask: { question: 'Move this card to its own file?', yes: 'Move' } })
  if (place.putBack === true) file.push({ action: 'put-back', label: unit('Put back into this page'), ask: { question: unit('Put this card back into this page?'), yes: 'Put back' } })
  if (place.toPage === true) file.push({ action: 'to-page', label: unit('Turn into a page'), ask: { question: unit('Turn this card into a page?'), yes: unit('Turn into a page') } })

  const review: CardMenuItem[] = []
  const m = place.marks
  if (m !== null) {
    const disabled = place.locked === true ? true : undefined
    if (place.upNext === true) {
      const on = !m.next
      const label = on ? 'Move to Up next' : 'Remove from Up next'
      review.push({ action: 'next', label, on, disabled, change: (l) => withCardNext(l, on) })
    }
    const off = !m.off
    // Chapter 11's tour (YAZ-5330): Archive card, then Unarchive card on the same row once the card is archived.
    review.push({ action: 'off', label: off ? 'Archive card' : 'Unarchive card', tour: off ? 'card-menu-archive' : 'card-menu-unarchive', ask: off ? ARCHIVE_ASK : undefined, on: off, disabled, change: (l) => withCardOff(l, off) })
    if (place.fix !== false) {
      const fix = !m.fix
      review.push({ action: 'fix', label: fix ? 'Fix later' : 'Remove Fix later', on: fix, disabled, change: (l) => withCardFix(l, fix) })
    }
    if (place.title !== false) {
      // Title in review › (YAZ-5696): the hint and the ✓ say the choice now; another choice asks first.
      const now: CardTitleChoice = m.titleAt ?? (m.notitle ? 'never' : 'default')
      const children = CARD_TITLE_CHOICES.map(({ choice }): CardMenuItem => ({ action: 'title-choice', label: cardTitleChoiceLabel(choice, place.titleGlobal), checked: choice === now, ask: choice === now ? undefined : titleChoiceAsk(choice), disabled, change: (l) => withCardTitleChoice(l, choice) }))
      review.push({ action: 'title', label: 'Title in review', hint: cardTitleChoiceLabel(now, place.titleGlobal), help: true, disabled, children })
    }
  }

  const copy: CardMenuItem[] = []
  if (place.copyId != null) copy.push({ action: 'copy-id', label: 'Copy card ID', hint: place.copyId })
  if (place.copyId != null && place.copyLink === true) copy.push({ action: 'copy-link', label: 'Copy card link', hint: `[[${place.copyId}]]`, tour: 'card-copy-link' })

  // LAST, alone (YAZ-5376): it asks by typing first.
  const reset: CardMenuItem[] = place.reset === true && m !== null && m.reviews > 0 ? [{ action: 'reset', label: 'Reset history', danger: true, disabled: place.locked === true ? true : undefined }] : []

  return [open, file, review, copy, reset].filter((group) => group.length > 0)
}
