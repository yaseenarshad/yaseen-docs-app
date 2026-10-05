import { pageLabel, type PathTitles } from './pageLabel'

export const APP_NAME = 'Yaseen Docs'

/**
 * Obsidian-style window title (C3, GRO-2165): `<file> — <vault>` (the page's title, YAZ-2420 🔒
 * D14, by `pageLabel`'s rule), the vault alone with no file open, the app name on
 * the Welcome screen (no vault). `vault` is the vault's NAME — its display name or folder name
 * (YAZ-1974 D4), never its path.
 */
export function windowTitle(vault: string | null, file: string | null, titles: PathTitles, folder = false): string {
  if (vault === null) return APP_NAME
  if (file === null) return vault
  return `${pageLabel(file, folder, titles)} — ${vault}`
}
