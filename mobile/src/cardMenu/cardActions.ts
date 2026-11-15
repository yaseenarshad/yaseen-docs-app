import { withCardFix, withCardNext, withCardNoTitle, withCardOff, type CardLine } from '@shared/cardLine'

/**
 * THE CARD'S SETTINGS ON THE PHONE: the rows of the Mac's card menu (`cardMenuSections`
 * in `client/src/review/cardPane.tsx`), in its order and with its words: Up next (the Mac's "Put at top of Inbox";
 * the phone's word, as Review's ⋯ and filter say it), Archive card, Fix later, Title on the front (Show / Hide: the
 * state now). Each one changes ONE word of the card line (`next`, `off`, `fix`, `notitle`), with the Mac's own change.
 * Answering a card is not a setting: it stays one tap.
 */
export type CardActionKind = 'next' | 'off' | 'fix' | 'notitle'

/** The card's marks now (off its card line). */
export interface CardActionMarks {
  off: boolean
  next: boolean
  fix: boolean
  notitle: boolean
}

export interface CardAction {
  kind: CardActionKind
  /** The mark after the action: true sets the word, false takes it out. */
  on: boolean
  /** The row's words. */
  label: string
  /** The row's state word at the right (Title on the front: Show / Hide), as the Mac's hint. */
  hint?: string
  /** The armed row's words, also said by VoiceOver: "Tap again to archive". */
  confirm: string
  /** What the screen says once it is done ("Archived"). */
  done: string
  /** The change of the card line: the shared writer's (`shared/cardLine.ts`), the Mac's. */
  change: (line: CardLine) => CardLine
}

/**
 * The rows for a card with these marks. `upNext`: the Up next row (the vault reviews; the Mac shows "Put at top of
 * Inbox" only then).
 */
export function cardActions(marks: CardActionMarks, options: { upNext: boolean }): CardAction[] {
  const rows: CardAction[] = []
  if (options.upNext) {
    const on = !marks.next
    rows.push({
      kind: 'next',
      on,
      label: on ? 'Up next' : 'Remove from Up next',
      confirm: on ? 'Tap again to put it Up next' : 'Tap again to remove from Up next',
      done: on ? 'Marked: Up next' : 'Removed: Up next',
      change: (l) => withCardNext(l, on),
    })
  }
  const off = !marks.off
  rows.push({
    kind: 'off',
    on: off,
    label: off ? 'Archive card' : 'Unarchive card',
    confirm: off ? 'Tap again to archive' : 'Tap again to unarchive',
    done: off ? 'Archived' : 'Unarchived',
    change: (l) => withCardOff(l, off),
  })
  const fix = !marks.fix
  rows.push({
    kind: 'fix',
    on: fix,
    label: fix ? 'Fix later' : 'Remove Fix later',
    confirm: fix ? 'Tap again to mark Fix later' : 'Tap again to remove Fix later',
    done: fix ? 'Marked: Fix later' : 'Removed: Fix later',
    change: (l) => withCardFix(l, fix),
  })
  // ONE toggle row (the Mac's YAZ-5030): the hint is the state now; the action turns it to the other.
  const hide = !marks.notitle
  rows.push({
    kind: 'notitle',
    on: hide,
    label: 'Title on the front',
    hint: marks.notitle ? 'Hide' : 'Show',
    confirm: hide ? 'Tap again to hide the title' : 'Tap again to show the title',
    done: hide ? 'Title on the front: Hide' : 'Title on the front: Show',
    change: (l) => withCardNoTitle(l, hide),
  })
  return rows
}
