import { useEffect, useReducer, useRef } from 'react'
import { isMarkdown } from '@shared/fileKind'
import type { FileHead } from '@shared/types'
import { api } from '../api'

/** How many lines of a note are kept at most: a page's own clamp shows fewer, the peek more. */
const PAGE_LINES = 24

/**
 * A note's first lines, by its path, with the mtime they were read at (YAZ-2648 D6). For the
 * session only, and never bigger than the tab strip: every answer drops the paths that are no
 * longer open. A note that could not be read is held too, with no lines, so it is not asked again
 * while its page stands.
 */
const cache = new Map<string, { mtime: number; lines: string }>()
/** The paths a call is out for, so a tab that joins while one runs is not asked twice. */
const pending = new Set<string>()
/** The boards on screen — one, in practice: each renders again when an answer lands. */
const watchers = new Set<() => void>()

/** Emphasis of ONE mark around a word or a phrase: `*so*`, `_so_`. A `*` or `_` with a space inside it, or inside a word, is no mark. */
const ONE_MARK = /(^|[\s(])([*_])(?=\S)([^*_]*[^\s*_])\2(?=$|[\s).,;:!?])/g

/**
 * The head of a note as a page shows it: plain text, a few lines. Markdown's marks come off — a
 * heading's `#`, a bullet, a task box, a quote mark, emphasis, the pipes at the ends of a table
 * row — a link shows its text, a wiki link its alias or its target, an HTML tag goes, and a line
 * that is only marks goes whole: a rule, a table's rule, a code fence with or without a language.
 * Text is never taken for a mark: a `<` and a `>` that hold no tag stay.
 */
export function plainLines(text: string): string {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(raw)) continue
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s?)*/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      .replace(/(\*\*|__|~~|==|`)/g, '')
      .replace(ONE_MARK, '$1$3')
      .replace(/^\s*\|(.*)\|\s*$/, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    if (line === '' || /^[-*_=`~|:\s]+$/.test(line)) continue
    lines.push(line)
    if (lines.length === PAGE_LINES) break
  }
  return lines.join('\n')
}

/**
 * The feature hook of the tab board's pages (YAZ-2648 D6): the first lines of every open tab
 * that is a note. ONE bridge call for all of them when the board opens — the lines held from
 * the last time show at once, and a note whose mtime moved gets new ones when the call answers. A
 * tab that joins while the board stands asks for itself alone. A folder, a PDF, an image and
 * view-only text have no lines and are never asked for.
 */
export function useTabHeads(tabs: readonly string[]): (path: string) => string {
  const [, landed] = useReducer((n: number) => n + 1, 0)
  const live = useRef({ tabs, opened: false })
  live.current.tabs = tabs
  const notes = tabs.filter(isMarkdown)
  const fresh = notes.filter((path) => !cache.has(path) && !pending.has(path))
  const wanted = fresh.join('\n')

  useEffect(() => {
    watchers.add(landed)
    return () => void watchers.delete(landed)
  }, [])

  useEffect(() => {
    // The open asks for every note, so a change made since the last time shows; after it, only a tab that joined.
    const paths = (live.current.opened ? fresh : notes).filter((path) => !pending.has(path))
    live.current.opened = true
    if (paths.length === 0) return
    for (const path of paths) pending.add(path)
    const done = (heads: readonly (FileHead | null)[]): void => {
      paths.forEach((path, i) => {
        pending.delete(path)
        const head = heads[i] ?? null
        if (head === null) cache.set(path, { mtime: -1, lines: '' })
        else if (cache.get(path)?.mtime !== head.mtime) cache.set(path, { mtime: head.mtime, lines: plainLines(head.text) })
      })
      const open = new Set(live.current.tabs)
      for (const path of cache.keys()) if (!open.has(path)) cache.delete(path)
      watchers.forEach((poke) => poke())
    }
    // A call that failed whole takes nothing away: a page keeps the lines the session holds for
    // it, and one it holds nothing for is on its title until the next open asks again. Nothing here is worth a notice.
    const failed = (): void => {
      for (const path of paths) {
        pending.delete(path)
        if (!cache.has(path)) cache.set(path, { mtime: -1, lines: '' })
      }
      watchers.forEach((poke) => poke())
    }
    api.readHeads(paths).then(done, failed)
    // `wanted` is `fresh` by value: the effect runs again only when a path joins it.
  }, [wanted])

  return (path) => cache.get(path)?.lines ?? ''
}

/** For the tests: the cache is a module's, and outlives a mount. */
export function _resetTabHeads(): void {
  cache.clear()
  pending.clear()
}
