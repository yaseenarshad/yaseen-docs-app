/**
 * The window's CARD FILES (YAZ-5037): the paths of the index records with `kind: 'card'`, across the window's vaults.
 * The card icon reads it (`FileIcon`, the tree): from the index, never from a file's name, one Set lookup per row.
 *
 * One Set for the window, the same object while it holds the same paths: a save that changed no card file draws no
 * icon again, and a vault whose records did not change is not walked again (`ofRecords`).
 */
import { useEffect, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'

export const NO_CARD_FILES: ReadonlySet<string> = new Set()

const walked = new WeakMap<readonly IndexRecord[], readonly string[]>()

/** One snapshot's card files, walked once per snapshot. */
function ofRecords(records: readonly IndexRecord[]): readonly string[] {
  let paths = walked.get(records)
  if (paths === undefined) {
    paths = []
    for (const r of records) if (r.kind === 'card') (paths as string[]).push(r.path)
    walked.set(records, paths)
  }
  return paths
}

/** The card files of `sources`' snapshots; `prev` itself when it holds the same paths. */
export function cardFilePaths(sources: readonly Pick<WikilinkResolveSource, 'records'>[], prev: ReadonlySet<string> = NO_CARD_FILES): ReadonlySet<string> {
  const lists = sources.map((s) => ofRecords(s.records))
  const size = lists.reduce((n, list) => n + list.length, 0)
  if (size === prev.size && lists.every((list) => list.every((p) => prev.has(p)))) return prev
  return size === 0 ? NO_CARD_FILES : new Set(lists.flat())
}

/** `cardFilePaths`, live with each source: `sources` is one list while its vaults stay (`useSameList`). */
export function useCardFiles(sources: readonly WikilinkResolveSource[]): ReadonlySet<string> {
  const [cards, setCards] = useState(() => cardFilePaths(sources))
  useEffect(() => {
    const read = () => setCards((prev) => cardFilePaths(sources, prev))
    read()
    const offs = sources.map((s) => s.subscribe(read))
    return () => offs.forEach((off) => off())
  }, [sources])
  return cards
}
