/**
 * THE PAGE FOLDS KEPT ON THIS PHONE (YAZ-5568, Yaseen's pick 2): which headings and bullets of a page are folded, by
 * vault and page path, in `localStorage`. Phone-only, as the Mac keeps its own folds only on the Mac (its app state,
 * `folders[root].folds[path]`): never written into the page's file, never synced. The keys are the Mac's fold keys
 * (`<hash>:<n>` for a bullet, `h:<hash>:<n>` for a heading, `outlineFoldKeys.ts`), so a line whose words change
 * drops its fold, as on the Mac. Every read and write is in try/catch: Private Browsing or a full phone keeps the
 * folds only while the page is open.
 */
export const FOLDS_KEY = 'notecard.folds'

export type FoldStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const local = (): FoldStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const keyOf = (vault: string, path: string) => `${FOLDS_KEY}\n${vault}\n${path}`

/** The folded keys of this page on this phone (none: an empty list). */
export function readFolds(vault: string, path: string, storage: FoldStorage | null = local()): string[] {
  try {
    const raw = storage?.getItem(keyOf(vault, path))
    const list: unknown = raw == null ? [] : JSON.parse(raw)
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Keeps the folded keys of this page; none: the page's entry goes. */
export function writeFolds(vault: string, path: string, keys: readonly string[], storage: FoldStorage | null = local()): void {
  try {
    if (keys.length === 0) storage?.removeItem(keyOf(vault, path))
    else storage?.setItem(keyOf(vault, path), JSON.stringify([...keys].sort()))
  } catch {
    // No storage here: the folds last while the page is open.
  }
}

/** A page renamed on the Mac (R6) keeps its folds under its new path. */
export function moveFolds(vault: string, from: string, to: string, storage: FoldStorage | null = local()): void {
  const keys = readFolds(vault, from, storage)
  if (keys.length === 0) return
  writeFolds(vault, to, keys, storage)
  writeFolds(vault, from, [], storage)
}
