import { readAppearance, saveAppearance, type Appearance } from '../store/appearancePref'

/**
 * YAZ-5565: light or dark, as Settings › Appearance says (the Mac's words and order: System, Light, Dark). The page's
 * look hangs on ONE attribute, `<html data-scheme="light|dark">`: every stylesheet's dark rules are
 * `:where([data-scheme='dark'])` (no added weight: the cascade is the one the media query gave). System follows the
 * iPhone live (the media query's change). `main.tsx` and the `/friend` page call `startAppearance()` first, before
 * anything draws. The address bar and status bar colour (`theme-color`) and the browser's own controls (`color-scheme`)
 * follow too; the drawings and diagrams draw in it (`schemeWatch`, for `drawing/watchDrawings.ts`).
 * YAZ-5661: the page paints again each time it is back on screen (from GitHub's pages, the iPhone's Settings, the app
 * switcher, a page kept by the browser): iOS can give the strip behind the clock its own colour while the app is away,
 * and a turn of the iPhone while the app slept may send no change. The manifest has no bar colour (one colour for
 * light and dark: iOS showed its white in the dark app).
 * YAZ-5661 round 2: iOS 26 does not take the strip's colour from `theme-color` or the manifest when it finds a fixed,
 * opaque bar across the top of the page: it takes that bar's background. `index.html` has one (`.status-strip`, the
 * safe area's height, `--bg`), so the strip is the theme's. Each paint nudges the bar tags for one frame (the colour
 * with an `fe` alpha, then back): a tag change makes iOS read the strip again at once.
 */
export type Scheme = 'light' | 'dark'

/** The Mac's `THEME_OPTIONS` (`client/src/settings/options.ts`): the same words, the same order. */
export const APPEARANCE_OPTIONS: readonly { label: string; value: Appearance }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

const QUERY = '(prefers-color-scheme: dark)'
let chosen: Appearance = 'system'
let media: MediaQueryList | null | undefined
let shown: Scheme | null = null
const changes = new Set<() => void>()

const systemDark = (): boolean => {
  try {
    media ??= typeof matchMedia === 'function' ? matchMedia(QUERY) : null
  } catch {
    media = null
  }
  return media?.matches === true
}

export const appearance = (): Appearance => chosen
export const schemeNow = (): Scheme => (chosen === 'system' ? (systemDark() ? 'dark' : 'light') : chosen)

/** Puts the scheme on the page; tells the drawings when it changed. */
function paint(): void {
  const scheme = schemeNow()
  document.documentElement.dataset.scheme = scheme
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
  for (const m of metas) m.dataset.own ??= m.content
  const own = metas.find((m) => (m.getAttribute('media') ?? '').includes(scheme))?.dataset.own
  for (const m of metas) m.content = chosen === 'system' || own === undefined ? m.dataset.own! : own
  const colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (colorScheme) colorScheme.content = chosen === 'system' ? 'light dark' : scheme
  nudge(metas)
  const was = shown
  shown = scheme
  if (was !== null && was !== scheme) for (const f of [...changes]) f()
}

let nudges = 0
/** One frame with a near-same colour in each bar tag, then the real one: iOS reads the strip again. */
function nudge(metas: HTMLMetaElement[]): void {
  if (typeof requestAnimationFrame !== 'function') return
  const id = ++nudges
  const real = metas.map((m) => m.content)
  requestAnimationFrame(() => {
    if (id !== nudges) return
    metas.forEach((m, i) => (m.content = `${real[i]}fe`))
    requestAnimationFrame(() => {
      if (id === nudges) metas.forEach((m, i) => (m.content = real[i]))
    })
  })
}

let started = false
/** Reads the saved choice and paints it; from then on System follows the iPhone. */
export function startAppearance(): void {
  chosen = readAppearance()
  if (!started) {
    started = true
    systemDark()
    media?.addEventListener?.('change', () => chosen === 'system' && paint())
    addEventListener('pageshow', () => paint())
    document.addEventListener('visibilitychange', () => document.visibilityState !== 'hidden' && paint())
  }
  paint()
}

/** Settings › Appearance: saved on this phone, painted at once. */
export function setAppearance(next: Appearance): void {
  chosen = next
  saveAppearance(next)
  paint()
}

/** The drawings' "is it dark" (`watchDrawings`'s `dark`): a change of the scheme draws the shown pictures again. */
export const schemeWatch = {
  get matches(): boolean {
    return schemeNow() === 'dark'
  },
  addEventListener(_type: 'change', fn: () => void): void {
    changes.add(fn)
  },
  removeEventListener(_type: 'change', fn: () => void): void {
    changes.delete(fn)
  },
}
