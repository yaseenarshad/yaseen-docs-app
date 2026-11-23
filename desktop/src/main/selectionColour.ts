/**
 * The Mac's selection colour for the editor in dark (YAZ-5941). Electron-free (like theme.ts), so it unit-tests
 * without a browser; index.ts gives it `systemPreferences.getColor('selected-text-background')` and the two events.
 *
 * - The colour is what macOS paints selected text with: it follows System Settings › Appearance › Highlight colour.
 * - `getColor` follows the Mac's own appearance, NOT `nativeTheme.themeSource` (checked on Electron 43: with the Mac
 *   in Dark it answers the dark colour for themeSource light, dark and system alike). So with the Mac in Light and
 *   the app set to Dark it answers the LIGHT colour, which white text cannot be read on: that colour counts as none,
 *   and the editor keeps its fixed dark blue (`#3f5573`, client/src/app.css).
 */

/** Darker than this (WCAG relative luminance) and white text on it reads at 3:1 or better: (1 + 0.05) / (0.3 + 0.05). */
export const DARK_ENOUGH = 0.3

/** `#rrggbb` (lower case) from what `getColor` answers (`#RRGGBBAA`, or `#RRGGBB`); null for anything else. */
export function parseMacColour(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The colour the editor uses in dark: the Mac's, when white text reads on it; else null (the fixed blue). */
export function darkSelectionColour(raw: unknown): string | null {
  const hex = parseMacColour(raw)
  return hex !== null && luminance(hex) <= DARK_ENOUGH ? hex : null
}

export interface SelectionColourSource {
  /** `systemPreferences.getColor('selected-text-background')`; may throw (off macOS). */
  read(): string
  /** Calls `changed` on each event that may change the colour; answers the unsubscribe. */
  subscribe(changed: () => void): () => void
}

/**
 * Reads the colour now and again on each event, and calls `emit` only when it changed. `current()` is the last read,
 * for a window that asks on mount.
 */
export function watchSelectionColour(source: SelectionColourSource, emit: (colour: string | null) => void): { current(): string | null; stop(): void } {
  const read = (): string | null => {
    try {
      return darkSelectionColour(source.read())
    } catch {
      return null
    }
  }
  let last = read()
  const stop = source.subscribe(() => {
    const next = read()
    if (next === last) return
    last = next
    emit(next)
  })
  return { current: () => last, stop }
}
