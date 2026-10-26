import { pageLabel, type PathTitles } from './pageLabel'

export const APP_NAME = 'Yaseen Docs'

/**
 * Window title (C3, GRO-2165): `<vault> — <file>` (the page's title, YAZ-2420 🔒 D14, by
 * `pageLabel`'s rule), the vault alone with no file open, the app name on the Welcome screen (no
 * vault). The vault stands FIRST (YAZ-2555 D6, which overturns C3's Obsidian-style `<file> — <vault>`):
 * macOS cuts a long title at the end, and with many vaults open the vault is the part you look
 * for in ⌘`, the Window menu and the Dock list. `vault` is the vault's NAME — its display name or
 * folder name (YAZ-1974 D4), never its path. `name` is the window's own name (YAZ-3343 D14), when it has one:
 * it stands where the vault stands. The Welcome screen keeps the app name.
 */
export function windowTitle(vault: string | null, file: string | null, titles: PathTitles, folder = false, name?: string): string {
  if (vault === null) return APP_NAME
  // A named window (YAZ-3343 D14) leads with its name in the vault's place: the name is what the user picks it by.
  const lead = name ?? vault
  if (file === null) return lead
  return `${lead} — ${pageLabel(file, folder, titles)}`
}
