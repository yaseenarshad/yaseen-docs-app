/**
 * How to add Yaseen Docs to the Home Screen: ONE source for the words, for the app's install hint (`InstallHint.tsx`),
 * "Set up your phone" and the `/friend` landing page (`landing.ts`). YAZ-5644: the Home Screen app is a choice, not a
 * must: a browser tab runs the whole app too. On iOS, Safari and the Home Screen app keep their data apart, so each is
 * its own copy of the vault (both may write: every write is compare-and-swap).
 * The iOS 26 Safari steps are Yaseen's, from his iPhone (compact address bar at the bottom): "three lines on the left
 * side of the URL … share … view more … add to home screen". Chrome and Firefox on iOS (16.4 and later) add to the
 * Home Screen from their own Share menu.
 */
export const HOME_SCREEN = {
  title: 'Add Yaseen Docs to your Home Screen',
  /** The hint's one line, after the title. */
  short: 'It opens like an app.',
  why: 'It opens like an app, works with no signal, and keeps your cards on this phone.',
  /** Safari on iOS 26: each tap in order. */
  safari: [{ tap: '☰', where: 'at the left of the address bar' }, { tap: 'Share' }, { tap: 'View More' }, { tap: 'Add to Home Screen' }] as { tap: string; where?: string }[],
  olderSafari: 'On an older iPhone: tap the Share button (a square with an arrow up), then Add to Home Screen.',
  otherIos: 'In Chrome or Firefox, open the Share menu, then tap Add to Home Screen.',
  android: 'In Chrome, open the ⋮ menu, then tap Add to Home screen.',
  /** iOS only: the Home Screen app is a second copy (an Android app shares the browser's data). */
  apart: 'The Home Screen app keeps its own copy of your vault, so you sign in there once more. This tab keeps working too.',
}

/**
 * Safari's ☰ button. VoiceOver reads the bare glyph as "trigram for heaven", so each place that shows it in
 * text wraps it in an element with this spoken name (`role="img"`, as the install hint's drawn lines).
 */
export const THREE_LINES = { glyph: '☰', name: 'the three lines' } as const

/** A text split around each ☰: the parts between are plain text, the glyph goes in its own named element. */
export const splitThreeLines = (text: string): string[] => text.split(THREE_LINES.glyph)

const tapWords = (s: { tap: string; where?: string }) => (s.where === undefined ? s.tap : `${s.tap} ${s.where}`)
/** The Safari steps in one sentence (the `/friend` page). */
export const safariLine = (): string => `In Safari, tap ${HOME_SCREEN.safari.map(tapWords).join(', then ')}.`
/** One step as a sentence (the app's list). */
export const safariStep = (s: { tap: string; where?: string }): string => `Tap ${tapWords(s)}.`

export type Where = 'standalone' | 'ios-safari' | 'ios-other' | 'not-ios'

export interface BrowserFacts {
  /** iOS Safari's `navigator.standalone`: true inside the Home Screen app. */
  standalone?: boolean
  /** `matchMedia('(display-mode: standalone)')`. */
  displayStandalone: boolean
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}

export function whereAmI(f: BrowserFacts): Where {
  if (f.standalone === true || f.displayStandalone) return 'standalone'
  // An iPad asks for the Mac's pages: it says Macintosh, but it has touch.
  const ios = /iPhone|iPad|iPod/.test(f.userAgent) || (f.platform === 'MacIntel' && (f.maxTouchPoints ?? 0) > 1)
  if (!ios) return 'not-ios'
  return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|GSA\//.test(f.userAgent) ? 'ios-other' : 'ios-safari'
}

/** The facts of this browser. */
export function browserFacts(): BrowserFacts {
  let displayStandalone = false
  try {
    displayStandalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
  } catch {
    // No matchMedia: a browser tab.
  }
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { standalone?: boolean })
  return { standalone: nav?.standalone, displayStandalone, userAgent: nav?.userAgent ?? '', platform: nav?.platform, maxTouchPoints: nav?.maxTouchPoints }
}

/** YAZ-5644: who gets the install hint: a browser tab on a phone or a tablet. A computer and the Home Screen app: none. */
export type HintKind = 'ios-safari' | 'ios-other' | 'android'

export function hintKind(f: BrowserFacts): HintKind | null {
  const where = whereAmI(f)
  if (where === 'standalone') return null
  if (where !== 'not-ios') return where
  return /Android/.test(f.userAgent) ? 'android' : null
}
