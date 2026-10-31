/**
 * The one-line note (YAZ-3704 D6): how many outside changes the open note has, with **Next change** and
 * **Mark all checked**; after a rewrite or above the limit, "Whole note changed outside the app" with
 * **Dismiss**. The React surface of `outsideChanges.ts`, through the ONE channel the host also hands
 * `createCrepe`: it keeps no state of its own and renders the channel's snapshot. No count, no note.
 * `Editor.tsx` puts it where the conflict bar is and hides it while that bar shows. The words are neutral
 * ("outside"): the app cannot tell an AI's save from a sync pull or another app.
 */
import { useSyncExternalStore, type MouseEvent } from 'react'
import type { OutsideChangesChannel } from './outsideChangesChannel'
import './outsideChanges.css'

/** The buttons act on the list; the caret stays where the reader left it, in the note. */
const hold = (event: MouseEvent): void => event.preventDefault()

export function OutsideChangesBar({ channel }: { channel: OutsideChangesChannel }) {
  const { count, wholeNote } = useSyncExternalStore(channel.subscribe, channel.getState)
  if (!wholeNote && count === 0) return null
  return (
    <div className="outside-changes-bar" role="status">
      {wholeNote ? (
        <>
          <span>Whole note changed outside the app</span>
          <button type="button" onMouseDown={hold} onClick={() => channel.clear()}>
            Dismiss
          </button>
        </>
      ) : (
        <>
          <span>{count === 1 ? '1 outside change in this note' : `${count} outside changes in this note`}</span>
          <button type="button" onMouseDown={hold} onClick={() => channel.next()}>
            Next change
          </button>
          <button type="button" onMouseDown={hold} onClick={() => channel.clear()}>
            Mark all checked
          </button>
        </>
      )}
    </div>
  )
}
