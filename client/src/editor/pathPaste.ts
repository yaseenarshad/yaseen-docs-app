/**
 * Paste a path, get a link (YAZ-3609). A pasted absolute path or `yaseendocs://` link to a file or
 * folder of THIS vault becomes the link the `[[` picker writes for it: a note's or folder's id, else
 * its vault spelling (`[[report.pdf]]`). Both are vault-relative, so they work on every Mac. A file
 * no tab can show gets a relative Markdown link, which opens in its default app (YAZ-1311).
 * The same `path → row` map tells a Markdown link's click which targets open in a tab (D8).
 * Read through a ctx slice, like `imageOptionsCtx`: `clipboardPaste` has no options of its own.
 */
import { parserCtx } from '@milkdown/kit/core'
import { createSlice, type Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Slice } from '@milkdown/kit/prose/model'
import { AddMarkStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { EXTERNAL_EDIT_META } from './external/applyExternalMarkdown'
import type { EditorView } from '@milkdown/kit/prose/view'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { fileKind } from '@shared/fileKind'
import { parseFileLink } from '@shared/links'
import type { LinkCandidate } from '../links/completion'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'

export interface PathPasteOptions {
  /** Vault root (absolute). A path outside it stays text: links never cross vaults (YAZ-314). */
  root: string
  /** ABSOLUTE path of this note: the `from` of a relative Markdown link. */
  notePath: string
  /** This vault's `[[` picker rows: the spelling of every link the app writes. */
  candidates: WikilinkCandidateSource
  /** The `[[` picker rows of the window's vault that holds `path`, or null outside them (D14): links across the workspace. */
  candidatesOf?: (path: string) => WikilinkCandidateSource | null
  /** The passive in-window notice: why a pasted path stayed text (D6). */
  onNotice?: (message: string) => void
}

export const pathPasteCtx = createSlice<PathPasteOptions | null>(null, 'mdapp-path-paste')

/** One pasted line as an absolute path: quotes, `\ ` escapes and `yaseendocs://` undone; a folder's `.folder.md` is its folder. */
export function pastedPath(line: string): string | null {
  let text = line.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (/^yaseen(docs|draw):\/\//.test(text)) text = parseFileLink(text)?.path ?? ''
  if (text.startsWith('/')) text = text.replace(/\\ /g, ' ')
  text = text.replace(/[\\/]\.folder\.md$/, '').replace(/[\\/]+$/, '')
  // A Mac path, or a Windows one (`C:\Users\…`): the app keeps each in its own form.
  return text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text) ? text : null
}

/** One key for a path in either form: `\` and `/` are one separator, case does not count, and accents compare in one Unicode form (YAZ-3635). */
const keyOf = (path: string): string => path.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const nameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
const inVault = (path: string, options: PathPasteOptions): boolean => keyOf(path).startsWith(`${keyOf(options.root)}/`)

const byPath = new WeakMap<readonly LinkCandidate[], Map<string, LinkCandidate>>()

/** The picker's row for `path`: one map per candidate list, built at the first paste or click after an index change. */
function rowOf(path: string, rows: readonly LinkCandidate[]): LinkCandidate | undefined {
  let map = byPath.get(rows)
  if (map === undefined) {
    map = new Map()
    for (const row of rows) if (row.path !== undefined && !map.has(keyOf(row.path))) map.set(keyOf(row.path), row)
    byPath.set(rows, map)
  }
  return map.get(keyOf(path))
}

/** The Markdown of the link to `path`, or null when it is no link of this vault (then the paste stays text). */
export function linkFor(path: string, options: PathPasteOptions): string | null {
  if (!inVault(path, options)) {
    // Another vault of this window (D15): a relative Markdown link, which a click opens in a tab (D14).
    const other = options.candidatesOf?.(path)
    const row = other == null ? undefined : rowOf(path, other.candidates)
    return row === undefined ? null : markdownLink(row.name, options.notePath, path)
  }
  const insert = rowOf(path, options.candidates.candidates)?.insert
  if (insert !== undefined) return `[[${insert}]]`
  // A file no tab can show (D5): a relative Markdown link. A click opens its default app (YAZ-1311).
  const name = nameOf(path)
  if (!name.includes('.') || fileKind(name) !== null) return null
  return markdownLink(name, options.notePath, path)
}

/** `[label](relative href)`: the label's brackets escaped. */
const markdownLink = (label: string, from: string, to: string): string => `[${label.replace(/[[\]]/g, '\\$&')}](${relativeHref(from, to)})`

/** A Markdown link's target as a page, folder or file of this vault (D8), or null: the web, another folder, a missing file. */
export function hrefTarget(href: string, options: PathPasteOptions): string | null {
  const target = hrefPath(href, options.notePath)
  return target === null ? null : rowOf(target, (options.candidatesOf?.(target) ?? options.candidates).candidates)?.path ?? null
}

/** A Markdown link's target as an absolute path in a vault of this window, found or not (D19); null for the web or anywhere else. */
export function vaultHref(href: string, options: PathPasteOptions): string | null {
  const target = hrefPath(href, options.notePath)
  return target !== null && (inVault(target, options) || options.candidatesOf?.(target) != null) ? target : null
}

/** A local `href` as an absolute path: decoded, `#` and `?` dropped, resolved from `notePath`'s folder; null for the web. */
export function hrefPath(href: string, notePath: string): string | null {
  if (/^[a-z][a-z\d+.-]+:/i.test(href) && !/^file:/i.test(href)) return null
  let path: string
  try {
    path = decodeURIComponent(href.replace(/^file:\/\/(localhost)?(\/(?=[A-Za-z]:))?/i, '').replace(/[?#].*$/, ''))
  } catch {
    return null
  }
  const absolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? path : `${notePath.replace(/[\\/][^\\/]*$/, '')}/${path}`
  // A folder's page names its folder, as a pasted path does.
  return collapse(absolute).replace(/\/\.folder\.md$/, '')
}

/** `.` and `..` folded away: `/v/a/../b.md` is `/v/b.md`. */
function collapse(path: string): string {
  const parts: string[] = []
  for (const part of path.split(/[\\/]/)) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/**
 * A link set in the link box (or "Add link…") or pasted with the absolute path of a file or folder of a
 * vault in this window (D16) is stored relative to this note, as a paste of a path writes it: it keeps
 * working on another Mac where the vaults keep their layout. Only the links that this change SETS are
 * read (YAZ-3649): never a link that an outside edit (an agent, another app) wrote, and never an older
 * link that the caret types inside. Milkdown's paste carries no meta, so a link that text brings counts
 * as set only when its line held no link to that address before: typing inside a link repeats one.
 */
export const relativeLinks = $prose((ctx) => new Plugin({
  key: new PluginKey('mdapp-relative-links'),
  appendTransaction: (trs, before, state) => {
    const options = ctx.get(pathPasteCtx)
    // Not an outside edit, and not an undo or a redo (`history$`): ⌘Z after "Remove link" puts the link back as it was (YAZ-3658).
    if (options === null || before.doc === state.doc || trs.some((tr) => tr.getMeta(EXTERNAL_EDIT_META) !== undefined || tr.getMeta('history$') !== undefined)) return null
    const type = linkSchema.type(ctx)
    // The hrefs this change sets: an added link mark (the link box), or the links a paste brings.
    const set = new Set<string>()
    for (const tr of trs) {
      tr.steps.forEach((step, i) => {
        if (step instanceof AddMarkStep && step.mark.type === type) set.add(step.mark.attrs.href as string)
        if (!(step instanceof ReplaceStep)) return
        const doc = tr.docs[i]!
        const line = new Set<string>()
        doc.resolve(Math.min(step.from, doc.content.size)).parent.descendants((node) => {
          const mark = type.isInSet(node.marks)
          if (mark !== undefined) line.add(mark.attrs.href as string)
        })
        step.slice.content.descendants((node) => {
          const href = type.isInSet(node.marks)?.attrs.href as string | undefined
          if (href !== undefined && !line.has(href)) set.add(href)
        })
      })
    }
    const absolute = [...set].filter((href) => typeof href === 'string' && /^(file:|\/|[A-Za-z]:[\\/])/i.test(href))
    if (absolute.length === 0) return null
    const start = before.doc.content.findDiffStart(state.doc.content)
    const end = before.doc.content.findDiffEnd(state.doc.content)
    if (start === null || end === null) return null
    const tr = state.tr
    state.doc.nodesBetween(start, Math.max(start, end.b), (node, pos) => {
      const mark = node.isText ? type.isInSet(node.marks) : undefined
      const href = mark?.attrs.href
      const path = typeof href === 'string' && absolute.includes(href) ? vaultHref(href, options) : null
      if (mark === undefined || path === null) return
      tr.addMark(pos, pos + node.nodeSize, type.create({ ...mark.attrs, href: relativeHref(options.notePath, path) }))
    })
    return tr.docChanged ? tr : null
  },
}))

/** A web, mail or phone link pasted over words in one block (D7): the words become that link, in one undo step. */
export function pasteUrlOverWords(view: EditorView, ctx: Ctx, text: string): boolean {
  const href = text.trim()
  const { empty, from, to, $from, $to } = view.state.selection
  if (empty || $from.parent !== $to.parent || !/^(https?:\/\/|mailto:|tel:)\S+$/i.test(href)) return false
  view.dispatch(closeHistory(view.state.tr).addMark(from, to, linkSchema.type(ctx).create({ href })).setMeta('paste', true))
  return true
}

/** Why a pasted path stayed text (D6). Only for a file the app can open, so a path in prose stays quiet. */
function noticeWhy(path: string, options: PathPasteOptions): void {
  const name = nameOf(path)
  if (options.onNotice === undefined || fileKind(name) === null) return
  const known = inVault(path, options) || options.candidatesOf?.(path) != null
  options.onNotice(known ? `Can't find ${name} yet, so it stays a path` : `${name} is not in a vault open in this window, so it stays a path`)
}

/** `to` from the folder of `from`, each name URL-encoded: `../finance/budget%20v2.zip`. */
function relativeHref(from: string, to: string): string {
  const source = from.split(/[\\/]/).slice(0, -1)
  const target = to.split(/[\\/]/)
  let same = 0
  // The shared folders are found as the rest of the paths are: case does not count (YAZ-3634).
  while (same < source.length && same < target.length - 1 && keyOf(source[same]!) === keyOf(target[same]!)) same += 1
  // Parentheses too: an unmatched one would end the Markdown link early.
  const encode = (name: string) => encodeURIComponent(name).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return [...source.slice(same).map(() => '..'), ...target.slice(same).map(encode)].join('/')
}

/** The most lines a paste may have to be read as paths. */
const MAX_PATHS = 500

/** Pastes `text` as links when every line is a link of this vault; false leaves the paste to the text handlers. */
export function pastePathLinks(view: EditorView, ctx: Ctx, options: PathPasteOptions, text: string): boolean {
  // Code keeps its text (P15): a `[[link]]` in code is no link.
  if (view.state.selection.$from.marks().some((mark) => mark.type.spec.code === true)) return false
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  // A paste this long is no list of paths: it goes on as text, unread.
  if (lines.length > MAX_PATHS) return false
  // Several paths (D4): each one a bullet, or the whole paste stays text.
  const links = lines.map((line) => {
    const path = pastedPath(line)
    return path === null ? null : linkFor(path, options)
  })
  if (links.length === 0 || links.includes(null)) {
    const path = lines.length === 1 ? pastedPath(lines[0]!) : null
    if (path !== null) noticeWhy(path, options)
    return false
  }
  if (links.length > 1) {
    const tr = closeHistory(view.state.tr).deleteSelection()
    // A table cell or a heading holds no list (YAZ-3631): there the links go on the line, one space apart.
    const $at = tr.selection.$from
    const noList = $at.parent.type.name === 'heading' || Array.from({ length: $at.depth }, (_, d) => $at.node(d).type.name).some((name) => name === 'table_cell' || name === 'table_header')
    if (noList) {
      view.dispatch(tr.replaceSelection(Slice.maxOpen(ctx.get(parserCtx)(links.join(' ')).content)).setMeta('paste', true).scrollIntoView())
      return true
    }
    const list = ctx.get(parserCtx)(links.map((link) => `- ${link}`).join('\n')).content
    // The bullets start on a line of their own: a line with text splits first. In a bullet they are its
    // siblings (the slice opens into the list); elsewhere they are a list of their own (a closed slice).
    const inList = tr.selection.$from.node(-1).type.name === 'list_item'
    if (tr.selection.$from.parent.content.size > 0) tr.split(tr.selection.from, inList ? 2 : 1)
    view.dispatch(tr.replaceSelection(inList ? Slice.maxOpen(list) : new Slice(list, 0, 0)).setMeta('paste', true).scrollIntoView())
    return true
  }
  const link = links[0]!
  // Pasted over words (D3): they become the link's text, `[[YAZ-12|the plan]]`, in one undo step.
  const { empty, from, to: end } = view.state.selection
  const words = empty ? '' : view.state.doc.textBetween(from, end)
  if (/^[^\n[\]|]+$/.test(words)) {
    const labelled = Slice.maxOpen(ctx.get(parserCtx)(link.startsWith('[[') ? link.replace(/\]\]$/, `|${words}]]`) : link.replace(/^\[(?:\\.|[^\]])*\]/, `[${words}]`)).content)
    view.dispatch(closeHistory(view.state.tr).replaceSelection(labelled).setMeta('paste', true).scrollIntoView())
    return true
  }
  // Two undo steps of their own: the path goes in first, so ⌘Z after the paste gives the path back, and
  // the next ⌘Z takes the paste away and leaves the typing before it (YAZ-3636).
  const raw = lines[0]!.trim()
  view.dispatch(closeHistory(view.state.tr).insertText(raw).setMeta('paste', true).setMeta('uiEvent', 'paste'))
  const to = view.state.selection.from
  const slice = Slice.maxOpen(ctx.get(parserCtx)(link).content)
  view.dispatch(closeHistory(view.state.tr).replace(to - raw.length, to, slice).scrollIntoView())
  // No chip after a paste over words (K5): ⌘Z gives the words back.
  if (empty) offerKeepAsPath(view, to - raw.length, to - raw.length + slice.size, raw)
  return true
}

/** The one open chip's close, or null. A new chip or a closing editor closes it (`closePathChip`). */
let openChip: (() => void) | null = null

/** Closes the "Keep as path" chip, if one is open: its editor is going away. */
export const closePathChip = (): void => openChip?.()

/** The small "Keep as path" chip under a pasted link (D2). The next key, click outside or scroll closes it. */
function offerKeepAsPath(view: EditorView, from: number, to: number, raw: string): void {
  closePathChip()
  const pasted = view.state.doc
  const chip = document.createElement('div')
  chip.className = 'ctx-menu ctx-menu--editor path-paste-chip'
  const keep = document.createElement('button')
  keep.type = 'button'
  keep.className = 'ctx-menu__item'
  keep.textContent = 'Keep as path'
  chip.appendChild(keep)
  const close = () => {
    openChip = null
    chip.remove()
    document.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('keydown', close, true)
    document.removeEventListener('scroll', close, true)
  }
  const onDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && chip.contains(event.target))) close()
  }
  keep.addEventListener('mousedown', (event) => event.preventDefault())
  keep.addEventListener('click', () => {
    // Only over the paste as it was: an edit since then has closed the chip already.
    if (view.state.doc === pasted) view.dispatch(view.state.tr.insertText(raw, from, to))
    close()
  })
  view.dom.parentElement?.appendChild(chip)
  // Kept inside the window, as the link menu is (`markdownLink.ts`).
  const at = view.coordsAtPos(to)
  chip.style.left = `${Math.max(0, Math.min(at.left, window.innerWidth - chip.offsetWidth))}px`
  chip.style.top = `${Math.max(0, Math.min(at.bottom + 4, window.innerHeight - chip.offsetHeight))}px`
  openChip = close
  document.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', close, true)
  document.addEventListener('scroll', close, true)
}
