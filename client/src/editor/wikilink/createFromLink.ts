/**
 * Create-on-click for unresolved wiki links (Links C, GRO-2192): clicking an unresolved
 * `[[link]]` CREATES its page, then opens it — never a dialog. The page name is the raw
 * inner text with `|alias` / `#heading` / `#^block` stripped (`linkPageName` — resolution
 * strips inside the resolver, creation must strip here); an empty result (`[[#h]]`, the
 * same-file form) is a no-op.
 *
 * Location ruling (LOCKED): a bare target creates at the VAULT ROOT — Obsidian's default.
 * The "default location for new notes" setting is C2- (GRO-2240); when it lands it threads
 * a folder into `planLinkCreation` instead of this hardcoded root. A pathed target
 * (`[[Sub/Page]]`) is root-relative; missing parent folders are created level by level
 * (`ensureFolder` — the bridge's `createDir` does not recurse). `.md` is appended unless
 * the name is already markdown (mirrors the sidebar's `entryPath`). Races are benign:
 * `ALREADY_EXISTS` means someone created the page first — just open it. Invalid names and
 * create failures come back as `error` for the caller's passive notice (App's link-notice).
 */
import { api, BridgeRequestError } from '../../api'
import { ensureFolder } from '../../bases/scaffold'
import { validateEntryName } from '../../sidebar/createEntry'
import { linkPageName } from './wikilinkPlugin'

export type CreateFromLinkResult =
  /** The page exists now — open `path` (`exists` = lost the creation race, equally fine). */
  | { status: 'created' | 'exists'; path: string }
  /** Same-file link (`[[#h]]`): nothing to create, nothing to open. */
  | { status: 'noop' }
  /** Unusable name or bridge failure: show `message` as a passive notice, never a dialog. */
  | { status: 'error'; message: string }

/**
 * Pure path planning for `target` (already stripped): root-relative folder ('' = the vault
 * root — the LOCKED default location, see module doc) + the absolute `.md` path, or a
 * human-readable error. Each `/`-segment passes the sidebar's `validateEntryName` rules.
 */
export function planLinkCreation(root: string, target: string): { folder: string; path: string } | { error: string } {
  const segments = target.replace(/^\/+/, '').split('/').map((s) => s.trim())
  for (const segment of segments) {
    if (segment === '') return { error: `Can't create "${target}": empty name` }
    const reason = validateEntryName(segment)
    if (reason !== null) return { error: `Can't create "${target}": ${reason}` }
  }
  const last = segments[segments.length - 1]
  const name = /\.(md|markdown)$/i.test(last) ? last : `${last}.md`
  const folder = segments.slice(0, -1).join('/')
  return { folder, path: `${root}/${folder === '' ? '' : `${folder}/`}${name}` }
}

/** Create the page behind raw `[[inner]]` under `root` and resolve where to open (see module doc). */
export async function createFromLink(root: string, inner: string): Promise<CreateFromLinkResult> {
  const target = linkPageName(inner)
  if (target === '') return { status: 'noop' }
  const planned = planLinkCreation(root, target)
  if ('error' in planned) return { status: 'error', message: planned.error }
  try {
    if (planned.folder !== '') await ensureFolder(root, planned.folder)
    await api.createFile(planned.path)
    return { status: 'created', path: planned.path }
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS') return { status: 'exists', path: planned.path }
    return { status: 'error', message: `Can't create "${target}": ${err instanceof Error ? err.message : String(err)}` }
  }
}
