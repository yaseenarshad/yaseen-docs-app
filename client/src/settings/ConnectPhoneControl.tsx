/**
 * "Connect your phone" (YAZ-5098; round 10, item 23): the row's "Show code" opens a dialog with this vault's code, for
 * the phone's "Add a vault › Scan a code". The click is the clear action the code needs: nothing asks main for a code
 * before it. The dialog is its own chunk, loaded on the click.
 */
import { lazy, Suspense, useState } from 'react'
import { useGithubTokenSaved } from './githubToken'

/** The code hides by itself after this many seconds (the brief: "It hides again after 60 seconds"). */
export const PHONE_CODE_SECONDS = 60

const ConnectPhoneSheet = lazy(() => import('./ConnectPhoneSheet'))

export function ConnectPhoneControl({ root }: { root: string }) {
  const saved = useGithubTokenSaved()
  const [open, setOpen] = useState(false)
  return (
    <>
      {saved === false && <p className="settings__key-status">Save a GitHub token above first.</p>}
      <div className="settings__options">
        <button type="button" className="settings__option" disabled={saved !== true} onClick={() => setOpen(true)}>
          Show code
        </button>
      </div>
      {open && (
        <Suspense fallback={null}>
          <ConnectPhoneSheet root={root} seconds={PHONE_CODE_SECONDS} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
