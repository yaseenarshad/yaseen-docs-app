import { useEffect, useMemo, useRef, useState } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import { pasteMessage, type PasteResult } from '@shared/friendsList'
import { useApp } from '../../app/AppState'
import { friendsMessage } from '../../auth/friends'
import { Confirm } from '../../screens/Confirm'
import { Problem } from '../../screens/Frame'
import type { Unavailable } from '../list'
import { MARK_LINE, PERIODS, boardRows, gistText, markToShow, markWords, updatedLabel, type BoardEntry, type Period } from './board'
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
 * The Friends tab (YAZ-5085, 4E4; decisions 20, 21, 22, 24, 25; round 10, items 12 and 13). The tab draws the board
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
  if (board.kind !== 'ok') return <section aria-label="Friends">{alert ?? <Unreadable board={board} refresh={refresh} />}</section>
  return (
    <section aria-label="Friends">
      {alert}
      <BoardView board={board} service={service} refresh={refresh} />
    </section>
  )
}

/** Words for a board that cannot show (decision 17, round 13 item 4, YAZ-5191). */
function Unreadable({ board, refresh }: { board: Unavailable; refresh: () => Promise<void> }) {
  const app = useApp()
  switch (board.kind) {
    case 'needs-repair':
      return <Problem message={LIST_NEEDS_REPAIR} action="Try again" onAction={() => void refresh()} />
    case 'newer-app':
      return <Problem message="Your friends list was written by a newer Notecards. Update this app to see your friends." />
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
    case 'offline':
      return <Problem quiet message="No connection. Your friends show when you are online." action="Try again" onAction={() => void refresh()} />
    case 'rate-limited':
      return <Problem quiet message="GitHub asks the app to wait. Your friends show in a few minutes." />
    default:
      return <Problem message="Your friends could not be read." action="Try again" onAction={() => void refresh()} />
  }
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
  const [list, setList] = useState<string>('friends')
  const [panel, setPanel] = useState<Panel>(null)
  const [asking, setAsking] = useState<null | {
    question: string
    yes: string
    run: () => Promise<unknown>
  }>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const group = board.groups.find((g) => g.kind !== 'not-found' && g.group === list) as Exclude<GroupView, { kind: 'not-found' }> | undefined
  const showGroup = list !== 'friends' && group !== undefined

  const friendEntries: Entry[] = useMemo(() => {
    const me: Entry = {
      key: 'me',
      name: gistText(board.me.name),
      you: true,
      stats: board.me.stats,
      avatar: board.me.avatar,
      sub: board.me.stats === null ? ['Your numbers need each vault that counts on this phone.'] : [],
      cheer: null,
      dim: false,
    }
    const them = board.friends.map((f): Entry => {
      const shown = markToShow(f.mark, board.seen[f.theirs], now)
      const numbers = f.state === 'ok' || f.state === 'waiting'
      const sub: string[] = []
      if (f.state !== 'ok' && f.label !== null) sub.push(f.label)
      if (!numbers && f.label === null) sub.push('no update yet')
      const ago = numbers ? updatedLabel(f.updatedAt, now) : undefined
      return {
        key: f.theirs,
        name: gistText(f.name) || 'Friend',
        you: false,
        stats: numbers ? f.stats : null,
        avatar: f.avatar,
        friend: f,
        sub,
        ago,
        cheer: shown === null ? null : MARK_LINE[shown.kind],
        dim: f.state === 'gone',
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
      return {
        key: m.pointer,
        name: m.me ? board.me.name : gistText(m.name) || gistText(m.login) || 'Member',
        you: m.me,
        stats: m.me ? board.me.stats : ok?.stats ?? null,
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
  const rows = boardRows(entries, period, now)

  // YAZ-5274: a friend who just added me back: said one time (the list marks the pair, so the next read has none).
  const paired = (board.newlyPaired ?? []).join(', ')
  useEffect(() => {
    if (paired !== '') setSaid(`${paired} added you back. You are friends now.`)
  }, [paired])

  const nobody = board.friends.length === 0 && board.groups.length === 0 && board.shared.length === 0

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
      // YAZ-5257: an answer that is not `done` says why, and what happens next.
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
            <button type="button" className="fr-pill" aria-pressed={!showGroup} onClick={() => setList('friends')}>
              Friends
            </button>
            {board.groups.map((g) =>
              g.kind === 'not-found' ? null : (
                <button key={g.group} type="button" className="fr-pill" aria-pressed={showGroup && list === g.group} onClick={() => setList(g.group)}>
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
        </>
      )}
      <AddPanel panel={panel} setPanel={setPanel} service={service} refresh={refresh} />
      {!nobody && (
        <>
          {board.offline && <p className="fr-line">No connection. These are the last numbers the app read.</p>}
          {said !== null && (
            <p className="fr-line" role="status">
              {said}
            </p>
          )}
          {showGroup && group !== undefined && group.kind === 'ok' && (
            <p className="fr-line">
              {group.streak === 1 ? 'Group streak: 1 day that everyone finished' : `Group streak: ${group.streak} days that everyone finished`}
            </p>
          )}
          {showGroup && group !== undefined && group.kind !== 'ok' && <GroupProblem view={group} />}
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
                      <span className={entry.you ? 'fr-name fr-name--you' : 'fr-name'}>{entry.you ? 'You' : entry.name}</span>
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
                        {numbers.minutes} min
                      </span>
                    )}
                  </button>
                  {entry.friend?.state === 'stopped' && (
                    // YAZ-5274: the link I pasted is gone and they never added me: the one way on is a new link of mine.
                    <button type="button" className="btn" aria-label="Share a new link" onClick={() => setPanel('share')}>
                      New link
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
                      onClick={() => ask('Cancel this link? A friend who has it cannot add you with it.', 'Cancel link', () => service.remove(s.mine))}
                    >
                      Cancel link
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {showGroup && group !== undefined && service.groups !== null && <GroupActions view={group} service={service} ask={ask} say={setSaid} />}
        </>
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
  service,
  ask,
  say,
}: {
  view: Exclude<GroupView, { kind: 'not-found' }>
  service: FriendsService
  ask: (q: string, yes: string, run: () => Promise<unknown>) => void
  say: (s: string | null) => void
}) {
  const groups = service.groups!
  const name = gistText(view.name) || 'this group'
  const [link, setLink] = useState<string | null>(null)
  const invite = async (data: { title: string; text: string; url: string }) => {
    const how = await shareOut(data)
    if (how === 'show') setLink(data.url)
    say(how === 'copied' ? 'Link copied. Send it.' : null)
  }
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {(view.kind === 'waiting' || view.kind === 'not-added') && (
        <button type="button" className="btn btn--wide" onClick={() => void invite(joinShareText(name, ownSiteLink(view.sendToAdmin)))}>
          Send my join link to the admin
        </button>
      )}
      {view.kind === 'ok' && view.iAmAdmin && (
        <button type="button" className="btn btn--wide" onClick={() => void invite(groupShareText(name, ownSiteLink(groupLink(view.group))))}>
          Share the group link
        </button>
      )}
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
  'newer-app': 'Your friends list was written by a newer Notecards. Update this app.',
  'needs-repair': LIST_NEEDS_REPAIR,
  failed: 'Something went wrong. Try again.',
}

/** "Share my link": a new link for ONE friend (4E2), then the share sheet, with what a friend sees (decision 22). */
function SharePanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [state, setState] = useState<{
    busy: boolean
    said: string | null
    link: string | null
  }>({ busy: false, said: null, link: null })
  const running = useRef(false)
  const go = async () => {
    if (running.current) return
    running.current = true
    setState({ busy: true, said: null, link: null })
    try {
      const made = await service.share()
      if (made.kind !== 'ok')
        return setState({
          busy: false,
          said: UNAVAILABLE_WORDS[made.kind],
          link: null,
        })
      const how = await shareOut({
        title: made.title,
        text: made.text,
        url: ownSiteLink(made.link),
      })
      setState({
        busy: false,
        said: SHARED_WORDS[how],
        link: how === 'show' ? ownSiteLink(made.link) : null,
      })
      void refresh()
    } finally {
      running.current = false
    }
  }
  return (
    <div className="fr-panel" role="group" aria-label="Share my link">
      <p>Each link is for one friend. Your friend opens it and adds you.</p>
      <p className="muted">{service.whatFriendsSee}</p>
      <button type="button" className="btn btn--primary" onClick={() => void go()} disabled={state.busy} aria-busy={state.busy}>
        {state.busy ? 'Making your link…' : 'Share my link'}
      </button>
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
    answer !== null && answer.kind === 'added' && !answer.paired ? answer.sendBack : answer !== null && answer.kind === 'joined' ? answer.sendToAdmin : null
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
                    title: 'Notecards friend link',
                    text: 'Add me as a friend on Notecards. Open this link, copy the code, then paste it in the app.',
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
            // YAZ-5265: ONE add for each request; a second tap while it runs does nothing.
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

/** "New group" (decision 18): a name, then the group's link to share. I am its admin. */
function GroupPanel({ service, close, refresh }: { service: FriendsService; close: () => void; refresh: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
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
      // YAZ-5263: the site the app runs on, and words that tell the true step (no page shows a group code yet).
      const data = groupShareText(gistText(name, 30), ownSiteLink(made.link))
      const how = await shareOut(data)
      if (how === 'show') setLink(data.url)
      setSaid('Group made. Send its link to the people you want in it. Then paste the join link each one sends you.')
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
 * (YAZ-5262): an `IntersectionObserver` (all of the line in view); with none, a check of its place on each scroll.
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
