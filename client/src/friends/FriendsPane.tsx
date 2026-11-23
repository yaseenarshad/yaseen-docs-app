/**
 * Desktop FriendsPane (YAZ-6220):
 * Full-parity Friends experience rendered in place inside CardInbox (toggled from CardInboxBar).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FriendBoardMember, FriendsBoardPayload, GroupBoardItem, SharedCardItem, SharedCardStatus, SharedFolderItem } from '@shared/friendsApi'
import type { FriendDay, FriendStats } from '@shared/friendStatsFormat'
import {
  average7Day,
  buildPeriodGoalHero,
  computeBuddyStreak,
  dailyMarkOf,
  filterSharedCards,
  localDayKey,
  periodConsistency,
  periodContext,
  periodTotals,
  sinceDayKey,
  type BoardPeriod,
  type LeaderboardRow,
} from '@shared/friendsBoard'
import { parseInviteInput } from '@shared/friendsShare'
import { qrCodeSvg } from '@shared/qrSvg'
import { api } from '../api'
import { renderCard } from '../editor/card/cardRender'
import { CardBand } from '../review/cardParts'
import { AcceptCardSheet, type AcceptCardTarget } from './AcceptCardSheet'
import { BrowseDeckModal } from './BrowseDeckModal'
import '../explore/explore.css'
import './friendsPane.css'

export interface FriendsPaneProps {
  vaultRoot: string
  onBack: () => void
  onNotice?: (message: string) => void
  onBoardLoaded?: (board: FriendsBoardPayload) => void
  pendingInvite?: {
    kind: 'friend' | 'group'
    code: string
    status?: 'accepted' | 'pending-auth' | 'error'
    result?: unknown
    error?: string
  } | null
  onClearPendingInvite?: () => void
}

/** Plain-English message for a D1 Friends invite API error code (YAZ-6372). */
export function friendlyInviteError(code: string): string {
  switch (code) {
    case 'invite_not_found':
      return 'This invite link is no longer valid. Ask for a new one.'
    case 'invite_expired':
      return 'This invite link has expired. Ask for a new one.'
    case 'self_invite':
    case 'cannot_add_self':
      return 'That is your own invite link.'
    case 'blocked':
      return 'Unable to accept this invite link.'
    case 'banned':
      return 'You cannot join this group.'
    case 'bad_code':
      return 'Paste a valid friend link, group link, or invite code.'
    case 'signed_out':
    case 'unauthorized':
      return 'Sign in with GitHub first to accept this invite.'
    case 'rate_limited':
      return 'Too many requests. Try again in a few minutes.'
    default:
      return /^[a-z0-9_]+$/i.test(code) ? 'Could not accept invite link. Try again.' : code
  }
}

/** Plain-English notice for a successful invite acceptance result (YAZ-6372). */
export function friendlyInviteSuccess(result: unknown): string {
  if (result && typeof result === 'object') {
    const r = result as { kind?: unknown; name?: unknown; alreadyMember?: unknown; alreadyFriends?: unknown }
    if (r.kind === 'group') {
      const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'group'
      return r.alreadyMember === true ? `You are already in ${name}.` : `Joined ${name}.`
    }
    if (r.kind === 'friend') {
      return r.alreadyFriends === true ? 'You are already friends.' : 'Friend added!'
    }
  }
  return 'Invite accepted!'
}

const PERIODS: readonly { id: BoardPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

const CARD_FILTERS: readonly { id: SharedCardStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Added' },
  { id: 'dismissed', label: 'Dismissed' },
]

interface RowView extends LeaderboardRow {
  finishedForPeriod: boolean
  statsAt: string | null
  member?: FriendBoardMember
}

/** Relative last-synced label for the Today tab (YAZ-6276): `now`, `15m ago`, `2h ago`, `3d ago`. */
function relativeSyncTime(iso: string | null, nowMs: number): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const mins = Math.max(0, Math.floor((nowMs - ms) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Full-viewport portal confetti burst dead-center on the Desktop window (zoom-independent, YAZ-6276). */
function FriendsConfettiPortal({ burstKey, onDone }: { burstKey: number; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return onDone()
    let cancelled = false
    let frame = 0
    void import('../review/confetti')
      .then(({ confettiPieces, stepPiece }) => {
        if (cancelled) return
        const w = window.innerWidth
        const h = window.innerHeight
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        ctx.scale(dpr, dpr)
        const pieces = confettiPieces(w / 2, h * 0.42)
        const LIFE = 2000
        let start: number | null = null
        let last = 0
        const tick = (now: number) => {
          if (cancelled) return
          if (start === null) start = last = now
          const t = now - start
          if (t >= LIFE) {
            onDone()
            return
          }
          const dt = Math.min(3, (now - last) / (1000 / 60))
          last = now
          const alpha = t < LIFE * 0.6 ? 1 : 1 - (t - LIFE * 0.6) / (LIFE * 0.4)
          ctx.clearRect(0, 0, w, h)
          for (const p of pieces) {
            stepPiece(p, dt)
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.spin)
            const face = Math.cos(p.flip)
            ctx.scale(1, Math.max(0.08, Math.abs(face)))
            ctx.globalAlpha = alpha * (face < 0 ? 0.8 : 1)
            ctx.fillStyle = p.colour
            const s = p.size
            if (p.shape === 'rect') ctx.fillRect(-s / 2, -s / 3, s, (s * 2) / 3)
            else if (p.shape === 'strip') ctx.fillRect(-s * 0.8, -s / 6, s * 1.6, s / 3)
            else if (p.shape === 'circle') {
              ctx.beginPath()
              ctx.arc(0, 0, s / 2.4, 0, Math.PI * 2)
              ctx.fill()
            } else {
              ctx.beginPath()
              ctx.moveTo(0, -s / 2)
              ctx.lineTo(s / 2, s / 2)
              ctx.lineTo(-s / 2, s / 2)
              ctx.closePath()
              ctx.fill()
            }
            ctx.restore()
          }
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      })
      .catch(() => onDone())
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [burstKey, onDone])
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9999 }}
    />,
    document.body,
  )
}

function finishedOnPeriod(
  stats: { days: readonly { day: string; cards: number; done: boolean }[] } | null,
  period: BoardPeriod,
  nowMs: number,
): boolean {
  if (period === 'week' || period === 'month' || !stats || stats.days.length === 0) return false
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const dt = new Date(nowMs)
  if (period === 'yesterday') dt.setDate(dt.getDate() - 1)
  const targetKey = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
  const day = stats.days.find((d) => d.day === targetKey)
  return day !== undefined && day.done === true && day.cards > 0
}

function sortTieredRows(rows: readonly RowView[], period: BoardPeriod): RowView[] {
  const useTier = period === 'today' || period === 'yesterday'
  return [...rows].sort((a, b) => {
    if (useTier && a.finishedForPeriod !== b.finishedForPeriod) {
      return a.finishedForPeriod ? -1 : 1
    }
    if (b.cards !== a.cards) return b.cards - a.cards
    return a.name.localeCompare(b.name)
  })
}

