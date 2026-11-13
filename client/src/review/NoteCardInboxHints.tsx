/**
 * The Inbox's key row (YAZ-5024, Yaseen: "this should only ever be one line"): ONE line at any card width (YAZ-5019's
 * drag too). Short labels first ("New tab"); when the row still does not fit, the least important keys fold, from the
 * end: ⌘↵, then O (then P, ← →, ⌘Z, only in a very narrow tab). Space and E never fold. The row's width is measured by
 * a ResizeObserver, and each key's width once per set of keys: no work per frame. The keys show in words (YAZ-5035,
 * `KeyCaps`: "Cmd + Enter", "Left / Right"); `data-keys` keeps the binding, so the fold order is the same, and a
 * narrow row folds sooner as the words are wider.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { KeyCaps } from '../keys/KeyCaps'

/** The keys that fold, the first to go first. Any key not here (Space, E) stays. */
export const HINT_FOLD_ORDER: readonly string[] = ['⌘↵', 'O', 'P', '← →', '⌘Z']

/**
 * Which keys fold so the row fits `room`: each key's width, the gap between two, in fold order. A pure function, so
 * the rule is tested without a layout engine.
 */
export function foldHints(keys: readonly string[], widths: readonly number[], gap: number, room: number): Set<string> {
  const folded = new Set<string>()
  const width = () => {
    const shown = widths.filter((_, i) => !folded.has(keys[i]))
    return shown.reduce((a, b) => a + b, 0) + gap * Math.max(0, shown.length - 1)
  }
  for (const key of HINT_FOLD_ORDER) {
    if (width() <= room) break
    if (keys.includes(key)) folded.add(key)
  }
  return folded
}

export function NoteCardInboxHints({ hints }: { hints: readonly { keys: string; label: string }[] }) {
  const row = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const set = hints.map((h) => h.keys).join('\n')

  // The row's width: a ResizeObserver (the card's drag, the window), never a measure per frame.
  useLayoutEffect(() => {
    const el = row.current
    if (el === null) return
    setRoom(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setRoom(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Each key's own width (a folded key is laid out off the row, so it is measured too), then what folds for the room.
  useLayoutEffect(() => {
    const el = row.current
    if (el === null || room === null || room <= 0) return setFolded((f) => (f.size === 0 ? f : new Set()))
    const parts = [...el.children] as HTMLElement[]
    const style = getComputedStyle(el)
    const gap = parseFloat(style.columnGap) || 0
    const inner = room - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
    const next = foldHints(
      parts.map((p) => p.dataset.keys ?? ''),
      parts.map((p) => p.offsetWidth),
      gap,
      inner,
    )
    setFolded((f) => (f.size === next.size && [...next].every((k) => f.has(k)) ? f : next))
  }, [set, room])

  return (
    <div ref={row} className="explore__foot note-card-inbox__hints" aria-hidden="true">
      {hints.map((h) => (
        <span key={h.label} data-keys={h.keys} data-folded={folded.has(h.keys) || undefined}>
          <KeyCaps keys={h.keys} /> {h.label}
        </span>
      ))}
    </div>
  )
}
