import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../app/AppState'
import type { Route } from '../../app/nav'
import { Confirm } from '../../screens/Confirm'
import { Frame, Problem } from '../../screens/Frame'
import { MARK_LINE, gistText, initialOf, markToShow, updatedLabel, vsBoard, type VsLine } from './board'
import './friends.css'
import type { MarkKind, MarkSend } from './marks'
import type { GroupView } from './groups'
import { Avatar, actionWords, clockTime } from './parts'
import { useBoard, useNow, useService } from './useFriends'

/**
 * "You vs <friend>" (decision 23; round 9: cards today in two rows). Side by side, their vault, the last 7 days (both
 * finished: both win), and Cheer and Nudge (decision 24). Every number is `vsBoard`'s. For a member of a group who is
 * not a friend: the same numbers, no Cheer or Nudge (a group's pointer has no mark), and Remove for the admin.
 */
export default function VsScreen({ route }: { route: Extract<Route, { kind: 'friend' }> }) {
  const app = useApp()
  const now = useNow()
  const { service } = useService()
  const { board, refresh } = useBoard(service)
  const [asking, setAsking] = useState<null | 'remove'>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const back = () => app.go({ type: 'back' })

  const ok = board !== null && board.kind === 'ok' ? board : null
  const friend = ok !== null && route.theirs !== undefined ? ok.friends.find((f) => f.theirs === route.theirs) ?? null : null
  const group =
    ok !== null && route.group !== undefined
      ? ok.groups.find((g): g is Extract<GroupView, { kind: 'ok' }> => g.kind === 'ok' && g.group === route.group)
      : undefined
  const member = group !== undefined && group.kind === 'ok' ? group.members.find((m) => m.pointer === route.pointer) ?? null : null
  const name =
    (friend === null ? null : gistText(friend.name) || 'Friend') ?? (member === null ? 'Friend' : gistText(member.name) || gistText(member.login) || 'Member')
  const theirStats = friend?.stats ?? (member?.read?.kind === 'ok' ? member.read.stats : null)
  const updatedAt = friend?.updatedAt ?? (member?.read?.kind === 'ok' ? member.read.updatedAt : null)
  const shownMark = friend === null || ok === null ? null : markToShow(friend.mark, ok.seen[friend.theirs], now)

  // Decision 24: the line at the top of "You vs" is on the screen: it is seen.
  const seenOnce = useRef<string | null>(null)
  useEffect(() => {
    if (service === null || friend === null || shownMark === null || seenOnce.current === shownMark.at) return
    seenOnce.current = shownMark.at
    void service.see([{ theirs: friend.theirs, mark: shownMark }])
  }, [service, friend, shownMark])

  const frame = (body: React.ReactNode) => (
    <Frame title={name} back={back} gear tabs>
      {body}
    </Frame>
  )
  if (ok === null) return frame(<p className="fr-line">{board === null ? 'Reading…' : 'Your friends could not be read.'}</p>)
  if (friend === null && member === null) return frame(<Problem quiet message="This friend is not in your list any more." action="Back" onAction={back} />)

  const vs = vsBoard(ok.me.stats, theirStats, now)
  const removeFriend = async () => {
    if (service === null) return
    setBusy(true)
    try {
      const result =
        friend !== null
          ? await service.remove(friend.mine)
          : member !== null && group !== undefined && service.groups !== null
          ? await service.groups.remove(group.group, member.pointer)
          : { kind: 'done' }
      // YAZ-5257: done goes back to the list; else the screen stays and says why, and what happens next.
      const words = actionWords(result)
      setSaid(words)
      if (words === null) back()
    } finally {
      setBusy(false)
      setAsking(null)
      await refresh()
    }
  }

  return frame(
    <div>
      {shownMark !== null && (
        <p className="fr-line fr-cheer" role="status">
          {name} {MARK_LINE[shownMark.kind]}
        </p>
      )}
      {friend !== null && friend.state !== 'ok' && friend.label !== null && <p className="fr-line">{friend.label}</p>}
      <div className="fr-vs" style={{ margin: '6px 0 10px' }}>
        <Avatar name={ok.me.name} url={ok.me.avatar} big />
        <span className="fr-vs__label">vs</span>
        <Avatar name={name} url={friend?.avatar ?? null} big />
      </div>
      <p className="fr-line" style={{ textAlign: 'center' }}>
        {name}: updated {updatedLabel(updatedAt, now)}
      </p>
      <Lines lines={vs.side} name={name} />
      <h2 className="fr-vs__head">Their vault</h2>
      <Lines lines={vs.vault} name={name} />
      <h2 className="fr-vs__head">Last 7 days. When you both finish your due cards, you both win.</h2>
      <ul className="fr-week" aria-label={`Last 7 days. You both won ${vs.bothWon} of 7.`}>
        {vs.week.map((d) => (
          <li
            key={d.day}
            className={d.both ? 'fr-day fr-day--both' : 'fr-day'}
            aria-label={`${d.weekday}: ${d.you ? 'you finished' : 'you did not finish'}, ${name} ${d.them ? 'finished' : 'did not finish'}${
              d.both ? '. You both win.' : ''
            }`}
          >
            <span aria-hidden="true">{d.weekday.slice(0, 2)}</span>
            <span aria-hidden="true">{d.you ? 'Y' : '·'}</span>
            <span aria-hidden="true">{d.them ? initialOf(name) : '·'}</span>
          </li>
        ))}
      </ul>
      <p className="fr-line" style={{ textAlign: 'center' }}>
        {vs.bothWon === 1 ? 'You both won 1 day of 7.' : `You both won ${vs.bothWon} days of 7.`}
      </p>
      {friend !== null && friend.state !== 'gone' && service !== null && (
        <CheerNudge name={name} mine={friend.mine} send={(kind) => service.mark(friend.mine, kind)} sent={ok.outbox[friend.mine]} />
      )}
      {(friend !== null || (group !== undefined && group.kind === 'ok' && group.iAmAdmin && member !== null && !member.me)) && (
        <div className="stack" style={{ marginTop: 24 }}>
          <button type="button" className="btn btn--wide btn--danger" onClick={() => setAsking('remove')}>
            {friend !== null ? 'Remove friend' : 'Remove from group'}
          </button>
        </div>
      )}
      {said !== null && (
        <p className="fr-line" role="status">
          {said}
        </p>
      )}
      {asking === 'remove' && (
        <Confirm
          question={
            friend !== null
              ? `Remove ${name}? ${name} stops seeing your numbers, and you stop seeing theirs.`
              : `Remove ${name} from ${gistText(group !== undefined && group.kind === 'ok' ? group.name : '')}?`
          }
          yes={`Remove ${name}`}
          busy={busy}
          onYes={() => void removeFriend()}
          onNo={() => setAsking(null)}
        />
      )}
    </div>,
  )
}

