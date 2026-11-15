import { readAppearance, saveAppearance, type Appearance } from '../store/appearancePref'

/**
 * YAZ-5565: light or dark, as Settings › Appearance says (the Mac's words and order: System, Light, Dark). The page's
 * look hangs on ONE attribute, `<html data-scheme="light|dark">`: every stylesheet's dark rules are
 * `:where([data-scheme='dark'])` (no added weight: the cascade is the one the media query gave). System follows the
 * iPhone live (the media query's change). `main.tsx` and the `/friend` page call `startAppearance()` first, before
 * anything draws. The address bar and status bar colour (`theme-color`) and the browser's own controls (`color-scheme`)
 * follow too; the drawings and diagrams draw in it (`schemeWatch`, for `drawing/watchDrawings.ts`).
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
  const was = shown
  shown = scheme
  if (was !== null && was !== scheme) for (const f of [...changes]) f()
}

let started = false
/** Reads the saved choice and paints it; from then on System follows the iPhone. */
export function startAppearance(): void {
  chosen = readAppearance()
  if (!started) {
    started = true
    systemDark()
    media?.addEventListener?.('change', () => chosen === 'system' && paint())
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
