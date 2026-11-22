import { useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../../app/AppState'
import type { Route } from '../../app/nav'
import { Confirm } from '../../screens/Confirm'
import { Frame, Problem } from '../../screens/Frame'
import { addDays, formatStudyDuration, gistText, initialOf, localDay, updatedLabel, vsBoard, type VsLine } from './board'
import './friends.css'
import type { GroupView } from './groups'
import { Avatar, actionWords } from './parts'
import { useBoard, useNow, useService } from './useFriends'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function shortDayDate(day: string): string {
  const parts = day.split('-')
  if (parts.length !== 3) return day
  return `${Number(parts[1])}/${Number(parts[2])}`
}

function weekdayFor(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
}

/**
 * "You vs <friend>" (decision 23; round 9: cards today in two rows). Side by side, buddy streak + dated last 7 days
 * at the top, followed by stats comparison and their vault. Every number is `vsBoard`'s.
 */
export default function VsScreen({ route }: { route: Extract<Route, { kind: 'friend' }> }) {
  const app = useApp()
  const now = useNow()
  const { service } = useService()
  const { board, refresh } = useBoard(service)
  const [asking, setAsking] = useState<null | 'remove'>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const stripRef = useRef<HTMLUListElement>(null)
  const back = () => app.go({ type: 'back' })

  const todayKey = localDay(now)
  useLayoutEffect(() => {
    const el = stripRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [todayKey, route.theirs, route.pointer, board])

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
      // Done goes back to the list; else the screen stays and says why, and what happens next.
      const words = actionWords(result)
      setSaid(words)
      if (words === null) back()
    } finally {
      setBusy(false)
      setAsking(null)
      await refresh()
    }
  }

  const friendMatch = friend ?? (member !== null ? ok.friends.find((f) => f.theirs === member.pointer) ?? null : null)
  const d1Avatar =
    member !== null
      ? ok.d1Groups?.find((g) => g.id === route.group)?.members.find((m) => String(m.id) === member.pointer)?.avatarUrl ?? null
      : null
  const theirAvatar = friendMatch?.avatar ?? d1Avatar
  const buddyStreak = friendMatch?.buddyStreak ?? 0
  const buddyStreakSubtitle =
    buddyStreak === 1
      ? '1 day in a row you both finished your due cards'
      : buddyStreak > 1
      ? `${buddyStreak} days in a row you both finished your due cards`
      : 'Finish your due cards today to start a buddy streak'

  const todayStr = todayKey
  const days30 = Array.from({ length: 30 }, (_, idx) => {
    const day = addDays(todayStr, idx - 29)
    const you = ok.me.stats?.days.some((d) => d.day === day && d.done === true) === true
    const them = theirStats?.days.some((d) => d.day === day && d.done === true) === true
    return {
      day,
      isToday: day === todayStr,
      weekday: weekdayFor(day),
      shortDate: shortDayDate(day),
      you,
      them,
      both: you && them,
    }
  })

  return frame(
    <div className="fr-vs-screen">
      {friend !== null && friend.state !== 'ok' && friend.label !== null && <p className="fr-line">{friend.label}</p>}
      {/* The two columns say who they are: "You" at the left, the friend at the right. */}
      <div className="fr-vs fr-vs--who" role="group" aria-label={`You vs ${name}`} style={{ margin: '6px 0 8px' }}>
        <span className="fr-vs__col" aria-hidden="true">
          <Avatar name={ok.me.name} url={ok.me.avatar} big />
          <span className="fr-vs__who">You</span>
        </span>
        <span className="fr-vs__label" aria-hidden="true">
          vs
        </span>
        <span className="fr-vs__col" aria-hidden="true">
          <Avatar name={name} url={theirAvatar} big />
          <span className="fr-vs__who">{name}</span>
        </span>
      </div>
      <div className="fr-hype-wrap">
        <span className="fr-hype-pill" title={buddyStreakSubtitle} aria-label={buddyStreakSubtitle}>
          🤝 {buddyStreak}d buddy streak
        </span>
        <p className="fr-hype-sub">{buddyStreakSubtitle}</p>
      </div>
      <ul ref={stripRef} className="fr-strip30" aria-label={`Last 30 days. You both finished ${days30.filter((d) => d.both).length} of 30.`}>
        {days30.map((d) => (
          <li
            key={d.day}
            className={d.both ? 'fr-day fr-strip30__col fr-day--both' : 'fr-day fr-strip30__col'}
            aria-label={`${d.weekday} ${d.shortDate}: ${d.you ? 'you finished' : 'you missed'}, ${name} ${d.them ? 'finished' : 'missed'}${
              d.both ? '. You both win.' : ''
            }`}
          >
            <span className="fr-day__wk" aria-hidden="true">
              {d.weekday}
            </span>
            <span className="fr-day__dt" aria-hidden="true">
              {d.shortDate}
            </span>
            <span className="fr-day__avs" aria-hidden="true">
              <span
                className={
                  d.you
                    ? 'fr-ring-av fr-ring-av--done'
                    : d.isToday
                    ? 'fr-ring-av'
                    : 'fr-ring-av fr-ring-av--missed'
                }
                title={d.you ? 'You: finished' : d.isToday ? 'You: in progress today' : 'You: missed'}
              >
                {ok.me.avatar ? <img src={ok.me.avatar} alt="" referrerPolicy="no-referrer" /> : initialOf(ok.me.name)}
                {(d.you || !d.isToday) && (
                  <span
                    className={d.you ? 'fr-ring-av__badge fr-ring-av__badge--done' : 'fr-ring-av__badge fr-ring-av__badge--missed'}
                    aria-hidden="true"
                  >
                    {d.you ? '✓' : '✕'}
                  </span>
                )}
              </span>
              <span
                className={
                  d.them
                    ? 'fr-ring-av fr-ring-av--done'
                    : d.isToday
                    ? 'fr-ring-av'
                    : 'fr-ring-av fr-ring-av--missed'
                }
                title={d.them ? `${name}: finished` : d.isToday ? `${name}: in progress today` : `${name}: missed`}
              >
                {theirAvatar ? <img src={theirAvatar} alt="" referrerPolicy="no-referrer" /> : initialOf(name)}
                {(d.them || !d.isToday) && (
                  <span
                    className={d.them ? 'fr-ring-av__badge fr-ring-av__badge--done' : 'fr-ring-av__badge fr-ring-av__badge--missed'}
                    aria-hidden="true"
                  >
                    {d.them ? '✓' : '✕'}
                  </span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="fr-line" style={{ textAlign: 'center', marginTop: 10 }}>
        {name}: updated {updatedLabel(updatedAt, now)}
        {friend?.sharedCardCount !== undefined && friend.sharedCardCount > 0 && (
          <>
            {' · '}
            {friend.sharedCardCount === 1 ? '1 card shared together' : `${friend.sharedCardCount} cards shared together`}
          </>
        )}
      </p>
      <Lines lines={vs.side} name={name} />
      <h2 className="fr-vs__head">Their vault</h2>
      <Lines lines={vs.vault} name={name} />
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
  const show = (l: VsLine, n: number | null) => {
    if (n === null) return '–'
    if (l.label === 'minutes today' && n >= 60) return formatStudyDuration(n)
    return `${n}${l.suffix ?? ''}`
  }
  return (
    <ul className="rows">
      {lines.map((l) => (
        <li
          key={l.label}
          className={l.part ? 'fr-vs fr-vs--part' : 'fr-vs'}
          aria-label={`${l.label}: you ${show(l, l.you)}, ${name} ${show(l, l.them)}`}
        >
          <span aria-hidden="true">{l.lead === 'you' || l.lead === 'both' ? <b>{show(l, l.you)}</b> : show(l, l.you)}</span>
          <span className="fr-vs__label" aria-hidden="true">
            {l.part ? `· ${l.label}` : l.label}
          </span>
          <span aria-hidden="true">{l.lead === 'them' || l.lead === 'both' ? <b>{show(l, l.them)}</b> : show(l, l.them)}</span>
        </li>
      ))}
    </ul>
  )
}
