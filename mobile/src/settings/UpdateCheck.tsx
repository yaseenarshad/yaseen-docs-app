import { useContext, useState, useSyncExternalStore } from 'react'
import { UpdateLine } from '../pwa/UpdateLine'
import type { CheckResult, Updates } from '../pwa/updates'
import { UpdatesContext } from '../pwa/updatesContext'
import { BUILD, buildName } from './buildInfo'

/** YAZ-5593: where the app runs from, and where it must be opened from when that host is gone. */
export const APP_HOST = 'docs.yaseenarshad.com'
export const NEWEST_WORDS = (build: string) => `You have the newest build (${build})`
export const UNREACHABLE_WORDS = `Can't reach the server. Open the app from ${APP_HOST}.`

/**
 * YAZ-5593, under the build's line at the top of Settings: the address the app runs from (`location.host`), and
 * "Check for updates". The check asks the host now and says one of: the newest build; "A new version is ready" with
 * Restart (the same line, the same holds as over the tabs: `safeMoment.ts`); or that the server cannot be reached
 * (no signal, or a host that no longer serves the app, like an old preview Home Screen app). It never restarts.
 */
export function UpdateCheck({ host = location.host }: { host?: string }) {
  const updates = useContext(UpdatesContext)
  return (
    <>
      <p className="muted settings__host">{host}</p>
      {updates?.checkNow && <CheckButton updates={updates} />}
    </>
  )
}

function CheckButton({ updates }: { updates: Updates }) {
  const ready = useSyncExternalStore(updates.subscribe, updates.ready, updates.ready)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)

  async function check() {
    if (checking) return
    setChecking(true)
    setResult(null)
    try {
      setResult(await updates.checkNow!())
    } catch {
      setResult('unreachable')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="settings__check">
      {/* Busy: the tap does nothing more; `aria-disabled` keeps the focus on the button (VoiceOver stays put). */}
      <button type="button" className="btn settings__check-button" aria-busy={checking} aria-disabled={checking} onClick={() => void check()}>
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
      {ready && <UpdateLine updates={updates} inline />}
      <div role="status">
        {!ready && (result === 'newest' || result === 'unreachable') && (
          <p className="muted settings__check-result">{result === 'newest' ? NEWEST_WORDS(buildName(BUILD)) : UNREACHABLE_WORDS}</p>
        )}
      </div>
    </div>
  )
}
