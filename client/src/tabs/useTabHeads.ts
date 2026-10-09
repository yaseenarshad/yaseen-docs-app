import { useEffect, useReducer, useRef } from 'react'
import { isMarkdown } from '@shared/fileKind'
import type { FileHead } from '@shared/types'
import { api } from '../api'

/** How many lines of a note are kept at most: a page's own clamp shows fewer, the peek more. */
const CARD_LINES = 24

/**
 * A note's first lines, by its path, with the mtime they were read at (YAZ-2648 D6). For the
 * session only, and never bigger than the tab strip: every answer drops the paths that are no
 * longer open. A note that could not be read is held too, with no lines, so it is not asked again
 * while its card stands.
 */
const cache = new Map<string, { mtime: number; lines: string }>()
/** The paths a call is out for, so a tab that joins while one runs is not asked twice. */
const pending = new Set<string>()
/** The overviews on screen — one, in practice: each renders again when an answer lands. */
const watchers = new Set<() => void>()

/**
 * The head of a note as a card shows it: plain text, a few lines. Markdown's marks come off — a
 * heading's `#`, a bullet, a task box, a quote mark, emphasis — a link shows its text, a wiki link
 * its alias or its target, and a line that holds only marks (a rule, a code fence) goes.
 */
export function plainLines(text: string): string {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s?)*/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/(\*\*|__|~~|==|`)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (line === '' || /^[-*_=`~|:\s]+$/.test(line)) continue
    lines.push(line)
    if (lines.length === CARD_LINES) break
  }
  return lines.join('\n')
}

/**
 * The feature hook of the tab overview's cards (YAZ-2648 D6): the first lines of every open tab
 * that is a note. ONE bridge call for all of them when the overview opens — the lines held from
 * the last time show at once, and a note whose mtime moved gets new ones when the call answers. A
 * tab that joins while the overview stands asks for itself alone. A folder, a PDF, an image and
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
    // A call that failed whole leaves the cards on their titles: nothing here is worth a notice.
    api.readHeads(paths).then(done, () => done([]))
    // `wanted` is `fresh` by value: the effect runs again only when a path joins it.
  }, [wanted])

  return (path) => cache.get(path)?.lines ?? ''
}

/** For the tests: the cache is a module's, and outlives a mount. */
export function _resetTabHeads(): void {
  cache.clear()
  pending.clear()
}
