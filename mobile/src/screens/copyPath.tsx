import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useOverlay } from '../app/browserHistory'
import { Toast, useToast } from './Toast'

/** The phone's clipboard. No clipboard at all (an old browser) throws here, and that is a "no" as well. */
const clipboard = (text: string) => navigator.clipboard.writeText(text)

/**
 * "Copy path", the ONE way for every place that has it (YAZ-5092 A3: the ID chip, the explore sheet's ⋯, the page's ⋯,
 * the folder's hold menu). The clipboard takes it: the app's one toast (`Toast`) says "Copied: <path>". The clipboard
 * says no: the path shows selected in a small dialog, to copy by hand (a path in a toast that fades cannot be copied).
 * `copyPath` says whether the clipboard took it. `layer` is the toast and the dialog: draw it once, where the caller is.
 */
export function useCopyPath(copy: (text: string) => Promise<void> = clipboard): { copyPath(path: string): Promise<boolean>; layer: ReactNode } {
  const [said, say] = useToast()
  const [byHand, setByHand] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  // YAZ-5092 D3: the by-hand dialog is an overlay of the app's one stack: a Back closes it, and the screen stays.
  useOverlay(byHand !== null, () => setByHand(null))
  useEffect(() => {
    if (byHand !== null) field.current?.select()
  }, [byHand])
  const copyPath = useCallback(
    async (path: string) => {
      try {
        await copy(path)
        setByHand(null)
        say(`Copied: ${path}`)
        return true
      } catch {
        // Sweep3 N-3 (YAZ-5524): one message at a time: the dialog takes the place of an earlier copy's toast.
        say(null)
        setByHand(path)
        return false
      }
    },
    [copy, say],
  )
  const layer = (
    <>
      {said !== null && <Toast text={said} />}
      {byHand !== null && (
        <div className="copy-by-hand" role="dialog" aria-label="Copy the path">
          <label>
            The phone could not copy. Copy the path by hand:
            <input ref={field} className="copy-by-hand__path" readOnly value={byHand} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="btn" onClick={() => setByHand(null)}>
            Close
          </button>
        </div>
      )}
    </>
  )
  return { copyPath, layer }
}
