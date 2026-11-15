/**
 * "Friends" (YAZ-5086, decision 16; Settings › Review › "Phone and friends"): the Mac sends the numbers too. The row
 * says what is sent and to whom, and why it did not send, in plain words. No switch (decision 22): with at least one
 * friend or group the numbers go; with none, nothing goes. It asks main once (`friends:status`), with no network call.
 */
import { useEffect, useState } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import type { FriendsSendView } from '@shared/types'
import { api } from '../api'
import { useUnit } from '../vault/unitWord'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function ago(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${plural(min, 'minute')} ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${plural(h, 'hour')} ago` : `${plural(Math.round(h / 24), 'day')} ago`
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function whom(v: FriendsSendView): string {
  const parts = [v.friends > 0 && plural(v.friends, 'friend'), v.groups > 0 && plural(v.groups, 'group')].filter(Boolean)
  return parts.join(' and ')
}

/** "1 vault … is" or "2 vaults … are". */
const vaults = (n: number, rest: string, one: string, many: string) => `${n === 1 ? `1 vault that counts for friends ${one}` : `${n} vaults that count for friends ${many}`} ${rest}`

/**
 * YAZ-5252: why the vaults that count cannot be counted on this Mac ("holds" means "on this Mac": open, or a closed vault
 * that the app knows). Three kinds, each in its own words: not on this Mac, older than GitHub's copy (YAZ-5391), and
 * not readable (YAZ-5388, YAZ-5395, YAZ-5396).
 */
function missingWords(v: FriendsSendView): string {
  const behind = v.behind ?? 0
  const unreadable = v.unreadable ?? 0
  const notHere = Math.max(0, v.missing - behind - unreadable)
  const one = (n: number) => (n === 1 ? 'it' : 'each')
  const parts: string[] = []
  if (notHere > 0) parts.push(vaults(notHere, `not on this Mac. Clone ${one(notHere)} from GitHub, then open ${one(notHere)} once in this app, and the numbers go.`, 'is', 'are'))
  if (behind > 0) parts.push(vaults(behind, `older on this Mac than on GitHub. Open ${one(behind)} in this app to sync ${behind === 1 ? 'it' : 'them'}, and the numbers go.`, 'is', 'are'))
  if (unreadable > 0)
    parts.push(vaults(unreadable, `could not be read on this Mac: a link inside it, or a file the app cannot open.${v.retryAt === null ? '' : ` Next try at ${clock(v.retryAt)}.`}`, '', ''))
  return parts.join(' ').replace(/ {2,}/g, ' ')
}

/** One line for the state, or null while main has not answered. */
function sendLine(v: FriendsSendView, now: number): string {
  switch (v.status) {
    case 'no-token':
      return 'Save a GitHub token above first.'
    case 'no-friends':
      return 'No friends yet, so nothing is sent. Add a friend in the phone app.'
    case 'no-list':
      // YAZ-5254 (round 13, item 4: one GitHub account for friends): say whose list is missing, and what to do.
      return `No friends list on ${v.login ? `@${v.login}` : 'this token\'s GitHub account'}, so nothing is sent. Friends use the GitHub account of the phone app. Add a friend there, or save a token of that account above.`
    case 'missing-vaults':
      return `Not sent: ${missingWords(v)}`
    case 'phone-first':
      return 'Not sent: open the phone app once. It finishes a change to your friends list, then this Mac sends again.'
    case 'no-gists':
      return 'Not sent: the token has no Gists permission. On GitHub, give it Gists (Read and write), then save it again above.'
    case 'sign-in-again':
      return 'Not sent: GitHub does not accept the token. Make a new token and save it above.'
    case 'offline':
      return 'Not sent: no connection to GitHub. The app tries again when your cards change.'
    case 'slowed':
      return `Sent less often now: GitHub allows 100 changes an hour.${v.retryAt === null ? '' : ` Next try at ${clock(v.retryAt)}.`}`
    case 'needs-repair':
      return `Not sent. ${LIST_NEEDS_REPAIR}`
    case 'needs-newer-app':
      return 'Not sent: your friends list is from a newer app. Update this app.'
    case 'list-elsewhere':
      // YAZ-5083: the list is in one vault of the person; this Mac reads it there.
      return `Not sent: your friends list is in the vault ${v.home ?? 'of the phone app'}. Open that vault once in this app, and the numbers go.`
    case 'no-list-access':
      return 'Not sent: the token cannot read the vault that holds your friends list. On GitHub, give it Contents (Read and write) on that vault, then save it again above.'
    case 'failed':
      // YAZ-5389: a count that failed waits (5 minutes, doubled each time, at most 1 hour) before the next one.
      return `Not sent: something went wrong. The app tries again ${v.retryAt === null ? 'when your cards change' : `at ${clock(v.retryAt)}`}.`
    default: {
      if (v.friends + v.groups === 0) return 'No friends yet, so nothing is sent. Add a friend in the phone app.'
      return v.lastSentAt === null ? `Sent to ${whom(v)} when your cards change.` : `Sent to ${whom(v)}. Last sent ${ago(v.lastSentAt, now)}.`
    }
  }
}

export function FriendsSendControl() {
  const [view, setView] = useState<FriendsSendView | null>(null)
  const unit = useUnit()
  useEffect(() => {
    let live = true
    api.friends.status().then(
      (v) => live && setView(v),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])
  return (
    <>
      <p className="settings__key-status">{unit('Only your numbers: cards, minutes and streaks, with your GitHub name and picture. Never your cards or your pages.')}</p>
      <p className="settings__key-status" role="status">
        {view === null ? '…' : sendLine(view, Date.now())}
      </p>
    </>
  )
}
