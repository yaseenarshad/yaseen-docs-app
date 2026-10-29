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
import { closeHistory } from '@milkdown/kit/prose/history'
import { Slice } from '@milkdown/kit/prose/model'
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

/** One key for a path in either form: `\` and `/` are one separator, and case does not count. */
const keyOf = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
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
  if (!inVault(path, options)) return null
  const insert = rowOf(path, options.candidates.candidates)?.insert
  if (insert !== undefined) return `[[${insert}]]`
  // A file no tab can show (D5): a relative Markdown link. A click opens its default app (YAZ-1311).
  const name = nameOf(path)
  if (!name.includes('.') || fileKind(name) !== null) return null
  return `[${name.replace(/[[\]]/g, '\\$&')}](${relativeHref(options.notePath, path)})`
}

/** A Markdown link's target as a page, folder or file of this vault (D8), or null: the web, another folder, a missing file. */
export function hrefTarget(href: string, options: PathPasteOptions): string | null {
  if (/^[a-z][a-z\d+.-]+:/i.test(href) && !/^file:/i.test(href)) return null
  let path: string
  try {
    path = decodeURIComponent(href.replace(/^file:\/\/(\/(?=[A-Za-z]:))?/i, '').replace(/[?#].*$/, ''))
  } catch {
    return null
  }
  const absolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? path : `${options.notePath.replace(/[\\/][^\\/]*$/, '')}/${path}`
  return rowOf(collapse(absolute), options.candidates.candidates)?.path ?? null
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
  options.onNotice(inVault(path, options) ? `Can't find ${name} in this vault yet, so it stays a path` : `${name} is not in this vault, so it stays a path. Links stay inside one vault`)
}

/** `to` from the folder of `from`, each name URL-encoded: `../finance/budget%20v2.zip`. */
function relativeHref(from: string, to: string): string {
  const source = from.split(/[\\/]/).slice(0, -1)
  const target = to.split(/[\\/]/)
  let same = 0
  while (same < source.length && same < target.length - 1 && source[same] === target[same]) same += 1
  return [...source.slice(same).map(() => '..'), ...target.slice(same).map(encodeURIComponent)].join('/')
}

/** Pastes `text` as links when every line is a link of this vault; false leaves the paste to the text handlers. */
export function pastePathLinks(view: EditorView, ctx: Ctx, options: PathPasteOptions, text: string): boolean {
  // Code keeps its text (P15): a `[[link]]` in code is no link.
  if (view.state.selection.$from.marks().some((mark) => mark.type.spec.code === true)) return false
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
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
    const list = ctx.get(parserCtx)(links.map((link) => `- ${link}`).join('\n')).content
    const tr = closeHistory(view.state.tr).deleteSelection()
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
    const labelled = Slice.maxOpen(ctx.get(parserCtx)(link.replace(/\]\]$/, `|${words}]]`)).content)
    view.dispatch(closeHistory(view.state.tr).replaceSelection(labelled).setMeta('paste', true).scrollIntoView())
    return true
  }
  // Two undo steps: the path goes in first, so ⌘Z after the paste gives the path back.
  const raw = lines[0]!.trim()
  view.dispatch(view.state.tr.insertText(raw).setMeta('paste', true).setMeta('uiEvent', 'paste'))
  const to = view.state.selection.from
  const slice = Slice.maxOpen(ctx.get(parserCtx)(link).content)
  view.dispatch(closeHistory(view.state.tr).replace(to - raw.length, to, slice).scrollIntoView())
  offerKeepAsPath(view, to - raw.length, to - raw.length + slice.size, raw)
  return true
}

/** The small "Keep as path" chip under a pasted link (D2). The next key, click outside or scroll closes it. */
function offerKeepAsPath(view: EditorView, from: number, to: number, raw: string): void {
  const pasted = view.state.doc
  const chip = document.createElement('div')
  chip.className = 'ctx-menu ctx-menu--editor path-paste-chip'
  const keep = document.createElement('button')
  keep.type = 'button'
  keep.className = 'ctx-menu__item'
  keep.textContent = 'Keep as path'
  chip.appendChild(keep)
  const close = () => {
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
  const at = view.coordsAtPos(to)
  chip.style.left = `${at.left}px`
  chip.style.top = `${at.bottom + 4}px`
  view.dom.parentElement?.appendChild(chip)
  document.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', close, true)
  document.addEventListener('scroll', close, true)
}
