/**
 * WHICH FILE AN ACTION GOES TO (YAZ-5514, W2). An action names its card by ID, and remembers the file the person acted
 * in (`WaitingAnswer.path`). Two files can hold one ID for a while: a page copied in Finder keeps its cards' IDs until
 * the Mac's sweep gives the copy new ones (`idSweep.ts`, YAZ-4960). So:
 *  - the file the person acted in, while it still holds the card;
 *  - else the ONE file that holds it now (the Mac moved the card, or renumbered the copy the person answered in: the
 *    sweep gives a same-text copy's reviews to the card that keeps the ID, so the answer joins them there);
 *  - else no file (the card is gone), or TWO or more (it cannot say which is meant): the action is refused, never
 *    guessed. Pure: the index's records in, no store.
 */
export type CardTarget = { path: string } | { gone: true } | { twoFiles: true }

/** What the target reads of an index record. */
type Holder = { path: string; cards?: readonly { id: string | null }[] }

/** Each card ID (in small letters) → the paths that hold it, in the index's order. */
export function cardHolders(records: Iterable<Holder>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of records)
    for (const card of r.cards ?? []) {
      if (card.id === null) continue
      const key = card.id.toLowerCase()
      const paths = out.get(key)
      if (paths === undefined) out.set(key, [r.path])
      else if (!paths.includes(r.path)) paths.push(r.path)
    }
  return out
}

/** The file that card `id`'s action, made in `path`, goes to. */
export function cardTarget(holders: ReadonlyMap<string, readonly string[]>, id: string, path: string): CardTarget {
  const paths = holders.get(id.toLowerCase()) ?? []
  if (paths.includes(path)) return { path }
  if (paths.length === 0) return { gone: true }
  if (paths.length > 1) return { twoFiles: true }
  return { path: paths[0] }
}
