/**
 * A path as a link, and a Markdown link's target as a path (YAZ-3609), with no editor (YAZ-5153, 2A1 of YAZ-5055): the
 * pure half of `pathPaste.ts`. The paste plugin writes with these and gives out the same names; the card screens read
 * a link's target here (`hrefTarget`), so they load without the editor.
 */
import { fileKind } from '@shared/fileKind'
import { parseFileLink } from '@shared/links'
import { fileLabel } from '../lib/pageLabel'
import type { LinkCandidate } from '../links/completion'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'

export interface PathPasteOptions {
  /** Vault root (absolute). A path in another vault of the window is a relative Markdown link (D15); one outside every vault of the window stays text. */
  root: string
  /** ABSOLUTE path of this page: the `from` of a relative Markdown link. */
  pagePath: string
  /** This vault's `[[` picker rows: the spelling of every link the app writes. */
  candidates: WikilinkCandidateSource
  /** The `[[` picker rows of the window's vault that holds `path`, or null outside them (D14): links across the workspace. */
  candidatesOf?: (path: string) => WikilinkCandidateSource | null
  /** The passive in-window notice: why a pasted path stayed text (D6). */
  onNotice?: (message: string) => void
}

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
export const keyOf = (path: string): string => path.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
export const nameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
export const inVault = (path: string, options: PathPasteOptions): boolean => keyOf(path).startsWith(`${keyOf(options.root)}/`)

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
    // The link's text is the page's name, as the sidebar shows it (YAZ-3778 D2): no `.excalidraw`.
    return row === undefined ? null : markdownLink(fileLabel(row.name), options.pagePath, path)
  }
  const insert = rowOf(path, options.candidates.candidates)?.insert
  if (insert !== undefined) return `[[${insert}]]`
  // A file no tab can show (D5): a relative Markdown link. A click opens its default app (YAZ-1311).
  const name = nameOf(path)
  if (!name.includes('.') || fileKind(name) !== null) return null
  return markdownLink(name, options.pagePath, path)
}

/** `[label](relative href)`: the label's brackets escaped. */
const markdownLink = (label: string, from: string, to: string): string => `[${label.replace(/[[\]]/g, '\\$&')}](${relativeHref(from, to)})`

/** A Markdown link's target as a page, folder or file of a vault of the window (D8, D14), or null: the web, another folder, a missing file. */
export function hrefTarget(href: string, options: PathPasteOptions): string | null {
  const target = hrefPath(href, options.pagePath)
  return target === null ? null : rowOf(target, (options.candidatesOf?.(target) ?? options.candidates).candidates)?.path ?? null
}

/** A Markdown link's target as an absolute path in a vault of this window, found or not (D19); null for the web or anywhere else. */
export function vaultHref(href: string, options: PathPasteOptions): string | null {
  const target = hrefPath(href, options.pagePath)
  return target !== null && (inVault(target, options) || options.candidatesOf?.(target) != null) ? target : null
}

/** A local `href` as an absolute path: decoded, `#` and `?` dropped, resolved from `pagePath`'s folder; null for the web. */
export function hrefPath(href: string, pagePath: string): string | null {
  if (/^[a-z][a-z\d+.-]+:/i.test(href) && !/^file:/i.test(href)) return null
  let path: string
  try {
    path = decodeURIComponent(href.replace(/^file:\/\/(localhost)?(\/(?=[A-Za-z]:))?/i, '').replace(/[?#].*$/, ''))
  } catch {
    return null
  }
  const absolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? path : `${pagePath.replace(/[\\/][^\\/]*$/, '')}/${path}`
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

/** `to` from the folder of `from`, each name URL-encoded: `../finance/budget%20v2.zip`. */
export function relativeHref(from: string, to: string): string {
  const source = from.split(/[\\/]/).slice(0, -1)
  const target = to.split(/[\\/]/)
  let same = 0
  // The shared folders are found as the rest of the paths are: case does not count (YAZ-3634).
  while (same < source.length && same < target.length - 1 && keyOf(source[same]!) === keyOf(target[same]!)) same += 1
  // Parentheses too: an unmatched one would end the Markdown link early.
  const encode = (name: string) => encodeURIComponent(name).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return [...source.slice(same).map(() => '..'), ...target.slice(same).map(encode)].join('/')
}
