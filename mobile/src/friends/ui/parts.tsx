import { useState } from 'react'
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
