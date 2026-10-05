/**
 * Create-on-click for unresolved wiki links (Links C, GRO-2192): clicking an unresolved
 * `[[link]]` CREATES its page, then opens it — never a dialog. The page name is the raw
 * inner text with `|alias` / `#heading` / `#^block` stripped (`linkPageName` — resolution
 * strips inside the resolver, creation must strip here); an empty result (`[[#h]]`, the
 * same-file form) is a no-op.
 *
 * Location ruling (LOCKED, C2- GRO-2240): a BARE target creates under `base` — the
 * root-relative folder App computes from the "default location for new notes" setting via
 * `newNoteBase` ('' = the vault root, which is also Obsidian's and the setting's default).
 * A pathed target (`[[Sub/Page]]`, `[[/Page]]`) is an explicit aim and stays root-relative
 * whatever the setting (Obsidian's behavior); missing parent folders — the base included —
 * are created level by level (`ensureFolder` — the bridge's `createDir` does not recurse).
 * What was typed is the note's TITLE (YAZ-2420 🔒 D20) — the last segment of a pathed target,
 * whose earlier segments are the titles of the folders it names (🔒 D6), each a folder that is
 * there before it is one to make (YAZ-2478); `base` is a path on disk.
 * Invalid names and create failures come back as `error` for the caller's passive notice
 * (App's link-notice).
 */
import type { SettingsState } from '@shared/types'
import { createNote, ensureFolder } from '../../views/scaffold'
import { validateEntryName } from '../../sidebar/createEntry'
import { linkPageName } from './wikilinkPlugin'

export type CreateFromLinkResult =
  /** The page exists now — open `path`. */
  | { status: 'created'; path: string }
  /** Same-file link (`[[#h]]`): nothing to create, nothing to open. */
  | { status: 'noop' }
  /** Unusable name or bridge failure: show `message` as a passive notice, never a dialog. */
  | { status: 'error'; message: string }

/**
 * The root-relative base folder where a BARE unresolved `[[link]]` creates its page
 * (C2-, GRO-2240) — pure, computed by App from the Files & Links setting + the SOURCE page
 * (the page the link was clicked or typed in, YAZ-1643): `'root'` → '' (the vault root);
 * `'current'` (the default) → the source page's folder, falling back to the root for a
 * source outside the vault; `'folder'` → `newNoteFolder` (validated at the settings
 * boundary; junk still fails safe in `planLinkCreation`).
 */
export function newNoteBase(settings: Pick<SettingsState, 'newNoteLocation' | 'newNoteFolder'>, root: string, sourcePath: string): string {
  if (settings.newNoteLocation === 'folder') return settings.newNoteFolder
  if (settings.newNoteLocation === 'current' && sourcePath.startsWith(`${root}/`)) {
    const rel = sourcePath.slice(root.length + 1)
    const cut = rel.lastIndexOf('/')
    return cut === -1 ? '' : rel.slice(0, cut)
  }
  return ''
}

/**
 * Pure planning for `target` (already stripped): the root-relative folder ('' = the vault root)
 * and the note's title, or a human-readable error. A BARE target lands under `base` (see
 * `newNoteBase`), a path on disk; a PATHED one ignores it — an explicit path is an explicit aim
 * (module doc) — and its folder is `titled`: typed text, each segment a folder's title, free text
 * as the note's is (YAZ-2478) and only has to be there. The base's segments pass the sidebar's
 * `validateEntryName` rules. Errors name the full effective path.
 */
export function planLinkCreation(target: string, base = ''): { folder: string; titled: boolean; title: string } | { error: string } {
  const titled = target.includes('/')
  const effective = base !== '' && !titled ? `${base}/${target}` : target
  const segments = effective.replace(/^\/+/, '').split('/').map((s) => s.trim())
  for (const [i, segment] of segments.entries()) {
    if (segment === '') return { error: `Can't create "${effective}": empty name` }
    const reason = titled || i === segments.length - 1 ? null : validateEntryName(segment)
    if (reason !== null) return { error: `Can't create "${effective}": ${reason}` }
  }
  return { folder: segments.slice(0, -1).join('/'), titled, title: segments[segments.length - 1] }
}

/**
 * Create the page behind raw `[[inner]]` under `root` — bare targets under `base` — and resolve where to open (see module doc).
 * It is born like every note in that folder (`createNote`): with the folder's `.template.md`.
 * `id` is for the picker's Create row (YAZ-2293), which has already written `[[id]]` and needs the
 * page born with it; a click on a name link passes none and one is made for it.
 */
export async function createFromLink(root: string, inner: string, base = '', id?: string): Promise<CreateFromLinkResult> {
  const target = linkPageName(inner)
  if (target === '') return { status: 'noop' }
  const planned = planLinkCreation(target, base)
  if ('error' in planned) return { status: 'error', message: planned.error }
  try {
    const dir = await ensureFolder(root, planned.folder, planned.titled)
    return { status: 'created', path: await createNote(dir, planned.title, undefined, id) }
  } catch (err) {
    return { status: 'error', message: `Can't create "${target}": ${err instanceof Error ? err.message : String(err)}` }
  }
}
