/**
 * THE UPDATE PILL (YAZ-2976 D4, D14): beside the cog in the sidebar footer, it says there is something
 * new, and a click opens the "What's new" sheet (D5) that App mounts. Nothing while there is nothing
 * to act on: `idle`, and `downloading` (D6: the download is the app's business until the new version
 * is staged).
 *
 * D14 (Yasin: "make it more like exciting", "no one cares about version numbers", "i like the solid
 * blue with something that keeps breathing"): a solid accent pill with a sparkle, the words "New update
 * for you" (or "See what's new" on the first launch after the swap), a pop when it appears, and a white
 * dot that breathes until the user opens the sheet for this version — then it rests, so it never nags.
 */
import { useState } from 'react'
import type { UpdateState } from '@shared/types'
import './update.css'

const LABEL = { ready: 'New update for you', manual: 'New update for you', updated: "See what's new" } as const

interface UpdatePillProps {
  update: UpdateState
  onOpen: () => void
}

/** A four-point sparkle and a small one: the "something new" mark, drawn in the pill's text colour. */
function Sparkle() {
  return (
    <svg className="update-pill__sparkle" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 2.5c.5 4.4 2.6 6.5 7 7-4.4.5-6.5 2.6-7 7-.5-4.4-2.6-6.5-7-7 4.4-.5 6.5-2.6 7-7Z" />
      <path d="M18.5 13.5c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5Z" />
    </svg>
  )
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
      <Sparkle />
      {LABEL[update.kind]}
      <span className={resting ? 'update-pill__dot' : 'update-pill__dot update-pill__dot--breathing'} aria-hidden="true" />
    </button>
  )
}