/** Formats study time per YAZ-6263: `< 60m` → `N min`, `>= 60m` → `Xhr Ymin` (or `Xhr` on exact hours). */
function formatStudyTime(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}hr` : `${h}hr ${rem}min`
}

/** Consecutive days both you and `friend` finished due cards (`done: true`), per YAZ-6268. */
function buddyStreakOf(
  meDays: readonly FriendDay[] | undefined,
  friend: FriendBoardMember,
  nowMs: number,
): number {
  if (typeof friend.buddyStreak === 'number') return friend.buddyStreak
  return computeBuddyStreak(meDays, friend.stats?.days, nowMs)
}

interface VsStatLine {
  label: string
  part?: boolean
  you: string
  them: string
  lead: 'you' | 'them' | 'both' | 'none'
}

function buildVsComparison(me: FriendStats | null, them: FriendStats | null, nowMs: number): { side: VsStatLine[]; vault: VsStatLine[] } {
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const keyAt = (offset: number) => {
    const dt = new Date(nowMs)
    dt.setDate(dt.getDate() - offset)
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
  }
  const today = keyAt(0)
  const yest = keyAt(1)
  const from30 = keyAt(29)

  const summarize = (s: FriendStats | null) => {
    if (!s) return null
    const dToday = s.days.find((d) => d.day === today)
    const dYest = s.days.find((d) => d.day === yest)
    const cardsToday = dToday?.cards ?? 0
    const newToday = dToday?.newCards ?? 0
    const dueToday = Math.max(0, cardsToday - newToday)
    const secondsToday = dToday?.seconds ?? 0
    const avg7 = average7Day(s, nowMs).cards
    const days30 = s.days.filter((d) => d.day >= from30 && d.day <= today)
    const rem = days30.reduce((acc, d) => acc + d.remembered, 0)
    const forg = days30.reduce((acc, d) => acc + d.forgot, 0)
    const rememberedPct = rem + forg > 0 ? Math.round((rem / (rem + forg)) * 100) : null
    const daysReviewed30 = days30.filter((d) => d.cards > 0).length
    return {
      cardsToday,
      dueToday,
      newToday,
      yesterday: dYest?.cards ?? 0,
      avg7,
      secondsToday,
      bestDay: s.totals.bestDay,
      streak: s.totals.streak,
      totalCards: s.totals.cards,
      inReview: s.totals.inReview,
      newLeft: s.totals.newLeft,
      rememberedPct,
      addedThisWeek: s.totals.addedThisWeek,
      daysReviewed30,
    }
  }

  const m = summarize(me)
  const t = summarize(them)

  const line = (
    label: string,
    a: number | null | undefined,
    b: number | null | undefined,
    opts?: { part?: boolean; fmt?: (n: number) => string; suffix?: string },
  ): VsStatLine => {
    const av = a ?? null
    const bv = b ?? null
    const fmt = (v: number | null) => (v === null ? '–' : opts?.fmt ? opts.fmt(v) : `${v}${opts?.suffix ?? ''}`)
    const lead: VsStatLine['lead'] =
      av === null || bv === null ? 'none' : av > bv ? 'you' : bv > av ? 'them' : 'both'
    return { label, part: opts?.part, you: fmt(av), them: fmt(bv), lead }
  }

  return {
    side: [
      line('cards today', m?.cardsToday, t?.cardsToday),
      line('due cards', m?.dueToday, t?.dueToday, { part: true }),
      line('new cards', m?.newToday, t?.newToday, { part: true }),
      line('yesterday', m?.yesterday, t?.yesterday),
      line('7 day average', m?.avg7, t?.avg7),
      line('minutes today', m?.secondsToday, t?.secondsToday, { fmt: formatStudyTime }),
      line('best day', m?.bestDay, t?.bestDay),
      line('streak', m?.streak, t?.streak, { suffix: 'd' }),
    ],
    vault: [
      line('total cards', m?.totalCards, t?.totalCards),
      line('in review', m?.inReview, t?.inReview),
      line('new cards left', m?.newLeft, t?.newLeft),
      line('remembered', m?.rememberedPct, t?.rememberedPct, { suffix: '%' }),
      line('added this week', m?.addedThisWeek, t?.addedThisWeek),
      line('days reviewed of 30', m?.daysReviewed30, t?.daysReviewed30),
    ],
  }
}

/** Auto-scrolls a 30-day horizontal strip to its right edge (Today) on mount. */
function scrollStripToRight(el: HTMLDivElement | null) {
  if (el) el.scrollLeft = el.scrollWidth
}

function Avatar({ name, url, big = false }: { name: string; url: string | null; big?: boolean }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <span className={`fr-av${big ? ' fr-av--big' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initial}
    </span>
  )
}

/** Renders a shared card's Markdown using the app's real Inbox/Explore `renderCard` engine. */
function RenderedCardBody({ markdown }: { markdown: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    el.appendChild(renderCard(markdown))
  }, [markdown])
  return <div ref={hostRef} className="card-inbox__body" />
}

function isSignedOutError(err: string): boolean {
  const low = err.toLowerCase()
  return low.includes('signed_out') || low.includes('no_token') || low.includes('no-token') || low.includes('401') || low.includes('unauthorized')
}

const BUDDY_REVEAL_KEY = 'yaseen-docs:friends-buddy-reveal'

function readRevealedToday(todayKey: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(BUDDY_REVEAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { day?: string; ids?: unknown }
    if (parsed.day !== todayKey || !Array.isArray(parsed.ids)) return {}
    const out: Record<string, boolean> = {}
    for (const id of parsed.ids) {
      if (typeof id === 'string' || typeof id === 'number') out[`${todayKey}:${id}`] = true
    }
    return out
  } catch {
    return {}
  }
}

function writeRevealedToday(todayKey: string, map: Record<string, boolean>): void {
  try {
    const prefix = `${todayKey}:`
    const ids = Object.keys(map)
      .filter((k) => k.startsWith(prefix) && map[k])
      .map((k) => k.slice(prefix.length))
    localStorage.setItem(BUDDY_REVEAL_KEY, JSON.stringify({ day: todayKey, ids }))
  } catch {
    // ignore storage errors
  }
}

