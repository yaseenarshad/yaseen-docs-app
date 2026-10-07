import { pageLabel, type PathTitles } from './pageLabel'

export const APP_NAME = 'Yaseen Docs'

/**
 * Window title (C3, GRO-2165): `<vault> — <file>` (the page's title, YAZ-2420 🔒 D14, by
 * `pageLabel`'s rule), the vault alone with no file open, the app name on the Welcome screen (no
 * vault). The vault stands FIRST (YAZ-2555 D6, which overturns C3's Obsidian-style `<file> — <vault>`):
 * macOS cuts a long title at the end, and with many vaults open the vault is the part you look
 * for in ⌘`, the Window menu and the Dock list. `vault` is the vault's NAME — its display name or
 * folder name (YAZ-1974 D4), never its path.
 */
export function windowTitle(vault: string | null, file: string | null, titles: PathTitles, folder = false): string {
  if (vault === null) return APP_NAME
  if (file === null) return vault
  return `${vault} — ${pageLabel(file, folder, titles)}`
}
