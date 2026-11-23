/**
 * AcceptCardSheet (YAZ-6220 D8, YAZ-6259):
 * Centered modal letting the user save 1 shared card or 1-shot import a shared folder
 * either into `Shared Cards` (default) OR into ANY existing folder in their real vault
 * (remembering their last pick), plus an optional "Move to Up next" checkbox.
 */
import { useEffect, useState } from 'react'
import type { TreeNode } from '@shared/types'
import { api } from '../api'

export const LAST_IMPORT_DIR_KEY = 'friends:lastImportDir'

export interface AcceptCardTarget {
  id: string
  title: string
  markdown: string
  senderLogin: string
  attachments?: { name: string; mime: string; dataBase64: string }[]
}

export interface AcceptCardSheetProps {
  cards: AcceptCardTarget[]
  folderId?: string | null
  folderName?: string | null
  vaultRoot: string
  /** When true (e.g. importing from Browse deck), skips `setCardState`/`setFolderState` calls. */
  skipServerState?: boolean
  onImported: (result: { dir: string; paths: string[]; cardIds: string[]; folderId?: string | null }) => void
  onClose: () => void
}

function collectDirs(nodes: readonly TreeNode[], root: string): string[] {
  const out: string[] = []
  const prefix = root.endsWith('/') ? root : `${root}/`
  const walk = (list: readonly TreeNode[]) => {
    for (const n of list) {
      if (n.type !== 'dir') continue
      const rel = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.name
      if (rel) out.push(rel)
      walk(n.children)
    }
  }
  walk(nodes)
  return out.sort((a, b) => a.localeCompare(b))
}

function readLastDir(): string {
  try {
    return localStorage.getItem(LAST_IMPORT_DIR_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeLastDir(dir: string): void {
  try {
    localStorage.setItem(LAST_IMPORT_DIR_KEY, dir)
  } catch {
    // ignore storage errors
  }
}

export function AcceptCardSheet({ cards, folderId, folderName, vaultRoot, skipServerState = false, onImported, onClose }: AcceptCardSheetProps) {
  const [folders, setFolders] = useState<string[]>([])
  const [destination, setDestination] = useState<'shared' | 'pick'>('shared')
  const [selectedDir, setSelectedDir] = useState<string>(() => readLastDir())
  const [upNext, setUpNext] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    if (!vaultRoot || typeof api.tree !== 'function') return
    api.tree(vaultRoot).then(
      (res) => {
        if (!live) return
        const dirs = collectDirs(res.tree, res.root || vaultRoot)
        setFolders(dirs)
        setSelectedDir((prev) => (prev === '' || dirs.includes(prev) ? prev : ''))
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [vaultRoot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const useShared = destination === 'shared'
      const res = await api.friends.importCards({
        root: vaultRoot,
        dir: useShared ? '' : selectedDir,
        ...(useShared ? { createFolder: 'Shared Cards' } : {}),
        cards: cards.map((c) => ({
          id: c.id,
          title: c.title,
          markdown: c.markdown,
          senderLogin: c.senderLogin,
          upNext,
          ...(c.attachments && c.attachments.length > 0 ? { attachments: c.attachments } : {}),
        })),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (!useShared) writeLastDir(selectedDir)
      if (!skipServerState) {
        if (folderId) {
          await api.friends.setFolderState(folderId, 'accepted').catch(() => undefined)
        } else {
          await Promise.all(cards.map((c) => api.friends.setCardState(c.id, 'accepted').catch(() => undefined)))
        }
      }
      onImported({
        dir: useShared ? 'Shared Cards' : selectedDir,
        paths: res.paths,
        cardIds: cards.map((c) => c.id),
        folderId,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const heading = cards.length === 1 ? 'Where should we save this card?' : `Where should we save these ${cards.length} cards?`
  const subtitle = folderName
    ? `Folder: ${folderName}`
    : cards.length === 1
      ? cards[0].title
      : `${cards.length} shared cards`
  const primaryLabel = busy
    ? 'Adding…'
    : destination === 'shared'
      ? 'Add to Shared Cards'
      : `Add to ${selectedDir || 'Vault root'}`

  return (
    <div className="fr-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="fr-modal" role="dialog" aria-modal="true" aria-label="Accept shared cards" onClick={(e) => e.stopPropagation()}>
        <div className="fr-modal__head" style={{ marginBottom: 4 }}>
          <h3 className="fr-modal__title">{heading}</h3>
          <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="fr-line" style={{ marginTop: 0, marginBottom: 14 }}>{subtitle}</p>

        <div className="fr-dest-list" role="radiogroup" aria-label="Save destination">
          <label className={`fr-dest-option${destination === 'shared' ? ' fr-dest-option--active' : ''}`}>
            <input
              type="radio"
              name="accept-dest"
              checked={destination === 'shared'}
              disabled={busy}
              onChange={() => setDestination('shared')}
            />
            <div>
              <div className="fr-dest-option__title">Shared Cards folder</div>
              <div className="fr-dest-option__sub">Quick save to Shared Cards</div>
            </div>
          </label>

          <label className={`fr-dest-option${destination === 'pick' ? ' fr-dest-option--active' : ''}`}>
            <input
              type="radio"
              name="accept-dest"
              checked={destination === 'pick'}
              disabled={busy}
              onChange={() => setDestination('pick')}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fr-dest-option__title">Pick a vault folder</div>
              <div className="fr-dest-option__sub">Choose any existing folder in your vault</div>
              {destination === 'pick' && (
                <select
                  className="fr-select"
                  style={{ marginTop: 8 }}
                  aria-label="Vault folder"
                  value={selectedDir}
                  disabled={busy}
                  onChange={(e) => setSelectedDir(e.target.value)}
                >
                  <option value="">Vault root</option>
                  {folders.map((dir) => (
                    <option key={dir} value={dir}>
                      {dir}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4, fontSize: 13 }}>
          <input type="checkbox" checked={upNext} disabled={busy} onChange={(e) => setUpNext(e.target.checked)} />
          <span>Move to Up next</span>
        </label>

        {error && <p className="fr-error" role="alert">{error}</p>}

        <div className="fr-actions">
          <button type="button" className="fr-btn" style={{ flex: 1 }} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fr-btn fr-btn--primary"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
