/**
 * The name rules of a new page or folder (GRO-2022, YAZ-2523 🔒 V3), shared by the app's "New page" and the command
 * (YAZ-4269 D1). Moved unchanged from `client/src/sidebar/createEntry.ts`, which re-exports them.
 */
import { fileKind } from './fileKind'
import type { BoardKind } from './types'

/** What the inline input creates: a markdown page, a folder, or a board — an Excalidraw drawing or a draw.io diagram (YAZ-3028 D9). */
export type EntryKind = 'file' | 'dir' | BoardKind

/** Human-readable reason the name is unusable, or null when fine. */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return 'Name cannot contain "/"'
  if (trimmed.includes('\0')) return 'Name contains an invalid character'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

/**
 * The name on disk of the page or the folder named `typed` in a vault that does not use IDs
 * (YAZ-2523 🔒 V3), made or renamed: as typed, and a page with `suffix` unless a Markdown suffix
 * was typed. Any other suffix is part of the name (`talk.pdf` is the page `talk.pdf.md`): a page
 * is never changed into another kind of file. A name a file cannot hold is refused.
 */
export function plainEntryName(typed: string, kind: EntryKind, suffix = '.md'): string {
  const name = typed.trim()
  const invalid = validateEntryName(name)
  if (invalid !== null) throw new Error(invalid)
  return kind === 'dir' || fileKind(name) === 'markdown' ? name : name + suffix
}
