/**
 * AcceptCardSheet (YAZ-6220 D8):
 * Lets the user accept 1 shared card or 1-shot import a shared folder into ANY existing folder
 * in their real vault (remembering their last pick), OR click 1-click "Put in Shared Cards"
 * (creating `Shared Cards/` only when chosen), plus an optional "Move to Up next" checkbox.
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
}

export interface AcceptCardSheetProps {
  cards: AcceptCardTarget[]
  folderId?: string | null
  folderName?: string | null
  vaultRoot: string
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

export function AcceptCardSheet({ cards, folderId, folderName, vaultRoot, onImported, onClose }: AcceptCardSheetProps) {
  const [folders, setFolders] = useState<string[]>([])
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

  const runImport = async (opts: { dir: string; createFolder?: string; remember: boolean }) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const targetDir = opts.createFolder ? '' : opts.dir
      const res = await api.friends.importCards({
        root: vaultRoot,
        dir: targetDir,
        ...(opts.createFolder ? { createFolder: opts.createFolder } : {}),
        cards: cards.map((c) => ({
          id: c.id,
          title: c.title,
          markdown: c.markdown,
          senderLogin: c.senderLogin,
          upNext,
        })),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (opts.remember) writeLastDir(opts.dir)
      if (folderId) {
        await api.friends.setFolderState(folderId, 'accepted').catch(() => undefined)
      } else {
        await Promise.all(cards.map((c) => api.friends.setCardState(c.id, 'accepted').catch(() => undefined)))
      }
      onImported({
        dir: opts.createFolder ?? opts.dir,
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

  const heading = folderName
    ? `Import folder "${folderName}" (${cards.length})`
    : cards.length === 1
      ? `Accept "${cards[0].title}"`
      : `Accept ${cards.length} cards`

  return (
    <div className="fr-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="fr-modal" role="dialog" aria-modal="true" aria-label="Accept shared cards" onClick={(e) => e.stopPropagation()}>
        <div className="fr-modal__head">
          <h3 className="fr-modal__title">{heading}</h3>
          <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="fr-line">Choose where in your vault to save {cards.length === 1 ? 'this card' : `these ${cards.length} cards`}. A fresh review schedule starts automatically.</p>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--fr-muted)', marginBottom: 4 }}>Vault folder</span>
          <select
            className="fr-select"
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
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13 }}>
          <input type="checkbox" checked={upNext} disabled={busy} onChange={(e) => setUpNext(e.target.checked)} />
          <span>Move to Up next</span>
        </label>

        {error && <p className="fr-error" role="alert">{error}</p>}

        <div className="fr-actions" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="fr-btn fr-btn--primary"
            disabled={busy}
            onClick={() => void runImport({ dir: selectedDir, remember: true })}
          >
            {busy ? 'Importing…' : `Add to ${selectedDir || 'Vault root'}`}
          </button>
          <button
            type="button"
            className="fr-btn"
            disabled={busy}
            onClick={() => void runImport({ dir: '', createFolder: 'Shared Cards', remember: false })}
          >
            Put in Shared Cards
          </button>
          <button type="button" className="fr-btn fr-btn--ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
