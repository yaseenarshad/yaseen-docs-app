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
 */
import { useState } from 'react'
import type { UpdateState } from '@shared/types'
import './update.css'

const LABEL = { ready: 'New update ready', manual: 'New update ready', updated: "See what's new" } as const

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
    <button type="button" className="update-pill" title="Click to see what's new" onClick={open}>
      <span className="update-pill__emoji" aria-hidden="true">
        🎉
      </span>
      {LABEL[update.kind]}
      <span className={resting ? 'update-pill__dot' : 'update-pill__dot update-pill__dot--breathing'} aria-hidden="true" />
    </button>
  )
}
