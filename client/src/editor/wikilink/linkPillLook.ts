/**
 * A vault's link pills look on a pill (YAZ-4924, `shared/linkPills.ts`), in two halves:
 *  - `linkPillVars`: the STYLE as CSS custom properties on the vault's page layers (App's `textVarsFor`, the way the
 *    text formatting travels): the box (`--pill-bg`, `--pill-pad`, `--pill-radius`, `--pill-decoration`) and each
 *    part's weight, style, decoration, colour and size (`--pill-<part>-*`). `wikilink.css` and `views.css` read them
 *    with today's look as each fallback, so a vault that changed nothing sets none, and a change costs one style
 *    update on the layers, never a redraw of a note.
 *  - `pillParts`: the PIECES a pill gains under its FORMAT, drawn by the two link plugins as widgets at the pill's
 *    ends (`headSpan`, `tailSpan`) and by a folder page's cells as spans (`LinkPillParts.tsx`): what the format puts
 *    before `{name}` is the head, what it puts after is the tail — your own text, the ID, the vault's name, the folder,
 *    the path, and the icon where `{icon}` does not stand right before `{name}`. Look only: the file keeps `[[Name]]`,
 *    a copy keeps the link as written. The format is parsed ONCE per look object (`compiled`, a WeakMap): a pill's
 *    draw reads the pieces, never the string. The ID and the folder come from the index snapshot through `pathInfo`,
 *    a Map built once per snapshot, as `pathTitles` is.
 */
import { DEFAULT_LINK_PILL_FORMAT, LINK_PILL_PARTS, parseLinkPillFormat, type LinkPillPartColor, type LinkPillSegment, type LinkPillToken, type LinkPills } from '@shared/linkPills'
import type { IndexRecord } from '@shared/types'
import { dirname } from '../../lib/paths'

/** The wash of a palette fill at each strength (a card's, `views.css`). */
const STRENGTH_PERCENT = { light: 15, medium: 30, strong: 50 } as const

/** A part's colour as CSS. */
const colorValue = (color: LinkPillPartColor): string => (color === 'accent' ? 'var(--accent)' : color === 'same' ? 'currentColor' : color === 'muted' ? 'var(--fg-muted)' : `var(--table-text-${color})`)

