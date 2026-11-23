import { useEffect, useState } from 'react'
import { sanitizeSharedCard } from '@shared/friendsShare'
import { useApp } from '../../app/AppState'
import { serviceOf } from './lazy'
import type { FriendsService } from './service'
import './friends.css'

export interface ShareCardSheetProps {
  title: string
  markdown: string
  kind?: 'card' | 'page'
  onClose: () => void
  onShared: (message: string) => void
}

/**
 * Centered modal for sharing a card or page with friends or a group via the D1 `shared_cards` pipeline.
 * Lazy-loaded from `pageCardMenu.tsx` and `PageTools.tsx` so it never enters the first-load bundle.
 */
export default function ShareCardSheet({ title, markdown, kind = 'card', onClose, onShared }: ShareCardSheetProps) {
  const app = useApp()
  const [service, setService] = useState<FriendsService | null>(null)
  const [friends, setFriends] = useState<{ id: number; name: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFriends, setSelectedFriends] = useState<number[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = serviceOf(app.services.friends)
    if (load === null) {
      setLoading(false)
      setError('Friends is not set up on this phone yet.')
      return
    }
    let live = true
    void load()
      .then(async (s) => {
        if (!live) return
        setService(s)
        const b = await s.board()
        if (!live) return
        if (b.kind === 'ok') {
          setFriends(
            b.friends
              .filter((f): f is typeof f & { userId: number } => typeof f.userId === 'number')
              .map((f) => ({ id: f.userId, name: f.name })),
          )
          setGroups((b.d1Groups ?? []).filter((g) => g.myStatus === 'active').map((g) => ({ id: g.id, name: g.name })))
        } else {
          setError('Could not load friends. Sign in and try again.')
        }
      })
      .catch(() => {
        if (live) setError('Could not load friends. Try again.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [app.services.friends])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const toggleFriend = (id: number) => {
    setSelectedGroup('')
    setSelectedFriends((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const noun = kind === 'page' ? 'page' : 'card'
  const heading = kind === 'page' ? 'Share page with friend or group' : 'Share with friend or group'

  const send = async () => {
    if (!service?.shareCards || busy) return
    if (!selectedGroup && selectedFriends.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const clean = sanitizeSharedCard(title, markdown, note)
      const res = await service.shareCards({
        ...(selectedGroup ? { groupId: selectedGroup } : { toUserIds: selectedFriends }),
        cards: [clean],
      })
      if (!res.ok) return setError(res.error)
      onShared(
        selectedGroup
          ? `Shared ${noun} with group`
          : `Shared ${noun} with ${selectedFriends.length} ${selectedFriends.length === 1 ? 'friend' : 'friends'}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const canSend = !busy && (selectedGroup !== '' || selectedFriends.length > 0)

  return (
    <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="fr-modal-card" role="dialog" aria-modal="true" aria-label={heading}>
        <h2 className="fr-modal-card__title">{heading}</h2>
        {title.trim() !== '' && <p className="fr-modal-card__hint">{title}</p>}
        {loading ? (
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Loading friends…
          </p>
        ) : friends.length === 0 && groups.length === 0 ? (
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Add a friend or group in the Friends tab first.
          </p>
        ) : (
          <>
            {friends.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {friends.map((f) => (
                  <label key={f.id} className="row" style={{ minHeight: 36 }}>
                    <input
                      type="checkbox"
                      className="check"
                      checked={selectedFriends.includes(f.id)}
                      onChange={() => toggleFriend(f.id)}
                      disabled={busy}
                    />
                    <span className="row__main">{f.name}</span>
                  </label>
                ))}
              </div>
            )}
            {groups.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {groups.map((g) => (
                  <label key={g.id} className="row" style={{ minHeight: 36 }}>
                    <input
                      type="radio"
                      className="check"
                      name="share-card-group"
                      checked={selectedGroup === g.id}
                      onChange={() => {
                        setSelectedFriends([])
                        setSelectedGroup(g.id)
                      }}
                      disabled={busy}
                    />
                    <span className="row__main">Group: {g.name}</span>
                  </label>
                ))}
              </div>
            )}
            <label className="field" style={{ marginBottom: 12 }}>
              <span className="field__label">Note (optional)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Why you're sharing this"
                disabled={busy}
              />
            </label>
          </>
        )}
        {error !== null && (
          <p className="fr-line" role="alert" style={{ marginBottom: 8 }}>
            {error}
          </p>
        )}
        <div className="fr-modal-card__actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {(friends.length > 0 || groups.length > 0) && (
            <button type="button" className="btn btn--primary" disabled={!canSend} aria-busy={busy} onClick={() => void send()}>
              {busy ? 'Sharing…' : 'Share'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
