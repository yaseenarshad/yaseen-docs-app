import { useEffect, useMemo, useRef, useState } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import { LIST_CUT, NO_LIST_ACCESS, TOO_MANY_GISTS, homeGoneMessage, listElsewhereMessage, pasteMessage, restartAction, restartWarning, type PasteResult } from '@shared/friendsList'
import type { FriendBoardMember, GroupBoardItem, SharedCardItem, SharedCardStatus, SharedFolderItem } from '@shared/friendsApi'
import { qrCodeSvg } from '@shared/qrSvg'
import { useApp } from '../../app/AppState'
import { friendsMessage } from '../../auth/friends'
import { Confirm } from '../../screens/Confirm'
import { Problem } from '../../screens/Frame'
import type { Unavailable } from '../list'
import {
  MARK_LINE,
  PERIODS,
  SORTS,
  boardRows,
  computeBuddyEmojis,
  filterSharedCards,
  gistText,
  markToShow,
  markWords,
  sendLine,
  sevenDayChain,
  updatedLabel,
  type BoardEntry,
  type BuddyEmoji,
  type LeaderboardSort,
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
import { Avatar, LinkToCopy, Mark, SHARED_WORDS, actionWords, groupShareText, joinShareText, ownSiteLink, readClipboard, shareOut } from './parts'
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
  cheer: string | null
  dim: boolean
  group?: string
  pointer?: string
  left?: boolean
  emojis?: BuddyEmoji[]
  chain?: ('done' | 'open' | 'missed')[]
}

const LAST_FOLDER_KEY = 'yaseendocs.friends.lastFolder'

function toD1Member(f: FriendEntry): FriendBoardMember {
  return {
    id: f.userId ?? 0,
    login: f.login ?? f.name,
    name: f.name,
    avatarUrl: f.avatar,
    since: f.since ?? new Date(0).toISOString(),
    stats: f.stats,
    statsAt: f.updatedAt ? new Date(f.updatedAt).toISOString() : null,
    incomingMark: f.mark ? { kind: f.mark.kind, message: f.incomingMarkMessage ?? null, at: f.mark.at, seenAt: null } : null,
    outgoingMark: f.outgoingMark ?? null,
    sharedCardCount: f.sharedCardCount ?? 0,
  }
}

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