/** One row a side: my number, the label, theirs. The larger number is bold (both when equal). */
function Lines({ lines, name }: { lines: VsLine[]; name: string }) {
  const show = (n: number | null, suffix = '') => (n === null ? '–' : `${n}${suffix}`)
  return (
    <ul className="rows">
      {lines.map((l) => (
        <li
          key={l.label}
          className={l.part ? 'fr-vs fr-vs--part' : 'fr-vs'}
          aria-label={`${l.label}: you ${show(l.you, l.suffix)}, ${name} ${show(l.them, l.suffix)}`}
        >
          <span aria-hidden="true">{l.lead === 'you' || l.lead === 'both' ? <b>{show(l.you, l.suffix)}</b> : show(l.you, l.suffix)}</span>
          <span className="fr-vs__label" aria-hidden="true">
            {l.part ? `· ${l.label}` : l.label}
          </span>
          <span aria-hidden="true">{l.lead === 'them' || l.lead === 'both' ? <b>{show(l.them, l.suffix)}</b> : show(l.them, l.suffix)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Cheer and Nudge: one tap, one send (a second tap while it runs does nothing), an honest state after it: sent, or
 * waiting with the time it goes (it is kept on the phone, never lost).
 */
function CheerNudge({
  name,
  send,
  sent,
}: {
  name: string
  mine: string
  send: (kind: MarkKind) => Promise<MarkSend>
  sent:
    | {
        mark: { kind: MarkKind; at: string }
        state: 'sent' | 'waiting'
        why?: string
        retryAt?: number | null
      }
    | undefined
}) {
  const [running, setRunning] = useState<MarkKind | null>(null)
  const [result, setResult] = useState<MarkSend | null>(null)
  const lock = useRef(false)
  const tap = async (kind: MarkKind) => {
    if (lock.current) return
    lock.current = true
    setRunning(kind)
    try {
      setResult(await send(kind))
    } finally {
      lock.current = false
      setRunning(null)
    }
  }
  const words = (r: MarkSend | null): string | null => {
    const now =
      r ??
      (sent === undefined
        ? null
        : sent.state === 'sent'
        ? ({ kind: 'sent', mark: sent.mark } as MarkSend)
        : ({
            kind: 'waiting',
            mark: sent.mark,
            why: (sent.why ?? 'offline') as 'offline',
            retryAt: sent.retryAt ?? null,
          } as MarkSend))
    if (now === null) return null
    const what = (m: { kind: MarkKind }) => (m.kind === 'cheer' ? 'cheer' : 'nudge')
    switch (now.kind) {
      case 'sent':
        return `${now.mark.kind === 'cheer' ? 'Cheer' : 'Nudge'} sent at ${clockTime(Date.parse(now.mark.at))}. ${name} sees it in Friends.`
      case 'already':
        return now.mark.kind === 'cheer' ? `You cheered ${name} today. One cheer a day.` : `You nudged ${name} today. One nudge a day.`
      case 'waiting':
        if (now.why === 'marks-limit') return `Cheers and nudges go out 5 an hour. Your ${what(now.mark)} goes at ${clockTime(now.retryAt ?? Date.now())}.`
        if (now.why === 'offline') return `No connection. Your ${what(now.mark)} goes when you are online.`
        return now.retryAt === null
          ? `Your ${what(now.mark)} waits. It goes by itself.`
          : `GitHub lets the app write only so often. Your ${what(now.mark)} goes at ${clockTime(now.retryAt)}.`
      case 'no-gists':
        return 'Friends needs the Gists permission on your token.'
      case 'unauthorized':
        return 'Sign in again, then try again.'
      case 'gone':
        return `${name} is not your friend on GitHub any more.`
      case 'newer-app':
        return 'Your link for this friend was written by a newer Notecards. Update this app.'
      case 'no-account':
        return 'Friends starts after the app checks your token.'
      default:
        return 'It could not be sent. Try again.'
    }
  }
  const said = words(result)
  return (
    <>
      <div className="fr-actions">
        <button type="button" className="btn" onClick={() => void tap('cheer')} disabled={running !== null} aria-busy={running === 'cheer'}>
          {running === 'cheer' ? 'Sending…' : 'Cheer'}
        </button>
        <button type="button" className="btn" onClick={() => void tap('nudge')} disabled={running !== null} aria-busy={running === 'nudge'}>
          {running === 'nudge' ? 'Sending…' : 'Nudge'}
        </button>
      </div>
      {said !== null && (
        <p className="fr-line" role="status">
          {said}
        </p>
      )}
    </>
  )
}
