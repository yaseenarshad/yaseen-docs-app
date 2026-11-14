/**
 * "Friends" (YAZ-5086, decision 16; Settings › Review › "Phone and friends"): the Mac sends the numbers too. The row
 * says what is sent and to whom, and why it did not send, in plain words. No switch (decision 22): with at least one
 * friend or group the numbers go; with none, nothing goes. It asks main once (`friends:status`), with no network call.
 */
import { useEffect, useState } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import type { FriendsSendView } from '@shared/types'
import { api } from '../api'

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
      // YAZ-5252: "holds" means "on this Mac": open, or a closed vault that the app knows.
      return `Not sent: ${v.missing === 1 ? '1 vault that counts for friends is' : `${v.missing} vaults that count for friends are`} not on this Mac. Open ${v.missing === 1 ? 'it' : 'each'} once in this app (or clone ${v.missing === 1 ? 'it' : 'them'} from GitHub), and the numbers go.`
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
    case 'failed':
      return 'Not sent: something went wrong. The app tries again when your cards change.'
    default: {
      if (v.friends + v.groups === 0) return 'No friends yet, so nothing is sent. Add a friend in the phone app.'
      return v.lastSentAt === null ? `Sent to ${whom(v)} when your cards change.` : `Sent to ${whom(v)}. Last sent ${ago(v.lastSentAt, now)}.`
    }
  }
}

export function FriendsSendControl() {
  const [view, setView] = useState<FriendsSendView | null>(null)
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
      <p className="settings__key-status">Only your numbers: cards, minutes and streaks, with your GitHub name and picture. Never your cards or your pages.</p>
      <p className="settings__key-status" role="status">
        {view === null ? '…' : sendLine(view, Date.now())}
      </p>
    </>
  )
}
