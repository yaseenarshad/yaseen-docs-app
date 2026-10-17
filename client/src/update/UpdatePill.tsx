/**
 * THE UPDATE PILL (YAZ-2976 D4): beside the cog in the sidebar footer, it says there is something
 * to see, and a click opens the "What's new" window (D5) that App mounts. Nothing while there is
 * nothing to act on: `idle`, and `downloading` (D6: the download is the app's business until the
 * new version is staged). The title names the version, because the label does not.
 */
import type { UpdateState } from '@shared/types'
import './update.css'

const LABEL = { ready: 'Update ready', manual: 'Update available', updated: "What's new" } as const

interface UpdatePillProps {
  update: UpdateState
  onOpen: () => void
}

export function UpdatePill({ update, onOpen }: UpdatePillProps) {
  if (update.kind === 'idle' || update.kind === 'downloading') return null
  return (
    <button type="button" className="update-pill" title={`Yaseen Docs ${update.version}`} onClick={onOpen}>
      {LABEL[update.kind]}
    </button>
  )
}
