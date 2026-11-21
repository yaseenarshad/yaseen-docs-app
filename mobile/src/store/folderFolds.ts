import type { Group } from '@client/views/engine'
import { render, type Value } from '@client/views/expr'

/**
 * YAZ-5598: a folder table's folded groups on the phone, as the Mac's ⌄ on a group row and its toolbar's collapse / expand
 * all. The Mac keeps its folded groups in its own store (`storage.getViewGroups`, keyed `<folder>::<view>`, GRO-2137), not
 * in the folder page file (`.folder.md`) nor the vault's `folder-pages.json`: nothing of them reaches the phone. So the phone
 * keeps its own, in this browser's `localStorage`, per vault + folder + view, and never writes the vault. Every read and
 * write is in try/catch: Private Browsing or a full phone keeps the folds until the page loads again.
 *
 * A group's key is the Mac's (`GroupHeader.tsx` `groupKeyOf` / `groupPathKeyOf`, `groupDrag.ts` `spotKey`), written out so
 * the phone's chunk does not load the Mac's table: a top group's `v:<value>` (`∅` for none), an inner group's its parents'
 * then its own, joined by U+001F, so the same value under two parents folds on its own.
 */
export const FOLDS_KEY = 'notecard.folderFolds'
/** The Mac's cap (`MAX_COLLAPSED_GROUP_KEYS`): a view with more groups offers no collapse all. */
export const MAX_FOLD_KEYS = 200

export type FoldStorage = Pick<Storage, 'getItem' | 'setItem'>

const local = (): FoldStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The Mac's `groupKeyOf`. */
export const groupKeyOf = (key: Value | null): string => (key === null ? '∅' : `v:${render(key)}`)

/** A group's key under its parents (outer first): the Mac's `spotKey`. */
export const foldKeyOf = (group: Group, parents: readonly Group[]): string =>
  parents.length === 0 ? groupKeyOf(group.key) : [...parents.map((p) => p.key), group.key].map(groupKeyOf).join('\u001f')

/** Every group's key of the view, each before its children (the Mac's `keysOf`). */
export function allFoldKeys(groups: readonly Group[] | null, parents: readonly Group[] = []): string[] {
  return (groups ?? []).flatMap((g) => [foldKeyOf(g, parents), ...allFoldKeys(g.children ?? null, [...parents, g])])
}

/** Where a view's folds live: the vault, the folder, the view's name. */
export const foldSpot = (vault: string, folder: string, view: string): string => JSON.stringify([vault, folder, view])

const readAll = (storage: FoldStorage | null): Record<string, string[]> => {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(FOLDS_KEY) ?? '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

/** The view's folded group keys; none when this browser holds none. */
export function readFolds(spot: string, storage: FoldStorage | null = local()): string[] {
  const list = readAll(storage)[spot]
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
}

/** Keeps the view's folded group keys (none: the entry goes). */
export function writeFolds(spot: string, keys: readonly string[], storage: FoldStorage | null = local()): void {
  try {
    const all = readAll(storage)
    if (keys.length === 0) delete all[spot]
    else all[spot] = keys.slice(0, MAX_FOLD_KEYS)
    storage?.setItem(FOLDS_KEY, JSON.stringify(all))
  } catch {
    // No storage here: the folds hold until the page loads again.
  }
}
