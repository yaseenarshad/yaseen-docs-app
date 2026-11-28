/**
 * Settings › General › Vault apps control (YAZ-5967, YAZ-6375, YAZ-6683).
 *
 * Shows the current vault or workspace's standalone macOS `.app` bundle(s) and actions:
 * - Unsupported (non-macOS): renders nothing.
 * - No app: "Make a vault app…" / "Make a workspace app…" button (or synced cross-Mac install card).
 * - Active app(s): stacked cards with icon preview, `<name>.app`, Primary badge (2+ apps),
 *   optional target & sidebarStart badges, Edit…, Reveal, Test, Remove, plus "+ Add another vault app…".
 * - Removed in Finder: clear notice with Recreate and Clear buttons.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import type { SidebarLens, VaultAppSidebarStart, VaultLauncherInfo, VaultLauncherStatus, VaultLauncherTarget } from '@shared/types'
import { api } from '../api'

const VaultLauncherModal = lazy(() => import('./VaultLauncherModal').then((m) => ({ default: m.VaultLauncherModal })))

export interface VaultLauncherControlProps {
  root?: string
  workspaceId?: string
  defaultName: string
  onChanged?: () => void
}

interface VaultAppItem {
  launcher: VaultLauncherInfo
  exists: boolean
  iconDataUrl: string | null
}

type ModalState =
  | { mode: 'create'; useSyncedPreset: boolean }
  | { mode: 'edit'; item: VaultAppItem; recreating: boolean }

const SIDEBAR_TAB_LABELS: Record<SidebarLens, string> = {
  files: 'Files',
  focus: 'Focus',
  favorites: 'Favorites',
  sessions: 'Sessions',
  recents: 'Recents',
}

function targetBadgeLabel(target?: VaultLauncherTarget): string | null {
  if (target === 'inbox') return 'Opens on Cards Inbox'
  if (target === 'today') return "Opens on Today's Daily Page"
  return null
}

function sidebarStartBadgeLabel(sidebarStart?: VaultAppSidebarStart): string | null {
  if (sidebarStart === undefined) return null
  const parts: string[] = [SIDEBAR_TAB_LABELS[sidebarStart.tab] ?? sidebarStart.tab]
  if (sidebarStart.folderPath !== undefined && sidebarStart.folderPath.length > 0) {
    parts.push(sidebarStart.folderPath)
  }
  if (sidebarStart.onlyFolder === true) {
    parts.push('Only')
  }
  return parts.join(' · ')
}

function resolveAppItems(status: VaultLauncherStatus, isWorkspace: boolean): VaultAppItem[] {
  if (!isWorkspace && status.launchers !== undefined) {
    return status.launchers
  }
  if (status.launcher !== null) {
    return [{ launcher: status.launcher, exists: status.exists, iconDataUrl: status.iconDataUrl }]
  }
  return []
}

export function VaultLauncherControl({ root, workspaceId, defaultName, onChanged }: VaultLauncherControlProps) {
  const isWorkspace = workspaceId !== undefined
  const [status, setStatus] = useState<VaultLauncherStatus | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
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

  const { synced = null, syncedIconDataUrl = null } = status
  const items = resolveAppItems(status, isWorkspace)
  const syncedTargetLabel = isWorkspace ? null : targetBadgeLabel(synced?.target)
  const hasExplicitDefault = items.some((entry) => entry.launcher.id === 'default')

  const handleRemove = async (appId?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await (isWorkspace
        ? api.vaultLauncher.removeWorkspace(workspaceId)
        : appId !== undefined
          ? api.vaultLauncher.remove(root!, appId)
          : api.vaultLauncher.remove(root!))
      setStatus((prev) => {
        if (prev === null) return null
        if (!isWorkspace && prev.launchers !== undefined) {
          const remaining = prev.launchers.filter((entry) => (appId !== undefined ? entry.launcher.id !== appId : false))
          const first = remaining[0] ?? null
          return {
            ...prev,
            launcher: first?.launcher ?? null,
            exists: first?.exists ?? false,
            iconDataUrl: first?.iconDataUrl ?? null,
            launchers: remaining,
          }
        }
        return {
          supported: true,
          launcher: null,
          exists: false,
          iconDataUrl: null,
          ...(prev.synced != null ? { synced: prev.synced, syncedIconDataUrl: prev.syncedIconDataUrl ?? null } : {}),
        }
      })
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
        throw new Error('Synced app icon image is unavailable.')
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
      const nextSynced = badgeToSave !== undefined ? { ...synced, badge: badgeToSave } : synced
      setStatus({ ...next, synced: nextSynced, syncedIconDataUrl })
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

  const refreshAfterMissing = async (err: unknown, appId?: string): Promise<void> => {
    try {
      const fresh = await (isWorkspace ? api.vaultLauncher.workspaceStatus(workspaceId) : api.vaultLauncher.status(root!))
      const freshItems = resolveAppItems(fresh, isWorkspace)
      const matched = appId !== undefined ? freshItems.find((entry) => entry.launcher.id === appId) : freshItems[0]
      if (!fresh.exists || (matched !== undefined && !matched.exists)) {
        setStatus(fresh)
        return
      }
    } catch {
      // Fall through to show the original action error.
    }
    setError(err instanceof Error ? err.message : String(err))
  }

  const handleReveal = async (appId?: string): Promise<void> => {
    setError(null)
    try {
      await (isWorkspace
        ? api.vaultLauncher.revealWorkspace(workspaceId)
        : appId !== undefined
          ? api.vaultLauncher.reveal(root!, appId)
          : api.vaultLauncher.reveal(root!))
    } catch (err: unknown) {
      await refreshAfterMissing(err, appId)
    }
  }

  const handleTest = async (appId?: string): Promise<void> => {
    setError(null)
    try {
      await (isWorkspace
        ? api.vaultLauncher.testWorkspace(workspaceId)
        : appId !== undefined
          ? api.vaultLauncher.test(root!, appId)
          : api.vaultLauncher.test(root!))
    } catch (err: unknown) {
      await refreshAfterMissing(err, appId)
    }
  }

  return (
    <div className="vault-launcher">
      <div className="vault-launcher__target-title">{isWorkspace ? `Workspace: ${defaultName}` : `Vault: ${defaultName}`}</div>
      {items.length === 0 ? (
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
                Add app to this Mac
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setModal({ mode: 'create', useSyncedPreset: true })}>
                Customize…
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void handleClearSynced()}>
                Clear synced icon
              </button>
            </div>
          </div>
        ) : (
          <div className="vault-launcher__empty">
            <button type="button" className="btn" onClick={() => setModal({ mode: 'create', useSyncedPreset: false })}>
              {isWorkspace ? 'Make a workspace app…' : 'Make a vault app…'}
            </button>
          </div>
        )
      ) : (
        <>
          {items.map((item, index) => {
            const key = item.launcher.id ?? item.launcher.appPath ?? String(index)
            const targetLabel = isWorkspace ? null : targetBadgeLabel(item.launcher.target)
            const sidebarStartLabel = sidebarStartBadgeLabel(item.launcher.sidebarStart)
            const isPrimary = !isWorkspace && items.length >= 2 && (hasExplicitDefault ? item.launcher.id === 'default' : index === 0)

            return item.exists ? (
              <div key={key} className="vault-launcher__card">
                <div className="vault-launcher__summary">
                  {item.iconDataUrl !== null && (
                    <img className="vault-launcher__icon" src={item.iconDataUrl} alt="" width={48} height={48} />
                  )}
                  <div className="vault-launcher__meta">
                    <div className="vault-launcher__name-line">
                      <span className="vault-launcher__name">{item.launcher.name}.app</span>
                      {isPrimary && <span className="all-launchers__badge all-launchers__badge--vault">Primary</span>}
                      {targetLabel !== null && <span className="vault-launcher__target">{targetLabel}</span>}
                      {sidebarStartLabel !== null && <span className="vault-launcher__target">{sidebarStartLabel}</span>}
                    </div>
                    <span className="vault-launcher__path" title={item.launcher.appPath}>{item.launcher.appPath}</span>
                  </div>
                </div>
                <div className="vault-launcher__actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => setModal({ mode: 'edit', item, recreating: false })}>
                    Edit…
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void handleReveal(item.launcher.id)}>
                    Reveal
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void handleTest(item.launcher.id)}>
                    Test
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove(item.launcher.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div key={key} className="vault-launcher__missing">
                {items.length >= 2 && (
                  <div className="vault-launcher__name-line">
                    <span className="vault-launcher__name">{item.launcher.name}.app</span>
                    {isPrimary && <span className="all-launchers__badge all-launchers__badge--vault">Primary</span>}
                  </div>
                )}
                <p className="vault-launcher__missing-text" role="status">
                  App was removed in Finder.
                </p>
                <div className="vault-launcher__actions">
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => setModal({ mode: 'edit', item, recreating: true })}>
                    Recreate
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove(item.launcher.id)}>
                    Clear
                  </button>
                </div>
              </div>
            )
          })}
          {!isWorkspace && (
            <div className="vault-launcher__actions">
              <button type="button" className="btn" disabled={busy} onClick={() => setModal({ mode: 'create', useSyncedPreset: false })}>
                + Add another vault app…
              </button>
            </div>
          )}
        </>
      )}

      {error !== null && (
        <p className="vault-launcher__error" role="alert">
          {error}
        </p>
      )}

      {modal !== null && (
        <Suspense fallback={null}>
          <VaultLauncherModal
            root={root}
            workspaceId={workspaceId}
            defaultName={defaultName}
            initial={modal.mode === 'edit' ? modal.item.launcher : null}
            preset={modal.mode === 'create' && modal.useSyncedPreset ? synced : null}
            initialIconDataUrl={
              modal.mode === 'edit'
                ? modal.item.iconDataUrl
                : modal.useSyncedPreset
                  ? syncedIconDataUrl
                  : null
            }
            recreating={modal.mode === 'edit' && modal.recreating}
            onSaved={(next) => {
              setStatus((prev) => ({
                ...next,
                ...(next.synced === undefined && prev?.synced != null
                  ? { synced: prev.synced, syncedIconDataUrl: prev.syncedIconDataUrl ?? null }
                  : {}),
              }))
              setModal(null)
              setError(null)
              onChanged?.()
            }}
            onClose={() => setModal(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
