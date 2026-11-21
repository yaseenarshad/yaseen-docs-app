import { useEffect, useState } from 'react'
import type { AutoSyncStatus } from '@shared/types'
import { api } from '../api'
import type { SettingsSyncCtx } from './SyncVaultControl'

/**
 * 3rd check when turning on Cards (YAZ-6190, D5): shown only when neither Docs App Sync nor
 * GitHub AutoSync syncs this vault. Educates the user on the two cloud sync paths and offers
 * 1-click setup for whichever option they prefer.
 */
export function CloudSyncSheet({
  autoSync,
  sync,
  onClose,
}: {
  autoSync: AutoSyncStatus
  sync?: SettingsSyncCtx
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const handleAutoSync = async () => {
    if (sync?.addToAutoSync === undefined) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const res = await sync.addToAutoSync()
      if (res.ok && res.method === 'deep-link') {
        onClose()
      } else if (res.ok) {
        setFeedback('Opened GitHub AutoSync. Click Add folder there to finish.')
      } else {
        setFeedback('Could not open GitHub AutoSync.')
      }
    } finally {
      setBusy(false)
    }
  }

  const [waitingSignIn, setWaitingSignIn] = useState(false)

  useEffect(() => {
    if (!waitingSignIn) return
    const gh = typeof window !== 'undefined' ? (window as unknown as { yaseenDocs?: { github?: { onAuthChanged?: unknown } } }).yaseenDocs?.github : undefined
    if (typeof gh?.onAuthChanged !== 'function') return
    return api.github.onAuthChanged((next) => {
      if (next.signedIn) {
        setWaitingSignIn(false)
        sync?.setEnabled(true)
        onClose()
      } else if (next.error !== undefined) {
        setWaitingSignIn(false)
        setFeedback(next.error)
      }
    })
  }, [waitingSignIn, sync, onClose])

  const handleBuiltInSync = async () => {
    setBusy(true)
    try {
      const gh = typeof window !== 'undefined' ? (window as unknown as { yaseenDocs?: { github?: { authStatus?: unknown; signIn?: unknown } } }).yaseenDocs?.github : undefined
      const auth = typeof gh?.authStatus === 'function' ? await api.github.authStatus().catch(() => null) : null
      if (auth !== null && !auth.signedIn && !auth.hasManualToken && typeof gh?.signIn === 'function') {
        await api.github.signIn()
        setWaitingSignIn(true)
        setFeedback('Finish signing in with GitHub in your browser — sync will turn on automatically.')
        return
      }
      sync?.setEnabled(true)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="confirm__backdrop" role="presentation" onClick={onClose}>
      <div
        className="confirm__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-sheet-title"
        data-testid="cloud-sync-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm__text" id="cloud-sync-sheet-title">
          <span className="confirm__title">Sync this vault to review on your phone?</span>
          Page IDs and Cards are now on. There are two ways to sync to GitHub: use <strong>Docs App Sync</strong> right here, or add this folder to <strong>GitHub AutoSync</strong> (a separate Mac app). Pick one so both do not sync the same folder.
        </p>
        {feedback !== null && (
          <p className="setting__hint" role="status">
            {feedback}
          </p>
        )}
        <div className="confirm__actions">
          {autoSync.installed && (
            <button type="button" className="confirm__btn confirm__btn--primary" disabled={busy} onClick={() => void handleAutoSync()}>
              Add to GitHub AutoSync
            </button>
          )}
          <button
            type="button"
            className={autoSync.installed ? 'confirm__btn' : 'confirm__btn confirm__btn--primary'}
            disabled={busy}
            onClick={() => void handleBuiltInSync()}
          >
            Use Docs App Sync
          </button>
          <button type="button" className="confirm__btn" disabled={busy} onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
