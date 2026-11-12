/**
 * A vault's link pills look on a pill (YAZ-4924, `shared/linkPills.ts`), in two halves:
 *  - `linkPillVars`: the LOOK as CSS custom properties on the vault's page layers (App's `textVarsFor`, the way the
 *    text formatting travels): the background, the text colour, the icon, bold / italic / underline and the shape.
 *    `wikilink.css` and `views.css` read them with today's look as each fallback, so a vault that changed nothing sets
 *    none, and a change costs one style update on the layers, never a redraw of a note.
 *  - `pillParts`: the TEXT a pill gains, drawn by the two link plugins as widgets at the pill's ends (`headSpan`,
 *    `tailSpan`) and by a folder page's cells as spans (`LinkPillParts.tsx`): the text before and after, the vault's
 *    name, the ID and the folder. Look only: the file keeps `[[Name]]`, a copy keeps the link as written. The ID and
 *    the folder come from the index snapshot through `pathInfo`, a Map built once per snapshot, as `pathTitles` is.
 */
import type { LinkPills } from '@shared/linkPills'
import type { IndexRecord } from '@shared/types'
import { dirname } from '../../lib/paths'

/** The wash of a palette background at each strength (a card's, `views.css`). */
const STRENGTH_PERCENT = { light: 15, medium: 30, strong: 50 } as const

/** The custom properties of the changed fields, for example `{ '--pill-bg': 'transparent' }`. `{}` sets none. */
export function linkPillVars(pills: LinkPills): Record<string, string> {
  const vars: Record<string, string> = {}
  if (pills.background === 'none') {
    vars['--pill-bg'] = 'transparent'
    vars['--pill-pad'] = '0'
  } else if (pills.background !== undefined) vars['--pill-bg'] = `color-mix(in srgb, var(--table-fill-solid-${pills.background}) ${STRENGTH_PERCENT[pills.strength ?? 'medium']}%, transparent)`
  if (pills.text === 'same') vars['--pill-fg'] = 'currentColor'
  else if (pills.text !== undefined) vars['--pill-fg'] = `var(--table-text-${pills.text})`
  if (pills.icon === 'hide') vars['--pill-icon-display'] = 'none'
  if (pills.bold) vars['--pill-weight'] = 'bold'
  if (pills.italic) vars['--pill-style'] = 'italic'
  if (pills.underline) vars['--pill-decoration'] = 'underline'
  if (pills.shape === 'square') vars['--pill-radius'] = '0'
  else if (pills.shape === 'underline') {
    vars['--pill-bg'] = 'transparent'
    vars['--pill-pad'] = '0'
    vars['--pill-radius'] = '0'
    vars['--pill-decoration'] = 'underline'
  }
  return vars
}

/** What the index knows of a page: its ID (a note with one) and its root-relative folder ('' at the root). */
export interface PathInfo {
  id?: string
  folder: string
}
export type PathInfos = ReadonlyMap<string, PathInfo>

const infoCache = new WeakMap<readonly IndexRecord[], WeakMap<readonly IndexRecord[], PathInfos>>()

/**
 * The index snapshot as `PathInfos`, built once per snapshot (keyed by the identity of its two arrays, as `pathTitles`
 * is). A folder's record is its `.folder.md`, so its directory is the key, and its folder is the one that holds it.
 */
export function pathInfo(records: readonly IndexRecord[], folders: readonly IndexRecord[]): PathInfos {
  let byFolders = infoCache.get(records)
  if (byFolders === undefined) infoCache.set(records, (byFolders = new WeakMap()))
  let infos = byFolders.get(folders)
  if (infos === undefined) {
    const built = new Map<string, PathInfo>()
    for (const record of records) built.set(record.path, record.id === undefined ? { folder: record.folder } : { id: record.id, folder: record.folder })
    for (const folder of folders) built.set(dirname(folder.path), { folder: folder.folder.includes('/') ? folder.folder.slice(0, folder.folder.lastIndexOf('/')) : '' })
    byFolders.set(folders, (infos = built))
  }
  return infos
}

/** Whether the look needs the index for a pill: an ID or a folder shown. Else no lookup is paid. */
export const pillsNeedInfo = (pills: LinkPills): boolean => pills.id === 'show' || pills.folder !== undefined

/** What is known of one pill's page. `otherVault`: the name of its vault when that is not the note's own (YAZ-3609 D22), else null. */
export interface PillMeta {
  info?: PathInfo
  otherVault: string | null
}