/** The custom properties of the changed fields, for example `{ '--pill-bg': 'transparent' }`. `{}` sets none. */
export function linkPillVars(pills: LinkPills): Record<string, string> {
  const vars: Record<string, string> = {}
  const box = pills.box
  if (box !== undefined) {
    if (box.fill === 'none') {
      vars['--pill-bg'] = 'transparent'
      vars['--pill-pad'] = '0'
    } else if (box.fill !== undefined) vars['--pill-bg'] = `color-mix(in srgb, var(--table-fill-solid-${box.fill}) ${STRENGTH_PERCENT[box.strength ?? 'medium']}%, transparent)`
    if (box.shape === 'square') vars['--pill-radius'] = '0'
    else if (box.shape === 'underline') {
      vars['--pill-bg'] = 'transparent'
      vars['--pill-pad'] = '0'
      vars['--pill-radius'] = '0'
      vars['--pill-decoration'] = 'underline'
    }
  }
  if (pills.parts !== undefined)
    for (const part of LINK_PILL_PARTS) {
      const style = pills.parts[part]
      if (style === undefined) continue
      if (style.bold) vars[`--pill-${part}-weight`] = 'bold'
      if (style.italic) vars[`--pill-${part}-style`] = 'italic'
      if (style.underline) vars[`--pill-${part}-decoration`] = 'underline'
      if (style.color !== undefined) vars[`--pill-${part}-fg`] = colorValue(style.color)
      if (style.size !== undefined) vars[`--pill-${part}-size`] = style.size === 'small' ? '0.85em' : '1em'
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

/** Where a pill's icon draws: on the name's own span (`{icon}{name}`, today's), as a piece of the head or the tail, or nowhere. */
export type PillIconPlace = 'name' | 'piece' | 'none'

/** A look's format, parsed once. */
interface Compiled {
  segments: readonly LinkPillSegment[]
  icon: PillIconPlace
  /** Whether a pill needs the index: `{id}`, `{folder}` or `{path}` in the format. Else no lookup is paid. */
  needsInfo: boolean
  hasVault: boolean
}

function compile(format: string): Compiled {
  const { segments } = parseLinkPillFormat(format)
  const tokens = new Set<LinkPillToken>()
  segments.forEach((s) => 'token' in s && tokens.add(s.token))
  const iconAt = segments.findIndex((s) => 'token' in s && s.token === 'icon')
  const next = segments[iconAt + 1]
  const icon: PillIconPlace = iconAt < 0 ? 'none' : next !== undefined && 'token' in next && next.token === 'name' ? 'name' : 'piece'
  return { segments, icon, needsInfo: tokens.has('id') || tokens.has('folder') || tokens.has('path'), hasVault: tokens.has('vault') }
}

const DEFAULT_COMPILED = compile(DEFAULT_LINK_PILL_FORMAT)
const compiledCache = new WeakMap<LinkPills, Compiled>()

/** The look's format in pieces, parsed once per look object: a vault's look changes identity only when it changes. */
function compiled(pills: LinkPills): Compiled {
  if (pills.format === undefined) return DEFAULT_COMPILED
  let c = compiledCache.get(pills)
  if (c === undefined) compiledCache.set(pills, (c = compile(pills.format)))
  return c
}

export const pillIconPlace = (pills: LinkPills): PillIconPlace => compiled(pills).icon
export const pillsNeedInfo = (pills: LinkPills): boolean => compiled(pills).needsInfo
export const pillsShowVault = (pills: LinkPills): boolean => compiled(pills).hasVault

/** What is known of one pill's page. `otherVault`: the name of its vault when that is not the note's own (YAZ-3609 D22), else null. */
export interface PillMeta {
  info?: PathInfo
  otherVault: string | null
}

/** One piece of a pill's head or tail: a text part with its text, or the icon. */
export type PillPiece = { part: 'text' | 'id' | 'vault' | 'folder' | 'path'; text: string } | { part: 'icon' }
/** A pill's head or tail: its pieces in order, never empty. */
export interface PillEnd {
  pieces: readonly PillPiece[]
}

/** The vault's name a pill shows, or '': other vaults only (absent, today), every pill (the note's own vault's name then), never. */
function vaultShown(pills: LinkPills, meta: PillMeta, ownVault: string | null): string {
  if (pills.vault === 'never') return ''
  return meta.otherVault ?? (pills.vault === 'always' ? ownVault ?? '' : '')
}

/** A token's text on this pill; '' when the pill has none (no ID, the root, this vault). The name and the icon are markers. */
function tokenText(token: LinkPillToken, pills: LinkPills, meta: PillMeta, ownVault: string | null): string {
  switch (token) {
    case 'name':
    case 'icon':
      return token
    case 'id':
      return meta.info?.id ?? ''
    case 'vault':
      return vaultShown(pills, meta, ownVault)
    case 'folder':
      return meta.info === undefined ? '' : meta.info.folder.slice(meta.info.folder.lastIndexOf('/') + 1)
    case 'path':
      return meta.info === undefined ? '' : meta.info.folder.split('/').join(' › ')
  }
}

interface Item {
  seg: LinkPillSegment
  text: string
}
const isBlank = (text: string): boolean => text.trim() === ''
/** The bracket pairs that stay together, each opening one at the index of its closing one. */
const OPEN = ['(', '[', '{', '«', '<', '“']
const CLOSE = [')', ']', '}', '»', '>', '”']

/**
 * The two ends a pill gains under `pills`, each null when it has nothing: the format's pieces before `{name}` and after
 * it, with the EMPTY parts dropped and their text with them. The rule: a part can be empty (`{id}` in a vault without
 * IDs, `{folder}` at the root, `{vault}` on a pill of this vault); text that stands only beside empty parts, up to the
 * pill's edge, is dropped (`{name} ({id})` with no ID is just the name); between two shown parts only the first piece
 * of text stays (`{name} · {folder} · {id}` with no folder is "Name · ID"). The icon is no part for this rule: `icon`
 * false (a pill with no icon to draw, a missing note) removes `{icon}` and one blank text beside it, so `{icon} {name}`
 * leaves no stray space and `({icon}{name})` keeps its brackets. `{icon}` right before `{name}` is no piece either: the
 * name's own span draws it (`pillIconPlace` 'name'). Today's look gives only the other vault's name, in its brackets, at
 * the tail.
 */
export function pillParts(pills: LinkPills, meta: PillMeta, ownVault: string | null, icon = true): { head: PillEnd | null; tail: PillEnd | null } {
  const c = compiled(pills)
  let items: Item[] = c.segments.map((seg) => ({ seg, text: 'token' in seg ? tokenText(seg.token, pills, meta, ownVault) : seg.text }))
  if (!icon && c.icon !== 'none') {
    const at = items.findIndex((it) => 'token' in it.seg && it.seg.token === 'icon')
    const after = items[at + 1]
    const before = items[at - 1]
    const blank = after !== undefined && 'text' in after.seg && isBlank(after.text) ? at + 1 : before !== undefined && 'text' in before.seg && isBlank(before.text) ? at - 1 : -1
    items = items.filter((_, i) => i !== at && i !== blank)
  }
  const shown = (it: Item) => 'token' in it.seg && it.text !== ''
  const literal = (i: number) => 'text' in items[i].seg
  // Which characters of each piece of text stay: all of a text beside shown parts only, none of a dropped one.
  const keep: boolean[][] = items.map((it) => ('text' in it.seg ? [...it.text].map(() => false) : []))
  const kept: boolean[] = items.map(() => false)
  // The bracket pairs of the whole format, by (item, character).
  const pairs: Array<[[number, number], [number, number]]> = []
  const open: Array<{ kind: number; item: number; at: number }> = []
  items.forEach((it, i) => {
    if (!literal(i)) return
    ;[...it.text].forEach((ch, k) => {
      const kind = OPEN.indexOf(ch)
      if (kind >= 0) return void open.push({ kind, item: i, at: k })
      const close = CLOSE.indexOf(ch)
      if (close < 0) return
      let o = open.length - 1
      while (o >= 0 && open[o].kind !== close) o--
      if (o < 0) return
      const [{ item, at }] = open.splice(o, 1)
      pairs.push([[item, at], [i, k]])
    })
  })
  const keepAll = (i: number) => {
    kept[i] = true
    keep[i] = keep[i].map(() => true)
  }
  for (let i = 0; i < items.length; ) {
    if (shown(items[i])) {
      kept[i] = true
      i++
      continue
    }
    let j = i
    let hasEmpty = false
    while (j < items.length && !shown(items[j])) {
      if ('token' in items[j].seg) hasEmpty = true
      j++
    }
    if (!hasEmpty) for (let k = i; k < j; k++) keepAll(k)
    else if (i > 0 && j < items.length) {
      // Between two shown parts: a bracket pair inside the run wrapped an empty part and goes; a text that holds a
      // bracket whose partner stands outside the run wraps the shown part and stays; else the last text stays (the
      // separator to the part after), so `{name} ({id}) · {folder}` with no ID is "Name · Folder" and
      // `{name} ({id} · {folder})` is "Name (Folder)".
      const inRun = (item: number) => item >= i && item < j
      const inner = pairs.filter(([a, b]) => inRun(a[0]) && inRun(b[0]))
      const wraps = pairs.filter(([a, b]) => inRun(a[0]) !== inRun(b[0])).map(([a, b]) => (inRun(a[0]) ? a[0] : b[0]))
      const chosen = wraps.length > 0 ? [...new Set(wraps)] : [Math.max(...items.map((_, k) => (k >= i && k < j && literal(k) ? k : -1)))]
      for (const k of chosen) if (k >= 0) keepAll(k)
      for (const [a, b] of inner) {
        keep[a[0]][a[1]] = false
        keep[b[0]][b[1]] = false
      }
    }
    i = j
  }
  // A bracket pair stays together: a bracket whose partner stays is kept out of a dropped piece, so `[{name} {id}]`
  // with no ID is "[Name]", while `{name} ({id})` loses both brackets.
  for (const [a, b] of pairs) {
    if (keep[a[0]][a[1]] && !keep[b[0]][b[1]]) keep[b[0]][b[1]] = true
    else if (!keep[a[0]][a[1]] && keep[b[0]][b[1]]) keep[a[0]][a[1]] = true
  }
  const head: PillPiece[] = []
  const tail: PillPiece[] = []
  let into = head
  items.forEach((it, i) => {
    if ('text' in it.seg) {
      const text = [...it.text].filter((_, k) => keep[i][k]).join('')
      if (text !== '') into.push({ part: 'text', text })
      return
    }
    if (!kept[i]) return
    if (it.seg.token === 'name') into = tail
    else if (it.seg.token === 'icon') {
      if (c.icon === 'piece') into.push({ part: 'icon' })
    } else into.push({ part: it.seg.token, text: it.text })
  })
  return { head: head.length === 0 ? null : { pieces: head }, tail: tail.length === 0 ? null : { pieces: tail } }
}

/** A widget's key: the same pieces draw the same DOM, so a rebuild that changes nothing redraws nothing. */
export const endKey = (end: PillEnd): string => end.pieces.map((p) => (p.part === 'icon' ? 'icon' : `${p.part}:${p.text}`)).join('|')
export const headKey = (head: PillEnd): string => `head:${endKey(head)}`
export const tailKey = (tail: PillEnd): string => `tail:${endKey(tail)}`

/** The whole text of an end, as a cell's `textContent` reads it. */
export const endText = (end: PillEnd): string => end.pieces.map((p) => (p.part === 'icon' ? '' : p.text)).join('')

/**
 * The DOM of a pill's head or tail, a piece of the pill (`cls` is the pill's own classes): each text piece in its
 * part's class (`link-pill__text`, `link-pill__id`, `link-pill__vault`, `link-pill__folder`, `link-pill__path`), the
 * icon as a `file-icon` span with `icon`'s attributes (the decoration's, `fileIconDecoration`). Spellcheck off: no word
 * to check.
 */
function endSpan(cls: string, end: PillEnd, icon: Record<string, string> | undefined, doc: Document): HTMLElement {
  const span = doc.createElement('span')
  span.className = cls
  span.spellcheck = false
  for (const piece of end.pieces) {
    const el = doc.createElement('span')
    if (piece.part === 'icon') {
      for (const [name, value] of Object.entries(icon ?? {})) el.setAttribute(name, value)
      el.className = `${icon?.class ?? 'file-icon'} link-pill__icon`
    } else {
      el.className = `link-pill__${piece.part}`
      el.textContent = piece.text
    }
    span.append(el)
  }
  return span
}
export const headSpan = (cls: string, head: PillEnd, icon?: Record<string, string>, doc: Document = document): HTMLElement => endSpan(`${cls} link-pill__head`, head, icon, doc)
export const tailSpan = (cls: string, tail: PillEnd, icon?: Record<string, string>, doc: Document = document): HTMLElement => endSpan(`${cls} link-pill__tail`, tail, icon, doc)
