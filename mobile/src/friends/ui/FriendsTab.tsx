import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import { LIST_CUT, NO_LIST_ACCESS, TOO_MANY_GISTS, homeGoneMessage, listElsewhereMessage, pasteMessage, restartAction, restartWarning, type PasteResult } from '@shared/friendsList'
import type { GroupBoardItem, SharedCardItem, SharedCardStatus, SharedFolderItem } from '@shared/friendsApi'
import { NO_LINK_PILLS } from '@shared/linkPills'
import { qrCodeSvg } from '@shared/qrSvg'
import '@client/editor/card/card.css'
import '@client/review/cardScreens.css'
import type { WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { useApp } from '../../app/AppState'
import { swipeIsOurs } from '../../app/edgeSwipe'
import { friendsMessage } from '../../auth/friends'
import { sheetMotion, type SheetMotion } from '../../explore/sheetMotion'
import '../../explore/explore.css'
import { drawLocalCard } from '../../media/ui/cardDraw'
import { browserFacts, whereAmI } from '../../pwa/homeScreen'
import { Confirm } from '../../screens/Confirm'
import { Problem } from '../../screens/Frame'
import { PHONE } from '../../store'
import { takePendingInvite } from '../../store/pendingInvitePref'
import type { Unavailable } from '../list'
import {
  PERIODS,
  addDays,
  boardRows,
  filterSharedCards,
  formatStudyDuration,
  gistText,
  initialOf,
  localDay,
  markWords,
  sendLine,
  sinceDayKey,
  updatedLabel,
  type BoardEntry,
  type Period,
} from './board'
import './friends.css'
import {
  GROUP_NAME_MAX,
  adminWords,
  groupLink,
  groupViewMessage,
  joinMessage,
  type GroupChange,
  type GroupView,
  type JoinRequest,
  type JoinResult,
} from './groups'
import { AcceptCardSheet } from './AcceptCardSheet'
import { Avatar, LinkToCopy, SHARED_WORDS, actionWords, groupShareText, joinShareText, ownSiteLink, readClipboard, shareOut } from './parts'
import type { Board, FriendEntry, FriendsService, PasteAnswer } from './service'
import { useBoard, useNow, useService } from './useFriends'

/**
 * The Friends tab (4E4; decisions 20, 21, 22, 24, 25; round 10, items 12 and 13). The tab draws the board
 * that the service reads (`useBoard`, each `FRIENDS_POLL_MS` while it shows). Each number and mark comes from
 * `board.ts`; the tab computes none.
 */
type OkBoard = Extract<Board, { kind: 'ok' }>
type Entry = BoardEntry & {
  friend?: FriendEntry
  avatar: string | null
  sub: string[]
  ago?: string
  dim: boolean
  group?: string
  pointer?: string
  left?: boolean
  buddyStreak?: number
}

const BUDDY_REVEAL_KEY = 'yaseendocs.friends.buddyReveal'

export default function FriendsTab() {
  const { service, ready } = useService()
  const { board, refresh } = useBoard(service)
  const app = useApp()
  const account = friendsMessage(app.friendsAccount)
  const alert =
    account === null ? null : app.friendsAccount.kind === 'no-gists' ? (
      <Problem
        message={`${account} Add it to the token on GitHub, then replace the token in Settings.`}
        action="How to make a token"
        onAction={() => app.go({ type: 'open', route: { kind: 'guide' } })}
      />
    ) : (
      <Problem quiet message={account} action="Change" onAction={() => app.go({ type: 'open', route: { kind: 'settings' } })} />
    )

  if (!ready || (service !== null && board === null))
    return (
      <section aria-label="Friends" aria-busy="true">
        {alert}
        <p className="fr-line">Reading your friends…</p>
      </section>
    )
  if (service === null || board === null) return <section aria-label="Friends">{alert ?? <Empty service={null} />}</section>
  if (board.kind !== 'ok') return <section aria-label="Friends">{alert ?? <Unreadable board={board} refresh={refresh} service={service} />}</section>
  return (
    <section aria-label="Friends">
      {alert}
      <BoardView board={board} service={service} refresh={refresh} />
    </section>
  )
}

/** Words for a board that cannot show (decision 17, round 13 item 4). */
function Unreadable({ board, refresh, service }: { board: Unavailable; refresh: () => Promise<void>; service: FriendsService }) {
  const app = useApp()
  switch (board.kind) {
    case 'home-gone':
      return <HomeGone message={homeGoneMessage(board.home, board.fileGone === true)} vaults={board.vaults} service={service} refresh={refresh} />
    case 'list-cut':
      return <HomeGone message={LIST_CUT} vaults={board.vaults} service={service} refresh={refresh} />
    case 'needs-repair':
      return <Problem message={LIST_NEEDS_REPAIR} action="Try again" onAction={() => void refresh()} />
    case 'newer-app':
      return <Problem message="Your friends list was written by a newer Yaseen Docs. Update this app to see your friends." />
    case 'unauthorized':
      return (
        <Problem
          message="Sign in again to see your friends."
          action="Sign in again"
          onAction={() =>
            app.vaultKey !== null &&
            app.go({
              type: 'open',
              route: { kind: 'replace-token', vault: app.vaultKey },
            })
          }
        />
      )
    case 'no-gists':
      return (
        <Problem
          message="Friends needs the Gists permission on your token. Add it on GitHub, then replace the token in Settings."
          action="How to make a token"
          onAction={() => app.go({ type: 'open', route: { kind: 'guide' } })}
        />
      )
    case 'no-account':
      return <Problem quiet message="Friends starts after the app checks your token. Open the app once with a connection." />
    case 'list-elsewhere':
      return <Problem message={listElsewhereMessage(board.home)} />
    case 'no-list-access':
      return <Problem message={NO_LIST_ACCESS} action="Try again" onAction={() => void refresh()} />
    case 'offline':
      return <Problem quiet message="No connection. Your friends show when you are online." action="Try again" onAction={() => void refresh()} />
    case 'rate-limited':
      return <Problem quiet message="GitHub asks the app to wait. Your friends show in a few minutes." />
    default:
      return <Problem message="Your friends could not be read." action="Try again" onAction={() => void refresh()} />
  }
}

/**
 * The vault that held the friends list is gone on GitHub (or, YAZ-5444, its list file is gone; or, YAZ-5400,
 * an old list has more than 300 files and cannot be read whole). The tab says what happened, and offers the way out
 * for each other vault of this phone: "Start the friends list again in <vault>", after a confirm that says its effect.
 */
function HomeGone({ message, vaults, service, refresh }: { message: string; vaults: readonly string[]; service: FriendsService; refresh: () => Promise<void> }) {
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const run = async () => {
    if (asking === null || service.restart === undefined) return
    setBusy(true)
    try {
      const r = await service.restart(asking)
      setSaid(r.kind === 'done' ? null : r.kind === 'home-is-there' ? 'Your friends list can be read again. Nothing was changed.' : r.kind === 'too-many-gists' ? TOO_MANY_GISTS : (UNAVAILABLE_WORDS[r.kind as Unavailable['kind']] ?? 'Something went wrong. Try again.'))
    } finally {
      setBusy(false)
      setAsking(null)
      await refresh()
    }
  }
  return (
    <div>
      <Problem message={message} />
      {vaults.length === 0 ? (
        <p className="muted">Add another of your vaults on this phone to start the friends list again there.</p>
      ) : (
        <div className="stack">
          {vaults.map((v) => (
            <button key={v} type="button" className="btn btn--wide" disabled={busy || service.restart === undefined} onClick={() => setAsking(v)}>
              {restartAction(v)}
            </button>
          ))}
        </div>
      )}
      {said !== null && (
        <p role="status" className="fr-line">
          {said}
        </p>
      )}
      {asking !== null && <Confirm question={restartWarning(asking)} yes="Start again" busy={busy} onYes={() => void run()} onNo={() => setAsking(null)} />}
    </div>
  )
}

/** Zero-friends first-run empty state card (YAZ-6222). */
function Empty({ service, setPanel }: { service: FriendsService | null; setPanel?: (p: Panel) => void }) {
  return (
    <div className="fr-empty-card">
      <div className="fr-empty-card__icon" aria-hidden="true">
        🤝
      </div>
      <h2 className="fr-empty-card__title">Study together with friends</h2>
      <p className="fr-empty-card__sub">Add a friend or create a group</p>
      <p className="fr-empty-card__note">
        {service?.whatFriendsSee ?? 'Friends see your review numbers only: cards, minutes and streaks. Never your cards or your pages.'}
      </p>
      {setPanel !== undefined && (
        <div className="fr-empty-card__actions">
          <button type="button" className="btn btn--primary btn--wide" onClick={() => setPanel('menu')}>
            Add friend or group
          </button>
        </div>
      )}
    </div>
  )
}

type Panel = null | 'menu' | 'share' | 'paste' | 'group'

function BoardView({ board, service, refresh }: { board: OkBoard; service: FriendsService; refresh: () => Promise<void> }) {
  const app = useApp()
  const now = useNow()
  const [period, setPeriod] = useState<Period>('today')
  const [list, setList] = useState<string>('friends')
  const [panel, setPanel] = useState<Panel>(null)
  const [manageGroup, setManageGroup] = useState(false)
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false)
  const [groupStreakOpen, setGroupStreakOpen] = useState(false)
  const [groupInviteOpen, setGroupInviteOpen] = useState(false)
  const [previewCard, setPreviewCard] = useState<SharedCardItem | null>(null)
  const [revealedToday, setRevealedToday] = useState<Set<string>>(() => new Set())
  const [confettiId, setConfettiId] = useState(0)
  const todayStr = localDay(now)

  useEffect(() => {
    let live = true
    void app.services.store
      .getState<{ day?: string; ids?: string[] }>(PHONE, BUDDY_REVEAL_KEY)
      .then((saved) => {
        if (!live) return
        if (saved && saved.day === todayStr && Array.isArray(saved.ids)) {
          setRevealedToday((prev) => {
            const next = new Set(prev)
            for (const id of saved.ids!) {
              if (typeof id === 'string') next.add(`${todayStr}:${id}`)
            }
            return next
          })
        } else {
          setRevealedToday(new Set())
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [app.services.store, todayStr])
  const [acceptTarget, setAcceptTarget] = useState<
    | null
    | { kind: 'card'; card: SharedCardItem }
    | { kind: 'folder'; folder: SharedFolderItem }
  >(null)
  const [asking, setAsking] = useState<null | {
    question: string
    yes: string
    run: () => Promise<unknown>
  }>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const group = board.groups.find((g) => g.kind !== 'not-found' && g.group === list) as Exclude<GroupView, { kind: 'not-found' }> | undefined
  const d1Group: GroupBoardItem | undefined = board.d1Groups?.find((g) => g.id === list)
  const showShared = list === 'shared'
  const showGroup = list !== 'friends' && list !== 'shared' && group !== undefined
  /** Only show a send status line on the main Friends tab when something is wrong/paused (hide healthy "last sent"). */
  const sent =
    board.sending === undefined ||
    board.sending.status === 'sent' ||
    board.sending.status === 'unchanged' ||
    board.sending.status === 'waiting'
      ? null
      : sendLine(board.sending, now)

  const friendEntries: Entry[] = useMemo(() => {
    const me: Entry = {
      key: 'me',
      name: gistText(board.me.name),
      you: true,
      stats: board.me.stats,
      streak: board.me.stats?.totals.streak ?? 0,
      avatar: board.me.avatar,
      sub: board.me.stats === null ? ['Your numbers need each vault that counts on this phone.'] : [],
      dim: false,
      buddyStreak: 0,
    }
    const them = board.friends.map((f): Entry => {
      const numbers = f.state === 'ok' || f.state === 'waiting'
      const sub: string[] = []
      if (f.state !== 'ok' && f.label !== null) sub.push(f.label)
      // Not read yet: with no signal, say so (round 3); else 4E2's "no update yet".
      if (!numbers && f.label === null) sub.push(f.state === 'offline' ? 'No connection. Not read yet.' : 'no update yet')
      const ago = numbers ? updatedLabel(f.updatedAt, now) : undefined
      return {
        key: f.theirs,
        name: gistText(f.name) || 'Friend',
        you: false,
        stats: numbers ? f.stats : null,
        streak: numbers ? f.stats?.totals.streak ?? 0 : 0,
        avatar: f.avatar,
        friend: f,
        sub,
        ago,
        dim: f.state === 'gone',
        buddyStreak: f.buddyStreak ?? 0,
      }
    })
    return [me, ...them]
  }, [board, now])

  const groupEntries: Entry[] = useMemo(() => {
    if (group === undefined || group.kind !== 'ok') return []
    return group.members.map((m): Entry => {
      const ok = m.read !== null && m.read.kind === 'ok' ? m.read : null
      const sub: string[] = []
      if (m.state !== 'ok' && m.label !== null) sub.push(m.label)
      const memberStats = m.me ? board.me.stats : ok?.stats ?? null
      const d1Member = d1Group?.members.find((dm) => String(dm.id) === m.pointer)
      const friendMatch = board.friends.find((f) => f.theirs === m.pointer)
      const memberAvatar = m.me ? board.me.avatar : friendMatch?.avatar ?? d1Member?.avatarUrl ?? null
      return {
        key: m.pointer,
        name: m.me ? board.me.name : gistText(m.name) || gistText(m.login) || 'Member',
        you: m.me,
        stats: memberStats,
        streak: memberStats?.totals.streak ?? 0,
        avatar: memberAvatar,
        sub,
        ago: !m.me && ok !== null ? updatedLabel(ok.updatedAt, now) : undefined,
        dim: m.state === 'left',
        group: group.group,
        pointer: m.pointer,
        left: m.state === 'left',
        buddyStreak: m.me ? 0 : friendMatch?.buddyStreak ?? 0,
      }
    })
  }, [group, d1Group, board, now])

  const entries = showGroup ? groupEntries : friendEntries
  const rows = boardRows(entries, period, now, 'cards')
  const incomingCards = board.incomingCards ?? []
  const d1Groups = board.d1Groups ?? []
  const allSharedCards = useMemo(
    () => [
      ...incomingCards.map((card) => ({ card, groupName: null as string | null })),
      ...d1Groups.flatMap((g) => g.sharedCards.map((card) => ({ card, groupName: g.name }))),
    ],
    [incomingCards, d1Groups],
  )
  const allSharedFolders = useMemo(
    () => d1Groups.flatMap((g) => g.sharedFolders.map((folder) => ({ folder, groupName: g.name }))),
    [d1Groups],
  )
  const totalSharedCount = allSharedCards.length + allSharedFolders.reduce((acc, f) => acc + f.folder.cards.length, 0)
  const totalPendingShared =
    allSharedCards.filter((x) => x.card.status === 'pending').length +
    allSharedFolders.reduce((acc, x) => acc + x.folder.cards.filter((c) => c.status === 'pending').length, 0)

  // YAZ-6222: auto-accept any invite link stashed on /friend#<code> or /group#<code> before GitHub sign-in.
  const pendingChecked = useRef(false)
  useEffect(() => {
    if (pendingChecked.current) return
    pendingChecked.current = true
    const pending = takePendingInvite()
    if (pending === null) return
    void service
      .paste(pending.url)
      .then(async (ans) => {
        if ('kind' in ans && (ans.kind === 'added' || ans.kind === 'already')) {
          setSaid(pasteMessage(ans))
        } else if ('kind' in ans && ans.kind === 'joined') {
          setSaid(joinMessage(ans))
        } else {
          setSaid(pending.kind === 'group' ? 'Could not join group from invite link.' : 'Could not add friend from invite link.')
        }
        await refresh()
      })
      .catch(() => {
        setSaid('Could not accept invite link. Try pasting it from +.')
      })
  }, [service, refresh])

  // A friend who just added me back: said one time (the list marks the pair, so the next read has none).
  const paired = (board.newlyPaired ?? []).join(', ')
  useEffect(() => {
    if (paired !== '') setSaid(`${paired} added you back. You are friends now.`)
  }, [paired])

  const nobody = board.friends.length === 0 && board.groups.length === 0 && totalSharedCount === 0

  const ask = (question: string, yes: string, run: () => Promise<unknown>) => setAsking({ question, yes, run })
  const doAsk = async () => {
    if (asking === null) return
    setBusy(true)
    try {
      // An answer that is not `done` says why, and what happens next.
      setSaid(actionWords(await asking.run()))
    } finally {
      setBusy(false)
      setAsking(null)
      await refresh()
    }
  }
  const open = (e: Entry) => {
    if (e.you) return
    if (e.group !== undefined && e.pointer !== undefined)
      app.go({
        type: 'open',
        route: { kind: 'friend', group: e.group, pointer: e.pointer },
      })
    else if (e.friend !== undefined)
      app.go({
        type: 'open',
        route: { kind: 'friend', theirs: e.friend.theirs },
      })
  }

  if (groupStreakOpen && showGroup && group !== undefined && group.kind === 'ok') {
    return (
      <GroupStreakScreen
        view={group}
        d1Group={d1Group}
        board={board}
        now={now}
        onBack={() => setGroupStreakOpen(false)}
      />
    )
  }

  if (groupSettingsOpen && showGroup && group !== undefined && service.groups !== null) {
    return (
      <div>
        <GroupSettingsScreen
          view={group}
          d1Group={d1Group}
          service={service}
          ask={(q, yes, run) => ask(q, yes, run)}
          say={setSaid}
          refresh={refresh}
          onBack={() => setGroupSettingsOpen(false)}
        />
        {said !== null && (
          <p className="fr-line" role="status">
            {said}
          </p>
        )}
        {asking !== null && <Confirm question={asking.question} yes={asking.yes} busy={busy} onYes={() => void doAsk()} onNo={() => setAsking(null)} />}
      </div>
    )
  }

  const meDoneToday = board.me.stats?.days.some((d) => d.day === todayStr && d.done === true) === true
  const revealBuddy = (entryKey: string) => {
    const token = `${todayStr}:${entryKey}`
    setRevealedToday((prev) => {
      if (prev.has(token)) return prev
      const next = new Set(prev)
      next.add(token)
      const prefix = `${todayStr}:`
      const ids = Array.from(next)
        .filter((t) => t.startsWith(prefix))
        .map((t) => t.slice(prefix.length))
      void app.services.store.setState(PHONE, BUDDY_REVEAL_KEY, { day: todayStr, ids }).catch(() => undefined)
      return next
    })
    setConfettiId((n) => n + 1)
  }

  // The add panel keeps its place (and its state) when the first link or friend turns the empty tab into the list.
  return (
    <div>
      {confettiId > 0 && <ConfettiBurst trigger={confettiId} />}
      {nobody ? (
        <Empty service={service} setPanel={setPanel} />
      ) : (
        <>
          <div className="fr-seg" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={p.id === period} onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="fr-lists" role="group" aria-label="Lists">
            <div className="fr-lists__scroll">
              <button
                type="button"
                className="fr-pill"
                aria-pressed={!showGroup && !showShared}
                onClick={() => {
                  setList('friends')
                  setManageGroup(false)
                  setGroupSettingsOpen(false)
                  setGroupStreakOpen(false)
                  setGroupInviteOpen(false)
                  setPanel(null)
                }}
              >
                Friends
              </button>
              {board.groups.map((g) => {
                if (g.kind === 'not-found') return null
                const active = showGroup && list === g.group
                const label = gistText(g.name, 30) || 'Group'
                return (
                  <button
                    key={g.group}
                    type="button"
                    className="fr-pill"
                    aria-pressed={active}
                    aria-haspopup={active ? 'dialog' : undefined}
                    onClick={() => {
                      setPanel(null)
                      if (active) {
                        setManageGroup(true)
                      } else {
                        setList(g.group)
                        setManageGroup(false)
                        setGroupSettingsOpen(false)
                        setGroupStreakOpen(false)
                        setGroupInviteOpen(false)
                      }
                    }}
                  >
                    {active ? `${label} ▾` : label}
                  </button>
                )
              })}
              {totalSharedCount > 0 && (
                <button
                  type="button"
                  className="fr-pill"
                  aria-pressed={showShared}
                  onClick={() => {
                    setList('shared')
                    setManageGroup(false)
                    setGroupSettingsOpen(false)
                    setGroupStreakOpen(false)
                    setGroupInviteOpen(false)
                    setPanel(null)
                  }}
                >
                  {totalPendingShared > 0 ? `Shared (${totalPendingShared})` : 'Shared'}
                </button>
              )}
            </div>
            <button
              type="button"
              className="fr-pill fr-pill--add fr-pill--icon"
              aria-label="Add a friend or a group"
              aria-expanded={panel !== null}
              onClick={() => setPanel(panel === null ? 'menu' : null)}
            >
              +
            </button>
          </div>
        </>
      )}
      <AddPanel panel={panel} setPanel={setPanel} service={service} refresh={refresh} />
      {!nobody && (
        <>
          {board.offline && <p className="fr-line">No connection. These are the last numbers the app read.</p>}
          {sent !== null && <p className="fr-line">{sent}</p>}
          {said !== null && (
            <p className="fr-line" role="status">
              {said}
            </p>
          )}
          {/* B8: who joined today, in 4E3's words, once and quietly. */}
          {showGroup && group !== undefined && group.kind === 'ok' && groupViewMessage(group) !== null && <p className="fr-line">{groupViewMessage(group)}</p>}
          {showGroup && group !== undefined && group.kind !== 'ok' && <GroupProblem view={group} />}
          {showShared ? (
            <UnifiedSharedView
              cards={allSharedCards}
              folders={allSharedFolders}
              service={service}
              refresh={refresh}
              say={setSaid}
              onPreview={setPreviewCard}
              onAcceptCard={(card) => setAcceptTarget({ kind: 'card', card })}
              onImportFolder={(folder) => setAcceptTarget({ kind: 'folder', folder })}
            />
          ) : (
            <ul className="rows" aria-label={showGroup ? `${gistText(group?.name ?? '')} members` : 'Friends'}>
              {rows.map(({ entry: e, numbers }) => {
                // Round 10, item 12 (mockup version 9): "updated … ago" below the name, on Today.
                const entry = period === 'today' && e.ago !== undefined ? { ...e, sub: [...e.sub, e.ago] } : e
                const rowClass = entry.dim ? 'fr-row fr-row--gone' : 'fr-row'
                const buddy = entry.buddyStreak ?? 0
                const entryDoneToday = entry.stats?.days.some((d) => d.day === todayStr && d.done === true) === true
                const bothDoneToday = meDoneToday && entryDoneToday
                const revealKey = `${todayStr}:${entry.key}`
                const isRevealed = revealedToday.has(revealKey)
                const buddyTitle =
                  buddy === 1
                    ? '1 day in a row you both finished your due cards'
                    : `${buddy} days in a row you both finished your due cards`
                return (
                  <li key={entry.key || entry.friend?.mine} className={rowClass}>
                    <button
                      type="button"
                      className="fr-row__tap"
                      onClick={() => open(entry)}
                      disabled={entry.friend?.state === 'removing'}
                      aria-label={rowWords(entry, numbers, period)}
                    >
                      {(period === 'today' || period === 'yesterday') && (
                        <span
                          className={numbers?.mark === 'finished' && numbers.cards > 0 ? 'fr-rank fr-rank--medal' : 'fr-rank'}
                          aria-hidden="true"
                        >
                          {numbers?.mark === 'finished' && numbers.cards > 0 ? '🥇' : ''}
                        </span>
                      )}
                      <Avatar key={entry.avatar ?? ''} name={entry.name} url={entry.avatar} />
                      <span className="fr-who" aria-hidden="true">
                        <span className="fr-name-line">
                          <span className={entry.you ? 'fr-name fr-name--you' : 'fr-name'}>
                            {entry.name || 'You'}
                          </span>
                          {!showGroup && !entry.you && buddy > 0 && (
                            period === 'today' && bothDoneToday && !isRevealed ? (
                              <span
                                role="button"
                                tabIndex={0}
                                className="fr-bell"
                                title="You both finished today! Tap to reveal your buddy streak"
                                aria-label="You both finished today! Tap to reveal your buddy streak"
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  ev.preventDefault()
                                  revealBuddy(entry.key)
                                }}
                                onKeyDown={(ev) => {
                                  if (ev.key === 'Enter' || ev.key === ' ') {
                                    ev.stopPropagation()
                                    ev.preventDefault()
                                    revealBuddy(entry.key)
                                  }
                                }}
                              >
                                🔔
                              </span>
                            ) : (
                              <span
                                className={
                                  period !== 'today'
                                    ? 'fr-buddy-pill'
                                    : bothDoneToday
                                    ? 'fr-buddy-pill fr-buddy-pill--pop'
                                    : 'fr-buddy-pill fr-buddy-pill--pending'
                                }
                                title={period !== 'today' || bothDoneToday ? buddyTitle : `${buddyTitle} (waiting on today)`}
                              >
                                🤝 {buddy}d
                              </span>
                            )
                          )}
                        </span>
                        {entry.sub.length > 0 && <span className="fr-sub">{entry.sub.join(' · ')}</span>}
                      </span>
                      {numbers !== null && (
                        <span className="fr-nums" aria-hidden="true">
                          {numbers.mark === 'finished' && numbers.cards > 0 && (
                            <span className="fr-mark fr-mark--finished" aria-hidden="true">
                              ✓
                            </span>
                          )}{' '}
                          <b>{numbers.cards}</b> cards
                          <br />
                          {(entry.streak ?? 0) > 0 ? `${entry.streak}d 🔥 · ${formatStudyDuration(numbers.minutes)}` : formatStudyDuration(numbers.minutes)}
                        </span>
                      )}
                    </button>
                  {entry.friend?.state === 'stopped' && (
                    // The link I pasted is gone and they never added me: the one way on is a new link of mine.
                    <button type="button" className="btn" aria-label="Share a new link" onClick={() => setPanel('share')}>
                      New link
                    </button>
                  )}
                  {entry.friend?.state === 'unreadable' && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        ask(`Remove ${entry.name}? You cannot read their numbers now.`, `Remove ${entry.name}`, () => service.remove(entry.friend!.mine))
                      }
                    >
                      Remove
                    </button>
                  )}
                  {entry.friend?.state === 'gone' && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        ask(`Remove ${entry.name}? They no longer share with you.`, `Remove ${entry.name}`, () => service.remove(entry.friend!.mine))
                      }
                    >
                      Remove
                    </button>
                  )}
                  {entry.left === true && group?.kind === 'ok' && group.iAmAdmin && service.groups !== null && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        ask(`Remove ${entry.name} from ${gistText(group.name)}?`, `Remove ${entry.name}`, () =>
                          service.groups!.remove(group.group, entry.pointer!),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              )
            })}
            </ul>
          )}
          {showGroup && group !== undefined && group.kind === 'ok' && (() => {
            const count = rows.length
            const doneCount = rows.filter((r) => r.numbers !== null && r.numbers.mark === 'finished' && r.numbers.cards > 0).length
            const totalCards = rows.reduce((acc, r) => acc + (r.numbers?.cards ?? 0), 0)
            const totalMins = rows.reduce((acc, r) => acc + (r.numbers?.minutes ?? 0), 0)
            const timeLabel = formatStudyDuration(totalMins)
            const leftSub = `${count === 1 ? '1 person' : `${count} people`} · ${totalCards} cards · ${timeLabel}`
            const rightSub =
              period === 'today'
                ? doneCount === count && count > 0
                  ? 'all finished'
                  : `${doneCount} of ${count} finished`
                : null
            return (
              <>
                <button
                  type="button"
                  className="fr-group-summary fr-group-summary--btn"
                  onClick={() => setGroupStreakOpen(true)}
                  aria-label={`Group streak: ${group.streak} days, ${leftSub}${rightSub ? `, ${rightSub}` : ''}. Open 30-day history`}
                >
                  <span className="fr-av" aria-hidden="true">🔥</span>
                  <span className="fr-who">
                    <span className="fr-name fr-name--you">Group streak</span>
                    <span className="fr-sub">{leftSub}</span>
                  </span>
                  <span className="fr-nums">
                    <b>{group.streak > 0 ? `${group.streak}d 🔥` : '0d'}</b>
                    {rightSub !== null && (
                      <>
                        <br />
                        {rightSub}
                      </>
                    )}
                  </span>
                  <span className="fr-chev" aria-hidden="true">›</span>
                </button>
              </>
            )
          })()}
          {(manageGroup || groupInviteOpen) && showGroup && group !== undefined && service.groups !== null && (
            <ManageGroupSheet
              view={group}
              d1Group={d1Group}
              initialQr={groupInviteOpen}
              service={service}
              ask={(q, yes, run) => {
                setManageGroup(false)
                setGroupInviteOpen(false)
                ask(q, yes, run)
              }}
              onOpenSettings={() => {
                setManageGroup(false)
                setGroupInviteOpen(false)
                setGroupSettingsOpen(true)
              }}
              onClose={() => {
                setManageGroup(false)
                setGroupInviteOpen(false)
              }}
            />
          )}
        </>
      )}
      {previewCard !== null && (
        <SharedCardPreviewSheet
          card={previewCard}
          service={service}
          refresh={refresh}
          say={setSaid}
          onClose={() => setPreviewCard(null)}
          onAccept={(card) => {
            setPreviewCard(null)
            setAcceptTarget({ kind: 'card', card })
          }}
        />
      )}
      {acceptTarget !== null && (
        <AcceptCardSheet
          target={acceptTarget}
          service={service}
          onClose={() => setAcceptTarget(null)}
          onDone={(msg) => {
            setAcceptTarget(null)
            setSaid(msg)
            void refresh()
          }}
        />
      )}
      {asking !== null && <Confirm question={asking.question} yes={asking.yes} busy={busy} onYes={() => void doAsk()} onNo={() => setAsking(null)} />}
    </div>
  )
}

