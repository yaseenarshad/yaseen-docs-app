import { cardMenu, type CardMenuItem } from '@shared/cardMenu'
import type { CardAsk } from '@shared/cardAsks'
import { withCardTitleChoice, type CardLine } from '@shared/cardLine'
import { CARD_TITLE_CHOICES, type CardTitleChoice } from '@shared/cardTitleAt'

/**
 * THE CARD'S SETTINGS ON THE PHONE: the review rows of the ONE card menu (`shared/cardMenu.ts`, YAZ-5697 round 2), the
 * Mac's rows in the Mac's order, words and asks: Up next (the Mac's "Put at top of Inbox"; the phone's word, as Review's
 * ⋯ and filter say it), Archive card, Fix later, Title in review › (YAZ-5696: Default · At once · After the front ·
 * With Side 2 · Never). Each changes the card line with the Mac's own change. Answering a card is not a setting: it
 * stays one tap.
 */
export type CardActionKind = 'next' | 'off' | 'fix' | 'title'

/** The card's marks now (off its card line). */
export interface CardActionMarks {
  off: boolean
  next: boolean
  fix: boolean
  notitle: boolean
  /** Title in review's choice now; absent: from `notitle` (Never, else Default). */
  titleAt?: CardTitleChoice
}

export interface CardAction {
  kind: CardActionKind
  /** The row's own key (`data-action`): the kind, or `title-<choice>` for a Title in review choice. */
  key: string
  /** The mark after the action: true sets the word, false takes it out. */
  on: boolean
  /** The row's words. */
  label: string
  /** The row's word at the right: Title in review's choice now. */
  hint?: string
  /** A row with no ask (Up next, Fix later, Unarchive card): the armed row's words, also said by VoiceOver: "Tap again to …". */
  confirm: string
  /** It asks in place first (the one ask rule): Archive card, a Title in review choice. */
  ask?: CardAsk
  /** What the screen says once it is done ("Archived"). */
  done: string
  /** The change of the card line: the shared writer's (`shared/cardLine.ts`), the Mac's. */
  change: (line: CardLine) => CardLine
  /** The change back (an Undo): a Title in review choice goes back to the choice before. */
  undo: (line: CardLine) => CardLine
  /** Title in review ›: its choices; `checked` the one now. */
  children?: CardAction[]
  checked?: boolean
}

const PHONE_WORDS: Record<'next' | 'off' | 'fix', (on: boolean) => { confirm: string; done: string }> = {
  next: (on) => (on ? { confirm: 'Tap again to put it Up next', done: 'Marked: Up next' } : { confirm: 'Tap again to remove from Up next', done: 'Removed: Up next' }),
  off: (on) => (on ? { confirm: 'Tap again to archive', done: 'Archived' } : { confirm: 'Tap again to unarchive', done: 'Unarchived' }),
  fix: (on) => (on ? { confirm: 'Tap again to mark Fix later', done: 'Marked: Fix later' } : { confirm: 'Tap again to remove Fix later', done: 'Removed: Fix later' }),
}

/**
 * The rows for a card with these marks. `upNext`: the Up next row (the vault reviews). `fix` (default true): the Fix
 * later row; Review's ⋯ has none (YAZ-5625), as the Mac's Inbox (YAZ-5430).
 */
export function cardActions(marks: CardActionMarks, options: { upNext: boolean; fix?: boolean }): CardAction[] {
  const now: CardTitleChoice = marks.titleAt ?? (marks.notitle ? 'never' : 'default')
  const items = cardMenu({ marks: { ...marks, titleAt: now, reviews: 0 }, upNext: options.upNext, fix: options.fix, upNextWord: true }).flat()
  return items.map((item): CardAction => {
    if (item.action === 'title') {
      const children = (item.children ?? []).map((c: CardMenuItem, i): CardAction => {
        const choice = CARD_TITLE_CHOICES[i].choice
        return { kind: 'title', key: `title-${choice}`, on: true, label: c.label, confirm: '', ask: c.ask, checked: c.checked, done: `Title in review: ${c.label}`, change: c.change!, undo: (l) => withCardTitleChoice(l, now) }
      })
      return { kind: 'title', key: 'title', on: true, label: item.label, hint: item.hint, confirm: '', done: '', change: (l) => l, undo: (l) => l, children }
    }
    const kind = item.action as 'next' | 'off' | 'fix'
    const on = item.on === true
    const back = cardMenu({ marks: { ...marks, [kind]: on, titleAt: now, reviews: 0 }, upNext: true }).flat().find((r) => r.action === kind)!
    return { kind, key: kind, on, label: item.label, ask: item.ask, ...PHONE_WORDS[kind](on), change: item.change!, undo: back.change! }
  })
}
