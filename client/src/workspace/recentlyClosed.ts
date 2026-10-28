/**
 * Pure (YAZ-3487 D8, D10): the rows of "Recently closed", the newest first, off the closed notes of
 * each vault of the window — less the notes a tab shows now, in this window or another: a note
 * opened again, or a tab moved to another window, is no closed note. `last` is when it closed.
 */
export function recentlyClosed(records: readonly { closed: Readonly<Record<string, number>> }[], openNow: ReadonlySet<string>): { path: string; last: number }[] {
  return records
    .flatMap(({ closed }) => Object.entries(closed).map(([path, last]) => ({ path, last })))
    .filter(({ path }) => !openNow.has(path))
    .sort((a, b) => b.last - a.last)
}
