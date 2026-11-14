import { useState } from 'react'
import { LIST_NEEDS_REPAIR } from '@shared/friendGists'
import { friendCodeFrom, friendLink } from '../../pwa/friendLink'
import { MARK_SIGN, initialOf, markWords, type DailyMark, type Period } from './board'

/**
 * Small parts of the Friends screens. Each string from a gist (a name, a login) is drawn as React TEXT, never as HTML,
 * and is bounded before (`cleanName`). A picture comes only from GitHub's avatar host (`avatarUrl`), with the plain
 * avatar (the first letter) when there is none, when it fails, or with no signal.
 */
export function Avatar({ name, url, big = false }: { name: string; url: string | null; big?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={big ? 'fr-av fr-av--big' : 'fr-av'} aria-hidden="true">
      {url !== null && !failed ? <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} /> : initialOf(name)}
    </span>
  )
}

/** ○ ◐ ✓, with its words for VoiceOver (decision 25). */
export function Mark({ mark, period }: { mark: DailyMark; period: Period }) {
  return (
    <span className={`fr-mark fr-mark--${mark}`} role="img" aria-label={markWords(mark, period)}>
      {MARK_SIGN[mark]}
    </span>
  )
}

/** The iOS share sheet (decision 20); with no share sheet, the link goes to the clipboard; else it shows to copy. */
export async function shareOut(data: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'cancelled' | 'show'> {
  const nav = globalThis.navigator as (Navigator & { share?: (d: ShareData) => Promise<void> }) | undefined
  if (typeof nav?.share === 'function') {
    try {
      await nav.share(data)
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await nav!.clipboard.writeText(data.url)
    return 'copied'
  } catch {
    return 'show'
  }
}

/** The clipboard, read on a tap (iOS asks the person; it may say no): null when it cannot be read. */
export async function readClipboard(): Promise<string | null> {
  try {
    const text = await globalThis.navigator?.clipboard?.readText?.()
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

/** A link to copy by hand, when neither the share sheet nor the clipboard works. */
export function LinkToCopy({ link }: { link: string }) {
  return (
    <label className="field">
      <span className="field__label">Copy this link and send it</span>
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
    </label>
  )
}

/** Words for each share outcome. */
export const SHARED_WORDS: Record<'shared' | 'copied' | 'cancelled' | 'show', string | null> = {
  shared: 'Link sent. When your friend adds you, paste the link they send you.',
  copied: 'Link copied. Send it to your friend.',
  cancelled: null,
  show: null,
}

/** The time of day, as the phone says it (for "goes at 14:05"). */
export const clockTime = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * 5- (YAZ-5087): the link that the share sheet sends points at the landing page of the site the app runs on, so the
 * preview and the stable site each make their own (`friendLink`). 4E2's link carries the same code.
 */
export function ownSiteLink(link: string, origin: string = globalThis.location?.origin ?? 'null'): string {
  if (!/^https:\/\//.test(origin)) return link
  const code = friendCodeFrom(link)
  if (code !== null) return friendLink(origin, code)
  // YAZ-5263: a group or join link (4E3's) names the site the app runs on too; its path and code stay.
  try {
    const url = new URL(link)
    return /^\/(group|join)\/?$/.test(url.pathname) ? `${origin.replace(/\/+$/, '')}${url.pathname}${url.hash}` : link
  } catch {
    return link
  }
}

/**
 * YAZ-5263, YAZ-5290: the words that go with a group link and a join link. Each opens a landing page of the site
 * (`/group`, `/join`, as `/friend`) with the code and Copy; the paste box reads it.
 */
export const groupShareText = (name: string, url: string) => ({
  title: 'Notecard group link',
  text: `Join my group ${name} on Notecard. Open this link, copy the code, then paste it in the app.`,
  url,
})
export const joinShareText = (name: string, url: string) => ({
  title: 'Notecard join link',
  text: `Please add me to ${name} on Notecard. Open this link, copy the code, then paste it in the app.`,
  url,
})

/**
 * YAZ-5257: the words for the answer of Remove, Cancel link, Leave group, Delete group and Remove a member, or null
 * when it is done. A remove that waits (4E2's `paused`: the budget, GitHub's rate limit, no connection) is kept on the
 * phone and finishes by itself; the words say so, and when.
 */
export function actionWords(result: unknown): string | null {
  const r = (result ?? {}) as { kind?: string; why?: string; retryAt?: number | null; login?: string }
  switch (r.kind) {
    case 'done':
      return null
    case 'paused': {
      const when = typeof r.retryAt === 'number' ? `at ${clockTime(r.retryAt)}` : null
      switch (r.why) {
        case 'offline':
          return 'Not removed yet: no connection. It finishes by itself when you are online.'
        case 'budget':
          return `Not removed yet: GitHub lets the app write only so often. It finishes by itself${when === null ? '' : ` ${when}`}.`
        case 'rate-limited':
          return `Not removed yet: GitHub asks the app to wait. It finishes by itself${when === null ? '' : ` ${when}`}.`
        case 'needs-repair':
          return LIST_NEEDS_REPAIR
        case 'unauthorized':
          return 'Not removed yet. Sign in again, and it finishes by itself.'
        default:
          // A remove that waits for another reason (the words may come with it).
          return typeof r.why === 'string' && r.why.includes(' ') ? r.why : 'Not removed yet. It finishes by itself.'
      }
    }
    case 'admin-cannot-leave':
      return 'You run this group. Delete the group instead.'
    case 'not-found':
      return 'That is gone already.'
    case 'no-gists':
      return 'Friends needs the Gists permission on your token.'
    case 'no-account':
      return 'Friends starts after the app checks your token. Open the app once with a connection.'
    case 'offline':
      return 'No connection. Try again when you are online.'
    case 'rate-limited':
      return 'GitHub asks the app to wait. Try again in a few minutes.'
    case 'unauthorized':
      return 'Sign in again, then try again.'
    case 'newer-app':
      return 'This needs a newer Notecard. Update this app.'
    case 'needs-repair':
      return LIST_NEEDS_REPAIR
    case 'not-admin':
      return 'Only the admin can do that.'
    case 'not-a-member':
      return 'That person is not in the group now.'
    default:
      return 'It could not be done. Try again.'
  }
}