/** The text before a pill's name: the vault's name ("Wiki › "), after the Before text. */
export interface PillHead {
  before?: string
  vault?: string
}
/** The text after a pill's name, in this order: the ID, the folder, the vault's name (" (Wiki)"), the After text. */
export interface PillTail {
  id?: string
  folder?: string
  vault?: string
  after?: string
}

/** The vault's name a pill shows, or null: other vaults only (absent, today), every pill (the note's own vault's name then), never. */
function vaultShown(pills: LinkPills, meta: PillMeta, ownVault: string | null): string | null {
  if (pills.vault === 'never') return null
  return meta.otherVault ?? (pills.vault === 'always' ? ownVault : null)
}

/** The folder a pill shows, or undefined: the parent folder's name, or the whole path from the vault with " › " between folders; nothing at the root. */
function folderShown(pills: LinkPills, info: PathInfo | undefined): string | undefined {
  if (info === undefined || info.folder === '') return undefined
  return pills.folder === 'full' ? info.folder.split('/').join(' › ') : pills.folder === 'parent' ? info.folder.slice(info.folder.lastIndexOf('/') + 1) : undefined
}

/** The two halves a pill gains under `pills`; each null when it has nothing. Today's look gives only the other vault's name, at the tail. */
export function pillParts(pills: LinkPills, meta: PillMeta, ownVault: string | null): { head: PillHead | null; tail: PillTail | null } {
  const vault = vaultShown(pills, meta, ownVault)
  const head: PillHead = {}
  if (pills.before !== undefined) head.before = pills.before
  if (vault !== null && pills.vaultPlace === 'before') head.vault = vault
  const tail: PillTail = {}
  if (pills.id === 'show' && meta.info?.id !== undefined) tail.id = meta.info.id
  const folder = folderShown(pills, meta.info)
  if (folder !== undefined) tail.folder = folder
  if (vault !== null && pills.vaultPlace !== 'before') tail.vault = vault
  if (pills.after !== undefined) tail.after = pills.after
  return { head: Object.keys(head).length === 0 ? null : head, tail: Object.keys(tail).length === 0 ? null : tail }
}

/** A widget's key: the same text draws the same DOM, so a rebuild that changes nothing redraws nothing. */
export const headKey = (head: PillHead): string => `head:${head.before ?? ''}|${head.vault ?? ''}`
export const tailKey = (tail: PillTail): string => `tail:${tail.id ?? ''}|${tail.folder ?? ''}|${tail.vault ?? ''}|${tail.after ?? ''}`

/** The text of the vault's name in each place: " (Wiki)" after the name (today's, YAZ-3609 D22), "Wiki › " before it. */
export const vaultAfterText = (vault: string): string => ` (${vault})`
export const vaultBeforeText = (vault: string): string => `${vault} › `

function piece(doc: Document, cls: string, text: string): HTMLElement {
  const span = doc.createElement('span')
  span.className = cls
  span.textContent = text
  return span
}

/**
 * The DOM of a pill's head, a piece of the pill (`cls` is the pill's own classes): the Before text, then the vault's
 * name as `link-pill__vault`. Spellcheck off: no word to check.
 */
export function headSpan(cls: string, head: PillHead, doc: Document = document): HTMLElement {
  const span = doc.createElement('span')
  span.className = `${cls} link-pill__head`
  span.spellcheck = false
  if (head.before !== undefined) span.append(head.before)
  if (head.vault !== undefined) span.append(piece(doc, 'link-pill__vault', vaultBeforeText(head.vault)))
  return span
}

/**
 * The DOM of a pill's tail, a piece of the pill at its end: the ID and the folder (`link-pill__id`, `link-pill__folder`,
 * small and muted), the vault's name (`link-pill__vault`, as the vault tag of YAZ-3609 D22 was drawn), then the After text.
 */
export function tailSpan(cls: string, tail: PillTail, doc: Document = document): HTMLElement {
  const span = doc.createElement('span')
  span.className = `${cls} link-pill__tail`
  span.spellcheck = false
  if (tail.id !== undefined) span.append(piece(doc, 'link-pill__id', tail.id))
  if (tail.folder !== undefined) span.append(piece(doc, 'link-pill__folder', tail.folder))
  if (tail.vault !== undefined) span.append(piece(doc, 'link-pill__vault', vaultAfterText(tail.vault)))
  if (tail.after !== undefined) span.append(tail.after)
  return span
}