/** What VoiceOver reads for a row: the name, the numbers, the mark in words, the lines. */
function rowWords(e: Entry, n: ReturnType<typeof boardRows>[number]['numbers'], period: Period): string {
  const parts: string[] = []
  parts.push(e.you ? 'You' : e.name)
  if (n !== null) {
    parts.push(`${n.cards} cards`, `${n.minutes} minutes`)
    if (n.mark !== null) parts.push(markWords(n.mark, period))
  }
  if (!e.you && (e.buddyStreak ?? 0) > 0) parts.push(`${e.buddyStreak} day buddy streak`)
  parts.push(...e.sub)
  return parts.join(', ')
}

function GroupProblem({ view }: { view: Exclude<GroupView, { kind: 'not-found' }> }) {
  const message = groupViewMessage(view)
  return message === null ? null : <Problem quiet message={message} />
}

function ManageGroupSheet({
  view,
  d1Group,
  initialQr = false,
  service,
  ask,
  onOpenSettings,
  onClose,
}: {
  view: Exclude<GroupView, { kind: 'not-found' }>
  d1Group?: GroupBoardItem
  initialQr?: boolean
  service: FriendsService
  ask: (q: string, yes: string, run: () => Promise<unknown>) => void
  onOpenSettings: () => void
  onClose: () => void
}) {
  const groups = service.groups!
  const name = gistText(view.name) || 'this group'
  const isAdmin = view.kind === 'ok' && view.iAmAdmin
  const inviteUrl = d1Group?.inviteCode
    ? ownSiteLink(`https://docs.yaseenarshad.com/group#${d1Group.inviteCode}`)
    : ownSiteLink(groupLink(view.group))
  const [qrUrl, setQrUrl] = useState<string | null>(initialQr ? inviteUrl : null)
  const [linkFallback, setLinkFallback] = useState<string | null>(null)
  const [sheetSaid, setSheetSaid] = useState<string | null>(null)

  const shareGroupUrl = async (url: string) => {
    const how = await shareOut(groupShareText(name, url))
    if (how === 'show') setLinkFallback(url)
    setSheetSaid(how === 'copied' ? 'Link copied. Send it.' : null)
  }

  if (qrUrl !== null) {
    return (
      <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="fr-qr-sheet" role="dialog" aria-modal="true" aria-label={`Invite to ${name}`}>
          <h2 className="fr-qr-sheet__title">Share your group link to invite friends to {name}</h2>
          <div className="fr-qr-sheet__box" dangerouslySetInnerHTML={{ __html: qrCodeSvg(qrUrl) }} />
          <p className="fr-qr-sheet__hint">Ask friends to scan QR code</p>
          <p className="fr-qr-sheet__or">or</p>
          <button type="button" className="btn btn--primary btn--wide fr-pill-btn" onClick={() => void shareGroupUrl(qrUrl)}>
            Share link
          </button>
          {sheetSaid !== null && (
            <p role="status" className="fr-line" style={{ marginTop: 8 }}>
              {sheetSaid}
            </p>
          )}
          {linkFallback !== null && <LinkToCopy link={linkFallback} />}
          <button type="button" className="link-btn" onClick={onClose} style={{ marginTop: 10 }}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fr-action-sheet" role="dialog" aria-modal="true" aria-label={`Manage ${name} group`}>
        <div className="fr-action-sheet__head">
          <h2 className="fr-action-sheet__title">Manage “{name}” group</h2>
          <p className="fr-action-sheet__sub">{isAdmin ? "You're an admin" : 'Member'}</p>
        </div>
        <button type="button" className="fr-action-sheet__btn" onClick={() => setQrUrl(inviteUrl)}>
          Invite to group
        </button>
        <button type="button" className="fr-action-sheet__btn" onClick={onOpenSettings}>
          Group Settings
        </button>
        {view.kind !== 'removing' && (
          <button
            type="button"
            className="fr-action-sheet__btn fr-action-sheet__btn--danger"
            onClick={() => ask(`Leave ${name}? The others stop seeing your numbers.`, 'Leave group', () => groups.leave(view.group))}
          >
            Leave group
          </button>
        )}
        <button type="button" className="fr-action-sheet__btn fr-action-sheet__btn--cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** StepUp-style Group Settings screen: Group name (admin edit), Members (Ban), Banned people (Unban), Leave, Delete. */
function GroupSettingsScreen({
  view,
  d1Group,
  service,
  ask,
  say,
  refresh,
  onBack,
}: {
  view: Exclude<GroupView, { kind: 'not-found' }>
  d1Group?: GroupBoardItem
  service: FriendsService
  ask: (q: string, yes: string, run: () => Promise<unknown>) => void
  say: (s: string | null) => void
  refresh: () => Promise<void>
  onBack: () => void
}) {
  const groups = service.groups!
  const isAdmin = view.kind === 'ok' && view.iAmAdmin
  const currentName = gistText(view.name) || 'Group'
  const [nameInput, setNameInput] = useState(view.name.replace(/[\u2068\u2069]/g, ''))
  const [savingName, setSavingName] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const members = d1Group?.members ?? []
  const banned = ((d1Group as (GroupBoardItem & { banned?: { id: number; login: string; name: string }[] }) | undefined)?.banned) ?? []

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!service.renameGroup || !d1Group || savingName || !nameInput.trim()) return
    setSavingName(true)
    try {
      const r = await service.renameGroup(d1Group.id, nameInput.trim())
      say(r.ok ? 'Group name updated.' : 'Could not rename group.')
      await refresh()
    } finally {
      setSavingName(false)
    }
  }

  return (
    <div>
      <div className="fr-gs-head">
        <button type="button" className="icon-btn" aria-label="Back to group" onClick={onBack}>
          ←
        </button>
        <h2 className="fr-gs-title">Group Settings</h2>
      </div>

      <h3 className="section">Group name</h3>
      {isAdmin ? (
        <form className="fr-gs-name-form" onSubmit={(e) => void saveName(e)}>
          <input
            aria-label="Group name"
            className="fr-modal-card__input"
            value={nameInput}
            maxLength={GROUP_NAME_MAX}
            onChange={(e) => setNameInput(e.target.value)}
            disabled={savingName}
          />
          <button type="submit" className="btn btn--primary" disabled={savingName || !nameInput.trim()}>
            {savingName ? 'Saving…' : 'Save'}
          </button>
        </form>
      ) : (
        <p className="fr-line">{currentName}</p>
      )}

      <h3 className="section">Members ({members.length})</h3>
      <ul className="rows">
        {members.map((m) => (
          <li key={m.id} className="fr-gs-row">
            <span>
              <b>{gistText(m.name || m.login)}</b> <span className="fr-sub">@{m.login}</span>
            </span>
            {isAdmin && d1Group && m.id !== d1Group.adminId && (
              <button
                type="button"
                className="btn"
                disabled={busyId === m.id}
                onClick={() => {
                  setBusyId(m.id)
                  void service
                    .banGroupMember?.(d1Group.id, m.id)
                    .then((r) => {
                      say(r?.ok ? `Banned ${gistText(m.name || m.login)}.` : 'Could not ban member.')
                      return refresh()
                    })
                    .finally(() => setBusyId(null))
                }}
              >
                Ban
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="section">Banned people</h3>
      {banned.length === 0 ? (
        <p className="fr-line">No banned people</p>
      ) : (
        <ul className="rows">
          {banned.map((b) => (
            <li key={b.id} className="fr-gs-row">
              <span>
                <b>{gistText(b.name || b.login)}</b> <span className="fr-sub">@{b.login}</span>
              </span>
              {isAdmin && d1Group && (
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === b.id}
                  onClick={() => {
                    setBusyId(b.id)
                    void service
                      .unbanGroupMember?.(d1Group.id, b.id)
                      .then((r) => {
                        say(r?.ok ? `Unbanned ${gistText(b.name || b.login)}.` : 'Could not unban member.')
                        return refresh()
                      })
                      .finally(() => setBusyId(null))
                  }}
                >
                  Unban
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="stack" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="btn btn--wide"
          onClick={() => ask(`Leave ${currentName}? The others stop seeing your numbers.`, 'Leave group', () => groups.leave(view.group))}
        >
          Leave group
        </button>
        {isAdmin && (
          <button
            type="button"
            className="btn btn--wide btn--danger"
            onClick={() => ask(`Delete ${currentName}? The group is gone for each person in it.`, 'Delete group', () => groups.delete(view.group))}
          >
            Delete group
          </button>
        )}
      </div>
    </div>
  )
}

/** StepUp-style centered `+` action menu: Add friends (QR), Create new group, Enter link, Cancel. */
function AddPanel({
  panel,
  setPanel,
  service,
  refresh,
}: {
  panel: Panel
  setPanel: (p: Panel) => void
  service: FriendsService
  refresh: () => Promise<void>
}) {
  if (panel === null) return null
  if (panel === 'menu')
    return (
      <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
        <div className="fr-action-sheet" role="dialog" aria-modal="true" aria-label="Add">
          <button type="button" className="fr-action-sheet__btn" onClick={() => setPanel('share')}>
            Add friends
          </button>
          {service.groups !== null && (
            <button type="button" className="fr-action-sheet__btn" onClick={() => setPanel('group')}>
              Create new group
            </button>
          )}
          <button type="button" className="fr-action-sheet__btn" onClick={() => setPanel('paste')}>
            Enter link to add friend/group
          </button>
          <button type="button" className="fr-action-sheet__btn fr-action-sheet__btn--cancel" onClick={() => setPanel(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  if (panel === 'share') return <SharePanel service={service} close={() => setPanel(null)} refresh={refresh} />
  if (panel === 'paste') return <PastePanel service={service} close={() => setPanel(null)} refresh={refresh} />
  return <GroupPanel service={service} close={() => setPanel(null)} refresh={refresh} />
}

const UNAVAILABLE_WORDS: Record<Unavailable['kind'], string> = {
  'no-gists': 'Friends needs the Gists permission on your token.',
  'no-account': 'Friends starts after the app checks your token. Open the app once with a connection.',
  offline: 'No connection. Try again when you are online.',
  'rate-limited': 'GitHub asks the app to wait. Try again in a few minutes.',
  unauthorized: 'Sign in again, then try again.',
  'newer-app': 'Your friends list was written by a newer Yaseen Docs. Update this app.',
  'needs-repair': LIST_NEEDS_REPAIR,
  'list-elsewhere': 'Your friends list is in another of your vaults. Add that vault on this phone to use Friends here.',
  'no-list-access': NO_LIST_ACCESS,
  'home-gone': 'The vault that held your friends list is gone on GitHub. Open Friends to start the list again.',
  'list-cut': LIST_CUT,
  failed: 'Something went wrong. Try again.',
}

/** StepUp-style dedicated QR Share sheet: auto-generates invite link, renders crisp QR + "Share link" pill. */
function SharePanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [state, setState] = useState<{
    busy: boolean
    said: string | null
    link: string | null
    qrUrl: string | null
    title: string
    text: string
  }>({ busy: true, said: null, link: null, qrUrl: null, title: 'Yaseen Docs friend link', text: 'Add me as a friend on Yaseen Docs.' })

  useEffect(() => {
    let live = true
    void service.share().then((made) => {
      if (!live) return
      if (made.kind !== 'ok') {
        setState((s) => ({ ...s, busy: false, said: UNAVAILABLE_WORDS[made.kind] }))
        return
      }
      const url = ownSiteLink(made.link)
      setState({ busy: false, said: null, link: null, qrUrl: url, title: made.title, text: made.text })
      void refresh()
    })
    return () => {
      live = false
    }
  }, [service, refresh])

  const shareNow = async () => {
    if (!state.qrUrl) return
    const how = await shareOut({ title: state.title, text: state.text, url: state.qrUrl })
    setState((s) => ({
      ...s,
      said: SHARED_WORDS[how],
      link: how === 'show' ? state.qrUrl : null,
    }))
  }

  return (
    <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="fr-qr-sheet" role="dialog" aria-modal="true" aria-label="Share your friend link">
        <h2 className="fr-qr-sheet__title">Share your unique friend link to add friends</h2>
        {state.busy ? (
          <p className="fr-line" aria-busy="true">
            Making your link…
          </p>
        ) : state.qrUrl !== null ? (
          <>
            <div className="fr-qr-sheet__box" dangerouslySetInnerHTML={{ __html: qrCodeSvg(state.qrUrl) }} />
            <p className="fr-qr-sheet__hint">Ask friends to scan QR code</p>
            <p className="fr-qr-sheet__or">or</p>
            <button type="button" className="btn btn--primary btn--wide fr-pill-btn" onClick={() => void shareNow()}>
              Share link
            </button>
          </>
        ) : null}
        {state.said !== null && (
          <p role="status" className="fr-line" style={{ marginTop: 8 }}>
            {state.said}
          </p>
        )}
        {state.link !== null && <LinkToCopy link={state.link} />}
        <p className="fr-qr-sheet__hint" style={{ marginTop: 10 }}>
          {service.whatFriendsSee}
        </p>
        <button type="button" className="link-btn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  )
}

/** Words for each answer to a paste: a friend link (4E2), a group link or a join request (4E3). */
function pasteWords(answer: PasteAnswer): string {
  if (answer.kind === 'list-elsewhere' && 'home' in answer && typeof answer.home === 'string') return listElsewhereMessage(answer.home)
  if (answer.kind in UNAVAILABLE_WORDS && !('name' in answer)) return UNAVAILABLE_WORDS[answer.kind as Unavailable['kind']]
  if (['request', 'already-member', 'not-your-group', 'not-a-join-link', 'duplicate', 'unverified'].includes(answer.kind))
    return adminWords(answer as JoinRequest)
  if (['joined', 'already', 'own-group', 'is-friend-link', 'is-join-request', 'not-a-group-link'].includes(answer.kind) && !('paired' in answer))
    return joinMessage(answer as JoinResult)
  return pasteMessage(answer as PasteResult)
}

/**
 * "Paste a friend's link" (decision 20): a tap reads the clipboard (iOS asks; it may say no), else the person pastes
 * in the field. After an add that is not paired yet, the app offers to send my link back (4E2: `sendBack`).
 */
function PastePanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<PasteAnswer | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const running = useRef(false)
  const addRunning = useRef(false)
  const [adding, setAdding] = useState(false)
  const add = async (value: string) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setSaid(null)
    try {
      const result = await service.paste(value)
      setAnswer(result)
      setSaid(pasteWords(result))
      if (result.kind === 'added' || result.kind === 'joined') void refresh()
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const fromClipboard = async () => {
    const read = await readClipboard()
    if (read === null || read.trim() === '') {
      setSaid('Paste the link in the field below.')
      field.current?.focus()
      return
    }
    setText(read)
    await add(read)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const sendBack =
    answer !== null && answer.kind === 'added' && !answer.paired
      ? answer.sendBack
      : answer !== null && answer.kind === 'joined' && answer.sendToAdmin !== ''
      ? answer.sendToAdmin
      : null
  const request = answer !== null && answer.kind === 'request' ? answer : null
  return (
    <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="fr-modal-card" role="dialog" aria-modal="true" aria-label="Paste invite link to join group or add friend">
        <h2 className="fr-modal-card__title">Paste invite link to join group or add friend</h2>
        <p className="fr-modal-card__hint">Eg. https://docs.yaseenarshad.com/friend#k9x2m7 or k9x2m7</p>
        <input
          ref={field}
          className="fr-modal-card__input"
          name="friend-link"
          aria-label="Invite link"
          placeholder="Invite link"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          maxLength={2000}
        />
        <div className="fr-modal-card__actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void add(text)} disabled={busy || text.trim() === ''} aria-busy={busy}>
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
        <button type="button" className="link-btn" onClick={() => void fromClipboard()} disabled={busy} style={{ marginTop: 8 }}>
          Paste from clipboard
        </button>
        {said !== null && (
          <p role="status" className="fr-line" style={{ marginTop: 8 }}>
            {said}
          </p>
        )}
        {sendBack !== null && (
          <button
            type="button"
            className="btn btn--wide"
            onClick={() =>
              void shareOut(
                answer?.kind === 'joined'
                  ? joinShareText(gistText(answer.name, 30), ownSiteLink(sendBack))
                  : {
                      title: 'Yaseen Docs friend link',
                      text: 'Add me as a friend on Yaseen Docs. Open this link, copy the code, then paste it in the app.',
                      url: ownSiteLink(sendBack),
                    },
              ).then((how) => {
                if (how === 'show') setLink(ownSiteLink(sendBack))
                else if (SHARED_WORDS[how] !== null) setSaid(SHARED_WORDS[how])
              })
            }
          >
            {answer?.kind === 'joined' ? 'Send my join link to the admin' : 'Send my link back'}
          </button>
        )}
        {request !== null && service.groups !== null && (
          <button
            type="button"
            className="btn btn--wide"
            disabled={adding}
            aria-busy={adding}
            onClick={() => {
              if (addRunning.current) return
              addRunning.current = true
              setAdding(true)
              void service.groups!.add(request.group, text).then((r) => {
                addRunning.current = false
                setAdding(false)
                setSaid(
                  r.kind === 'done'
                    ? `${gistText(request.name)} is in ${gistText(request.groupName)} now.`
                    : r.kind in UNAVAILABLE_WORDS
                    ? UNAVAILABLE_WORDS[r.kind as Unavailable['kind']]
                    : adminWords(r as GroupChange),
                )
                setAnswer(null)
                void refresh()
              })
            }}
          >
            {adding ? 'Adding…' : `Add ${gistText(request.name)}`}
          </button>
        )}
        {link !== null && <LinkToCopy link={link} />}
      </div>
    </div>
  )
}

/** StepUp-style centered modal for creating a new group. */
function GroupPanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const running = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const make = async () => {
    if (running.current || service.groups === null) return
    running.current = true
    setBusy(true)
    try {
      const made = await service.groups.create(name)
      if (made.kind === 'bad-name') return setSaid('Give the group a name.')
      if (made.kind !== 'ok') return setSaid(UNAVAILABLE_WORDS[made.kind])
      void refresh()
      const data = groupShareText(gistText(name, 30), ownSiteLink(made.link))
      setQrUrl(data.url)
      const how = await shareOut(data)
      if (how === 'show') setLink(data.url)
      setSaid('Group made. Share the link or QR code with the people you want in it.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="fr-modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="fr-modal-card" role="dialog" aria-modal="true" aria-label="Create new group">
        <h2 className="fr-modal-card__title">Create new group</h2>
        <p className="fr-modal-card__hint">Study together and share cards in one group.</p>
        <input
          className="fr-modal-card__input"
          name="group-name"
          aria-label="Group name"
          placeholder="Group name"
          value={name}
          maxLength={GROUP_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="fr-modal-card__actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void make()} disabled={busy || name.trim() === ''} aria-busy={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
        {qrUrl !== null && <div className="fr-qr-sheet__box" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: qrCodeSvg(qrUrl) }} />}
        {said !== null && (
          <p role="status" className="fr-line" style={{ marginTop: 8 }}>
            {said}
          </p>
        )}
        {link !== null && <LinkToCopy link={link} />}
      </div>
    </div>
  )
}

const GROUP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function shortMonthDay(day: string): string {
  const parts = day.split('-')
  if (parts.length !== 3) return day
  return `${Number(parts[1])}/${Number(parts[2])}`
}

function weekdayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return GROUP_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
}

function GroupStreakScreen({
  view,
  d1Group,
  board,
  now,
  onBack,
}: {
  view: Extract<GroupView, { kind: 'ok' }>
  d1Group?: GroupBoardItem
  board: OkBoard
  now: number
  onBack: () => void
}) {
  const groupName = gistText(view.name) || 'Group'
  const todayStr = localDay(now)
  const stripRef = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    const el = stripRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [todayStr, view.group])

  const members = view.members.map((m) => {
    const ok = m.read !== null && m.read.kind === 'ok' ? m.read : null
    const stats = m.me ? board.me.stats : ok?.stats ?? null
    const d1Member = d1Group?.members.find((dm) => String(dm.id) === m.pointer)
    const friendMatch = board.friends.find((f) => f.theirs === m.pointer)
    const avatar = m.me ? board.me.avatar : friendMatch?.avatar ?? d1Member?.avatarUrl ?? null
    const name = m.me ? board.me.name || 'You' : gistText(m.name) || gistText(m.login) || 'Member'
    const sinceDay = sinceDayKey(d1Member?.since)
    return { pointer: m.pointer, name, avatar, stats, sinceDay }
  })

  const minStripDay = addDays(todayStr, -29)
  const candidateStarts = [
    sinceDayKey(d1Group?.createdAt),
    ...members.map((m) => m.sinceDay),
  ].filter((d): d is string => d !== null)
  const earliestSince = candidateStarts.length > 0 ? candidateStarts.reduce((a, b) => (a < b ? a : b)) : null
  const stripStart =
    earliestSince !== null && earliestSince > minStripDay
      ? earliestSince > todayStr
        ? todayStr
        : earliestSince
      : minStripDay

  const stripDays: string[] = []
  for (let d = stripStart; d <= todayStr && stripDays.length < 30; d = addDays(d, 1)) {
    stripDays.push(d)
  }
  if (stripDays.length === 0) stripDays.push(todayStr)

  const days30 = stripDays.map((day) => {
    const isToday = day === todayStr
    const statuses = members
      .map((m) => {
        const isPreMembership = m.sinceDay !== null && day < m.sinceDay
        const entry = m.stats?.days.find((d) => d.day === day)
        const hasDayEntry = entry !== undefined
        const done = !isPreMembership && entry?.done === true
        const missed = !done && !isToday && !isPreMembership && hasDayEntry
        return {
          ...m,
          isPreMembership,
          hasDayEntry,
          done,
          missed,
        }
      })
      .sort((a, b) => (a.done ? 0 : 1) - (b.done ? 0 : 1))
    const eligible = statuses.filter((s) => !s.isPreMembership)
    return {
      day,
      isToday,
      weekday: weekdayShort(day),
      shortDate: shortMonthDay(day),
      statuses,
      allDone: eligible.length > 0 && eligible.every((s) => s.done),
    }
  })

  const memberSummaries = members
    .map((m) => {
      const finishedCount = days30.filter((d) => d.statuses.some((s) => s.pointer === m.pointer && s.done)).length
      const eligibleDays = Math.max(
        1,
        days30.filter((d) => d.statuses.some((s) => s.pointer === m.pointer && !s.isPreMembership)).length,
      )
      return {
        ...m,
        finishedCount,
        eligibleDays,
      }
    })
    .sort((a, b) => b.finishedCount - a.finishedCount || a.name.localeCompare(b.name))

  const brokenDay = [...days30].filter((d) => !d.isToday).reverse().find((d) => !d.allDone) ?? null
  const missedNames = brokenDay
    ? brokenDay.statuses.filter((s) => !s.isPreMembership && s.hasDayEntry && !s.done).map((s) => s.name)
    : []

  const heroSubtitle =
    view.streak === 1
      ? '1 day in a row everyone finished'
      : view.streak > 1
      ? `${view.streak} days in a row everyone finished`
      : 'Everyone finish due cards today to start a group streak'

  return (
    <div>
      <div className="fr-gs-head">
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
        <h2 className="fr-gs-title">{groupName}</h2>
      </div>
      <div className="fr-hype-wrap">
        <span className="fr-hype-pill">🔥 {view.streak}d group streak</span>
        <p className="fr-hype-sub">{heroSubtitle}</p>
        {brokenDay !== null && missedNames.length > 0 && (
          <p className="fr-hype-sub">
            Last broken on {brokenDay.weekday} {brokenDay.shortDate} by {missedNames.join(', ')}
          </p>
        )}
      </div>
      <ul ref={stripRef} className="fr-strip30" aria-label={`Last ${days30.length} ${days30.length === 1 ? 'day' : 'days'} for ${groupName}`}>
        {days30.map((d) => (
          <li
            key={d.day}
            className={d.allDone ? 'fr-day fr-strip30__col fr-day--both' : 'fr-day fr-strip30__col'}
          >
            <span className="fr-day__wk" aria-hidden="true">
              {d.weekday}
            </span>
            <span className="fr-day__dt" aria-hidden="true">
              {d.shortDate}
            </span>
            <span className="fr-day__avs" aria-hidden="true">
              {d.statuses.map((s) => (
                <span
                  key={s.pointer}
                  className={
                    s.done
                      ? 'fr-ring-av fr-ring-av--done'
                      : s.missed
                      ? 'fr-ring-av fr-ring-av--missed'
                      : 'fr-ring-av'
                  }
                  title={
                    s.done
                      ? `${s.name}: finished`
                      : s.isPreMembership
                      ? `${s.name}: not in group yet`
                      : d.isToday
                      ? `${s.name}: in progress today`
                      : s.missed
                      ? `${s.name}: missed`
                      : `${s.name}: no data`
                  }
                >
                  {s.avatar ? <img src={s.avatar} alt="" referrerPolicy="no-referrer" /> : initialOf(s.name)}
                  {(s.done || s.missed) && (
                    <span
                      className={s.done ? 'fr-ring-av__badge fr-ring-av__badge--done' : 'fr-ring-av__badge fr-ring-av__badge--missed'}
                      aria-hidden="true"
                    >
                      {s.done ? '✓' : '✕'}
                    </span>
                  )}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <ul className="rows" style={{ marginTop: 14 }} aria-label="Member streak summary">
        {memberSummaries.map((m) => (
          <li key={m.pointer} className="fr-gs-row">
            <span className="fr-legend-who">
              <span className="fr-ring-av fr-ring-av--legend" aria-hidden="true">
                {m.avatar ? <img src={m.avatar} alt="" referrerPolicy="no-referrer" /> : initialOf(m.name)}
              </span>
              <span className="fr-name">{m.name}</span>
            </span>
            <span className="fr-sub">
              {m.finishedCount} of {m.eligibleDays} {m.eligibleDays === 1 ? 'day' : 'days'} finished
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Lightweight inline canvas confetti burst for daily Buddy Streak reveal (YAZ-6269). */
function ConfettiBurst({ trigger }: { trigger: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = (canvas.width = globalThis.innerWidth || 390)
    const h = (canvas.height = globalThis.innerHeight || 844)
    const colors = ['#4a5ae8', '#16a34a', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6']
    const pieces = Array.from({ length: 48 }, (_, i) => ({
      x: w * 0.5 + (Math.random() - 0.5) * 140,
      y: h * 0.25 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 7 - 2,
      size: 6 + (i % 5),
      color: colors[i % colors.length],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.25,
    }))
    let frame = 0
    let raf = 0
    const tick = () => {
      frame++
      ctx.clearRect(0, 0, w, h)
      for (const p of pieces) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.28
        p.rot += p.vrot
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }
      if (frame < 75) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, w, h)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [trigger])
  return <canvas ref={ref} className="fr-confetti-canvas" aria-hidden="true" />
}

const CARD_FILTERS: readonly { id: SharedCardStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Added' },
  { id: 'dismissed', label: 'Dismissed' },
]

const EMPTY_PREVIEW_LINKS: WikilinkResolveSource = {
  resolve: null,
  records: [],
  folders: [],
  ids: false,
  letters: [],
  pills: NO_LINK_PILLS,
  vault: null,
  subscribe: () => () => undefined,
}

function SharedCardRow({
  card,
  sourceLabel,
  armed = false,
  onArmDismiss,
  onClearArm,
  service,
  refresh,
  say,
  onPreview,
  onAccept,
}: {
  card: SharedCardItem
  sourceLabel?: string
  armed?: boolean
  onArmDismiss?: () => void
  onClearArm?: () => void
  service: FriendsService
  refresh: () => Promise<void>
  say: (s: string | null) => void
  onPreview: (card: SharedCardItem) => void
  onAccept: (card: SharedCardItem) => void
}) {
  const [busy, setBusy] = useState(false)
  const setStatus = async (status: SharedCardStatus) => {
    if (!service.setCardState || busy) return
    onClearArm?.()
    setBusy(true)
    try {
      const r = await service.setCardState(card.id, status)
      if (!r.ok) say('Could not update card status.')
      else say(status === 'dismissed' ? 'Card dismissed.' : status === 'pending' ? 'Restored to pending.' : null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fr-shared-row">
      <button type="button" className="fr-shared-row__main" onClick={() => onPreview(card)}>
        <span className="fr-shared-row__title">{gistText(card.title, 80) || 'Shared card'}</span>
        <span className="fr-shared-row__sub">
          {sourceLabel ?? `from @${gistText(card.senderLogin, 40)}`}
          {card.note ? ` · ${gistText(card.note, 120)}` : ''}
        </span>
      </button>
      <div className="fr-shared-row__right">
        {card.status === 'pending' && (
          <>
            <button type="button" className="fr-add-pill" disabled={busy} onClick={() => onAccept(card)}>
              Add
            </button>
            {armed ? (
              <button type="button" className="fr-dismiss-confirm" disabled={busy} onClick={() => void setStatus('dismissed')}>
                Dismiss?
              </button>
            ) : (
              <button
                type="button"
                className="fr-dismiss-x"
                disabled={busy}
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => (onArmDismiss ? onArmDismiss() : void setStatus('dismissed'))}
              >
                ×
              </button>
            )}
          </>
        )}
        {card.status === 'dismissed' && (
          <button type="button" className="fr-undo-pill" disabled={busy} onClick={() => void setStatus('pending')}>
            Undo
          </button>
        )}
        {card.status === 'accepted' && <span className="fr-shared-row__sub">Added ✓</span>}
      </div>
    </div>
  )
}

/**
 * Real draggable Explore bottom sheet (`sheetMotion` + `explore.css`) for previewing a shared card
 * before accepting or dismissing it — smooth drag-up/drag-down to dismiss, grabber handle, and real `drawLocalCard`.
 */
function SharedCardPreviewSheet({
  card,
  service,
  refresh,
  say,
  onClose,
  onAccept,
}: {
  card: SharedCardItem
  service: FriendsService
  refresh: () => Promise<void>
  say: (s: string | null) => void
  onClose: () => void
  onAccept: (card: SharedCardItem) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const dim = useRef<HTMLDivElement>(null)
  const motion = useRef<SheetMotion | null>(null)
  const cardBodyRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const latestClose = useRef(onClose)
  latestClose.current = onClose

  useLayoutEffect(() => {
    if (!box.current || !head.current || !body.current || !mark.current || !dim.current) return
    const m = sheetMotion(
      { box: box.current, head: head.current, body: body.current, top: mark.current, dim: dim.current },
      { onClosed: () => latestClose.current(), edge: swipeIsOurs(whereAmI(browserFacts())) },
    )
    motion.current = m
    m.open()
    box.current.focus({ preventScroll: true })
    return () => {
      m.destroy()
      motion.current = null
    }
  }, [])

  const closeAnimated = () => {
    if (motion.current) motion.current.close()
    else onClose()
  }

  useEffect(() => {
    const el = cardBodyRef.current
    if (!el) return
    const drawn = drawLocalCard(
      card.markdown,
      { sides: 99, shown: 99, next: null },
      { links: EMPTY_PREVIEW_LINKS, files: [], holder: '' },
    )
    el.replaceChildren(drawn)
  }, [card.markdown])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAnimated()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setStatus = async (status: SharedCardStatus) => {
    if (!service.setCardState || busy) return
    setBusy(true)
    try {
      const r = await service.setCardState(card.id, status)
      if (!r.ok) say('Could not update card status.')
      else say(status === 'dismissed' ? 'Card dismissed.' : 'Restored to pending.')
      await refresh()
      closeAnimated()
    } finally {
      setBusy(false)
    }
  }

  const title = gistText(card.title, 80) || 'Shared card'
  const sheet = (
    <div className="explore-layer">
      <div ref={dim} className="explore-dim explore-dim--top" style={{ zIndex: 0 }} onClick={closeAnimated} aria-hidden="true" />
      <div className="explore-sheet" style={{ zIndex: 1, '--sheet-step': 0 } as CSSProperties}>
        <div ref={box} className="explore-sheet__box" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
          <div ref={head} className="explore-sheet__head">
            <span className="explore-sheet__grab" aria-hidden="true" />
            <span className="explore-sheet__where">shared from @{gistText(card.senderLogin, 40)}</span>
            <button type="button" className="explore-sheet__more" aria-label="Close preview" onClick={closeAnimated}>
              ✕
            </button>
          </div>
          <div ref={body} className="explore-sheet__body">
            <div ref={mark} className="explore-sheet__top" aria-hidden="true" />
            <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 className="fr-preview-title" style={{ fontSize: 18 }}>
                {title}
              </h2>
              {card.note && <p className="fr-preview-note">“{gistText(card.note, 200)}”</p>}
              <div className="fr-preview-card card card-screen">
                <div ref={cardBodyRef} className="phone-card__body" />
              </div>
              <div className="fr-preview-actions">
                {card.status === 'pending' && (
                  <>
                    <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onAccept(card)}>
                      Add to vault
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => void setStatus('dismissed')}>
                      Dismiss
                    </button>
                  </>
                )}
                {card.status === 'dismissed' && (
                  <button type="button" className="btn" disabled={busy} onClick={() => void setStatus('pending')}>
                    Undo dismiss
                  </button>
                )}
                {card.status === 'accepted' && <span className="fr-preview-meta">Added to vault ✓</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet
}

/** ONE unified flat Shared (N) view (1:1 incoming cards + group shared folders & cards). */
function UnifiedSharedView({
  cards,
  folders,
  service,
  refresh,
  say,
  onPreview,
  onAcceptCard,
  onImportFolder,
}: {
  cards: { card: SharedCardItem; groupName: string | null }[]
  folders: { folder: SharedFolderItem; groupName: string }[]
  service: FriendsService
  refresh: () => Promise<void>
  say: (s: string | null) => void
  onPreview: (card: SharedCardItem) => void
  onAcceptCard: (card: SharedCardItem) => void
  onImportFolder: (folder: SharedFolderItem) => void
}) {
  const [status, setStatus] = useState<SharedCardStatus>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [armedDismissId, setArmedDismissId] = useState<string | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearArm = () => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current)
      armTimer.current = null
    }
    setArmedDismissId(null)
  }

  const armDismiss = (id: string) => {
    if (armTimer.current !== null) clearTimeout(armTimer.current)
    setArmedDismissId(id)
    armTimer.current = setTimeout(() => {
      setArmedDismissId(null)
      armTimer.current = null
    }, 3000)
  }

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current)
    }
  }, [])

  const visibleFolders = folders.filter((x) => x.folder.cards.some((c) => c.status === status))
  const visibleCards = cards.filter((x) => x.card.status === status)

  const setFolderStatus = async (folderId: string, next: SharedCardStatus) => {
    if (!service.setFolderState || busyId !== null) return
    clearArm()
    setBusyId(folderId)
    try {
      const r = await service.setFolderState(folderId, next)
      if (!r.ok) say('Could not update folder status.')
      else say(next === 'dismissed' ? 'Folder dismissed.' : 'Folder restored to pending.')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="fr-shared-flat" aria-label="Shared cards">
      <div className="fr-sort" role="group" aria-label="Shared card filter">
        {CARD_FILTERS.map((f) => (
          <button key={f.id} type="button" className="fr-sort__btn" aria-pressed={f.id === status} onClick={() => setStatus(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {visibleFolders.length === 0 && visibleCards.length === 0 ? (
        <p className="fr-line">No {status} shared cards.</p>
      ) : (
        <>
          {visibleFolders.map(({ folder, groupName }) => {
            const matching = folder.cards.filter((c) => c.status === status)
            return (
              <div key={folder.id} className="fr-shared-folder">
                <div className="fr-shared-folder__head">
                  <div className="fr-shared-folder__info">
                    <span className="fr-shared-row__title">📁 {gistText(folder.name, 60) || 'Shared folder'}</span>
                    <span className="fr-shared-row__sub">
                      from {gistText(folder.senderLogin, 40)} · {gistText(groupName, 30)} · {matching.length} {matching.length === 1 ? 'card' : 'cards'}
                    </span>
                  </div>
                  <div className="fr-shared-row__right">
                    {status === 'pending' && (
                      <>
                        <button type="button" className="fr-add-pill" disabled={busyId !== null} onClick={() => onImportFolder(folder)}>
                          Import ({matching.length})
                        </button>
                        {armedDismissId === folder.id ? (
                          <button
                            type="button"
                            className="fr-dismiss-confirm"
                            disabled={busyId !== null}
                            onClick={() => void setFolderStatus(folder.id, 'dismissed')}
                          >
                            Dismiss?
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="fr-dismiss-x"
                            disabled={busyId !== null}
                            aria-label="Dismiss"
                            title="Dismiss"
                            onClick={() => armDismiss(folder.id)}
                          >
                            ×
                          </button>
                        )}
                      </>
                    )}
                    {status === 'dismissed' && (
                      <button type="button" className="fr-undo-pill" disabled={busyId !== null} onClick={() => void setFolderStatus(folder.id, 'pending')}>
                        Undo
                      </button>
                    )}
                    {status === 'accepted' && <span className="fr-shared-row__sub">Imported ✓</span>}
                  </div>
                </div>
                <ul className="fr-folder-cards">
                  {matching.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="fr-folder-cards__btn" onClick={() => onPreview(c)}>
                        <span>{gistText(c.title, 80) || 'Shared card'}</span>
                        <span className="fr-folder-cards__chev" aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {visibleCards.map(({ card, groupName }) => (
            <SharedCardRow
              key={card.id}
              card={card}
              sourceLabel={groupName ? `from ${gistText(card.senderLogin, 40)} · ${gistText(groupName, 30)}` : `from ${gistText(card.senderLogin, 40)}`}
              armed={armedDismissId === card.id}
              onArmDismiss={() => armDismiss(card.id)}
              onClearArm={clearArm}
              service={service}
              refresh={refresh}
              say={say}
              onPreview={onPreview}
              onAccept={onAcceptCard}
            />
          ))}
        </>
      )}
    </section>
  )
}
