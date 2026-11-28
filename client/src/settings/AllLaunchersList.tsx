/**
 * Settings › General › Vault apps › All vault & workspace apps (YAZ-6448 Decision 6, YAZ-6683).
 *
 * Lazy-loaded list of every registered vault app, workspace app, and
 * leftover `.app` bundle found on this Mac. Subscribes to
 * `api.vaultLauncher.onChanged` so creations, edits, and removals stay live.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { LauncherListItem, SidebarLens, VaultAppSidebarStart, VaultLauncherStatus, VaultLauncherTarget } from '@shared/types'
import { api } from '../api'

const VaultLauncherModal = lazy(() => import('./VaultLauncherModal').then((m) => ({ default: m.VaultLauncherModal })))

export interface AllLaunchersListProps {
  onChanged?: () => void
}

const SIDEBAR_TAB_LABELS: Record<SidebarLens, string> = {
  files: 'Files',
  focus: 'Focus',
  favorites: 'Favorites',
  sessions: 'Sessions',
  recents: 'Recents',
}

function kindLabel(kind: LauncherListItem['kind']): string {
  if (kind === 'workspace') return 'Workspace'
  if (kind === 'vault') return 'Vault'
  return 'Orphaned'
}

function targetBadgeLabel(target?: VaultLauncherTarget): string | null {
  if (target === 'today') return 'Today'
  if (target === 'inbox') return 'Cards Inbox'
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

function targetSummary(item: LauncherListItem): string {
  if (item.kind === 'workspace') return item.targetName
  if (item.kind === 'vault') return item.targetName !== item.id ? `${item.targetName} · ${item.id}` : item.id
  return item.vaultPath ?? item.targetName
}

function itemKey(item: LauncherListItem): string {
  return `${item.kind}:${item.id}:${item.appId ?? 'default'}`
}

interface EditingState {
  item: LauncherListItem
  status: VaultLauncherStatus
  recreating: boolean
}

export function AllLaunchersList({ onChanged }: AllLaunchersListProps) {
  const [items, setItems] = useState<LauncherListItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)

  const mountedRef = useRef(true)
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    if (typeof window.yaseenDocs?.vaultLauncher?.listAll !== 'function') {
      if (mountedRef.current) setItems([])
      return
    }
    const seq = ++loadSeqRef.current
    try {
      const list = await api.vaultLauncher.listAll()
      if (mountedRef.current && loadSeqRef.current === seq) {
        setItems(list)
      }
    } catch (err: unknown) {
      if (mountedRef.current && loadSeqRef.current === seq) {
        setError(err instanceof Error ? err.message : String(err))
        setItems((prev) => prev ?? [])
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    const off =
      typeof window.yaseenDocs?.vaultLauncher?.onChanged === 'function'
        ? api.vaultLauncher.onChanged(() => {
            void load()
          })
        : undefined
    return () => {
      mountedRef.current = false
      off?.()
    }
  }, [load])

  const handleEdit = async (item: LauncherListItem, recreating: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const status =
        item.kind === 'workspace'
          ? await api.vaultLauncher.workspaceStatus(item.id)
          : item.appId !== undefined
            ? await api.vaultLauncher.status(item.id, item.appId)
            : await api.vaultLauncher.status(item.id)
      if (!mountedRef.current) return
      setEditing({ item, status, recreating })
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleReveal = async (item: LauncherListItem): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (item.kind === 'orphan') {
        await api.shell.reveal({ path: item.appPath })
      } else if (item.kind === 'workspace') {
        await api.vaultLauncher.revealWorkspace(item.id)
      } else if (item.appId !== undefined) {
        await api.vaultLauncher.reveal(item.id, item.appId)
      } else {
        await api.vaultLauncher.reveal(item.id)
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
      void load()
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleTest = async (item: LauncherListItem): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (item.kind === 'workspace') {
        await api.vaultLauncher.testWorkspace(item.id)
      } else if (item.appId !== undefined) {
        await api.vaultLauncher.test(item.id, item.appId)
      } else {
        await api.vaultLauncher.test(item.id)
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
      void load()
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleRemove = async (item: LauncherListItem): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (item.kind === 'orphan') {
        await api.vaultLauncher.removeOrphan(item.appPath)
      } else if (item.kind === 'workspace') {
        await api.vaultLauncher.removeWorkspace(item.id)
      } else if (item.appId !== undefined) {
        await api.vaultLauncher.remove(item.id, item.appId)
      } else {
        await api.vaultLauncher.remove(item.id)
      }
      await load()
      onChanged?.()
    } catch (err: unknown) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <div className="all-launchers">
      {items === null ? (
        <p className="all-launchers__empty">Loading apps…</p>
      ) : items.length === 0 ? (
        <p className="all-launchers__empty">No vault or workspace apps created yet.</p>
      ) : (
        <ul className="all-launchers__list">
          {items.map((item) => {
            const targetBadge = item.kind === 'vault' ? targetBadgeLabel(item.target) : null
            const sidebarStartBadge = item.kind !== 'orphan' ? sidebarStartBadgeLabel(item.sidebarStart) : null
            const summary = targetSummary(item)
            return (
              <li
                key={itemKey(item)}
                className={`all-launchers__item${item.kind === 'orphan' ? ' all-launchers__item--orphan' : ''}${!item.exists ? ' all-launchers__item--missing' : ''}`}
              >
                <div className="all-launchers__summary">
                  {item.iconDataUrl !== null ? (
                    <img className="all-launchers__icon" src={item.iconDataUrl} alt="" width={36} height={36} />
                  ) : (
                    <span
                      className={`all-launchers__icon-fallback${item.kind === 'orphan' ? ' all-launchers__icon-fallback--orphan' : ''}`}
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="14" height="14" rx="3.5" />
                        <path d="M7.5 10h5M10 7.5v5" />
                      </svg>
                    </span>
                  )}
                  <div className="all-launchers__meta">
                    <div className="all-launchers__name-line">
                      <span className="all-launchers__name">{item.name}.app</span>
                      <span className={`all-launchers__badge all-launchers__badge--${item.kind}`}>
                        {kindLabel(item.kind)}
                      </span>
                      {targetBadge !== null && (
                        <span className="all-launchers__badge all-launchers__badge--target">{targetBadge}</span>
                      )}
                      {sidebarStartBadge !== null && (
                        <span className="all-launchers__badge all-launchers__badge--target">{sidebarStartBadge}</span>
                      )}
                      {!item.exists && <span className="all-launchers__missing-note">Missing in Finder</span>}
                    </div>
                    <span className="all-launchers__path" title={item.appPath}>
                      {item.appPath}
                    </span>
                    <span className="all-launchers__target" title={summary}>
                      {summary}
                    </span>
                  </div>
                </div>
                <div className="all-launchers__actions">
                  {item.kind === 'orphan' ? (
                    <>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleReveal(item)}>
                        Reveal
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove(item)}>
                        Remove
                      </button>
                    </>
                  ) : item.exists ? (
                    <>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleEdit(item, false)}>
                        Edit…
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleReveal(item)}>
                        Reveal
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleTest(item)}>
                        Test
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove(item)}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy}
                        onClick={() => void handleEdit(item, true)}
                      >
                        Recreate
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void handleRemove(item)}>
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {error !== null && (
        <p className="all-launchers__error" role="alert">
          {error}
        </p>
      )}

      {editing !== null && (
        <Suspense fallback={null}>
          <VaultLauncherModal
            root={editing.item.kind === 'vault' ? editing.item.id : undefined}
            workspaceId={editing.item.kind === 'workspace' ? editing.item.id : undefined}
            defaultName={editing.item.targetName || editing.item.name}
            initial={editing.status.launcher}
            initialIconDataUrl={editing.status.iconDataUrl}
            recreating={editing.recreating}
            onSaved={() => {
              setEditing(null)
              setError(null)
              void load()
              onChanged?.()
            }}
            onClose={() => setEditing(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
