/**
 * THE UPDATE PILL (YAZ-2976 D4, D14): beside the cog in the sidebar footer, it says there is something
 * new, and a click opens the "What's new" sheet (D5) that App mounts. Nothing while there is nothing
 * to act on: `idle`, and `downloading` (D6: the download is the app's business until the new version
 * is staged).
 *
 * D14 (Yasin: "make it more like exciting", "no one cares about version numbers", "i like the solid
 * blue with something that keeps breathing", then "just put \"new update Ready\"" with "the 🎉 emoji"):
 * a solid accent pill with 🎉, the words "New update ready" (or "See what's new" on the first launch
 * after the swap), a pop when it appears, and a white dot that breathes until the user opens the sheet
 * for this version — then it rests, so it never nags.
 *
 * YAZ-3401: the footer also holds the sidebar zoom, so the pill shortens by the room left for it: a slot takes the
 * footer's free width, and `update.css` queries the slot. The full words, then `SHORT` (CSS draws it from
 * `data-short`), then a 22 px round 🎉 with the dot on its corner. The DOM text, the accessible name and the title
 * stay the full words at every width.
 */
import { useState } from 'react'
import type { UpdateState } from '@shared/types'
import './update.css'

const LABEL = { ready: 'New update ready', manual: 'New update ready', updated: "See what's new" } as const
/** The words in a narrower slot (YAZ-3401). `update.css` picks its breakpoint for the wider one, "What's new". */
const SHORT = { ready: 'Update', manual: 'Update', updated: "What's new" } as const

interface UpdatePillProps {
  update: UpdateState
  onOpen: () => void
}

export function UpdatePill({ update, onOpen }: UpdatePillProps) {
  /** The version whose sheet this pill already opened: its dot rests. A newer version breathes again. */
  const [seen, setSeen] = useState<string | null>(null)
  if (update.kind === 'idle' || update.kind === 'downloading') return null
  const resting = seen === update.version
  const open = (): void => {
    setSeen(update.version)
    onOpen()
  }
  return (
    <div className="update-pill-slot">
      <button type="button" className="update-pill" title="Click to see what's new" aria-label={LABEL[update.kind]} data-short={SHORT[update.kind]} onClick={open}>
        <span className="update-pill__emoji" aria-hidden="true">
          🎉
        </span>
        <span className="update-pill__label">{LABEL[update.kind]}</span>
        <span className={resting ? 'update-pill__dot' : 'update-pill__dot update-pill__dot--breathing'} aria-hidden="true" />
      </button>
    </div>
  )
}
