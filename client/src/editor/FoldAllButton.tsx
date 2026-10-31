/**
 * The fold-all button (YAZ-3938 D1, D4): the chevrons, left of the cog, in a note and in a code tab. One
 * button for both directions, the sidebar's rule (YAZ-862): while anything is open it collapses all; once
 * everything is folded it expands all. The host gives `run`: in a note the ⌘⇧U / ⌘⇧I command
 * (`foldAllHotkeys.ts`), so one ⌘Z undoes it; in a code tab Monaco's own fold action.
 *
 * D2, THE TYPING BUDGET: the host's `read` runs when the pointer comes to or moves over the button, when the
 * focus comes, and at the click. Never on a keystroke: the button holds no subscription, and the label waits for
 * a look. The move keeps the label true while the pointer rests on it and a key or a chevron changes the folds.
 */
import { useState } from 'react'
import { hintOf } from '../lib/keyHint'
import { ChevronsIcon } from '../views/view/icons'

/** What a click does now. */
export type FoldNext = 'collapse' | 'expand' | 'none'

const LABEL: Record<FoldNext, string> = { collapse: 'Collapse all', expand: 'Expand all', none: 'Nothing to fold' }

export function FoldAllButton({ read, run, keys }: {
  read: () => FoldNext | Promise<FoldNext>
  run: (collapse: boolean) => void
  /** The key rows the label names: the user's key, as Settings › Hotkeys has it. */
  keys: { collapse: string; expand: string }
}) {
  const [label, setLabel] = useState(LABEL.collapse)
  const labelOf = (next: FoldNext): string => {
    const key = next === 'none' ? undefined : hintOf(next === 'collapse' ? keys.collapse : keys.expand)
    return key === undefined ? LABEL[next] : `${LABEL[next]} (${key})`
  }
  const refresh = (): void => void Promise.resolve(read()).then((next) => setLabel(labelOf(next)))
  return (
    <button type="button" className="fold-all__trigger" aria-label={label} title={label} onPointerEnter={refresh} onPointerMove={refresh} onFocus={refresh}
      onClick={() => void Promise.resolve(read()).then((next) => {
        if (next !== 'none') run(next === 'collapse')
        refresh()
      })}>
      <ChevronsIcon />
    </button>
  )
}
