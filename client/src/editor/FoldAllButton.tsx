/**
 * The fold-all button (YAZ-3938 D1, D4): the chevrons, left of the cog, in a note and in a code tab. One
 * button for both directions, the sidebar's rule (YAZ-862): while anything is open it collapses all; once
 * everything is folded it expands all. The host gives `run`: in a note the ⌘⇧U / ⌘⇧I command
 * (`foldAllHotkeys.ts`), so one ⌘Z undoes it; in a code tab Monaco's own fold action.
 *
 * D9: the chevrons show what a click does: they point up for "Collapse all" and down for "Expand all".
 *
 * D2, THE TYPING BUDGET: the host's `read` runs when the pointer comes onto the button, when the focus comes, at
 * the click, and when the host's `subscribe` says that a fold changed (a chevron, a key, an undo). Never on a
 * keystroke: typing changes no fold, so the host never calls. Typing that makes the first foldable line, or
 * removes the last one, can leave the chevrons one step late until the next look or fold; the click reads first,
 * so it never does the wrong thing.
 */
import { useEffect, useRef, useState } from 'react'
import { hintOf } from '../lib/keyHint'
import { CollapseAllIcon, ExpandAllIcon } from '../views/view/icons'

/** What a click does now. */
export type FoldNext = 'collapse' | 'expand' | 'none'

const LABEL: Record<FoldNext, string> = { collapse: 'Collapse all', expand: 'Expand all', none: 'Nothing to fold' }

export function FoldAllButton({ read, run, subscribe, keys }: {
  read: () => FoldNext | Promise<FoldNext>
  run: (collapse: boolean) => void
  /** Calls `changed` after each fold change and returns the unsubscribe. A new function subscribes again, and reads once. */
  subscribe: (changed: () => void) => () => void
  /** The key rows the label names: the user's key, as Settings › Hotkeys has it. */
  keys: { collapse: string; expand: string }
}) {
  const [shown, setShown] = useState<{ next: FoldNext; label: string }>({ next: 'collapse', label: LABEL.collapse })
  const labelOf = (next: FoldNext): string => {
    const key = next === 'none' ? undefined : hintOf(next === 'collapse' ? keys.collapse : keys.expand)
    return key === undefined ? LABEL[next] : `${LABEL[next]} (${key})`
  }
  const refresh = (): void =>
    void Promise.resolve(read()).then((next) => {
      const label = labelOf(next)
      setShown((was) => (was.next === next && was.label === label ? was : { next, label }))
    })
  // The subscription calls the refresh of the latest render, so it reads with the host's latest `read`.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    refreshRef.current()
    return subscribe(() => refreshRef.current())
  }, [subscribe])
  return (
    <button type="button" className="fold-all__trigger" aria-label={shown.label} title={shown.label} onPointerEnter={refresh} onFocus={refresh}
      onClick={() => void Promise.resolve(read()).then((next) => {
        if (next !== 'none') run(next === 'collapse')
        refresh()
      })}>
      {shown.next === 'expand' ? <ExpandAllIcon /> : <CollapseAllIcon />}
    </button>
  )
}
