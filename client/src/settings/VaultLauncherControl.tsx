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
import type { VaultLauncherInfo, VaultLauncherPreset, VaultLauncherStatus, VaultLauncherTarget } from '@shared/types'
import { api } from '../api'
import { sidebarStartBadgeLabel } from './vaultAppStartLabel'

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

interface SyncedAppItem {
  preset: VaultLauncherPreset
  iconDataUrl: string | null
}

type ModalState =
  | { mode: 'create'; syncedEntry: SyncedAppItem | null }
  | { mode: 'edit'; item: VaultAppItem; recreating: boolean }

function targetBadgeLabel(target?: VaultLauncherTarget): string | null {
  if (target === 'inbox') return 'Opens on Cards Inbox'
  if (target === 'today') return "Opens on Today's Daily Page"
  return null
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

function resolveSyncedItems(status: VaultLauncherStatus, isWorkspace: boolean): SyncedAppItem[] {
  if (!isWorkspace && status.syncedApps !== undefined && status.syncedApps.length > 0) {
    return status.syncedApps
  }
  if (status.synced != null) {
    return [{ preset: status.synced, iconDataUrl: status.syncedIconDataUrl ?? null }]
  }
  return []
}

function isPresetInstalled(preset: VaultLauncherPreset, installed: readonly VaultAppItem[]): boolean {
  const presetId = preset.id ?? 'default'
  const presetName = preset.name.trim().toLowerCase()
  return installed.some((item) => {
    const localId = item.launcher.id ?? 'default'
    if (localId === presetId) return true
    return item.launcher.name.trim().toLowerCase() === presetName
  })
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

  const items = resolveAppItems(status, isWorkspace)
  const allSynced = resolveSyncedItems(status, isWorkspace)
  const pendingSynced = isWorkspace
    ? (items.length === 0 ? allSynced : [])
    : allSynced.filter((entry) => !isPresetInstalled(entry.preset, items))
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
          let remaining: VaultAppItem[]
          if (appId !== undefined) {
            remaining = prev.launchers.filter((entry) => entry.launcher.id !== appId)
          } else {
            const defaultIdx = prev.launchers.findIndex((entry) => entry.launcher.id === 'default')
            const dropIdx = defaultIdx >= 0 ? defaultIdx : 0
            remaining = prev.launchers.filter((_, idx) => idx !== dropIdx)
          }
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
          ...(prev.syncedApps !== undefined ? { syncedApps: prev.syncedApps } : {}),
        }
      })
      onChanged?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const installOneSynced = async (entry: SyncedAppItem): Promise<VaultLauncherStatus> => {
    const { preset, iconDataUrl } = entry
    let pngDataUrl: string
    let badgeToSave = preset.badge
    if (preset.badge !== undefined) {
      const { enrichBadgeForSync, renderBadgeToPng } = await import('./VaultLauncherModal')
      badgeToSave = await enrichBadgeForSync(preset.badge)
      pngDataUrl = await renderBadgeToPng(badgeToSave)
    } else if (iconDataUrl !== null && iconDataUrl.startsWith('data:image/png;base64,')) {
      pngDataUrl = iconDataUrl
    } else {
      throw new Error('Synced app icon image is unavailable.')
    }
    const pngBase64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
    const resolvedPresetAppId = preset.id ?? (items.length > 0 ? 'default' : undefined)
    return isWorkspace
      ? api.vaultLauncher.createWorkspace({
          workspaceId,
          name: preset.name,
          pngBase64,
          ...(badgeToSave !== undefined ? { badge: badgeToSave } : {}),
          ...(preset.sidebarStart !== undefined ? { sidebarStart: preset.sidebarStart } : {}),
        })
      : api.vaultLauncher.create({
          root: root!,
          ...(resolvedPresetAppId !== undefined ? { appId: resolvedPresetAppId } : {}),
          name: preset.name,
          pngBase64,
          ...(preset.target !== undefined ? { target: preset.target } : {}),
          ...(badgeToSave !== undefined ? { badge: badgeToSave } : {}),
          ...(preset.sidebarStart !== undefined ? { sidebarStart: preset.sidebarStart } : {}),
        })
  }

  const handleInstallSynced = async (entry: SyncedAppItem): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await installOneSynced(entry)
      setStatus((prev) => ({
        ...next,
        ...(next.synced === undefined && prev?.synced != null
          ? { synced: prev.synced, syncedIconDataUrl: prev.syncedIconDataUrl ?? null }
          : {}),
        ...(next.syncedApps === undefined && prev?.syncedApps !== undefined
          ? { syncedApps: prev.syncedApps }
          : {}),
      }))
      onChanged?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleInstallAllSynced = async (): Promise<void> => {
    if (pendingSynced.length === 0) return
    setBusy(true)
    setError(null)
    let latest: VaultLauncherStatus | null = null
    try {
      for (const entry of pendingSynced) {
        latest = await installOneSynced(entry)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (latest !== null) {
        setStatus((prev) => ({
          ...latest!,
          ...(latest!.synced === undefined && prev?.synced != null
            ? { synced: prev.synced, syncedIconDataUrl: prev.syncedIconDataUrl ?? null }
            : {}),
          ...(latest!.syncedApps === undefined && prev?.syncedApps !== undefined
            ? { syncedApps: prev.syncedApps }
            : {}),
        }))
        onChanged?.()
      }
      setBusy(false)
    }
  }

  const handleClearSynced = async (appId?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const targetId = appId ?? 'default'
      const clearSingle = !isWorkspace && allSynced.length > 1
      await (isWorkspace
        ? api.vaultLauncher.clearSyncedWorkspace(workspaceId)
        : clearSingle
          ? api.vaultLauncher.clearSynced(root!, targetId)
          : api.vaultLauncher.clearSynced(root!))
      setStatus((prev) => {
        if (prev === null) return null
        if (clearSingle && prev.syncedApps !== undefined) {
          const remaining = prev.syncedApps.filter((e) => (e.preset.id ?? 'default') !== targetId)
          const first = remaining[0] ?? null
          return {
            ...prev,
            synced: first?.preset ?? null,
            syncedIconDataUrl: first?.iconDataUrl ?? null,
            syncedApps: remaining,
          }
        }
        return { ...prev, synced: null, syncedIconDataUrl: null, syncedApps: [] }
      })
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
      if (matched !== undefined ? !matched.exists : !fresh.exists) {
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

  const renderSyncedSection = () => {
    if (pendingSynced.length === 0) return null
    return (
      <>
        {!isWorkspace && pendingSynced.length >= 2 && (
          <div className="vault-launcher__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleInstallAllSynced()}>
              Install all {pendingSynced.length} synced apps
            </button>
          </div>
        )}
        {pendingSynced.map((entry, idx) => {
          const preset = entry.preset
          const targetLabel = isWorkspace ? null : targetBadgeLabel(preset.target)
          const startLabel = sidebarStartBadgeLabel(preset.sidebarStart)
          return (
            <div key={`synced:${preset.id ?? preset.name}:${idx}`} className="vault-launcher__card vault-launcher__card--synced">
              <div className="vault-launcher__summary">
                {entry.iconDataUrl !== null && (
                  <img className="vault-launcher__icon" src={entry.iconDataUrl} alt="" width={48} height={48} />
                )}
                <div className="vault-launcher__meta">
                  <div className="vault-launcher__name-line">
                    <span className="vault-launcher__name">{preset.name}.app</span>
                    {targetLabel !== null && <span className="vault-launcher__target">{targetLabel}</span>}
                    {startLabel !== null && <span className="vault-launcher__target">{startLabel}</span>}
                  </div>
                  <span className="vault-launcher__path">
                    Saved for this {isWorkspace ? 'workspace' : 'vault'} on another Mac — not installed on this Mac yet.
                  </span>
                </div>
              </div>
              <div className="vault-launcher__actions">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleInstallSynced(entry)}>
                  Add app to this Mac
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setModal({ mode: 'create', syncedEntry: entry })}>
                  Customize…
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void handleClearSynced(preset.id)}>
                  {allSynced.length > 1 ? 'Clear synced' : 'Clear synced icon'}
                </button>
              </div>
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="vault-launcher">
      <div className="vault-launcher__target-title">{isWorkspace ? `Workspace: ${defaultName}` : `Vault: ${defaultName}`}</div>
      {items.length === 0 ? (
        pendingSynced.length > 0 ? (
          renderSyncedSection()
        ) : (
          <div className="vault-launcher__empty">
            <button type="button" className="btn" onClick={() => setModal({ mode: 'create', syncedEntry: null })}>
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
                      {isPrimary && <span className="vault-launcher__badge">Primary</span>}
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
                    {isPrimary && <span className="vault-launcher__badge">Primary</span>}
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
          {renderSyncedSection()}
          {!isWorkspace && (
            <div className="vault-launcher__actions">
              <button type="button" className="btn" disabled={busy} onClick={() => setModal({ mode: 'create', syncedEntry: null })}>
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
            appId={
              !isWorkspace
                ? modal.mode === 'edit'
                  ? (modal.item.launcher.id ?? 'default')
                  : (modal.syncedEntry?.preset.id ?? (modal.syncedEntry !== null && items.length > 0 ? 'default' : undefined))
                : undefined
            }
            defaultName={defaultName}
            initial={modal.mode === 'edit' ? modal.item.launcher : null}
            preset={modal.mode === 'create' ? (modal.syncedEntry?.preset ?? null) : null}
            initialIconDataUrl={
              modal.mode === 'edit'
                ? modal.item.iconDataUrl
                : (modal.syncedEntry?.iconDataUrl ?? null)
            }
            recreating={modal.mode === 'edit' && modal.recreating}
            onSaved={(next) => {
              setStatus((prev) => ({
                ...next,
                ...(next.synced === undefined && prev?.synced != null
                  ? { synced: prev.synced, syncedIconDataUrl: prev.syncedIconDataUrl ?? null }
                  : {}),
                ...(next.syncedApps === undefined && prev?.syncedApps !== undefined
                  ? { syncedApps: prev.syncedApps }
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
