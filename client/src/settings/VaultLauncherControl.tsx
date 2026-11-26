/**
 * Settings › General › Vault app control (YAZ-5967, YAZ-6375).
 *
 * Shows the current vault's macOS `.app` launcher status and actions:
 * - Unsupported (non-macOS): renders nothing.
 * - No launcher: "Make a launcher…" button.
 * - Active launcher: icon preview, `<name>.app`, path, optional target badge, Edit…, Reveal, Test, Remove.
 * - Removed in Finder: clear notice with Recreate and Clear buttons.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import type { VaultLauncherStatus, VaultLauncherTarget } from '@shared/types'
import { api } from '../api'

const VaultLauncherModal = lazy(() => import('./VaultLauncherModal').then((m) => ({ default: m.VaultLauncherModal })))

export interface VaultLauncherControlProps {
  root?: string
  workspaceId?: string
  defaultName: string
  onChanged?: () => void
}

function targetBadgeLabel(target?: VaultLauncherTarget): string | null {
  if (target === 'inbox') return 'Opens on Cards Inbox'
  if (target === 'today') return "Opens on Today's Daily Page"
  return null
}

export function VaultLauncherControl({ root, workspaceId, defaultName, onChanged }: VaultLauncherControlProps) {
  const isWorkspace = workspaceId !== undefined
  const [status, setStatus] = useState<VaultLauncherStatus | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    const statusFn = isWorkspace ? window.yaseenDocs?.vaultLauncher?.workspaceStatus : window.yaseenDocs?.vaultLauncher?.status
    if (typeof statusFn !== 'function' || (!isWorkspace && root === undefined)) {
      setStatus({ supported: false, launcher: null, exists: false, iconDataUrl: null })
      return
    }
    let seq = 0
    const load = () => {
      const mySeq = ++seq
      const req = isWorkspace ? api.vaultLauncher.workspaceStatus(workspaceId) : api.vaultLauncher.status(root!)
      void req.then(
        (res) => {
          if (live && mySeq === seq) setStatus(res)
        },
        () => {
          if (live && mySeq === seq) setStatus({ supported: false, launcher: null, exists: false, iconDataUrl: null })
        },
      )
    }
    load()
    const off = typeof window.yaseenDocs?.vaultLauncher?.onChanged === 'function' ? api.vaultLauncher.onChanged(load) : undefined
    return () => {
      live = false
      off?.()
    }
  }, [isWorkspace, root, workspaceId])

  if (status === null || !status.supported) return null

  const { launcher, exists, iconDataUrl, synced = null, syncedIconDataUrl = null } = status
  const targetLabel = isWorkspace ? null : targetBadgeLabel(launcher?.target)
  const syncedTargetLabel = isWorkspace ? null : targetBadgeLabel(synced?.target)

  const handleRemove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await (isWorkspace ? api.vaultLauncher.removeWorkspace(workspaceId) : api.vaultLauncher.remove(root!))
      setStatus((prev) => ({
        supported: true,
        launcher: null,
        exists: false,
        iconDataUrl: null,
        ...(prev?.synced != null ? { synced: prev.synced, syncedIconDataUrl: prev.syncedIconDataUrl ?? null } : {}),
      }))
      onChanged?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleInstallSynced = async (): Promise<void> => {
    if (synced === null) return
    setBusy(true)
    setError(null)
    try {
      let pngDataUrl: string
      let badgeToSave = synced.badge
      if (synced.badge !== undefined) {
        const { enrichBadgeForSync, renderBadgeToPng } = await import('./VaultLauncherModal')
        badgeToSave = await enrichBadgeForSync(synced.badge)
        pngDataUrl = await renderBadgeToPng(badgeToSave)
      } else if (syncedIconDataUrl !== null && syncedIconDataUrl.startsWith('data:image/png;base64,')) {
        pngDataUrl = syncedIconDataUrl
      } else {
        throw new Error('Synced launcher icon image is unavailable.')
      }
      const pngBase64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
      const next = isWorkspace
        ? await api.vaultLauncher.createWorkspace({
            workspaceId,
            name: synced.name,
            pngBase64,
            ...(badgeToSave !== undefined ? { badge: badgeToSave } : {}),
          })
        : await api.vaultLauncher.create({
            root: root!,
            name: synced.name,
            pngBase64,
            ...(synced.target !== undefined ? { target: synced.target } : {}),
            ...(badgeToSave !== undefined ? { badge: badgeToSave } : {}),
          })
      setStatus({ ...next, synced, syncedIconDataUrl })
      onChanged?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleClearSynced = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await (isWorkspace ? api.vaultLauncher.clearSyncedWorkspace(workspaceId) : api.vaultLauncher.clearSynced(root!))
      setStatus((prev) => (prev === null ? null : { ...prev, synced: null, syncedIconDataUrl: null }))
      onChanged?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const refreshAfterMissing = async (err: unknown): Promise<void> => {
    try {
      const fresh = await (isWorkspace ? api.vaultLauncher.workspaceStatus(workspaceId) : api.vaultLauncher.status(root!))
      if (!fresh.exists) {
        setStatus(fresh)
        return
      }
    } catch {
      // Fall through to show the original action error.
    }
    setError(err instanceof Error ? err.message : String(err))
  }

  const handleReveal = async (): Promise<void> => {
    setError(null)
    try {
      await (isWorkspace ? api.vaultLauncher.revealWorkspace(workspaceId) : api.vaultLauncher.reveal(root!))
    } catch (err: unknown) {
      await refreshAfterMissing(err)
    }
  }

  const handleTest = async (): Promise<void> => {
    setError(null)
    try {
      await (isWorkspace ? api.vaultLauncher.testWorkspace(workspaceId) : api.vaultLauncher.test(root!))
    } catch (err: unknown) {
      await refreshAfterMissing(err)
    }
  }

  return (
    <div className="vault-launcher">
      <div className="vault-launcher__target-title">{isWorkspace ? `Workspace: ${defaultName}` : `Vault: ${defaultName}`}</div>
      {launcher === null ? (
        synced !== null ? (
          <div className="vault-launcher__card vault-launcher__card--synced">
            <div className="vault-launcher__summary">
              {syncedIconDataUrl !== null && (
                <img className="vault-launcher__icon" src={syncedIconDataUrl} alt="" width={48} height={48} />
              )}
              <div className="vault-launcher__meta">
                <div className="vault-launcher__name-line">
                  <span className="vault-launcher__name">{synced.name}.app</span>
                  {syncedTargetLabel !== null && <span className="vault-launcher__target">{syncedTargetLabel}</span>}
                </div>
                <span className="vault-launcher__path">
                  Saved for this {isWorkspace ? 'workspace' : 'vault'} on another Mac — not installed on this Mac yet.
                </span>
              </div>
            </div>
            <div className="vault-launcher__actions">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleInstallSynced()}>
                Add launcher to this Mac
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setModalOpen(true)}>
                Customize…
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void handleClearSynced()}>
                Clear synced icon
              </button>
            </div>
          </div>
        ) : (
          <div className="vault-launcher__empty">
            <button type="button" className="btn" onClick={() => setModalOpen(true)}>
              Make a launcher…
            </button>
          </div>
        )
      ) : exists ? (
        <div className="vault-launcher__card">
          <div className="vault-launcher__summary">
            {iconDataUrl !== null && (
              <img className="vault-launcher__icon" src={iconDataUrl} alt="" width={48} height={48} />
            )}
            <div className="vault-launcher__meta">
              <div className="vault-launcher__name-line">
                <span className="vault-launcher__name">{launcher.name}.app</span>
                {targetLabel !== null && <span className="vault-launcher__target">{targetLabel}</span>}
              </div>
              <span className="vault-launcher__path" title={launcher.appPath}>{launcher.appPath}</span>
            </div>
          </div>
          <div className="vault-launcher__actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setModalOpen(true)}>
              Edit…
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleReveal()}>
              Reveal
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleTest()}>
              Test
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove()}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="vault-launcher__missing">
          <p className="vault-launcher__missing-text" role="status">
            Launcher was removed in Finder.
          </p>
          <div className="vault-launcher__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => setModalOpen(true)}>
              Recreate
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove()}>
              Clear
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p className="vault-launcher__error" role="alert">
          {error}
        </p>
      )}

      {modalOpen && (
        <Suspense fallback={null}>
          <VaultLauncherModal
            root={root}
            workspaceId={workspaceId}
            defaultName={defaultName}
            initial={launcher}
            preset={launcher === null ? synced : null}
            initialIconDataUrl={launcher !== null ? iconDataUrl : syncedIconDataUrl}
            recreating={launcher !== null && !exists}
            onSaved={(next) => {
              setStatus(next)
              setModalOpen(false)
              setError(null)
              onChanged?.()
            }}
            onClose={() => setModalOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
