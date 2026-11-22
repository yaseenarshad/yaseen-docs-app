/**
 * ShareCardModal (YAZ-6220 D7, D10):
 * Opens from a card's `⋯` menu ("Share with friend or group…") to send a sanitized card
 * (IDs & review history stripped) to one or more friends or an active group.
 */
import { useEffect, useState } from 'react'
import type { FriendsBoardPayload } from '@shared/friendsApi'
import { MAX_SHARED_NOTE_CHARS, sanitizeSharedCard } from '@shared/friendsShare'
import { api } from '../api'
import './friendsPane.css'

export interface ShareCardModalProps {
  card: { title: string; markdown: string }
  kind?: 'card' | 'page'
  onShared: (summary: string) => void
  onClose: () => void
}

export function ShareCardModal({ card, kind = 'card', onShared, onClose }: ShareCardModalProps) {
  const [board, setBoard] = useState<FriendsBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [targetKind, setTargetKind] = useState<'friends' | 'group'>('friends')
  const [selectedFriends, setSelectedFriends] = useState<number[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let live = true
    api.friends.board(false).then(
      (res) => {
        if (!live) return
        setLoading(false)
        if (!res.ok) {
          setError(res.error === 'signed_out' ? 'Sign in with GitHub in Friends first.' : res.error)
          return
        }
        setBoard(res.board)
        const activeGroups = res.board.groups.filter((g) => g.myStatus === 'active')
        if (res.board.friends.length === 0 && activeGroups.length > 0) {
          setTargetKind('group')
          setSelectedGroupId(activeGroups[0].id)
        } else if (activeGroups.length > 0) {
          setSelectedGroupId(activeGroups[0].id)
        }
      },
      (err: unknown) => {
        if (!live) return
        setLoading(false)
        setError(err instanceof Error ? err.message : 'Could not load friends.')
      },
    )
    return () => {
      live = false
    }
  }, [])

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

  const activeGroups = (board?.groups ?? []).filter((g) => g.myStatus === 'active')
  const friends = board?.friends ?? []

  const toggleFriend = (id: number) => {
    setSelectedFriends((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const canSend =
    !sending &&
    board !== null &&
    (targetKind === 'group' ? selectedGroupId !== '' : selectedFriends.length > 0)

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const clean = sanitizeSharedCard(card.title, card.markdown, note)
      const res = await api.friends.shareCards({
        ...(targetKind === 'group' ? { groupId: selectedGroupId } : { toUserIds: selectedFriends }),
        cards: [clean],
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      const targetName =
        targetKind === 'group'
          ? activeGroups.find((g) => g.id === selectedGroupId)?.name ?? 'group'
          : selectedFriends.length === 1
            ? friends.find((f) => f.id === selectedFriends[0])?.name ?? 'friend'
            : `${selectedFriends.length} friends`
      onShared(`Shared "${clean.title}" with ${targetName}`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share card.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fr-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="fr-modal" role="dialog" aria-modal="true" aria-label={kind === 'page' ? 'Share page with friend or group' : 'Share card with friend or group'} onClick={(e) => e.stopPropagation()}>
        <div className="fr-modal__head">
          <h3 className="fr-modal__title">{kind === 'page' ? 'Share page' : 'Share card'}</h3>
          <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="fr-line">
          <strong>{card.title || (kind === 'page' ? 'Untitled page' : 'Untitled card')}</strong> · Review history and card IDs are stripped before sending.
        </p>

        {loading && <p className="fr-line">Loading friends…</p>}
        {error && <p className="fr-error" role="alert">{error}</p>}

        {!loading && board !== null && (
          <>
            {friends.length === 0 && activeGroups.length === 0 ? (
              <p className="fr-line">Add a friend or join a group in Friends first.</p>
            ) : (
              <>
                <div className="fr-seg" style={{ marginBottom: 10 }}>
                  <button type="button" aria-pressed={targetKind === 'friends'} onClick={() => setTargetKind('friends')}>
                    Friends ({friends.length})
                  </button>
                  <button type="button" aria-pressed={targetKind === 'group'} onClick={() => setTargetKind('group')}>
                    Groups ({activeGroups.length})
                  </button>
                </div>

                {targetKind === 'friends' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 180, overflowY: 'auto' }}>
                    {friends.length === 0 ? (
                      <p className="fr-line">No friends yet.</p>
                    ) : (
                      friends.map((f) => (
                        <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={selectedFriends.includes(f.id)}
                            onChange={() => toggleFriend(f.id)}
                          />
                          <span>{f.name}</span>
                          <span style={{ color: 'var(--fr-muted)', fontSize: 12 }}>@{f.login}</span>
                        </label>
                      ))
                    )}
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    {activeGroups.length === 0 ? (
                      <p className="fr-line">No active groups yet.</p>
                    ) : (
                      <select
                        className="fr-select"
                        aria-label="Choose group"
                        value={selectedGroupId}
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                      >
                        {activeGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.members.length} members)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--fr-muted)', marginBottom: 4 }}>Note (optional)</span>
                  <input
                    type="text"
                    className="fr-input"
                    maxLength={MAX_SHARED_NOTE_CHARS}
                    placeholder="Add a short note…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}

        <div className="fr-actions">
          <button type="button" className="fr-btn fr-btn--primary" disabled={!canSend} onClick={() => void handleSend()}>
            {sending ? 'Sharing…' : kind === 'page' ? 'Share page' : 'Share card'}
          </button>
          <button type="button" className="fr-btn fr-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
