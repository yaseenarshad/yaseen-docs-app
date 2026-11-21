import { useEffect, useState } from 'react'
import type { AddToAutoSyncResult, AutoSyncStatus, GithubAuthStatus, GithubInstalledRepo, GithubSyncStatus } from '@shared/types'
import { api } from '../api'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS } from './options'

export interface SettingsSyncCtx {
  status: GithubSyncStatus | null
  setEnabled: (enabled: boolean) => void
  autoSync?: AutoSyncStatus | null
  addToAutoSync?: () => Promise<AddToAutoSyncResult>
  openAutoSync?: () => void
  refreshAutoSync?: () => void
}

const PHONE_URL = 'https://docs.yaseenarshad.com'

/**
 * Per-vault sync switch plus GitHub AutoSync handoff, non-git repo picker, and phone review link
 * (YAZ-6190: D3, D4, Extras #1, #2, #4).
 */
export function SyncVaultControl({ root, sync }: { root?: string; sync: SettingsSyncCtx }) {
  const [auth, setAuth] = useState<GithubAuthStatus | null>(null)
  const [pickingRepo, setPickingRepo] = useState(false)
  const [repos, setRepos] = useState<GithubInstalledRepo[] | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectNote, setConnectNote] = useState<string | null>(null)
  const [autoSyncNote, setAutoSyncNote] = useState<string | null>(null)
  const [copiedPhone, setCopiedPhone] = useState(false)

  useEffect(() => {
    let live = true
    const hasBridge = typeof window !== 'undefined' && typeof (window as unknown as { yaseenDocs?: { github?: { authStatus?: unknown } } }).yaseenDocs?.github?.authStatus === 'function'
    if (hasBridge) {
      void api.github.authStatus().then((res) => live && setAuth(res), () => undefined)
    }
    const hasSub = typeof window !== 'undefined' && typeof (window as unknown as { yaseenDocs?: { github?: { onAuthChanged?: unknown } } }).yaseenDocs?.github?.onAuthChanged === 'function'
    const unsub = hasSub ? api.github.onAuthChanged((next) => live && setAuth(next)) : () => undefined
    return () => {
      live = false
      unsub()
    }
  }, [])

  const autoSync = sync.autoSync ?? null
  const blockedByAutoSync = autoSync?.vaultSynced === true
  const needsRepo = sync.status?.repo === undefined || sync.status.repo.remoteUrl === null
  const cloudSynced = sync.status?.enabled === true || blockedByAutoSync

  const openRepoPicker = async () => {
    if (typeof api.github.listRepos !== 'function') return
    setPickingRepo(true)
    setConnectNote(null)
    setRepos(null)
    try {
      setRepos(await api.github.listRepos())
    } catch {
      setRepos([])
      setConnectNote('Could not load your GitHub repositories. Try again.')
    }
  }

  const pickRepo = async (fullName: string) => {
    if (root === undefined || typeof api.github.connectRepo !== 'function') return
    setConnectBusy(true)
    setConnectNote(null)
    try {
      const res = await api.github.connectRepo(root, fullName)
      if (res.ok) {
        setPickingRepo(false)
        setConnectNote(`Connected to ${fullName}.`)
      } else {
        setConnectNote(res.error ?? 'Could not connect this folder to GitHub.')
      }
    } finally {
      setConnectBusy(false)
    }
  }

  const handleAddAutoSync = async () => {
    if (sync.addToAutoSync === undefined) return
    const res = await sync.addToAutoSync()
    if (res.ok && res.method === 'deep-link') setAutoSyncNote('Sent this folder to GitHub AutoSync.')
    else if (res.ok && res.method === 'opened-app') setAutoSyncNote('Opened GitHub AutoSync. Click Add folder there to finish.')
    else setAutoSyncNote('Could not open GitHub AutoSync.')
  }

  const copyPhoneLink = () => {
    void navigator.clipboard?.writeText(PHONE_URL)
    setCopiedPhone(true)
    setTimeout(() => setCopiedPhone(false), 2000)
  }

  return (
    <div className="sync-vault">
      <Segmented
        options={ON_OFF_OPTIONS}
        value={sync.status?.enabled === true}
        isOptionDisabled={(opt) => blockedByAutoSync && opt === true}
        onChange={(enabled) => {
          if (enabled && blockedByAutoSync) return
          sync.setEnabled(enabled)
        }}
        ariaLabel="Sync this vault to GitHub"
      />

      {/* Extra #2: block double-syncing when GitHub AutoSync already owns this vault. */}
      {blockedByAutoSync && (
        <div className="sync-vault__note" role="status" data-testid="autosync-active-note">
          <span>Synced by GitHub AutoSync. Keep Docs App Sync off so both do not clash.</span>
          <button type="button" className="settings__option" onClick={() => sync.openAutoSync?.()}>
            Open GitHub AutoSync
          </button>
        </div>
      )}

      {/* D3: GitHub AutoSync installed on this Mac, not syncing this folder yet. */}
      {autoSync?.installed === true && !blockedByAutoSync && (
        <div className="sync-vault__note" data-testid="autosync-available-note">
          <span>GitHub AutoSync is installed on this Mac.</span>
          <button type="button" className="settings__option" onClick={() => void handleAddAutoSync()}>
            Add to GitHub AutoSync
          </button>
        </div>
      )}
      {autoSyncNote !== null && <p className="setting__hint" role="status">{autoSyncNote}</p>}

      {/* Extra #1: connect a non-git or remote-less vault directly when signed in with GitHub. */}
      {!blockedByAutoSync && needsRepo && auth?.signedIn === true && root !== undefined && (
        <div className="sync-vault__connect">
          {!pickingRepo ? (
            <button type="button" className="settings__option" onClick={() => void openRepoPicker()} disabled={connectBusy}>
              Connect to a GitHub repo
            </button>
          ) : (
            <div className="sync-vault__repos" data-testid="connect-repo-picker">
              {repos === null ? (
                <p className="setting__hint">Loading your repositories…</p>
              ) : repos.length === 0 ? (
                <div className="settings__options">
                  <span className="setting__hint">No repositories allowed yet.</span>
                  <button type="button" className="settings__option" onClick={() => void api.github.manageRepos?.()}>
                    Choose repos on GitHub ↗
                  </button>
                </div>
              ) : (
                <div className="settings__options" role="group" aria-label="Choose a GitHub repository">
                  {repos.slice(0, 12).map((r) => (
                    <button key={r.fullName} type="button" className="settings__option" disabled={connectBusy} onClick={() => void pickRepo(r.fullName)}>
                      {r.fullName}
                    </button>
                  ))}
                  <button type="button" className="settings__option" onClick={() => setPickingRepo(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          {connectNote !== null && <p className="setting__hint" role="status">{connectNote}</p>}
        </div>
      )}

      {/* Extra #4: quiet phone review link once synced via either Docs App Sync or GitHub AutoSync. */}
      {cloudSynced && (
        <div className="sync-vault__note" data-testid="phone-sync-note">
          <span>Review on your phone: open docs.yaseenarshad.com and tap Sign in with GitHub.</span>
          <button type="button" className="settings__option" onClick={copyPhoneLink}>
            {copiedPhone ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  )
}