export function FriendsPane({ vaultRoot, onBack, onNotice, onBoardLoaded, pendingInvite, onClearPendingInvite }: FriendsPaneProps) {
  const [board, setBoard] = useState<FriendsBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [scope, setScope] = useState<'all' | 'shared' | string>('all')
  const [period, setPeriod] = useState<BoardPeriod>('today')
  const [cardFilter, setCardFilter] = useState<SharedCardStatus>('pending')
  const [vsFriendId, setVsFriendId] = useState<number | null>(null)
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null)
  const [streakGroupId, setStreakGroupId] = useState<string | null>(null)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [revealedToday, setRevealedToday] = useState<Record<string, boolean>>(() => readRevealedToday(localDayKey(Date.now())))
  const [confettiKey, setConfettiKey] = useState(0)
  const [armedDismissId, setArmedDismissId] = useState<string | null>(null)
  const armedTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current)
    },
    [],
  )

  const armDismiss = (id: string) => {
    if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current)
    setArmedDismissId(id)
    armedTimerRef.current = window.setTimeout(() => {
      setArmedDismissId(null)
      armedTimerRef.current = null
    }, 3000)
  }

  const clearArmedDismiss = () => {
    if (armedTimerRef.current !== null) {
      window.clearTimeout(armedTimerRef.current)
      armedTimerRef.current = null
    }
    setArmedDismissId(null)
  }

  // Modals & sheets (StepUp-style + menu, QR Share sheet, Enter link, New group, Manage group)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [qrShareModal, setQrShareModal] = useState<{ title: string; link: string } | null>(null)
  const [enterLinkOpen, setEnterLinkOpen] = useState(false)
  const [myInvite, setMyInvite] = useState<{ code: string; link: string; expiresAt: string } | null>(null)
  const [inviteInput, setInviteInput] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupBusy, setNewGroupBusy] = useState(false)

  const [manageGroup, setManageGroup] = useState<GroupBoardItem | null>(null)
  const [confirmRemoveFriend, setConfirmRemoveFriend] = useState<FriendBoardMember | null>(null)
  const [removingFriend, setRemovingFriend] = useState(false)
  const [browseFriend, setBrowseFriend] = useState<FriendBoardMember | null>(null)
  const [previewCard, setPreviewCard] = useState<{ card: SharedCardItem; context?: string } | null>(null)
  const [acceptTarget, setAcceptTarget] = useState<{ cards: AcceptCardTarget[]; folderId?: string | null; folderName?: string | null } | null>(null)
  const [lastDismissedCard, setLastDismissedCard] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    const anyModal = Boolean(previewCard || confirmRemoveFriend || plusMenuOpen || qrShareModal || enterLinkOpen || newGroupOpen || manageGroup)
    if (!anyModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (confirmRemoveFriend) setConfirmRemoveFriend(null)
      else if (previewCard) setPreviewCard(null)
      else if (qrShareModal) setQrShareModal(null)
      else if (enterLinkOpen) setEnterLinkOpen(false)
      else if (newGroupOpen) setNewGroupOpen(false)
      else if (manageGroup) setManageGroup(null)
      else if (plusMenuOpen) setPlusMenuOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [previewCard, confirmRemoveFriend, plusMenuOpen, qrShareModal, enterLinkOpen, newGroupOpen, manageGroup])

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
    if (pendingInvite.status === 'accepted') {
      onNotice?.(friendlyInviteSuccess(pendingInvite.result))
      void loadBoard(true)
      onClearPendingInvite?.()
      return
    }
    if (pendingInvite.status === 'pending-auth') {
      onClearPendingInvite?.()
      return
    }
    if (pendingInvite.status === 'error') {
      onNotice?.(friendlyInviteError(pendingInvite.error ?? 'Could not accept invite link.'))
      onClearPendingInvite?.()
      return
    }
    setInviteInput(pendingInvite.code)
    setEnterLinkOpen(true)
    onClearPendingInvite?.()
  }, [pendingInvite, onClearPendingInvite, onNotice, loadBoard])

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

  const openFriendQrShare = async () => {
    setPlusMenuOpen(false)
    setCopiedLink(false)
    let inv = myInvite
    if (!inv && board) {
      const res = await api.friends.createInvite().catch(() => null)
      if (res?.ok) {
        inv = { code: res.code, link: res.link, expiresAt: res.expiresAt }
        setMyInvite(inv)
      }
    }
    if (inv) {
      setQrShareModal({ title: 'Share your unique friend link to add friends', link: inv.link })
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
        setInviteError(friendlyInviteError(res.error))
        return
      }
      setInviteInput('')
      setEnterLinkOpen(false)
      onNotice?.(friendlyInviteSuccess(res.result))
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
    () => (scope === 'all' || scope === 'shared' || !board ? null : board.groups.find((g) => g.id === scope) ?? null),
    [scope, board],
  )

  const settingsGroup: GroupBoardItem | null = useMemo(
    () => (settingsGroupId === null || !board ? null : board.groups.find((g) => g.id === settingsGroupId) ?? null),
    [settingsGroupId, board],
  )

  const streakGroup: GroupBoardItem | null = useMemo(
    () => (streakGroupId === null || !board ? null : board.groups.find((g) => g.id === streakGroupId) ?? null),
    [streakGroupId, board],
  )

  const handleRenameGroup = async (groupId: string, rawName: string) => {
    const next = rawName.trim()
    if (!next) return
    const res = await api.friends.renameGroup(groupId, next)
    if (!res.ok) {
      onNotice?.(res.error || 'Could not rename group')
      return
    }
    setGroupNameDraft(res.name)
    await loadBoard(true)
    onNotice?.(`Renamed group to "${res.name}"`)
  }

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
      finishedForPeriod: finishedOnPeriod(board.me.stats, period, nowMs),
      statsAt: board.me.statsAt,
      cards: meTotals.cards,
      seconds: meTotals.seconds,
      streak: board.me.stats?.totals.streak ?? 0,
      sharedCardCount: 0,
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
        finishedForPeriod: finishedOnPeriod(f.stats, period, nowMs),
        statsAt: f.statsAt,
        cards: totals.cards,
        seconds: totals.seconds,
        streak: f.stats?.totals.streak ?? 0,
        sharedCardCount: f.sharedCardCount,
        emojis: [],
        member: f,
      }
    })
    return sortTieredRows([meRow, ...friendRows], period)
  }, [board, period, nowMs])

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
        name: isMe ? board.me.nickname || board.me.name || m.name : m.name,
        avatarUrl: isMe ? board.me.avatarUrl ?? m.avatarUrl : m.avatarUrl ?? friend?.avatarUrl ?? null,
        isMe,
        mark: dailyMarkOf(m.stats, nowMs),
        finishedForPeriod: finishedOnPeriod(m.stats, period, nowMs),
        statsAt: m.statsAt ?? (isMe ? board.me.statsAt : friend?.statsAt ?? null),
        cards: totals.cards,
        seconds: totals.seconds,
        streak: m.stats?.totals.streak ?? 0,
        sharedCardCount: friend?.sharedCardCount ?? 0,
        emojis: [],
        member: friend,
      }
    })
    return sortTieredRows(rows, period)
  }, [board, activeGroup, period, nowMs])

  const totalPendingShared = useMemo(() => {
    if (!board) return 0
    const direct = filterSharedCards(board.incomingCards, 'pending').length
    const groupCards = board.groups.reduce(
      (sum, g) =>
        sum +
        filterSharedCards(g.sharedCards, 'pending').length +
        g.sharedFolders.reduce((fs, f) => fs + filterSharedCards(f.cards, 'pending').length, 0),
      0,
    )
    return direct + groupCards
  }, [board])

  const renderPeriodHero = () => {
    if (!board) return null
    const ctx = periodContext(period, nowMs)
    const meTotals = periodTotals(board.me.stats, period, nowMs)
    const meStreak = board.me.stats?.totals.streak ?? 0
    const dueLeft = board.me.stats?.totals.dueLeft ?? 0
    const streakText = meStreak === 1 ? '1-day streak' : `${meStreak}-day streak`

    let subHeading = ctx.rangeLabel
    let heroPrimary = ''
    let heroParen: string | null = null
    let heroDone = false
    const metaParts: string[] = []

    if (period === 'today') {
      const todayDone = finishedOnPeriod(board.me.stats, 'today', nowMs) || (dueLeft === 0 && meTotals.cards > 0)
      heroDone = todayDone
      heroPrimary = todayDone ? '🎉 Today complete' : dueLeft > 0 ? `${dueLeft} due left` : 'No cards due'
      metaParts.push(`${meTotals.cards.toLocaleString()} cards`, formatStudyTime(meTotals.seconds), streakText)
    } else if (period === 'yesterday') {
      subHeading = `Yesterday · ${ctx.rangeLabel}`
      const yestDone = finishedOnPeriod(board.me.stats, 'yesterday', nowMs)
      heroDone = yestDone
      heroPrimary = yestDone ? '🥇 Yesterday complete' : 'Not finished'
      metaParts.push(`${meTotals.cards.toLocaleString()} cards`, formatStudyTime(meTotals.seconds), streakText)
    } else {
      const goal = buildPeriodGoalHero(board.me.stats, period, meTotals.cards, formatStudyTime(meTotals.seconds), nowMs)
      subHeading = goal.line1
      heroDone = goal.heroDone
      heroPrimary = goal.heroPrimary
      heroParen = goal.heroParen
      metaParts.push(goal.line3)
    }

    return (
      <section className={heroDone ? 'fr-hero-card fr-hero-card--done' : 'fr-hero-card'} aria-label={ctx.heroTitle}>
        <div className="fr-seg" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="fr-hero-card__body">
          <div className="fr-hero-card__sub">{subHeading}</div>
          <div className={heroDone ? 'fr-hero-card__num fr-hero-card__num--done' : 'fr-hero-card__num'}>
            {heroPrimary}
            {heroParen && <span className="fr-hero-card__paren"> {heroParen}</span>}
          </div>
          <div className="fr-hero-card__meta">{metaParts.join(' · ')}</div>
        </div>
      </section>
    )
  }

  const renderLeaderboard = (rows: readonly RowView[], showBuddyStreak: boolean) => {
    const todayKey = localDayKey(nowMs)
    const myDoneToday = board ? dailyMarkOf(board.me.stats, nowMs) === 'finished' : false
    const orderedRows =
      period === 'week' || period === 'month'
        ? [...rows].sort((a, b) => {
            const sa = a.isMe ? board?.me.stats : a.member?.stats
            const sb = b.isMe ? board?.me.stats : b.member?.stats
            const ca = periodConsistency(sa, period, nowMs)
            const cb = periodConsistency(sb, period, nowMs)
            return cb.finishedDays - ca.finishedDays || b.cards - a.cards || a.name.localeCompare(b.name)
          })
        : rows
    return (
      <div className="fr-board" role="list" aria-label="Friends leaderboard">
        {orderedRows.map((row, rowIndex) => {
          const friend = row.member
          const rowStats = row.isMe ? board?.me.stats : friend?.stats
          const rowConsistency = period === 'week' || period === 'month' ? periodConsistency(rowStats, period, nowMs) : null
          const rowPerfect = rowConsistency !== null && rowConsistency.possibleDays > 0 && rowConsistency.finishedDays >= rowConsistency.possibleDays
          const rowBeatPrior =
            rowConsistency !== null &&
            rowConsistency.priorFinishedDays !== null &&
            rowConsistency.priorFinishedDays > 0 &&
            rowConsistency.finishedDays > rowConsistency.priorFinishedDays
          const priorBadgeLabel = period === 'week' ? 'Beat prev week' : 'Beat prev month'
          const priorSubLabel =
            rowConsistency && rowConsistency.priorFinishedDays !== null && rowConsistency.priorFinishedDays > 0
              ? `${period === 'week' ? 'Prev wk' : 'Prev mo'}: ${rowConsistency.priorFinishedDays}d`
              : null
          const buddyStreak = showBuddyStreak && !row.isMe && friend && board ? buddyStreakOf(board.me.stats?.days, friend, nowMs) : 0
          const bothDoneToday = myDoneToday && row.mark === 'finished'
          const revealKey = friend ? `${todayKey}:${friend.id}` : ''
          const isRevealed = revealKey !== '' && revealedToday[revealKey] === true
          const buddyTitle = `${buddyStreak} ${buddyStreak === 1 ? 'day' : 'days'} in a row you both finished your due cards`
          return (
            <div key={row.id} className="fr-row" role="listitem" data-user-id={row.id}>
              <div
                className="fr-row__tap"
                role={friend ? 'button' : undefined}
                tabIndex={friend ? 0 : undefined}
                onClick={() => {
                  if (!friend) return
                  setVsFriendId(friend.id)
                }}
                onKeyDown={(e) => {
                  if (!friend) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setVsFriendId(friend.id)
                  }
                }}
              >
                {period === 'today' || period === 'yesterday' ? (
                  <span className="fr-rank fr-rank--medal" aria-hidden="true">
                    {row.finishedForPeriod ? '🥇' : ''}
                  </span>
                ) : (
                  <span className="fr-rank" aria-hidden="true">
                    {rowIndex + 1}
                  </span>
                )}
                <Avatar name={row.name} url={row.avatarUrl} />
                <div className="fr-who">
                  <div className="fr-name-line">
                    <span className={`fr-name${row.isMe ? ' fr-name--you' : ''}`}>{row.name}</span>
                    {(period === 'week' || period === 'month') && rowBeatPrior && (
                      <span className="fr-cons-badge fr-cons-badge--beat">{priorBadgeLabel}</span>
                    )}
                    {(period === 'week' || period === 'month') && !rowBeatPrior && rowPerfect && (
                      <span className="fr-cons-badge fr-cons-badge--perfect">Perfect</span>
                    )}
                    {showBuddyStreak && !row.isMe && friend && buddyStreak > 0 && (period === 'today' || period === 'yesterday') && (
                      period === 'today' && bothDoneToday && !isRevealed ? (
                        <button
                          type="button"
                          className="fr-bell-btn fr-bell-btn--wiggle"
                          aria-label="You both finished today! Tap to reveal your buddy streak"
                          title="You both finished today! Click to reveal your buddy streak"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRevealedToday((prev) => {
                              const next = { ...prev, [revealKey]: true }
                              writeRevealedToday(todayKey, next)
                              return next
                            })
                            setConfettiKey((k) => k + 1)
                          }}
                        >
                          🔔
                        </button>
                      ) : (
                        <span
                          className={`fr-buddy-pill${period === 'today' && bothDoneToday ? ' fr-buddy-pill--pop' : period === 'today' ? ' fr-buddy-pill--pending' : ''}`}
                          title={buddyTitle}
                        >
                          🤝 {buddyStreak}d
                        </span>
                      )
                    )}
                  </div>
                  {period === 'today' && (() => {
                    const rel = relativeSyncTime(row.statsAt, nowMs)
                    return rel ? <div className="fr-sub">{rel}</div> : null
                  })()}
                </div>
                <div className="fr-nums">
                  {(period === 'week' || period === 'month') && rowConsistency !== null ? (
                    <>
                      <span className="fr-hero-cards">
                        {rowPerfect && (
                          <span className="fr-mark--finished" aria-label="Perfect period" style={{ marginRight: 5 }}>
                            ✓
                          </span>
                        )}
                        {rowConsistency.finishedDays} / {rowConsistency.possibleDays}
                        <span className="fr-hero-unit">{rowConsistency.possibleDays === 1 ? 'day' : 'days'}</span>
                      </span>
                      <span className="fr-nums__sub">
                        {priorSubLabel ? `${priorSubLabel} · ${row.cards.toLocaleString()} cards` : `${row.cards.toLocaleString()} cards`}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="fr-hero-cards">
                        {row.finishedForPeriod && (
                          <span className="fr-mark--finished" aria-label="Finished due cards" style={{ marginRight: 5 }}>
                            ✓
                          </span>
                        )}
                        {row.cards}
                        <span className="fr-hero-unit">cards</span>
                      </span>
                      <span className="fr-nums__sub">
                        {row.streak > 0 ? `${row.streak}d 🔥 · ` : ''}
                        {formatStudyTime(row.seconds)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="fr-pane" role="region" aria-label="Friends">
      <div className="fr-pane__content">
        <div className="fr-pane__head">
        <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={onBack}>
          ← Back to Review
        </button>
        <h2 className="fr-pane__title">Friends</h2>
        {board && (
          <>
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Refresh Friends" onClick={() => void loadBoard(true)}>
              ↻
            </button>
            <button
              type="button"
              className="fr-icon-btn"
              aria-label="Add or create"
              title="Add friends or create group"
              onClick={() => setPlusMenuOpen(true)}
            >
              +
            </button>
          </>
        )}
      </div>

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
          <p>Sign in with GitHub to see your friends' daily streaks, keep each other accountable, and share cards.</p>
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
      ) : board && streakGroup ? (
        /* ---- Group Streak 30-day detail view (Demo Round 20, YAZ-6270) ---- */
        <div className="fr-panel">
          <div className="fr-panel__head">
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={() => setStreakGroupId(null)}>
              ← {streakGroup.name}
            </button>
          </div>

          {(() => {
            const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            const pad2 = (n: number) => String(n).padStart(2, '0')
            const friendById = new Map(board.friends.map((f) => [f.id, f]))
            const members = streakGroup.members.map((m) => {
              const isMe = m.id === board.me.id
              const fr = friendById.get(m.id)
              const name = isMe ? board.me.nickname || board.me.name || m.name : m.name
              const avatarUrl = isMe ? board.me.avatarUrl ?? m.avatarUrl : m.avatarUrl ?? fr?.avatarUrl ?? null
              const daySet = new Set((m.stats?.days ?? []).map((d) => d.day))
              const doneSet = new Set((m.stats?.days ?? []).filter((d) => d.done).map((d) => d.day))
              const sinceDay = sinceDayKey(m.since)
              return { id: m.id, name, avatarUrl, daySet, doneSet, sinceDay }
            })
            const todayKey = localDayKey(nowMs)
            const floorDt = new Date(nowMs)
            floorDt.setDate(floorDt.getDate() - 29)
            const floor30 = `${floorDt.getFullYear()}-${pad2(floorDt.getMonth() + 1)}-${pad2(floorDt.getDate())}`
            const groupCreatedDay = sinceDayKey(streakGroup.createdAt)
            const memberSinceDays = members.map((m) => m.sinceDay).filter((s): s is string => s !== null)
            const earliestMemberSince = memberSinceDays.length > 0 ? memberSinceDays.reduce((a, b) => (a < b ? a : b)) : null
            const groupOriginDay = groupCreatedDay ?? earliestMemberSince
            const stripStart =
              groupOriginDay && groupOriginDay > floor30
                ? groupOriginDay > todayKey
                  ? todayKey
                  : groupOriginDay
                : floor30
            // Build days chronologically from stripStart -> todayKey (max 30 days)
            const days: {
              key: string
              isToday: boolean
              wk: string
              md: string
              allDone: boolean
              missedNames: string[]
            }[] = []
            for (let offset = 29; offset >= 0; offset--) {
              const dt = new Date(nowMs)
              dt.setDate(dt.getDate() - offset)
              const key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
              if (key < stripStart) continue
              // Only count members who had already joined on `key` for blaming / group completion
              const joinedOnDay = members.filter((m) => m.sinceDay === null || key >= m.sinceDay)
              const eligible = joinedOnDay.length > 0 ? joinedOnDay : members
              const missedNames = eligible
                .filter((m) => !m.doneSet.has(key) && m.daySet.has(key))
                .map((m) => m.name)
              const allDone = eligible.length > 0 && eligible.every((m) => m.doneSet.has(key))
              days.push({
                key,
                isToday: offset === 0,
                wk: DAY_LABELS[dt.getDay()],
                md: `${dt.getMonth() + 1}/${dt.getDate()}`,
                allDone,
                missedNames,
              })
            }
            const todayDay = days[days.length - 1]
            const explicitStreak = (streakGroup as GroupBoardItem & { groupStreak?: number }).groupStreak
            const computedStreak = (() => {
              if (members.length === 0 || days.length === 0) return 0
              let i = todayDay?.allDone ? days.length - 1 : days.length - 2
              let count = 0
              while (i >= 0 && days[i].allDone) {
                count++
                i--
              }
              return count
            })()
            const groupStreak = typeof explicitStreak === 'number' ? explicitStreak : computedStreak
            const newestFirst = [...days].reverse()
            const brokenDay = newestFirst.filter((d) => !d.isToday).find((d) => !d.allDone && d.missedNames.length > 0)
            const heroSub =
              groupStreak > 0
                ? `${groupStreak} ${groupStreak === 1 ? 'day' : 'days'} in a row everyone finished`
                : brokenDay
                  ? `Last broken on ${brokenDay.wk} ${brokenDay.md} by ${brokenDay.missedNames.join(', ')}`
                  : 'Finish today to start a group streak'

            return (
              <>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                  <span className="fr-hype-pill" style={{ marginBottom: 4 }}>
                    🔥 {groupStreak}d group streak
                  </span>
                  <p className="fr-buddy-sub">
                    {heroSub}
                    {groupStreak > 0 && brokenDay && (
                      <span> · Last broken {brokenDay.wk} {brokenDay.md} by {brokenDay.missedNames.join(', ')}</span>
                    )}
                  </p>
                </div>

                {/* Horizontally scrollable strip (chronological left -> right, auto-scrolled to Today on right) */}
                <div ref={scrollStripToRight} className="fr-strip30" aria-label="Group 30-day history">
                  {days.map((d) => {
                    const sortedMembers = [...members].sort((a, b) => {
                      const ad = a.doneSet.has(d.key) ? 0 : 1
                      const bd = b.doneSet.has(d.key) ? 0 : 1
                      return ad - bd
                    })
                    return (
                      <div key={d.key} className={`fr-day30${d.allDone ? ' fr-day30--all' : ''}`}>
                        <span className="fr-day__wk">{d.wk}</span>
                        <span className="fr-day__date">{d.md}</span>
                        <div className="fr-day30__avs">
                          {sortedMembers.map((m) => {
                            const beforeJoin = m.sinceDay !== null && d.key < m.sinceDay
                            const hasDayEntry = m.daySet.has(d.key)
                            const done = !beforeJoin && m.doneSet.has(d.key)
                            const missed = !beforeJoin && hasDayEntry && !done && !d.isToday
                            const statusTitle = done
                              ? 'finished'
                              : d.isToday
                                ? 'in progress today'
                                : beforeJoin
                                  ? 'joined later'
                                  : !hasDayEntry
                                    ? 'no data yet'
                                    : 'missed'
                            return (
                              <span
                                key={m.id}
                                className={`fr-ring-av fr-ring-av--lg${missed ? ' fr-ring-av--missed' : ''}`}
                                title={`${m.name}: ${statusTitle}`}
                              >
                                {m.avatarUrl ? <img src={m.avatarUrl} alt={m.name} /> : (m.name[0] ?? '?').toUpperCase()}
                                {(done || missed) && (
                                  <span
                                    className={`fr-ring-av__badge ${done ? 'fr-ring-av__badge--done' : 'fr-ring-av__badge--missed'}`}
                                    aria-hidden="true"
                                  >
                                    {done ? '✓' : '✕'}
                                  </span>
                                )}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Compact member legend / summary (sorted by days finished desc) */}
                <div className="fr-settings-section" style={{ marginTop: 8 }}>
                  <div className="fr-settings-section__label">
                    {days.length < 30 ? `Members (last ${days.length} ${days.length === 1 ? 'day' : 'days'})` : 'Members (last 30 days)'}
                  </div>
                  {[...members]
                    .map((m) => {
                      const eligibleDays = days.filter((d) => (m.sinceDay === null || d.key >= m.sinceDay) && (m.daySet.size === 0 || m.daySet.has(d.key)))
                      const finishedCount = eligibleDays.filter((d) => m.doneSet.has(d.key)).length
                      const denom = eligibleDays.length
                      return { ...m, finishedCount, denom }
                    })
                    .sort((a, b) => b.finishedCount - a.finishedCount || a.name.localeCompare(b.name))
                    .map((m) => (
                      <div key={m.id} className="fr-card-item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                          <Avatar name={m.name} url={m.avatarUrl} />
                          <span className="fr-card-item__title">{m.name}</span>
                        </div>
                        <span className="fr-card-item__meta">
                          {m.finishedCount} of {m.denom} {m.denom === 1 ? 'day' : 'days'} finished
                        </span>
                      </div>
                    ))}
                </div>
              </>
            )
          })()}
        </div>
      ) : board && settingsGroup ? (
        /* ---- StepUp Group Settings view (Demo Round 11) ---- */
        <div className="fr-panel">
          <div className="fr-panel__head">
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={() => setSettingsGroupId(null)}>
              ← Group Settings
            </button>
            <span style={{ fontSize: 12, color: 'var(--fr-muted)' }}>
              {settingsGroup.isAdmin ? 'Admin' : 'Member'}
            </span>
          </div>

          {/* Group name */}
          <div className="fr-settings-section">
            <div className="fr-settings-section__label">Group name</div>
            {settingsGroup.isAdmin ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="fr-input"
                  aria-label="Group name"
                  value={groupNameDraft}
                  onChange={(e) => setGroupNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && groupNameDraft.trim() && groupNameDraft.trim() !== settingsGroup.name) {
                      void handleRenameGroup(settingsGroup.id, groupNameDraft)
                    }
                  }}
                />
                <button
                  type="button"
                  className="fr-btn fr-btn--primary fr-btn--sm"
                  disabled={!groupNameDraft.trim() || groupNameDraft.trim() === settingsGroup.name}
                  onClick={() => void handleRenameGroup(settingsGroup.id, groupNameDraft)}
                >
                  Save
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 14, fontWeight: 600 }}>{settingsGroup.name}</div>
            )}
          </div>

          {/* Members */}
          {(() => {
            const allBanned = settingsGroup.banned ?? []
            const bannedIds = new Set(allBanned.map((b) => b.id))
            const activeMembers = settingsGroup.members.filter((m) => !bannedIds.has(m.id))
            return (
              <>
                <div className="fr-settings-section">
                  <div className="fr-settings-section__label">Members ({activeMembers.length})</div>
                  {activeMembers.map((m) => (
                    <div key={m.id} className="fr-card-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        <Avatar
                          name={m.id === board.me.id ? board.me.nickname || board.me.name || m.name : m.name}
                          url={m.id === board.me.id ? board.me.avatarUrl ?? m.avatarUrl : m.avatarUrl}
                        />
                        <div className="fr-card-item__info">
                          <div className="fr-card-item__title">{m.id === board.me.id ? board.me.nickname || board.me.name || m.name : m.name}</div>
                          <div className="fr-card-item__meta">
                            @{m.login}
                            {m.id === settingsGroup.adminId ? ' · Admin' : ''}
                          </div>
                        </div>
                      </div>
                      {settingsGroup.isAdmin && m.id !== board.me.id && (
                        <button
                          type="button"
                          className="fr-btn fr-btn--ghost fr-btn--danger fr-btn--sm"
                          onClick={async () => {
                            const res = await api.friends.banMember(settingsGroup.id, m.id)
                            if (!res.ok) {
                              onNotice?.(res.error || `Could not ban ${m.name}`)
                              return
                            }
                            await loadBoard(true)
                            onNotice?.(`Banned ${m.name} from ${settingsGroup.name}`)
                          }}
                        >
                          Ban
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Banned people */}
                <div className="fr-settings-section">
                  <div className="fr-settings-section__label">Banned people</div>
                  {allBanned.length === 0 ? (
                    <p className="fr-line" style={{ margin: 0 }}>No banned people</p>
                  ) : (
                    allBanned.map((b) => (
                      <div key={b.id} className="fr-card-item">
                        <div className="fr-card-item__info">
                          <div className="fr-card-item__title">{b.name}</div>
                          <div className="fr-card-item__meta">@{b.login}</div>
                        </div>
                        {settingsGroup.isAdmin && (
                          <button
                            type="button"
                            className="fr-btn fr-btn--sm"
                            onClick={async () => {
                              const res = await api.friends.unbanMember(settingsGroup.id, b.id)
                              if (!res.ok) {
                                onNotice?.(res.error || `Could not unban ${b.name}`)
                                return
                              }
                              await loadBoard(true)
                              onNotice?.(`Unbanned ${b.name}`)
                            }}
                          >
                            Unban
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )
          })()}

          {/* Leave & Delete group */}
          <div className="fr-settings-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="fr-btn"
              onClick={async () => {
                const gid = settingsGroup.id
                const res = await api.friends.removeMember(gid)
                if (res.ok) {
                  setSettingsGroupId(null)
                  setScope('all')
                  await loadBoard(true)
                }
              }}
            >
              Leave group
            </button>
            {settingsGroup.isAdmin && (
              <button
                type="button"
                className="fr-btn fr-btn--danger"
                onClick={async () => {
                  const gid = settingsGroup.id
                  const res = await api.friends.removeMember(gid)
                  if (res.ok) {
                    setSettingsGroupId(null)
                    setScope('all')
                    await loadBoard(true)
                  }
                }}
              >
                Delete group
              </button>
            )}
          </div>
        </div>
      ) : board && vsFriend ? (
        /* ---- You vs Friend view (Buddy Streak + Dated 7-Day Strip AT THE TOP, YAZ-6269) ---- */
        <div className="fr-panel">
          <div className="fr-panel__head">
            <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" onClick={() => setVsFriendId(null)}>
              ← Back to leaderboard
            </button>
          </div>

          {(() => {
            const vs = buildVsComparison(board.me.stats, vsFriend.stats, nowMs)
            const buddyStreak = buddyStreakOf(board.me.stats?.days, vsFriend, nowMs)
            const buddySub =
              buddyStreak > 0
                ? `${buddyStreak} ${buddyStreak === 1 ? 'day' : 'days'} in a row you both finished your due cards`
                : 'Finish your due cards today to start a buddy streak'
            const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            const pad2 = (n: number) => String(n).padStart(2, '0')
            const myDaysSet = new Set((board.me.stats?.days ?? []).map((d) => d.day))
            const theirDaysSet = new Set((vsFriend.stats?.days ?? []).map((d) => d.day))
            const myDone = new Set((board.me.stats?.days ?? []).filter((d) => d.done).map((d) => d.day))
            const theirDone = new Set((vsFriend.stats?.days ?? []).filter((d) => d.done).map((d) => d.day))
            const myName = board.me.nickname || board.me.name || 'Y'
            const todayKey = localDayKey(nowMs)
            const floorDt = new Date(nowMs)
            floorDt.setDate(floorDt.getDate() - 29)
            const floor30 = `${floorDt.getFullYear()}-${pad2(floorDt.getMonth() + 1)}-${pad2(floorDt.getDate())}`
            const friendSince = sinceDayKey(vsFriend.since)
            const stripStart =
              friendSince && friendSince > floor30
                ? friendSince > todayKey
                  ? todayKey
                  : friendSince
                : floor30
            // Chronological left -> right (oldest eligible day on left, Today on right)
            const days: {
              key: string
              isToday: boolean
              wk: string
              md: string
              me: boolean
              them: boolean
              meHasEntry: boolean
              themHasEntry: boolean
            }[] = []
            for (let offset = 29; offset >= 0; offset--) {
              const dt = new Date(nowMs)
              dt.setDate(dt.getDate() - offset)
              const key = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
              if (key < stripStart) continue
              days.push({
                key,
                isToday: offset === 0,
                wk: DAY_LABELS[dt.getDay()],
                md: `${dt.getMonth() + 1}/${dt.getDate()}`,
                me: myDone.has(key),
                them: theirDone.has(key),
                meHasEntry: myDaysSet.has(key),
                themHasEntry: theirDaysSet.has(key),
              })
            }
            const canBrowse = Boolean(vsFriend.canBrowseDeck && vsFriend.browsableVaults && vsFriend.browsableVaults.length > 0)
            return (
              <>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                  <span className="fr-hype-pill" style={{ marginBottom: 4 }} title={buddySub} aria-label={buddySub}>
                    🤝 {buddyStreak}d buddy streak
                  </span>
                  <p className="fr-buddy-sub">{buddySub}</p>
                </div>

                {/* Horizontally scrollable circular-avatar strip (chronological left -> right, auto-scrolled to Today on right) */}
                <div ref={scrollStripToRight} className="fr-strip30" aria-label="Last 30 days" style={{ marginBottom: 14 }}>
                  {days.map((d) => {
                    const meMissed = !d.me && !d.isToday && d.meHasEntry
                    const themMissed = !d.them && !d.isToday && d.themHasEntry
                    return (
                      <div key={d.key} className={`fr-day30${d.me && d.them ? ' fr-day30--all' : ''}`}>
                        <span className="fr-day__wk">{d.wk}</span>
                        <span className="fr-day__date">{d.md}</span>
                        <div className="fr-day30__avs">
                          <span
                            className={`fr-ring-av${meMissed ? ' fr-ring-av--missed' : ''}`}
                            title={`${myName}: ${d.me ? 'finished' : d.isToday ? 'in progress today' : d.meHasEntry ? 'missed' : 'no data yet'}`}
                          >
                            {board.me.avatarUrl ? <img src={board.me.avatarUrl} alt={myName} /> : myName[0].toUpperCase()}
                            {(d.me || meMissed) && (
                              <span
                                className={`fr-ring-av__badge ${d.me ? 'fr-ring-av__badge--done' : 'fr-ring-av__badge--missed'}`}
                                aria-hidden="true"
                              >
                                {d.me ? '✓' : '✕'}
                              </span>
                            )}
                          </span>
                          <span
                            className={`fr-ring-av${themMissed ? ' fr-ring-av--missed' : ''}`}
                            title={`${vsFriend.name}: ${d.them ? 'finished' : d.isToday ? 'in progress today' : d.themHasEntry ? 'missed' : 'no data yet'}`}
                          >
                            {vsFriend.avatarUrl ? <img src={vsFriend.avatarUrl} alt={vsFriend.name} /> : (vsFriend.name[0] ?? '?').toUpperCase()}
                            {(d.them || themMissed) && (
                              <span
                                className={`fr-ring-av__badge ${d.them ? 'fr-ring-av__badge--done' : 'fr-ring-av__badge--missed'}`}
                                aria-hidden="true"
                              >
                                {d.them ? '✓' : '✕'}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="fr-vs">
                  <div className="fr-vs__col">
                    <Avatar name={myName} url={board.me.avatarUrl} big />
                    <span className="fr-vs__who">{myName}</span>
                  </div>
                  <span className="fr-vs__label">vs</span>
                  <div className="fr-vs__col">
                    <Avatar name={vsFriend.name} url={vsFriend.avatarUrl} big />
                    <span className="fr-vs__who">{vsFriend.name}</span>
                  </div>
                </div>

                {canBrowse && (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 6px' }}>
                    <button
                      type="button"
                      className="fr-btn fr-btn--primary fr-btn--sm"
                      onClick={() => setBrowseFriend(vsFriend)}
                    >
                      Browse deck
                    </button>
                  </div>
                )}

                {vsFriend.sharedCardCount > 0 && (
                  <div className="fr-vs__shared">
                    {vsFriend.sharedCardCount} {vsFriend.sharedCardCount === 1 ? 'card' : 'cards'} shared together
                  </div>
                )}

                {vs.side.map((row) => (
                  <div key={row.label} className={row.part ? 'fr-vs fr-vs--part' : 'fr-vs'}>
                    <span>{row.lead === 'you' || row.lead === 'both' ? <b>{row.you}</b> : row.you}</span>
                    <span className="fr-vs__label">{row.part ? `· ${row.label}` : row.label}</span>
                    <span>{row.lead === 'them' || row.lead === 'both' ? <b>{row.them}</b> : row.them}</span>
                  </div>
                ))}

                <div className="fr-week-head" style={{ marginTop: 16 }}>Their vault</div>
                {vs.vault.map((row) => (
                  <div key={row.label} className="fr-vs">
                    <span>{row.lead === 'you' || row.lead === 'both' ? <b>{row.you}</b> : row.you}</span>
                    <span className="fr-vs__label">{row.label}</span>
                    <span>{row.lead === 'them' || row.lead === 'both' ? <b>{row.them}</b> : row.them}</span>
                  </div>
                ))}

                <div className="fr-actions" style={{ justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="fr-btn fr-btn--danger"
                    onClick={() => setConfirmRemoveFriend(vsFriend)}
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
          {/* Scope pills: All friends + Groups (active group shows ▾ to manage) + Shared Cards */}
          <div className="fr-lists" role="group" aria-label="Friends or group">
            <button
              type="button"
              className="fr-pill"
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              All friends ({board.friends.length})
            </button>
            {board.groups.map((g) => {
              const isActive = scope === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  className="fr-pill"
                  aria-pressed={isActive}
                  onClick={() => {
                    if (isActive) {
                      setManageGroup(g)
                    } else {
                      setScope(g.id)
                    }
                  }}
                >
                  {g.name}
                  {isActive ? ' ▾' : ''}
                </button>
              )
            })}
            <button
              type="button"
              className="fr-pill"
              aria-pressed={scope === 'shared'}
              onClick={() => setScope('shared')}
            >
              Shared{totalPendingShared > 0 ? ` (${totalPendingShared})` : ''}
            </button>
          </div>

          {scope === 'shared' ? (
            /* ---- Unified flat Shared (N) view (never follows you to Friends or Groups) ---- */
            <section aria-label="Shared cards">
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

              {(() => {
                const directCards = filterSharedCards(board.incomingCards, cardFilter)
                const groupFolders = board.groups.flatMap((g) =>
                  g.sharedFolders
                    .map((folder) => ({ groupName: g.name, folder, matching: filterSharedCards(folder.cards, cardFilter) }))
                    .filter((x) => x.matching.length > 0),
                )
                const groupLooseCards = board.groups.flatMap((g) =>
                  filterSharedCards(g.sharedCards, cardFilter).map((card) => ({ groupName: g.name, card })),
                )
                if (directCards.length === 0 && groupFolders.length === 0 && groupLooseCards.length === 0) {
                  return <p className="fr-line">No {cardFilter === 'accepted' ? 'added' : cardFilter} shared cards.</p>
                }
                return (
                  <div className="fr-flat-list">
                    {directCards.map((card) => (
                      <div key={card.id} className="fr-shared-row">
                        <button
                          type="button"
                          className="fr-shared-row__tap"
                          onClick={() => setPreviewCard({ card, context: 'Direct share' })}
                        >
                          <div className="fr-shared-row__title">{card.title}</div>
                          <div className="fr-shared-row__sub">
                            from {card.senderLogin}
                            {card.note ? ` · ${card.note}` : ''}
                          </div>
                        </button>
                        <div className="fr-shared-row__actions">
                          {cardFilter === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="fr-shared-add"
                                onClick={() =>
                                  setAcceptTarget({
                                    cards: [{ id: card.id, title: card.title, markdown: card.markdown, senderLogin: card.senderLogin }],
                                  })
                                }
                              >
                                Add
                              </button>
                              <button
                                type="button"
                                className={armedDismissId === card.id ? 'fr-shared-dismiss-confirm' : 'fr-shared-x'}
                                aria-label={armedDismissId === card.id ? 'Confirm dismiss' : 'Dismiss'}
                                title={armedDismissId === card.id ? 'Click again to dismiss' : 'Dismiss'}
                                onClick={() => {
                                  if (armedDismissId === card.id) {
                                    clearArmedDismiss()
                                    void handleCardState(card, 'dismissed')
                                  } else {
                                    armDismiss(card.id)
                                  }
                                }}
                              >
                                {armedDismissId === card.id ? 'Dismiss?' : '×'}
                              </button>
                            </>
                          )}
                          {cardFilter === 'dismissed' && (
                            <button
                              type="button"
                              className="fr-shared-undo"
                              onClick={() => void handleCardState(card, 'pending')}
                            >
                              Undo
                            </button>
                          )}
                          {cardFilter === 'accepted' && <span className="fr-shared-added">Added ✓</span>}
                        </div>
                      </div>
                    ))}

                    {groupFolders.map(({ groupName, folder, matching }) => (
                      <div key={folder.id} className="fr-flat-folder">
                        <div className="fr-flat-folder__head">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="fr-shared-row__title">📁 {folder.name}</div>
                            <div className="fr-shared-row__sub">
                              from {folder.senderLogin} · {groupName} · {matching.length} {matching.length === 1 ? 'card' : 'cards'}
                            </div>
                          </div>
                          <div className="fr-shared-row__actions">
                            {cardFilter === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="fr-shared-add"
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
                                  Import ({matching.length})
                                </button>
                                <button
                                  type="button"
                                  className={armedDismissId === `folder:${folder.id}` ? 'fr-shared-dismiss-confirm' : 'fr-shared-x'}
                                  aria-label={armedDismissId === `folder:${folder.id}` ? 'Confirm dismiss folder' : 'Dismiss'}
                                  title={armedDismissId === `folder:${folder.id}` ? 'Click again to dismiss' : 'Dismiss'}
                                  onClick={() => {
                                    const key = `folder:${folder.id}`
                                    if (armedDismissId === key) {
                                      clearArmedDismiss()
                                      void handleFolderState(folder, 'dismissed')
                                    } else {
                                      armDismiss(key)
                                    }
                                  }}
                                >
                                  {armedDismissId === `folder:${folder.id}` ? 'Dismiss?' : '×'}
                                </button>
                              </>
                            )}
                            {cardFilter === 'dismissed' && (
                              <button
                                type="button"
                                className="fr-shared-undo"
                                onClick={() => void handleFolderState(folder, 'pending')}
                              >
                                Undo
                              </button>
                            )}
                            {cardFilter === 'accepted' && <span className="fr-shared-added">Added ✓</span>}
                          </div>
                        </div>
                        <div className="fr-flat-folder__cards">
                          {matching.map((card) => (
                            <button
                              key={card.id}
                              type="button"
                              className="fr-folder-card-row"
                              onClick={() => setPreviewCard({ card, context: `${groupName} › ${folder.name}` })}
                            >
                              <span>{card.title}</span>
                              <span className="fr-folder-card-row__chev" aria-hidden="true">›</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    {groupLooseCards.map(({ groupName, card }) => (
                      <div key={card.id} className="fr-shared-row">
                        <button
                          type="button"
                          className="fr-shared-row__tap"
                          onClick={() => setPreviewCard({ card, context: groupName })}
                        >
                          <div className="fr-shared-row__title">{card.title}</div>
                          <div className="fr-shared-row__sub">
                            from {card.senderLogin} · {groupName}
                            {card.note ? ` · ${card.note}` : ''}
                          </div>
                        </button>
                        <div className="fr-shared-row__actions">
                          {cardFilter === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="fr-shared-add"
                                onClick={() =>
                                  setAcceptTarget({
                                    cards: [{ id: card.id, title: card.title, markdown: card.markdown, senderLogin: card.senderLogin }],
                                  })
                                }
                              >
                                Add
                              </button>
                              <button
                                type="button"
                                className={armedDismissId === card.id ? 'fr-shared-dismiss-confirm' : 'fr-shared-x'}
                                aria-label={armedDismissId === card.id ? 'Confirm dismiss' : 'Dismiss'}
                                title={armedDismissId === card.id ? 'Click again to dismiss' : 'Dismiss'}
                                onClick={() => {
                                  if (armedDismissId === card.id) {
                                    clearArmedDismiss()
                                    void handleCardState(card, 'dismissed')
                                  } else {
                                    armDismiss(card.id)
                                  }
                                }}
                              >
                                {armedDismissId === card.id ? 'Dismiss?' : '×'}
                              </button>
                            </>
                          )}
                          {cardFilter === 'dismissed' && (
                            <button
                              type="button"
                              className="fr-shared-undo"
                              onClick={() => void handleCardState(card, 'pending')}
                            >
                              Undo
                            </button>
                          )}
                          {cardFilter === 'accepted' && <span className="fr-shared-added">Added ✓</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </section>
          ) : activeGroup ? (
            /* ---- Pure StepUp Group Leaderboard (no Shared Cards sub-tabs, no Pending requests box) ---- */
            <div>
              {renderPeriodHero()}

              {renderLeaderboard(groupRows, false)}

              {/* Group streak hero bottom row (YAZ-6267, #194) */}
              {(() => {
                const totalCards = groupRows.reduce((sum, r) => sum + r.cards, 0)
                const totalSeconds = groupRows.reduce((sum, r) => sum + r.seconds, 0)
                const doneTodayCount = groupRows.filter((r) => r.finishedForPeriod).length
                const explicitStreak = (activeGroup as GroupBoardItem & { groupStreak?: number }).groupStreak
                const groupStreak =
                  typeof explicitStreak === 'number'
                    ? explicitStreak
                    : groupRows.length === 0
                      ? 0
                      : Math.min(...groupRows.map((r) => r.streak))
                const rightSub =
                  period === 'today'
                    ? groupRows.length > 0 && doneTodayCount === groupRows.length
                      ? 'all finished'
                      : `${doneTodayCount} of ${groupRows.length} finished`
                    : null
                return (
                  <button
                    type="button"
                    className="fr-group-summary"
                    onClick={() => setStreakGroupId(activeGroup.id)}
                  >
                    <div className="fr-group-summary__left">
                      <span className="fr-group-summary__icon" aria-hidden="true">🔥</span>
                      <div>
                        <div className="fr-group-summary__title">Group streak</div>
                        <div className="fr-group-summary__sub">
                          {groupRows.length} {groupRows.length === 1 ? 'person' : 'people'} · {totalCards} {totalCards === 1 ? 'card' : 'cards'} · {formatStudyTime(totalSeconds)}
                        </div>
                      </div>
                    </div>
                    <div className="fr-group-summary__right">
                      <div className="fr-nums">
                        <span className="fr-hero-cards">{groupStreak > 0 ? `${groupStreak}d 🔥` : '0d'}</span>
                        {rightSub && <span className="fr-nums__sub">{rightSub}</span>}
                      </div>
                      <span className="fr-group-summary__chev" aria-hidden="true">›</span>
                    </div>
                  </button>
                )
              })()}
            </div>
          ) : (
            /* ---- All Friends Leaderboard ---- */
            <>
              {renderPeriodHero()}

              {board.friends.length === 0 && board.groups.length === 0 ? (
                <div className="fr-signed-out">
                  <h3>Study together with friends</h3>
                  <p>Add a friend or create a group to track daily streaks, share cards, and stay accountable.</p>
                  <button type="button" className="fr-btn fr-btn--primary" onClick={() => setPlusMenuOpen(true)}>
                    Add a friend or create a group
                  </button>
                </div>
              ) : board.friends.length === 0 ? (
                <div className="fr-signed-out">
                  <h3>No friends yet</h3>
                  <p>Share your invite link or QR code to add a study buddy.</p>
                  <button type="button" className="fr-btn fr-btn--primary" onClick={() => setPlusMenuOpen(true)}>
                    Add friends
                  </button>
                </div>
              ) : (
                renderLeaderboard(allFriendsRows, true)
              )}
            </>
          )}
        </>
      ) : null}
      </div>

      {/* Full-viewport portal confetti (dead-center at any zoom level, YAZ-6276) */}
      {confettiKey > 0 && <FriendsConfettiPortal key={confettiKey} burstKey={confettiKey} onDone={() => setConfettiKey(0)} />}

      {/* All modals/overlays rendered via createPortal to document.body so CSS zoom never clips fixed positioning */}
      {createPortal(
        <>
          {/* StepUp-style `+` action sheet */}
          {plusMenuOpen && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setPlusMenuOpen(false)}>
          <div className="fr-sheet" role="dialog" aria-modal="true" aria-label="Add friends or create group" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fr-sheet__item" onClick={() => void openFriendQrShare()}>
              Add friends
            </button>
            <button
              type="button"
              className="fr-sheet__item"
              onClick={() => {
                setPlusMenuOpen(false)
                setNewGroupOpen(true)
              }}
            >
              Create new group
            </button>
            <button
              type="button"
              className="fr-sheet__item"
              onClick={() => {
                setPlusMenuOpen(false)
                setInviteError(null)
                setEnterLinkOpen(true)
              }}
            >
              Enter link to add friend/group
            </button>
            <button type="button" className="fr-sheet__item fr-sheet__item--cancel" onClick={() => setPlusMenuOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Dedicated QR Share sheet (friend or group) */}
      {qrShareModal && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setQrShareModal(null)}>
          <div className="fr-modal fr-qr-share" role="dialog" aria-modal="true" aria-label={qrShareModal.title} onClick={(e) => e.stopPropagation()}>
            <div className="fr-modal__head">
              <h3 className="fr-modal__title" style={{ flex: 1, textAlign: 'center' }}>
                {qrShareModal.title}
              </h3>
              <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={() => setQrShareModal(null)}>
                ✕
              </button>
            </div>
            <div className="fr-qr-share__box" dangerouslySetInnerHTML={{ __html: qrCodeSvg(qrShareModal.link) }} />
            <p className="fr-line">Ask friends to scan QR code</p>
            <div className="fr-qr-share__or">or</div>
            <button
              type="button"
              className="fr-btn fr-btn--primary fr-btn--pill"
              onClick={() => void handleCopyText(qrShareModal.link)}
            >
              {copiedLink ? 'Link copied ✓' : 'Share link'}
            </button>
          </div>
        </div>
      )}

      {/* Create new group modal */}
      {newGroupOpen && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setNewGroupOpen(false)}>
          <div className="fr-modal" role="dialog" aria-modal="true" aria-label="Create new group" onClick={(e) => e.stopPropagation()}>
            <div className="fr-modal__head">
              <h3 className="fr-modal__title">Create new group</h3>
              <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={() => setNewGroupOpen(false)}>
                ✕
              </button>
            </div>
            <input
              type="text"
              className="fr-input"
              placeholder="Group name (e.g. Med Study)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreateGroup()}
            />
            <div className="fr-actions">
              <button type="button" className="fr-btn" style={{ flex: 1 }} onClick={() => setNewGroupOpen(false)}>
                Cancel
              </button>
              <button type="button" className="fr-btn fr-btn--primary" style={{ flex: 1 }} disabled={newGroupBusy || !newGroupName.trim()} onClick={() => void handleCreateGroup()}>
                {newGroupBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enter link to add friend/group modal (StepUp centered dialog) */}
      {enterLinkOpen && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setEnterLinkOpen(false)}>
          <div className="fr-modal" role="dialog" aria-modal="true" aria-label="Paste invite link to join group or add friend" onClick={(e) => e.stopPropagation()}>
            <div className="fr-modal__head">
              <h3 className="fr-modal__title">Paste invite link to join group or add friend</h3>
              <button type="button" className="fr-btn fr-btn--ghost fr-btn--sm" aria-label="Close" onClick={() => setEnterLinkOpen(false)}>
                ✕
              </button>
            </div>
            <p className="fr-line">Eg. https://docs.yaseenarshad.com/friend#k9x2m7 or k9x2m7</p>
            <input
              type="text"
              className="fr-input"
              style={{ borderRadius: 10, padding: '9px 12px' }}
              placeholder="Invite link"
              aria-label="Invite link"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleAcceptInvite()}
            />
            {inviteError && <p className="fr-error" role="alert">{inviteError}</p>}
            <div className="fr-actions">
              <button type="button" className="fr-btn" style={{ flex: 1 }} onClick={() => setEnterLinkOpen(false)}>
                Cancel
              </button>
              <button type="button" className="fr-btn fr-btn--primary" style={{ flex: 1 }} disabled={inviteBusy} onClick={() => void handleAcceptInvite()}>
                {inviteBusy ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage "<name>" group action sheet (StepUp: Invite to group, Group Settings, Leave group, Cancel) */}
      {manageGroup && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => setManageGroup(null)}>
          <div className="fr-sheet" role="dialog" aria-modal="true" aria-label={`Manage ${manageGroup.name} group`} onClick={(e) => e.stopPropagation()}>
            <div className="fr-sheet__head">
              <h3 className="fr-sheet__title">Manage "{manageGroup.name}" group</h3>
              <p className="fr-sheet__sub">{manageGroup.isAdmin ? "You're an admin" : 'Member'}</p>
            </div>
            {manageGroup.inviteCode && (
              <button
                type="button"
                className="fr-sheet__item"
                onClick={() => {
                  const g = manageGroup
                  setManageGroup(null)
                  setCopiedLink(false)
                  setQrShareModal({
                    title: `Invite friends to "${g.name}"`,
                    link: `https://docs.yaseenarshad.com/group#${g.inviteCode}`,
                  })
                }}
              >
                Invite to group
              </button>
            )}
            <button
              type="button"
              className="fr-sheet__item"
              onClick={() => {
                const g = manageGroup
                setManageGroup(null)
                setGroupNameDraft(g.name)
                setSettingsGroupId(g.id)
              }}
            >
              Group Settings
            </button>
            <button
              type="button"
              className="fr-sheet__item fr-sheet__item--danger"
              onClick={async () => {
                const g = manageGroup
                setManageGroup(null)
                const res = await api.friends.removeMember(g.id)
                if (res.ok) {
                  setScope('all')
                  await loadBoard(true)
                }
              }}
            >
              Leave group
            </button>
            <button type="button" className="fr-sheet__item fr-sheet__item--cancel" onClick={() => setManageGroup(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Real Explore-style shared card preview overlay (uses .explore + .explore__layer + CardBand + renderCard) */}
      {previewCard && (
        <div className="explore" role="presentation" onClick={() => setPreviewCard(null)}>
          <div
            className="explore__layer explore__layer--in fr-explore-layer"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${previewCard.card.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fr-explore-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span className="fr-explore-chip">shared from @{previewCard.card.senderLogin}</span>
                {previewCard.context && <span>· {previewCard.context}</span>}
              </div>
              <button
                type="button"
                className="fr-btn fr-btn--ghost fr-btn--sm"
                aria-label="Close preview"
                onClick={() => setPreviewCard(null)}
              >
                Close (Esc)
              </button>
            </div>

            <div className="fr-explore-body">
              <div className="card-inbox__card">
                <CardBand>
                  <span className="card-inbox__name">{previewCard.card.title}</span>
                </CardBand>
                <RenderedCardBody markdown={previewCard.card.markdown} />
              </div>

              {previewCard.card.note && (
                <p className="fr-explore-note">
                  <strong>Note from @{previewCard.card.senderLogin}:</strong> {previewCard.card.note}
                </p>
              )}
            </div>

            <div className="fr-explore-foot">
              <button type="button" className="fr-btn fr-btn--ghost" onClick={() => setPreviewCard(null)}>
                Close
              </button>
              {previewCard.card.status === 'dismissed' ? (
                <button
                  type="button"
                  className="fr-btn"
                  onClick={() => {
                    const c = previewCard.card
                    setPreviewCard(null)
                    void handleCardState(c, 'pending')
                  }}
                >
                  Undo dismiss
                </button>
              ) : (
                previewCard.card.status === 'pending' && (
                  <button
                    type="button"
                    className="fr-btn fr-btn--ghost"
                    onClick={() => {
                      const c = previewCard.card
                      setPreviewCard(null)
                      void handleCardState(c, 'dismissed')
                    }}
                  >
                    Dismiss
                  </button>
                )
              )}
              {previewCard.card.status !== 'accepted' && (
                <button
                  type="button"
                  className="fr-btn fr-btn--primary"
                  onClick={() => {
                    const c = previewCard.card
                    setPreviewCard(null)
                    setAcceptTarget({
                      cards: [{ id: c.id, title: c.title, markdown: c.markdown, senderLogin: c.senderLogin }],
                    })
                  }}
                >
                  Accept
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Remove Friend modal (YAZ-6276) */}
      {confirmRemoveFriend && (
        <div className="fr-modal-backdrop" role="presentation" onClick={() => !removingFriend && setConfirmRemoveFriend(null)}>
          <div
            className="fr-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Remove ${confirmRemoveFriend.name}?`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fr-modal__head">
              <h3 className="fr-modal__title">Remove {confirmRemoveFriend.name}?</h3>
              <button
                type="button"
                className="fr-btn fr-btn--ghost fr-btn--sm"
                aria-label="Close"
                disabled={removingFriend}
                onClick={() => setConfirmRemoveFriend(null)}
              >
                ✕
              </button>
            </div>
            <p className="fr-line">
              They won't see your numbers anymore. You can add each other again with a new link.
            </p>
            <div className="fr-actions">
              <button
                type="button"
                className="fr-btn"
                style={{ flex: 1 }}
                disabled={removingFriend}
                onClick={() => setConfirmRemoveFriend(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fr-btn fr-btn--danger"
                style={{ flex: 1 }}
                disabled={removingFriend}
                onClick={async () => {
                  const target = confirmRemoveFriend
                  setRemovingFriend(true)
                  try {
                    const res = await api.friends.removeFriend(target.id, false)
                    if (res.ok) {
                      setConfirmRemoveFriend(null)
                      setVsFriendId(null)
                      onNotice?.(`Removed ${target.name}`)
                      await loadBoard(true)
                    }
                  } finally {
                    setRemovingFriend(false)
                  }
                }}
              >
                {removingFriend ? 'Removing…' : 'Remove friend'}
              </button>
            </div>
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
        </>,
        document.body,
      )}
      {browseFriend && (
        <BrowseDeckModal
          friend={browseFriend}
          vaultRoot={vaultRoot}
          onNotice={onNotice}
          onClose={() => setBrowseFriend(null)}
        />
      )}
    </div>
  )
}
