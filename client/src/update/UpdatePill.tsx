/**
 * THE UPDATE PILL (YAZ-2976 D4, D14): beside the cog in the sidebar footer, it says there is something
 * new, and a click opens the "What's new" sheet (D5) that App mounts. Nothing while there is nothing
 * to act on: `idle`, and `downloading` (D6: the download is the app's business until the new version
 * is staged).
 *
 * D14 (Yasin: "make it more like exciting", "no one cares about version numbers", "i like the solid
 * blue with something that keeps breathing", then "just put \"new update Ready\"" with "the 🎉 emoji"):
 * a solid accent pill with 🎉, the words "New update ready", a pop when it appears, and a white dot that
 * breathes until the user opens the sheet for this version — then it rests, so it never nags. No pill after
 * the swap (YAZ-3698): the sheet showed the notes before "Restart to update".
 *
 * YAZ-3401: the footer also holds the sidebar zoom, so the pill shortens by the room left for it: a slot takes the
 * footer's free width, and `update.css` queries the slot. The full words, then `SHORT` (CSS draws it from
 * `data-short`), then a 22 px round 🎉 with the dot on its corner. The DOM text, the accessible name and the title
 * stay the full words at every width.
 */
import { useState } from 'react'
import type { UpdateState } from '@shared/types'
import './update.css'

const LABEL = 'New update ready'
/** The words in a narrower slot (YAZ-3401). `update.css` sets where they give way to the round 🎉. */
const SHORT = 'Update'

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
      <button type="button" className="update-pill" title="Click to see what's new" aria-label={LABEL} data-short={SHORT} onClick={open}>
        <span className="update-pill__emoji" aria-hidden="true">
          🎉
        </span>
        <span className="update-pill__label">{LABEL}</span>
        <span className={resting ? 'update-pill__dot' : 'update-pill__dot update-pill__dot--breathing'} aria-hidden="true" />
      </button>
    </div>
  )
}
