/**
 * Desktop FriendsPane (YAZ-6220):
 * Full-parity Friends experience rendered in place inside CardInbox (toggled from CardInboxBar).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FriendBoardMember, FriendsBoardPayload, GroupBoardItem, SharedCardItem, SharedCardStatus, SharedFolderItem } from '@shared/friendsApi'
import {
  DAILY_MARK_SIGN,
  computeBuddyEmojis,
  dailyMarkOf,
  filterSharedCards,
  formatMinutes,
  periodTotals,
  sevenDayChain,
  smartMarkSuggestion,
  sortLeaderboard,
  type BoardPeriod,
  type BuddyEmoji,
  type LeaderboardRow,
  type LeaderboardSort,
} from '@shared/friendsBoard'
import { parseInviteInput } from '@shared/friendsShare'
import { qrCodeSvg } from '@shared/qrSvg'
import { api } from '../api'
import { AcceptCardSheet, type AcceptCardTarget } from './AcceptCardSheet'
import './friendsPane.css'

export interface FriendsPaneProps {
  vaultRoot: string
  onBack: () => void
  onNotice?: (message: string) => void
  onBoardLoaded?: (board: FriendsBoardPayload) => void
  pendingInvite?: { kind: 'friend' | 'group'; code: string } | null
  onClearPendingInvite?: () => void
}

const PERIODS: readonly { id: BoardPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const SORTS: readonly { id: LeaderboardSort; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'time', label: 'Time' },
  { id: 'streak', label: 'Streak' },
]

const CARD_FILTERS: readonly { id: SharedCardStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Added' },
  { id: 'dismissed', label: 'Dismissed' },
]

interface RowView extends LeaderboardRow {
  chain: ('done' | 'open' | 'missed')[]
  member?: FriendBoardMember
}

function Avatar({ name, url, big = false }: { name: string; url: string | null; big?: boolean }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <span className={`fr-av${big ? ' fr-av--big' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initial}
    </span>
  )
}

function SevenDayChain({ chain }: { chain: readonly ('done' | 'open' | 'missed')[] }) {
  return (
    <span className="fr-chain" aria-label="Last 7 days streak chain">
      {chain.map((state, idx) => (
        <span
          key={idx}
          className={`fr-chain__dot fr-chain__dot--${state}`}
          title={state === 'done' ? 'Finished' : state === 'open' ? 'Today (in progress)' : 'Missed'}
        />
      ))}
    </span>
  )
}

function BuddyEmojiList({ emojis }: { emojis: readonly BuddyEmoji[] }) {
  if (emojis.length === 0) return null
  return (
    <span className="fr-emojis">
      {emojis.map((e) => (
        <span key={e.label} role="img" aria-label={e.label} title={`${e.label}: ${e.reason}`}>
          {e.emoji}
        </span>
      ))}
    </span>
  )
}

function isSignedOutError(err: string): boolean {
  const low = err.toLowerCase()
  return low.includes('signed_out') || low.includes('no_token') || low.includes('no-token') || low.includes('401') || low.includes('unauthorized')
}

export function FriendsPane({ vaultRoot, onBack, onNotice, onBoardLoaded, pendingInvite, onClearPendingInvite }: FriendsPaneProps) {
  const [board, setBoard] = useState<FriendsBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [scope, setScope] = useState<'all' | string>('all')
  const [period, setPeriod] = useState<BoardPeriod>('today')
  const [sort, setSort] = useState<LeaderboardSort>('cards')
  const [groupTab, setGroupTab] = useState<'leaderboard' | 'cards'>('leaderboard')
  const [cardFilter, setCardFilter] = useState<SharedCardStatus>('pending')
  const [showDismissedIncoming, setShowDismissedIncoming] = useState(false)
  const [vsFriendId, setVsFriendId] = useState<number | null>(null)
  const [sentMarks, setSentMarks] = useState<Record<number, boolean>>({})
  const [toastMarks, setToastMarks] = useState<{ id: number; name: string; kind: 'cheer' | 'nudge'; message: string }[]>([])

  // Modals & sheets
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [myInvite, setMyInvite] = useState<{ code: string; link: string; expiresAt: string } | null>(null)
  const [inviteInput, setInviteInput] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupBusy, setNewGroupBusy] = useState(false)

  const [groupInviteModal, setGroupInviteModal] = useState<{ groupId: string; name: string; link: string; isAdmin: boolean } | null>(null)
  const [acceptTarget, setAcceptTarget] = useState<{ cards: AcceptCardTarget[]; folderId?: string | null; folderName?: string | null } | null>(null)
  const [lastDismissedCard, setLastDismissedCard] = useState<{ id: string; title: string } | null>(null)

  const nowMs = Date.now()

  const loadBoard = useCallback(
    async (force = false) => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.friends.board(force)
        if (!res.ok) {
          if (isSignedOutError(res.error)) {
            setSignedOut(true)
            setBoard(null)
          } else {
            setSignedOut(false)
            setError(res.error)
          }
          return
        }
        setSignedOut(false)
        setBoard(res.board)
        onBoardLoaded?.(res.board)

        // Quiet toast on incoming unseen Cheer/Nudge (Item 8)
        const unseen = res.board.friends.filter((f) => f.incomingMark && !f.incomingMark.seenAt)
        if (unseen.length > 0) {
          setToastMarks(
            unseen.map((f) => ({
              id: f.id,
              name: f.name,
              kind: f.incomingMark!.kind,
              message:
                f.incomingMark!.message ||
                (f.incomingMark!.kind === 'cheer' ? 'cheered your review!' : 'nudged you to review today!'),
            })),
          )
          void api.friends.markSeen(unseen.map((f) => f.id)).catch(() => undefined)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isSignedOutError(msg)) {
          setSignedOut(true)
          setBoard(null)
        } else {
          setError(msg)
        }
      } finally {
        setLoading(false)
      }
    },
    [onBoardLoaded],
  )

  useEffect(() => {
    void loadBoard(false)
  }, [loadBoard])

  // Handle deep-link invite (yaseendocs://friend#<code> or yaseendocs://group#<code>)
  useEffect(() => {
    if (!pendingInvite) return
    setInviteInput(pendingInvite.code)
    setAddModalOpen(true)
    onClearPendingInvite?.()
  }, [pendingInvite, onClearPendingInvite])

  const handleSignIn = async () => {
    if (signingIn) return
    setSigningIn(true)
    setError(null)
    try {
      const res = await api.github.signIn()
      if (res.signedIn) {
        setSignedOut(false)
        await loadBoard(true)
      } else {
        setError('GitHub sign-in did not complete.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setSigningIn(false)
    }
  }

  const openAddModal = async () => {
    setAddModalOpen(true)
    setInviteError(null)
    setCopiedLink(false)
    if (!myInvite && board) {
      const res = await api.friends.createInvite().catch(() => null)
      if (res?.ok) setMyInvite({ code: res.code, link: res.link, expiresAt: res.expiresAt })
    }
  }

  const handleAcceptInvite = async () => {
    const parsed = parseInviteInput(inviteInput)
    if (!parsed) {
      setInviteError('Paste a valid friend link, group link, or invite code.')
      return
    }
    setInviteBusy(true)
    setInviteError(null)
    try {
      const res = await api.friends.acceptInvite(parsed.code)
      if (!res.ok) {
        setInviteError(res.error)
        return
      }
      setInviteInput('')
      setAddModalOpen(false)
      onNotice?.('Invite accepted!')
      await loadBoard(true)
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not accept invite.')
    } finally {
      setInviteBusy(false)
    }
  }

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      // ignore clipboard errors in headless tests
    }
  }

  const handleSendMark = async (friend: FriendBoardMember) => {
    const suggestion = smartMarkSuggestion(friend, nowMs)
    setSentMarks((prev) => ({ ...prev, [friend.id]: true }))
    const res = await api.friends.sendMark(friend.id, suggestion.kind, suggestion.message).catch(() => ({ ok: false as const, error: 'Failed' }))
    if (res.ok) {
      onNotice?.(`${suggestion.kind === 'cheer' ? 'Cheered' : 'Nudged'} ${friend.name}`)
    } else {
      setSentMarks((prev) => ({ ...prev, [friend.id]: false }))
    }
  }

  const handleCreateGroup = async () => {
    const trimmed = newGroupName.trim()
    if (!trimmed || newGroupBusy) return
    setNewGroupBusy(true)
    try {
      const res = await api.friends.createGroup(trimmed)
      if (res.ok) {
        setNewGroupName('')
        setNewGroupOpen(false)
        setScope(res.id)
        onNotice?.(`Created group "${res.name}"`)
        await loadBoard(true)
      }
    } finally {
      setNewGroupBusy(false)
    }
  }

  const handleCardState = async (card: SharedCardItem, status: SharedCardStatus) => {
    const res = await api.friends.setCardState(card.id, status)
    if (res.ok) {
      if (status === 'dismissed') setLastDismissedCard({ id: card.id, title: card.title })
      if (status === 'pending' && lastDismissedCard?.id === card.id) setLastDismissedCard(null)
      await loadBoard(true)
    }
  }

  const handleFolderState = async (folder: SharedFolderItem, status: SharedCardStatus) => {
    const res = await api.friends.setFolderState(folder.id, status)
    if (res.ok) await loadBoard(true)
  }

  const activeGroup: GroupBoardItem | null = useMemo(
    () => (scope === 'all' || !board ? null : board.groups.find((g) => g.id === scope) ?? null),
    [scope, board],
  )

  const vsFriend: FriendBoardMember | null = useMemo(
    () => (vsFriendId === null || !board ? null : board.friends.find((f) => f.id === vsFriendId) ?? null),
    [vsFriendId, board],
  )

  const allFriendsRows: RowView[] = useMemo(() => {
    if (!board) return []
    const meTotals = periodTotals(board.me.stats, period, nowMs)
    const meRow: RowView = {
      id: board.me.id,
      login: board.me.login,
      name: board.me.nickname || board.me.name || 'You',
      avatarUrl: board.me.avatarUrl,
      isMe: true,
      mark: dailyMarkOf(board.me.stats, nowMs),
      cards: meTotals.cards,
      seconds: meTotals.seconds,
      streak: board.me.stats?.totals.streak ?? 0,
      sharedCardCount: 0,
      emojis: [],
      chain: sevenDayChain(board.me.stats, nowMs),
    }
    const friendRows: RowView[] = board.friends.map((f) => {
      const totals = periodTotals(f.stats, period, nowMs)
      return {
        id: f.id,
        login: f.login,
        name: f.name,
        avatarUrl: f.avatarUrl,
        isMe: false,
        mark: dailyMarkOf(f.stats, nowMs),
        cards: totals.cards,
        seconds: totals.seconds,
        streak: f.stats?.totals.streak ?? 0,
        sharedCardCount: f.sharedCardCount,
        emojis: computeBuddyEmojis(f, board.me, board.friends, nowMs),
        chain: sevenDayChain(f.stats, nowMs),
        member: f,
      }
    })
    return sortLeaderboard([meRow, ...friendRows], sort)
  }, [board, period, sort, nowMs])

  const groupRows: RowView[] = useMemo(() => {
    if (!board || !activeGroup) return []
    const friendById = new Map(board.friends.map((f) => [f.id, f]))
    const rows: RowView[] = activeGroup.members.map((m) => {
      const isMe = m.id === board.me.id
      const totals = periodTotals(m.stats, period, nowMs)
      const friend = friendById.get(m.id)
      return {
        id: m.id,
        login: m.login,
        name: isMe ? board.me.nickname || m.name : m.name,
        avatarUrl: m.avatarUrl,
        isMe,
        mark: dailyMarkOf(m.stats, nowMs),
        cards: totals.cards,
        seconds: totals.seconds,
        streak: m.stats?.totals.streak ?? 0,
        sharedCardCount: friend?.sharedCardCount ?? 0,
        emojis: friend ? computeBuddyEmojis(friend, board.me, board.friends, nowMs) : [],
        chain: sevenDayChain(m.stats, nowMs),
        member: friend,
      }
    })
    return sortLeaderboard(rows, sort)
  }, [board, activeGroup, period, sort, nowMs])

  const pendingIncoming = useMemo(() => filterSharedCards(board?.incomingCards ?? [], 'pending'), [board])
  const dismissedIncoming = useMemo(() => filterSharedCards(board?.incomingCards ?? [], 'dismissed'), [board])

  const renderLeaderboard = (rows: readonly RowView[]) => (
    <div className="fr-board" role="list" aria-label="Friends leaderboard">
      {rows.map((row, index) => {
        const friend = row.member
        const suggestion = friend ? smartMarkSuggestion(friend, nowMs) : null
        const alreadySent = friend ? sentMarks[friend.id] === true || friend.outgoingMark !== null : false
        return (
          <div key={row.id} className="fr-row" role="listitem" data-user-id={row.id}>
            <button
              type="button"
              className="fr-row__tap"
              disabled={row.isMe || !friend}
              onClick={() => friend && setVsFriendId(friend.id)}
            >
              <span className="fr-rank">{index + 1}</span>
              <span className={`fr-mark fr-mark--${row.mark}`} aria-label={row.mark}>
                {DAILY_MARK_SIGN[row.mark]}
              </span>
              <Avatar name={row.name} url={row.avatarUrl} />
              <div className="fr-who">
                <div className="fr-name-line">
                  <span className={`fr-name${row.isMe ? ' fr-name--you' : ''}`}>
                    {row.name}
                    {row.isMe ? ' (You)' : ''}
                  </span>
                  <BuddyEmojiList emojis={row.emojis} />
                </div>
                <div className="fr-sub">
                  <span>🔥 {row.streak}d</span>
                  <SevenDayChain chain={row.chain} />
                  <span>{formatMinutes(row.seconds)}</span>
                </div>
              </div>
              <div className="fr-nums">
                <span className="fr-hero-cards">
                  {row.cards}
                  <span className="fr-hero-unit">cards</span>
                </span>
              </div>
            </button>
            {friend && suggestion && (
              <button
                type="button"
                className="fr-mark-btn"
                disabled={alreadySent}
                onClick={() => void handleSendMark(friend)}
              >
                {alreadySent ? 'Sent ✓' : suggestion.buttonLabel}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="fr-pane" role="region" aria-label="Friends">
      <div className="fr-pane__head">
        <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={onBack}>
          ← Back to Review
        </button>
        <h2 className="fr-pane__title">Friends</h2>
        {board && (
          <>
            <button type="button" className="fr-btn fr-btn--primary fr-btn--sm" onClick={() => void openAddModal()}>
              + Add / Join
            </button>
            <button type="button" className="fr-btn fr-btn--sm" onClick={() => setNewGroupOpen((v) => !v)}>
              New group
            </button>
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Refresh Friends" onClick={() => void loadBoard(true)}>
              ↻
            </button>
          </>
        )}
      </div>

      {/* Quiet toast on incoming unseen Cheer/Nudge (Item 8) */}
      {toastMarks.length > 0 && (
        <div className="fr-toast" role="status">
          <span>
            {toastMarks.map((t) => `${t.name} ${t.message}`).join(' · ')}
          </span>
          <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={() => setToastMarks([])}>
            Dismiss
          </button>
        </div>
      )}

      {/* Reversible undo banner right after dismissing a card */}
      {lastDismissedCard && (
        <div className="fr-toast" role="status">
          <span>Dismissed "{lastDismissedCard.title}"</span>
          <button
            type="button"
            className="fr-btn fr-btn--sm"
            onClick={async () => {
              const id = lastDismissedCard.id
              setLastDismissedCard(null)
              const res = await api.friends.setCardState(id, 'pending')
              if (res.ok) await loadBoard(true)
            }}
          >
            Undo dismiss
          </button>
        </div>
      )}

      {/* Signed-out state (Item 4) */}
      {signedOut ? (
        <div className="fr-signed-out">
          <h3>Study with Friends</h3>
          <p>Sign in with GitHub to see your friends' daily streaks, cheer each other on, and share cards.</p>
          {error && <p className="fr-error">{error}</p>}
          <button type="button" className="fr-btn fr-btn--primary" disabled={signingIn} onClick={() => void handleSignIn()}>
            {signingIn ? 'Signing in…' : 'Sign in with GitHub'}
          </button>
        </div>
      ) : loading && !board ? (
        <p className="fr-line">Loading Friends…</p>
      ) : error && !board ? (
        <div className="fr-panel">
          <p className="fr-error">{error}</p>
          <button type="button" className="fr-btn" onClick={() => void loadBoard(true)}>
            Try again
          </button>
        </div>
      ) : board && vsFriend ? (
        /* ---- You vs Friend view ---- */
        <div className="fr-panel">
          <div className="fr-panel__head">
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={() => setVsFriendId(null)}>
              ← Back to leaderboard
            </button>
            <BuddyEmojiList emojis={computeBuddyEmojis(vsFriend, board.me, board.friends, nowMs)} />
          </div>

          <div className="fr-vs">
            <div className="fr-vs__col">
              <Avatar name={board.me.nickname || board.me.name} url={board.me.avatarUrl} big />
              <span className="fr-vs__who">You</span>
            </div>
            <span className="fr-vs__label">30-day match</span>
            <div className="fr-vs__col">
              <Avatar name={vsFriend.name} url={vsFriend.avatarUrl} big />
              <span className="fr-vs__who">{vsFriend.name}</span>
            </div>
          </div>

          {(() => {
            const my30 = periodTotals(board.me.stats, 'month', nowMs)
            const their30 = periodTotals(vsFriend.stats, 'month', nowMs)
            const suggestion = smartMarkSuggestion(vsFriend, nowMs)
            const alreadySent = sentMarks[vsFriend.id] === true || vsFriend.outgoingMark !== null
            return (
              <>
                <div className="fr-vs">
                  <b>{my30.cards}</b>
                  <span className="fr-vs__label">Cards (30d)</span>
                  <b>{their30.cards}</b>
                </div>
                <div className="fr-vs">
                  <b>{formatMinutes(my30.seconds)}</b>
                  <span className="fr-vs__label">Time (30d)</span>
                  <b>{formatMinutes(their30.seconds)}</b>
                </div>
                <div className="fr-vs">
                  <b>🔥 {board.me.stats?.totals.streak ?? 0}d</b>
                  <span className="fr-vs__label">Streak</span>
                  <b>🔥 {vsFriend.stats?.totals.streak ?? 0}d</b>
                </div>
                <div className="fr-vs">
                  <SevenDayChain chain={sevenDayChain(board.me.stats, nowMs)} />
                  <span className="fr-vs__label">Last 7 days</span>
                  <SevenDayChain chain={sevenDayChain(vsFriend.stats, nowMs)} />
                </div>

                <div className="fr-vs__shared">
                  {vsFriend.sharedCardCount} {vsFriend.sharedCardCount === 1 ? 'card' : 'cards'} shared together
                </div>

                <div className="fr-actions">
                  <button
                    type="button"
                    className="fr-btn fr-btn--primary"
                    disabled={alreadySent}
                    onClick={() => void handleSendMark(vsFriend)}
                  >
                    {alreadySent ? 'Sent ✓' : suggestion.buttonLabel}
                  </button>
                  <button
                    type="button"
                    className="fr-btn fr-btn--danger"
                    onClick={async () => {
                      const res = await api.friends.removeFriend(vsFriend.id, false)
                      if (res.ok) {
                        setVsFriendId(null)
                        await loadBoard(true)
                      }
                    }}
                  >
                    Remove friend
                  </button>
                </div>
              </>
            )
          })()}
        </div>
      ) : board ? (
        <>
          {/* Create group inline panel */}
          {newGroupOpen && (
            <div className="fr-panel">
              <div className="fr-panel__head">
                <h3 className="fr-panel__title">Create a study group</h3>
                <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={() => setNewGroupOpen(false)}>
                  Cancel
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="fr-input"
                  placeholder="Group name (e.g. Spanish 101)"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleCreateGroup()}
                />
                <button type="button" className="fr-btn fr-btn--primary" disabled={newGroupBusy || !newGroupName.trim()} onClick={() => void handleCreateGroup()}>
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Pinned Incoming cards (N) section at top for 1-on-1 shared cards (hidden when 0) */}
          {(pendingIncoming.length > 0 || (showDismissedIncoming && dismissedIncoming.length > 0)) && (
            <section className="fr-panel" aria-label="Incoming cards">
              <div className="fr-panel__head">
                <h3 className="fr-panel__title">Incoming cards ({pendingIncoming.length})</h3>
                {dismissedIncoming.length > 0 && (
                  <button
                    type="button"
                    className="fr-btn fr-btn--ghost fr-btn--sm"
                    onClick={() => setShowDismissedIncoming((v) => !v)}
                  >
                    {showDismissedIncoming ? 'Hide dismissed' : `Dismissed (${dismissedIncoming.length})`}
                  </button>
                )}
              </div>
              {pendingIncoming.map((card) => (
                <div key={card.id} className="fr-card-item">
                  <div className="fr-card-item__info">
                    <div className="fr-card-item__title">{card.title}</div>
                    <div className="fr-card-item__meta">
                      from @{card.senderLogin}
                      {card.note ? ` · "${card.note}"` : ''}
                    </div>
                  </div>
                  <div className="fr-card-item__actions">
                    <button
                      type="button"
                      className="fr-btn fr-btn--primary fr-btn--sm"
                      onClick={() =>
                        setAcceptTarget({
                          cards: [{ id: card.id, title: card.title, markdown: card.markdown, senderLogin: card.senderLogin }],
                        })
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="fr-btn fr-btn--ghost fr-btn--sm"
                      onClick={() => void handleCardState(card, 'dismissed')}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
              {showDismissedIncoming &&
                dismissedIncoming.map((card) => (
                  <div key={card.id} className="fr-card-item">
                    <div className="fr-card-item__info">
                      <div className="fr-card-item__title">{card.title}</div>
                      <div className="fr-card-item__meta">Dismissed · from @{card.senderLogin}</div>
                    </div>
                    <div className="fr-card-item__actions">
                      <button
                        type="button"
                        className="fr-btn fr-btn--sm"
                        onClick={() => void handleCardState(card, 'pending')}
                      >
                        Undo dismiss
                      </button>
                    </div>
                  </div>
                ))}
            </section>
          )}

          {/* Scope pills: All friends + Groups */}
          <div className="fr-lists" role="group" aria-label="Friends or group">
            <button
              type="button"
              className="fr-pill"
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              All friends ({board.friends.length})
            </button>
            {board.groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className="fr-pill"
                aria-pressed={scope === g.id}
                onClick={() => {
                  setScope(g.id)
                  setGroupTab('leaderboard')
                }}
              >
                {g.name}
                {g.isAdmin && g.pending.length > 0 ? ` (${g.pending.length})` : ''}
              </button>
            ))}
          </div>

          {activeGroup ? (
            /* ---- Group View ---- */
            <div>
              {/* Group Chain banner */}
              <div className="fr-group-banner">
                <div>
                  <strong>{activeGroup.name}</strong>
                  {' · '}
                  <span>
                    {groupRows.filter((r) => r.mark === 'finished').length} / {groupRows.length} finished today
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {activeGroup.inviteCode && (
                    <button
                      type="button"
                      className="fr-btn fr-btn--sm"
                      onClick={() =>
                        setGroupInviteModal({
                          groupId: activeGroup.id,
                          name: activeGroup.name,
                          link: `https://docs.yaseenarshad.com/group#${activeGroup.inviteCode}`,
                          isAdmin: activeGroup.isAdmin,
                        })
                      }
                    >
                      Invite
                    </button>
                  )}
                  <button
                    type="button"
                    className="fr-btn fr-btn--ghost fr-btn--danger fr-btn--sm"
                    onClick={async () => {
                      const res = await api.friends.removeMember(activeGroup.id)
                      if (res.ok) {
                        setScope('all')
                        await loadBoard(true)
                      }
                    }}
                  >
                    Leave
                  </button>
                </div>
              </div>

              {/* Admin pending approvals */}
              {activeGroup.isAdmin && activeGroup.pending.length > 0 && (
                <div className="fr-panel">
                  <div className="fr-panel__head">
                    <h3 className="fr-panel__title">Pending approvals ({activeGroup.pending.length})</h3>
                  </div>
                  {activeGroup.pending.map((p) => (
                    <div key={p.id} className="fr-card-item">
                      <div className="fr-card-item__info">
                        <div className="fr-card-item__title">{p.name}</div>
                        <div className="fr-card-item__meta">@{p.login}</div>
                      </div>
                      <div className="fr-card-item__actions">
                        <button
                          type="button"
                          className="fr-btn fr-btn--primary fr-btn--sm"
                          onClick={async () => {
                            const res = await api.friends.approveMember(activeGroup.id, p.id)
                            if (res.ok) await loadBoard(true)
                          }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="fr-btn fr-btn--ghost fr-btn--sm"
                          onClick={async () => {
                            const res = await api.friends.removeMember(activeGroup.id, p.id)
                            if (res.ok) await loadBoard(true)
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Group sub-tabs: Leaderboard | Shared Cards */}
              <div className="fr-seg" style={{ marginBottom: 12 }}>
                <button type="button" aria-pressed={groupTab === 'leaderboard'} onClick={() => setGroupTab('leaderboard')}>
                  Leaderboard
                </button>
                <button type="button" aria-pressed={groupTab === 'cards'} onClick={() => setGroupTab('cards')}>
                  Shared Cards ({filterSharedCards(activeGroup.sharedCards, 'pending').length + activeGroup.sharedFolders.reduce((acc, f) => acc + filterSharedCards(f.cards, 'pending').length, 0)})
                </button>
              </div>

              {groupTab === 'leaderboard' ? (
                <>
                  <div className="fr-controls">
                    <div className="fr-seg" role="group" aria-label="Period">
                      {PERIODS.map((p) => (
                        <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="fr-sort" role="group" aria-label="Sort leaderboard">
                      {SORTS.map((s) => (
                        <button key={s.id} type="button" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {renderLeaderboard(groupRows)}
                </>
              ) : (
                /* ---- Group Shared Cards tab ---- */
                <div>
                  <div className="fr-lists" role="group" aria-label="Shared card filter">
                    {CARD_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="fr-pill"
                        aria-pressed={cardFilter === f.id}
                        onClick={() => setCardFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Shared Folders (1-shot Import folder (N)) */}
                  {activeGroup.sharedFolders.map((folder) => {
                    const matching = filterSharedCards(folder.cards, cardFilter)
                    if (matching.length === 0) return null
                    return (
                      <div key={folder.id} className="fr-panel">
                        <div className="fr-panel__head">
                          <div>
                            <h3 className="fr-panel__title">📁 {folder.name}</h3>
                            <span className="fr-card-item__meta">
                              Shared by @{folder.senderLogin} · {matching.length} {matching.length === 1 ? 'card' : 'cards'}
                            </span>
                          </div>
                          <div className="fr-card-item__actions">
                            {cardFilter === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="fr-btn fr-btn--primary fr-btn--sm"
                                  onClick={() =>
                                    setAcceptTarget({
                                      folderId: folder.id,
                                      folderName: folder.name,
                                      cards: matching.map((c) => ({
                                        id: c.id,
                                        title: c.title,
                                        markdown: c.markdown,
                                        senderLogin: c.senderLogin,
                                      })),
                                    })
                                  }
                                >
                                  Import folder ({matching.length})
                                </button>
                                <button
                                  type="button"
                                  className="fr-btn fr-btn--ghost fr-btn--sm"
                                  onClick={() => void handleFolderState(folder, 'dismissed')}
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                            {cardFilter === 'dismissed' && (
                              <button
                                type="button"
                                className="fr-btn fr-btn--sm"
                                onClick={() => void handleFolderState(folder, 'pending')}
                              >
                                Undo dismiss
                              </button>
                            )}
                          </div>
                        </div>
                        {matching.map((card) => (
                          <div key={card.id} className="fr-card-item">
                            <div className="fr-card-item__info">
                              <div className="fr-card-item__title">{card.title}</div>
                              {card.note && <div className="fr-card-item__meta">"{card.note}"</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}

                  {/* Individual shared cards in group */}
                  {(() => {
                    const cards = filterSharedCards(activeGroup.sharedCards, cardFilter)
                    const folderHasAny = activeGroup.sharedFolders.some((f) => filterSharedCards(f.cards, cardFilter).length > 0)
                    if (cards.length === 0 && !folderHasAny) {
                      return <p className="fr-line">No {cardFilter === 'accepted' ? 'added' : cardFilter} cards in this group.</p>
                    }
                    return cards.map((card) => (
                      <div key={card.id} className="fr-card-item">
                        <div className="fr-card-item__info">
                          <div className="fr-card-item__title">{card.title}</div>
                          <div className="fr-card-item__meta">
                            from @{card.senderLogin}
                            {card.note ? ` · "${card.note}"` : ''}
                          </div>
                        </div>
                        <div className="fr-card-item__actions">
                          {cardFilter === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="fr-btn fr-btn--primary fr-btn--sm"
                                onClick={() =>
                                  setAcceptTarget({
                                    cards: [{ id: card.id, title: card.title, markdown: card.markdown, senderLogin: card.senderLogin }],
                                  })
                                }
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="fr-btn fr-btn--ghost fr-btn--sm"
                                onClick={() => void handleCardState(card, 'dismissed')}
                              >
                                Dismiss
                              </button>
                            </>
                          )}
                          {cardFilter === 'dismissed' && (
                            <button
                              type="button"
                              className="fr-btn fr-btn--sm"
                              onClick={() => void handleCardState(card, 'pending')}
                            >
                              Undo dismiss
                            </button>
                          )}
                          {card.senderId === board.me.id && (
                            <button
                              type="button"
                              className="fr-btn fr-btn--ghost fr-btn--danger fr-btn--sm"
                              onClick={async () => {
                                const res = await api.friends.deleteSharedCard(card.id)
                                if (res.ok) await loadBoard(true)
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          ) : (
            /* ---- All Friends Leaderboard ---- */
            <>
              <div className="fr-controls">
                <div className="fr-seg" role="group" aria-label="Period">
                  {PERIODS.map((p) => (
                    <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="fr-sort" role="group" aria-label="Sort leaderboard">
                  {SORTS.map((s) => (
                    <button key={s.id} type="button" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {board.friends.length === 0 ? (
                <div className="fr-panel">
                  <p className="fr-line">No friends yet. Share your invite link or QR code to add a study buddy!</p>
                  <button type="button" className="fr-btn fr-btn--primary" onClick={() => void openAddModal()}>
                    + Add friend or join group
                  </button>
                </div>
              ) : (
                renderLeaderboard(allFriendsRows)
              )}
            </>
          )}
        </>
      ) : null}

      {/* 1-step Add Friend / Join Group modal */}
      {addModalOpen && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setAddModalOpen(false)}>
          <div className="fr-modal" role="dialog" aria-modal="true" aria-label="Add friend or join group" onClick={(e) => e.stopPropagation()}>
            <div className="fr-modal__head">
              <h3 className="fr-modal__title">Add friend or join group</h3>
              <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={() => setAddModalOpen(false)}>
                ✕
              </button>
            </div>

            {myInvite && (
              <div style={{ marginBottom: 16 }}>
                <p className="fr-line">Share your invite link or scan the QR code:</p>
                <div className="fr-qr" dangerouslySetInnerHTML={{ __html: qrCodeSvg(myInvite.link) }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="text" className="fr-input" readOnly value={myInvite.link} aria-label="Your invite link" />
                  <button type="button" className="fr-btn" onClick={() => void handleCopyText(myInvite.link)}>
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div>
              <p className="fr-line">Or paste a friend / group invite link or code:</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="fr-input"
                  placeholder="https://docs.yaseenarshad.com/friend#…"
                  aria-label="Paste invite link or code"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleAcceptInvite()}
                />
                <button type="button" className="fr-btn fr-btn--primary" disabled={inviteBusy} onClick={() => void handleAcceptInvite()}>
                  {inviteBusy ? 'Joining…' : 'Join'}
                </button>
              </div>
              {inviteError && <p className="fr-error" role="alert">{inviteError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Group invite modal with QR & admin rotate */}
      {groupInviteModal && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setGroupInviteModal(null)}>
          <div className="fr-modal" role="dialog" aria-modal="true" aria-label={`Invite to ${groupInviteModal.name}`} onClick={(e) => e.stopPropagation()}>
            <div className="fr-modal__head">
              <h3 className="fr-modal__title">Invite to {groupInviteModal.name}</h3>
              <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={() => setGroupInviteModal(null)}>
                ✕
              </button>
            </div>
            <div className="fr-qr" dangerouslySetInnerHTML={{ __html: qrCodeSvg(groupInviteModal.link) }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" className="fr-input" readOnly value={groupInviteModal.link} aria-label="Group invite link" />
              <button type="button" className="fr-btn" onClick={() => void handleCopyText(groupInviteModal.link)}>
                {copiedLink ? 'Copied' : 'Copy'}
              </button>
            </div>
            {groupInviteModal.isAdmin && (
              <div className="fr-actions">
                <button
                  type="button"
                  className="fr-btn"
                  onClick={async () => {
                    const res = await api.friends.rotateGroupInvite(groupInviteModal.groupId)
                    if (res.ok) {
                      setGroupInviteModal((prev) => (prev ? { ...prev, link: res.link } : null))
                      await loadBoard(true)
                    }
                  }}
                >
                  Rotate invite link
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AcceptCardSheet (D8) */}
      {acceptTarget && (
        <AcceptCardSheet
          cards={acceptTarget.cards}
          folderId={acceptTarget.folderId}
          folderName={acceptTarget.folderName}
          vaultRoot={vaultRoot}
          onClose={() => setAcceptTarget(null)}
          onImported={async ({ dir, paths }) => {
            setAcceptTarget(null)
            onNotice?.(`Added ${paths.length} ${paths.length === 1 ? 'card' : 'cards'} to ${dir || 'Vault root'}`)
            await loadBoard(true)
          }}
        />
      )}
    </div>
  )
}
