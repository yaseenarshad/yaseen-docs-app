import { useEffect, useState } from 'react'
import type { SharedCardItem, SharedFolderItem } from '@shared/friendsApi'
import { useApp } from '../../app/AppState'
import { PHONE } from '../../store'
import { gistText } from './board'
import type { FriendsService } from './service'

const LAST_FOLDER_KEY = 'yaseendocs.friends.lastFolder'

export type AcceptTarget =
  | {
      kind: 'card'
      card: SharedCardItem
      skipMarkAccepted?: boolean
      loadAssets?: () => Promise<{ path: string; bytes: Uint8Array }[]>
    }
  | { kind: 'folder'; folder: SharedFolderItem }

/**
 * Accept sheet (D8): pick any existing folder in the vault (remembers last pick) OR 1-click "Put in Shared Cards",
 * plus optional "Move to Up next", committing via `githubRemote.commit()`.
 */
export function AcceptCardSheet({
  target,
  service,
  onClose,
  onDone,
}: {
  target: AcceptTarget
  service: FriendsService
  onClose: () => void
  onDone: (message: string) => void
}) {
  const app = useApp()
  const [folders, setFolders] = useState<string[]>([])
  const [dest, setDest] = useState<'shared' | 'pick'>('shared')
  const [picked, setPicked] = useState<string>('')
  const [upNext, setUpNext] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([
      service.vaultFolders?.() ?? Promise.resolve([]),
      app.services.store.getState<string>(PHONE, LAST_FOLDER_KEY).catch(() => undefined),
    ]).then(([list, last]) => {
      if (!live) return
      setFolders(list)
      if (typeof last === 'string' && last !== 'Shared Cards') setPicked(last)
    })
    return () => {
      live = false
    }
  }, [service, app.services.store])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const commit = async () => {
    if (busy) return
    const dir = dest === 'shared' ? 'Shared Cards' : picked
    setBusy(true)
    setError(null)
    try {
      await app.services.store.setState(PHONE, LAST_FOLDER_KEY, dir).catch(() => undefined)
      if (target.kind === 'card') {
        const assetFiles = target.loadAssets ? await target.loadAssets() : undefined
        const res = await service.acceptCardToVault?.({
          card: target.card,
          folder: dir,
          upNext,
          assetFiles,
          skipMarkAccepted: target.skipMarkAccepted,
        })
        if (!res?.ok) return setError(res?.error ?? 'Could not add card to vault.')
        onDone(`Added "${gistText(target.card.title, 60)}" to ${dir || 'Vault root'}.`)
      } else {
        const res = await service.importFolderToVault?.({ folder: target.folder, targetDir: dir, upNext })
        if (!res?.ok) return setError(res?.error ?? 'Could not import folder.')
        onDone(`Imported ${res.paths.length} ${res.paths.length === 1 ? 'card' : 'cards'} into ${dir ? `${dir}/${target.folder.name}` : target.folder.name}.`)
      }
    } finally {
      setBusy(false)
    }
  }

  const cardCount = target.kind === 'folder' ? target.folder.cards.filter((c) => c.status !== 'accepted').length || target.folder.cards.length : 1
  const heading = target.kind === 'card' ? 'Where should we save this card?' : `Where should we save these ${cardCount} cards?`
  const subtitle = target.kind === 'card' ? gistText(target.card.title, 80) : `📁 ${gistText(target.folder.name, 60)}`
  const primaryLabel =
    busy
      ? 'Saving…'
      : dest === 'shared'
      ? 'Add to Shared Cards'
      : `Add to ${picked || 'Vault root'}`

  return (
    <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="fr-modal-card" role="dialog" aria-modal="true" aria-label={heading}>
        <h2 className="fr-modal-card__title">{heading}</h2>
        <p className="fr-modal-card__hint">{subtitle}</p>
        <div className="fr-dest-list" role="radiogroup" aria-label="Destination folder">
          <label className={dest === 'shared' ? 'fr-dest-opt fr-dest-opt--active' : 'fr-dest-opt'}>
            <input type="radio" className="check" name="accept-dest" checked={dest === 'shared'} onChange={() => setDest('shared')} disabled={busy} />
            <span>
              <span className="fr-dest-opt__title">Shared Cards folder</span>
              <span className="fr-dest-opt__sub">Quick save to Shared Cards</span>
            </span>
          </label>
          <label className={dest === 'pick' ? 'fr-dest-opt fr-dest-opt--active' : 'fr-dest-opt'}>
            <input type="radio" className="check" name="accept-dest" checked={dest === 'pick'} onChange={() => setDest('pick')} disabled={busy} />
            <span>
              <span className="fr-dest-opt__title">Pick a vault folder</span>
              <span className="fr-dest-opt__sub">Save into any folder in your vault</span>
            </span>
          </label>
        </div>
        {dest === 'pick' && (
          <label className="field" style={{ marginBottom: 10 }}>
            <span className="field__label">Vault folder</span>
            <select aria-label="Vault folder" className="fr-modal-card__input" style={{ marginBottom: 0 }} value={picked} onChange={(e) => setPicked(e.target.value)} disabled={busy}>
              <option value="">Vault root</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="row" style={{ minHeight: 36, marginBottom: 12 }}>
          <input type="checkbox" className="check" checked={upNext} onChange={(e) => setUpNext(e.target.checked)} disabled={busy} />
          <span className="row__main">Move to Up next</span>
        </label>
        {error !== null && (
          <p className="fr-line" role="alert">
            {error}
          </p>
        )}
        <div className="fr-modal-card__actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} aria-busy={busy} onClick={() => void commit()}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