/** No friend and no group yet: the two steps of decision 20, and one time what a friend sees (decision 22). */
function Empty({ service, setPanel }: { service: FriendsService | null; setPanel?: (p: Panel) => void }) {
  return (
    <div>
      <h2 className="title">Review with friends</h2>
      <p>Add a friend in two steps:</p>
      <ol className="fr-steps">
        <li>Share your link with your friend.</li>
        <li>Paste the link that your friend sends you.</li>
      </ol>
      <p className="muted">{service?.whatFriendsSee ?? 'Friends see your review numbers only: cards, minutes and streaks. Never your cards or your pages.'}</p>
      {setPanel !== undefined && (
        <div className="stack">
          <button type="button" className="btn btn--wide" onClick={() => setPanel('share')}>
            Share my link
          </button>
          <button type="button" className="btn btn--wide" onClick={() => setPanel('paste')}>
            Paste a friend's link
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
  const [sort, setSort] = useState<LeaderboardSort>('cards')
  const [list, setList] = useState<string>('friends')
  const [groupTab, setGroupTab] = useState<'leaderboard' | 'cards'>('leaderboard')
  const [panel, setPanel] = useState<Panel>(null)
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
  const showGroup = list !== 'friends' && group !== undefined
  /** This phone's send of my numbers, in one line (the Mac's Settings row says its own). */
  const sent = board.sending === undefined ? null : sendLine(board.sending, now)

  const friendEntries: Entry[] = useMemo(() => {
    const me: Entry = {
      key: 'me',
      name: gistText(board.me.name),
      you: true,
      stats: board.me.stats,
      streak: board.me.stats?.totals.streak ?? 0,
      chain: board.me.stats ? sevenDayChain(board.me.stats, now) : undefined,
      avatar: board.me.avatar,
      sub: board.me.stats === null ? ['Your numbers need each vault that counts on this phone.'] : [],
      cheer: null,
      dim: false,
    }
    const d1Friends = board.friends.filter((f) => f.userId !== undefined).map(toD1Member)
    const them = board.friends.map((f): Entry => {
      const shown = markToShow(f.mark, board.seen[f.theirs], now)
      const numbers = f.state === 'ok' || f.state === 'waiting'
      const sub: string[] = []
      if (f.state !== 'ok' && f.label !== null) sub.push(f.label)
      // Not read yet: with no signal, say so (round 3); else 4E2's "no update yet".
      if (!numbers && f.label === null) sub.push(f.state === 'offline' ? 'No connection. Not read yet.' : 'no update yet')
      const ago = numbers ? updatedLabel(f.updatedAt, now) : undefined
      const emojis = f.userId !== undefined ? computeBuddyEmojis(toD1Member(f), { stats: board.me.stats }, d1Friends, now) : []
      return {
        key: f.theirs,
        name: gistText(f.name) || 'Friend',
        you: false,
        stats: numbers ? f.stats : null,
        streak: numbers ? f.stats?.totals.streak ?? 0 : 0,
        chain: numbers && f.stats ? sevenDayChain(f.stats, now) : undefined,
        avatar: f.avatar,
        friend: f,
        sub,
        ago,
        cheer: shown === null ? null : f.incomingMarkMessage || MARK_LINE[shown.kind],
        dim: f.state === 'gone',
        emojis,
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
      return {
        key: m.pointer,
        name: m.me ? board.me.name : gistText(m.name) || gistText(m.login) || 'Member',
        you: m.me,
        stats: memberStats,
        streak: memberStats?.totals.streak ?? 0,
        chain: memberStats ? sevenDayChain(memberStats, now) : undefined,
        avatar: null,
        sub,
        ago: !m.me && ok !== null ? updatedLabel(ok.updatedAt, now) : undefined,
        cheer: null,
        dim: m.state === 'left',
        group: group.group,
        pointer: m.pointer,
        left: m.state === 'left',
      }
    })
  }, [group, board, now])

  const entries = showGroup ? groupEntries : friendEntries
  const rows = boardRows(entries, period, now, sort)
  const incomingCards = board.incomingCards ?? []
  const groupSharedCount =
    d1Group === undefined
      ? 0
      : d1Group.sharedCards.filter((c) => c.status === 'pending').length +
        d1Group.sharedFolders.reduce((acc, f) => acc + f.cards.filter((c) => c.status === 'pending').length, 0)

  // A friend who just added me back: said one time (the list marks the pair, so the next read has none).
  const paired = (board.newlyPaired ?? []).join(', ')
  useEffect(() => {
    if (paired !== '') setSaid(`${paired} added you back. You are friends now.`)
  }, [paired])

  const nobody = board.friends.length === 0 && board.groups.length === 0 && board.shared.length === 0 && incomingCards.length === 0

  // Decision 24, YAZ-5262: a cheer or nudge is "seen" when its line was really on the screen (`CheerLine`).
  const seenOnce = useRef(new Set<string>())
  const seeOnce = (f: FriendEntry) => {
    const mark = markToShow(f.mark, board.seen[f.theirs], now)
    if (mark === null || seenOnce.current.has(`${f.theirs}:${mark.at}`)) return
    seenOnce.current.add(`${f.theirs}:${mark.at}`)
    void service.see([{ theirs: f.theirs, mark }])
  }
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

  // The add panel keeps its place (and its state) when the first link or friend turns the empty tab into the list.
  return (
    <div>
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
            <button
              type="button"
              className="fr-pill"
              aria-pressed={!showGroup}
              onClick={() => {
                setList('friends')
                setGroupTab('leaderboard')
              }}
            >
              Friends
            </button>
            {board.groups.map((g) =>
              g.kind === 'not-found' ? null : (
                <button
                  key={g.group}
                  type="button"
                  className="fr-pill"
                  aria-pressed={showGroup && list === g.group}
                  onClick={() => {
                    setList(g.group)
                    setGroupTab('leaderboard')
                  }}
                >
                  {gistText(g.name, 30) || 'Group'}
                </button>
              ),
            )}
            <button
              type="button"
              className="fr-pill fr-pill--add"
              aria-label="Add a friend or a group"
              aria-expanded={panel !== null}
              onClick={() => setPanel(panel === null ? 'menu' : null)}
            >
              + Add
            </button>
          </div>
          {(!showGroup || groupTab === 'leaderboard') && (
            <div className="fr-sort" role="group" aria-label="Sort by">
              <span className="fr-sort__label">Sort:</span>
              {SORTS.map((s) => (
                <button key={s.id} type="button" className="fr-sort__btn" aria-pressed={s.id === sort} onClick={() => setSort(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {showGroup && d1Group !== undefined && (
            <div className="fr-seg" role="tablist" aria-label="Group sections" style={{ marginBottom: 10 }}>
              <button type="button" role="tab" aria-selected={groupTab === 'leaderboard'} aria-pressed={groupTab === 'leaderboard'} onClick={() => setGroupTab('leaderboard')}>
                Leaderboard
              </button>
              <button type="button" role="tab" aria-selected={groupTab === 'cards'} aria-pressed={groupTab === 'cards'} onClick={() => setGroupTab('cards')}>
                {groupSharedCount > 0 ? `Shared Cards (${groupSharedCount})` : 'Shared Cards'}
              </button>
            </div>
          )}
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
          {!showGroup && incomingCards.length > 0 && (
            <IncomingCardsSection
              cards={incomingCards}
              service={service}
              refresh={refresh}
              say={setSaid}
              onAccept={(card) => setAcceptTarget({ kind: 'card', card })}
            />
          )}
          {showGroup && group !== undefined && group.kind === 'ok' && (
            <p className="fr-line">
              {group.streak === 1 ? 'Group streak: 1 day that everyone finished' : `Group streak: ${group.streak} days that everyone finished`}
            </p>
          )}
          {/* B8: who joined today, in 4E3's words, once and quietly under the streak. */}
          {showGroup && group !== undefined && group.kind === 'ok' && groupViewMessage(group) !== null && <p className="fr-line">{groupViewMessage(group)}</p>}
          {showGroup && group !== undefined && group.kind !== 'ok' && <GroupProblem view={group} />}
          {showGroup && d1Group !== undefined && d1Group.isAdmin && d1Group.pending.length > 0 && groupTab === 'leaderboard' && (
            <div className="fr-cards-box" aria-label="Pending join requests">
              <div className="fr-cards-box__head">
                <h2 className="fr-cards-box__title">Pending requests ({d1Group.pending.length})</h2>
              </div>
              {d1Group.pending.map((p) => (
                <div key={p.id} className="fr-card-item">
                  <div className="fr-card-item__title">{gistText(p.name || p.login) || 'Member'}</div>
                  <div className="fr-card-item__meta">@{p.login}</div>
                  <div className="fr-card-item__actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() =>
                        void service.approveMember?.(d1Group.id, p.id).then((r) => {
                          setSaid(r?.ok ? `${gistText(p.name || p.login)} joined the group.` : 'Could not approve member.')
                          void refresh()
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void service.groups?.remove(d1Group.id, String(p.id)).then(() => {
                          setSaid(`Declined ${gistText(p.name || p.login)}.`)
                          void refresh()
                        })
                      }
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showGroup && d1Group !== undefined && groupTab === 'cards' ? (
            <GroupSharedCards
              group={d1Group}
              service={service}
              refresh={refresh}
              say={setSaid}
              onAcceptCard={(card) => setAcceptTarget({ kind: 'card', card })}
              onImportFolder={(folder) => setAcceptTarget({ kind: 'folder', folder })}
            />
          ) : (
            <ul className="rows" aria-label={showGroup ? `${gistText(group?.name ?? '')} members` : 'Friends'}>
              {rows.map(({ entry: e, rank, numbers }) => {
                // Round 10, item 12 (mockup version 9): "updated … ago" below the name, on Today.
                const entry = period === 'today' && e.ago !== undefined ? { ...e, sub: [...e.sub, e.ago] } : e
                return (
                  <li key={entry.key || entry.friend?.mine} className={entry.dim ? 'fr-row fr-row--gone' : 'fr-row'}>
                    <button
                      type="button"
                      className="fr-row__tap"
                      onClick={() => open(entry)}
                      disabled={entry.you || entry.friend?.state === 'removing'}
                      aria-label={rowWords(entry, rank, numbers, period)}
                    >
                      <span className="fr-rank" aria-hidden="true">
                        {rank ?? ''}
                      </span>
                      <Avatar name={entry.name} url={entry.avatar} />
                      <span className="fr-who" aria-hidden="true">
                        <span className={entry.you ? 'fr-name fr-name--you' : 'fr-name'}>
                          {entry.you ? 'You' : entry.name}
                          {entry.emojis && entry.emojis.length > 0 && (
                            <span className="fr-emojis">
                              {entry.emojis.map((em) => (
                                <span key={em.emoji} className="fr-emoji" title={`${em.label}: ${em.reason}`}>
                                  {em.emoji}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        {(entry.cheer !== null || entry.sub.length > 0) && (
                          <span className="fr-sub">
                            {entry.cheer !== null && entry.friend !== undefined && <CheerLine text={entry.cheer} onSeen={() => seeOnce(entry.friend!)} />}
                            {entry.cheer !== null && entry.sub.length > 0 && ' · '}
                            {entry.sub.join(' · ')}
                          </span>
                        )}
                      </span>
                      {numbers !== null && (
                        <span className="fr-nums" aria-hidden="true">
                          {numbers.mark !== null && <Mark mark={numbers.mark} period={period} />} <b>{numbers.cards}</b> cards
                          <br />
                          <span className="fr-nums__sub">
                            {(entry.streak ?? 0) > 0 && sort === 'streak' && <span>🔥 {entry.streak}d</span>}
                            {entry.chain && (
                              <span className="fr-chain">
                                {entry.chain.map((st, idx) => (
                                  <span key={idx} className={`fr-chain__dot fr-chain__dot--${st}`} />
                                ))}
                              </span>
                            )}
                            <span>{numbers.minutes} min</span>
                          </span>
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
          {!showGroup && board.shared.length > 0 && (
            <>
              <h2 className="section">Links you shared</h2>
              <ul className="rows">
                {board.shared.map((s) => (
                  <li key={s.mine} className="row">
                    <span className="row__main">Shared {updatedLabel(Date.parse(s.at), now)}, not used yet</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => ask('Cancel this link? A friend who has it cannot add you with it.', 'Cancel link', () => service.remove(s.mine, 'shared'))}
                    >
                      Cancel link
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {showGroup && group !== undefined && service.groups !== null && (
            <GroupActions view={group} d1Group={d1Group} service={service} ask={ask} say={setSaid} refresh={refresh} />
          )}
        </>
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

/** What VoiceOver reads for a row: the rank, the name, the numbers, the mark in words, the lines. */
function rowWords(e: Entry, rank: number | null, n: ReturnType<typeof boardRows>[number]['numbers'], period: Period): string {
  const parts: string[] = []
  if (rank !== null) parts.push(`Number ${rank}`)
  parts.push(e.you ? 'You' : e.name)
  if (n !== null) {
    parts.push(`${n.cards} cards`, `${n.minutes} minutes`)
    if (n.mark !== null) parts.push(markWords(n.mark, period))
  }
  if (e.cheer !== null) parts.push(e.cheer)
  parts.push(...e.sub)
  return parts.join(', ')
}

function GroupProblem({ view }: { view: Exclude<GroupView, { kind: 'not-found' }> }) {
  const message = groupViewMessage(view)
  return message === null ? null : <Problem quiet message={message} />
}

function GroupActions({
  view,
  d1Group,
  service,
  ask,
  say,
  refresh,
}: {
  view: Exclude<GroupView, { kind: 'not-found' }>
  d1Group?: GroupBoardItem
  service: FriendsService
  ask: (q: string, yes: string, run: () => Promise<unknown>) => void
  say: (s: string | null) => void
  refresh: () => Promise<void>
}) {
  const groups = service.groups!
  const name = gistText(view.name) || 'this group'
  const [link, setLink] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const inviteUrl =
    d1Group?.inviteCode
      ? ownSiteLink(`https://docs.yaseenarshad.com/group#${d1Group.inviteCode}`)
      : ownSiteLink(groupLink(view.group))
  const invite = async (data: { title: string; text: string; url: string }) => {
    setQrUrl(data.url)
    const how = await shareOut(data)
    if (how === 'show') setLink(data.url)
    say(how === 'copied' ? 'Link copied. Send it.' : null)
  }
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {(view.kind === 'waiting' || view.kind === 'not-added') && view.sendToAdmin !== '' && (
        <button type="button" className="btn btn--wide" onClick={() => void invite(joinShareText(name, ownSiteLink(view.sendToAdmin)))}>
          Send my join link to the admin
        </button>
      )}
      {view.kind === 'ok' && view.iAmAdmin && (
        <button type="button" className="btn btn--wide" onClick={() => void invite(groupShareText(name, inviteUrl))}>
          Share the group link
        </button>
      )}
      {view.kind === 'ok' && view.iAmAdmin && d1Group !== undefined && service.rotateGroupInvite !== undefined && (
        <button
          type="button"
          className="btn btn--wide"
          onClick={() =>
            void service.rotateGroupInvite!(d1Group.id).then((r) => {
              if (r.ok) {
                const nextUrl = ownSiteLink(r.link)
                setQrUrl(nextUrl)
                setLink(nextUrl)
                say('Group invite link rotated.')
                void refresh()
              } else {
                say('Could not rotate the invite link.')
              }
            })
          }
        >
          Rotate invite link
        </button>
      )}
      {qrUrl !== null && <div className="fr-qr" dangerouslySetInnerHTML={{ __html: qrCodeSvg(qrUrl) }} />}
      {link !== null && <LinkToCopy link={link} />}
      {view.kind === 'removing' ? null : view.kind === 'ok' && view.iAmAdmin ? (
        <button
          type="button"
          className="btn btn--wide btn--danger"
          onClick={() => ask(`Delete ${name}? The group is gone for each person in it.`, 'Delete group', () => groups.delete(view.group))}
        >
          Delete group
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--wide btn--danger"
          onClick={() => ask(`Leave ${name}? The others stop seeing your numbers.`, 'Leave group', () => groups.leave(view.group))}
        >
          Leave group
        </button>
      )}
    </div>
  )
}

/** "+ Add": Share my link, Paste a friend's link, New group (decisions 18 and 20). */
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
      <div className="sheet" role="group" aria-label="Add">
        <div className="row">
          <button type="button" className="row__button" onClick={() => setPanel('share')}>
            Share my link
          </button>
        </div>
        <div className="row">
          <button type="button" className="row__button" onClick={() => setPanel('paste')}>
            Paste a friend's link
          </button>
        </div>
        {service.groups !== null && (
          <div className="row">
            <button type="button" className="row__button" onClick={() => setPanel('group')}>
              New group
            </button>
          </div>
        )}
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

/** "Share my link": 1-step invite link + local QR SVG (YAZ-6218). */
function SharePanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [state, setState] = useState<{
    busy: boolean
    said: string | null
    link: string | null
    qrUrl: string | null
  }>({ busy: false, said: null, link: null, qrUrl: null })
  const running = useRef(false)
  const go = async () => {
    if (running.current) return
    running.current = true
    setState({ busy: true, said: null, link: null, qrUrl: null })
    try {
      const made = await service.share()
      if (made.kind !== 'ok')
        return setState({
          busy: false,
          said: UNAVAILABLE_WORDS[made.kind],
          link: null,
          qrUrl: null,
        })
      const url = ownSiteLink(made.link)
      const how = await shareOut({
        title: made.title,
        text: made.text,
        url,
      })
      setState({
        busy: false,
        said: SHARED_WORDS[how],
        link: how === 'show' ? url : null,
        qrUrl: url,
      })
      void refresh()
    } finally {
      running.current = false
    }
  }
  return (
    <div className="fr-panel" role="group" aria-label="Share my link">
      <p>Each link is for one friend. Your friend opens or scans it and you are connected.</p>
      <p className="muted">{service.whatFriendsSee}</p>
      <button type="button" className="btn btn--primary" onClick={() => void go()} disabled={state.busy} aria-busy={state.busy}>
        {state.busy ? 'Making your link…' : 'Share my link'}
      </button>
      {state.qrUrl !== null && <div className="fr-qr" dangerouslySetInnerHTML={{ __html: qrCodeSvg(state.qrUrl) }} />}
      {state.said !== null && (
        <p role="status" style={{ marginTop: 8 }}>
          {state.said}
        </p>
      )}
      {state.link !== null && <LinkToCopy link={state.link} />}
      <button type="button" className="link-btn" onClick={close}>
        Close
      </button>
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
  const sendBack =
    answer !== null && answer.kind === 'added' && !answer.paired
      ? answer.sendBack
      : answer !== null && answer.kind === 'joined' && answer.sendToAdmin !== ''
      ? answer.sendToAdmin
      : null
  const request = answer !== null && answer.kind === 'request' ? answer : null
  return (
    <div className="fr-panel" role="group" aria-label="Paste a friend's link">
      <button type="button" className="btn btn--primary" onClick={() => void fromClipboard()} disabled={busy}>
        Paste from the clipboard
      </button>
      <label className="field">
        <span className="field__label">Or paste the link here</span>
        <input
          ref={field}
          name="friend-link"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          maxLength={2000}
        />
      </label>
      <button type="button" className="btn btn--wide" onClick={() => void add(text)} disabled={busy || text.trim() === ''} aria-busy={busy}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      {said !== null && (
        <p role="status" style={{ marginTop: 8 }}>
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
            // ONE add for each request; a second tap while it runs does nothing.
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
      <button type="button" className="link-btn" onClick={close}>
        Close
      </button>
    </div>
  )
}

/** "New group" (decision 18): a name, then the group's link + local QR SVG to share. I am its admin. */
function GroupPanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const running = useRef(false)
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
    <div className="fr-panel" role="group" aria-label="New group">
      <label className="field">
        <span className="field__label">Group name</span>
        <input name="group-name" value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" className="btn btn--primary" onClick={() => void make()} disabled={busy || name.trim() === ''} aria-busy={busy}>
        {busy ? 'Making the group…' : 'Make the group'}
      </button>
      {qrUrl !== null && <div className="fr-qr" dangerouslySetInnerHTML={{ __html: qrCodeSvg(qrUrl) }} />}
      {said !== null && (
        <p role="status" style={{ marginTop: 8 }}>
          {said}
        </p>
      )}
      {link !== null && <LinkToCopy link={link} />}
      <button type="button" className="link-btn" onClick={close}>
        Close
      </button>
    </div>
  )
}

/**
 * The line "cheered you" or "nudged you" (decision 24). It tells `onSeen` once, when the line is really on the screen
 *: an `IntersectionObserver` (all of the line in view); with none, a check of its place on each scroll.
 */
function CheerLine({ text, onSeen }: { text: string; onSeen: () => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  const latest = useRef(onSeen)
  latest.current = onSeen
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    let done = false
    const seen = () => {
      if (done) return
      done = true
      latest.current()
    }
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver
    if (typeof IO === 'function') {
      const watch = new IO(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            seen()
            watch.disconnect()
          }
        },
        { threshold: 1 },
      )
      watch.observe(el)
      return () => watch.disconnect()
    }
    const check = () => {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.top >= 0 && r.bottom <= (globalThis.innerHeight ?? 0)) seen()
    }
    check()
    document.addEventListener('scroll', check, true)
    return () => document.removeEventListener('scroll', check, true)
  }, [])
  return (
    <span ref={ref} className="fr-cheer">
      {text}
    </span>
  )
}

const CARD_FILTERS: readonly { id: SharedCardStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Added' },
  { id: 'dismissed', label: 'Dismissed' },
]

function SharedCardRow({
  card,
  service,
  refresh,
  say,
  onAccept,
}: {
  card: SharedCardItem
  service: FriendsService
  refresh: () => Promise<void>
  say: (s: string | null) => void
  onAccept: (card: SharedCardItem) => void
}) {
  const [busy, setBusy] = useState(false)
  const setStatus = async (status: SharedCardStatus) => {
    if (!service.setCardState || busy) return
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
    <div className="fr-card-item">
      <div className="fr-card-item__title">{gistText(card.title, 80) || 'Shared card'}</div>
      <div className="fr-card-item__meta">
        from @{gistText(card.senderLogin, 40)}
        {card.note ? ` · ${gistText(card.note, 120)}` : ''}
      </div>
      <div className="fr-card-item__actions">
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
        {card.status === 'accepted' && <span className="fr-card-item__meta">Added ✓</span>}
      </div>
    </div>
  )
}

/** Pinned 1-on-1 Incoming cards section at the top of the Friends tab (hidden when 0). */
function IncomingCardsSection({
  cards,
  service,
  refresh,
  say,
  onAccept,
}: {
  cards: SharedCardItem[]
  service: FriendsService
  refresh: () => Promise<void>
  say: (s: string | null) => void
  onAccept: (card: SharedCardItem) => void
}) {
  const [status, setStatus] = useState<SharedCardStatus>('pending')
  const pendingCount = cards.filter((c) => c.status === 'pending').length
  const visible = filterSharedCards(cards, status)
  return (
    <section className="fr-cards-box" aria-label="Incoming cards">
      <div className="fr-cards-box__head">
        <h2 className="fr-cards-box__title">Incoming cards ({pendingCount})</h2>
      </div>
      <div className="fr-sort" role="group" aria-label="Incoming card filter">
        {CARD_FILTERS.map((f) => (
          <button key={f.id} type="button" className="fr-sort__btn" aria-pressed={f.id === status} onClick={() => setStatus(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="fr-line">No {status} cards.</p>
      ) : (
        visible.map((c) => <SharedCardRow key={c.id} card={c} service={service} refresh={refresh} say={say} onAccept={onAccept} />)
      )}
    </section>
  )
}

/** Group "Shared Cards" tab: shared folders (with 1-shot Import folder + Undo dismiss) and loose cards. */
function GroupSharedCards({
  group,
  service,
  refresh,
  say,
  onAcceptCard,
  onImportFolder,
}: {
  group: GroupBoardItem
  service: FriendsService
  refresh: () => Promise<void>
  say: (s: string | null) => void
  onAcceptCard: (card: SharedCardItem) => void
  onImportFolder: (folder: SharedFolderItem) => void
}) {
  const [status, setStatus] = useState<SharedCardStatus>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const folders = group.sharedFolders.filter((f) => f.cards.some((c) => c.status === status))
  const cards = filterSharedCards(group.sharedCards, status)

  const setFolderStatus = async (folderId: string, next: SharedCardStatus) => {
    if (!service.setFolderState || busyId !== null) return
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
    <section className="fr-cards-box" aria-label="Group shared cards">
      <div className="fr-sort" role="group" aria-label="Shared card filter">
        {CARD_FILTERS.map((f) => (
          <button key={f.id} type="button" className="fr-sort__btn" aria-pressed={f.id === status} onClick={() => setStatus(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {folders.length === 0 && cards.length === 0 ? (
        <p className="fr-line">No {status} shared cards in this group.</p>
      ) : (
        <>
          {folders.map((folder) => {
            const matching = folder.cards.filter((c) => c.status === status)
            return (
              <div key={folder.id} className="fr-card-item">
                <div className="fr-card-item__title">📁 {gistText(folder.name, 60) || 'Shared folder'}</div>
                <div className="fr-card-item__meta">
                  from @{gistText(folder.senderLogin, 40)} · {matching.length} {matching.length === 1 ? 'card' : 'cards'}
                </div>
                <div className="fr-card-item__actions">
                  {status === 'pending' && (
                    <>
                      <button type="button" className="btn btn--primary" disabled={busyId !== null} onClick={() => onImportFolder(folder)}>
                        Import folder ({matching.length})
                      </button>
                      <button type="button" className="btn" disabled={busyId !== null} onClick={() => void setFolderStatus(folder.id, 'dismissed')}>
                        Dismiss
                      </button>
                    </>
                  )}
                  {status === 'dismissed' && (
                    <button type="button" className="btn" disabled={busyId !== null} onClick={() => void setFolderStatus(folder.id, 'pending')}>
                      Undo dismiss
                    </button>
                  )}
                  {status === 'accepted' && <span className="fr-card-item__meta">Imported ✓</span>}
                </div>
              </div>
            )
          })}
          {cards.map((c) => (
            <SharedCardRow key={c.id} card={c} service={service} refresh={refresh} say={say} onAccept={onAcceptCard} />
          ))}
        </>
      )}
    </section>
  )
}

/**
 * Accept sheet (D8): pick any existing folder in the vault (remembers last pick) OR 1-click "Put in Shared Cards",
 * plus optional "Move to Up next", committing via `githubRemote.commit()`.
 */
function AcceptCardSheet({
  target,
  service,
  onClose,
  onDone,
}: {
  target: { kind: 'card'; card: SharedCardItem } | { kind: 'folder'; folder: SharedFolderItem }
  service: FriendsService
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [folders, setFolders] = useState<string[]>([])
  const [picked, setPicked] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_FOLDER_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [upNext, setUpNext] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void service.vaultFolders?.().then((list) => {
      if (live) setFolders(list)
    })
    return () => {
      live = false
    }
  }, [service])

  const commit = async (dir: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      try {
        globalThis.localStorage?.setItem(LAST_FOLDER_KEY, dir)
      } catch {
        // ignore storage errors
      }
      if (target.kind === 'card') {
        const res = await service.acceptCardToVault?.({ card: target.card, folder: dir, upNext })
        if (!res?.ok) return setError(res?.error ?? 'Could not add card to vault.')
        onDone(`Added "${gistText(target.card.title, 60)}" to ${dir || 'vault root'}.`)
      } else {
        const res = await service.importFolderToVault?.({ folder: target.folder, targetDir: dir, upNext })
        if (!res?.ok) return setError(res?.error ?? 'Could not import folder.')
        onDone(`Imported ${res.paths.length} ${res.paths.length === 1 ? 'card' : 'cards'} into ${dir ? `${dir}/${target.folder.name}` : target.folder.name}.`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fr-panel" role="dialog" aria-label={target.kind === 'card' ? 'Add shared card to vault' : 'Import shared folder to vault'}>
      <p>
        <b>{target.kind === 'card' ? gistText(target.card.title, 80) : `📁 ${gistText(target.folder.name, 60)}`}</b>
      </p>
      <div className="stack" style={{ gap: 8 }}>
        <button type="button" className="btn btn--primary btn--wide" disabled={busy} aria-busy={busy} onClick={() => void commit('Shared Cards')}>
          {busy ? 'Adding to vault…' : 'Put in Shared Cards'}
        </button>
        <label className="field">
          <span className="field__label">Or pick a vault folder</span>
          <select aria-label="Vault folder" value={picked} onChange={(e) => setPicked(e.target.value)} disabled={busy}>
            <option value="">Vault root</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ minHeight: 36 }}>
          <input type="checkbox" className="check" checked={upNext} onChange={(e) => setUpNext(e.target.checked)} disabled={busy} />
          <span className="row__main">Move to Up next</span>
        </label>
        <button type="button" className="btn btn--wide" disabled={busy} onClick={() => void commit(picked)}>
          {target.kind === 'card' ? `Add to ${picked || 'vault root'}` : `Import into ${picked || 'vault root'}`}
        </button>
      </div>
      {error !== null && (
        <p className="fr-line" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="link-btn" onClick={onClose} disabled={busy}>
        Cancel
      </button>
    </div>
  )
}
