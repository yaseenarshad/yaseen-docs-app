/**
 * A VERSION BUMP THAT CHANGED NOTHING IS NOT A CHANGE (YAZ-3210). The snapshot's version was
 * `getSceneVersion`, the sum of every element's `version`, and the engine bumps `version` on writes
 * that move no content: leaving a text element's editor with no edit rewrites it through
 * `newElementWith`, which always bumps when an update carries an object (the fork's per-line
 * `lineBolds` / `lineUnderlines` / `lineStrikethroughs` arrays are fresh on every submit). The modal
 * then read dirty and the tab wrote the same bytes back.
 *
 * So each element counts the version at which its CONTENT last moved: everything but the engine's
 * own stamps (`version`, `versionNonce`, `updated`). Only an element whose version moved is
 * serialized and compared, so a drag costs the dragged elements, not the scene. The compare is
 * against what that element last looked like, not against the disk, so the sum keeps
 * `getSceneVersion`'s rule (Draw's YAZ-1775): it only ever grows with real edits, and an undo back
 * to the disk content is one redundant save, never a lost one.
 */

/** The engine's bookkeeping on every write; what is left is the element as the file holds it. */
interface Stamped {
  readonly id: string
  readonly version: number
  readonly versionNonce?: number
  readonly updated?: number
  readonly [field: string]: unknown
}

function contentKey({ version: _v, versionNonce: _n, updated: _u, ...content }: Stamped): string {
  return JSON.stringify(content)
}

/**
 * A counter fed the engine's elements (deleted ones included, as `onChange` hands them): returns the
 * sum, over elements, of the version at which each one's content last changed. The first time it
 * sees an element, that element's version is taken as is.
 */
export function contentVersion(): (elements: readonly Stamped[]) => number {
  const seen = new Map<string, { version: number; key: string; counted: number }>()
  return (elements) => {
    let sum = 0
    for (const element of elements) {
      const last = seen.get(element.id)
      if (last === undefined) {
        seen.set(element.id, { version: element.version, key: contentKey(element), counted: element.version })
      } else if (last.version !== element.version) {
        const key = contentKey(element)
        if (key !== last.key) last.counted = element.version
        last.version = element.version
        last.key = key
      }
      sum += seen.get(element.id)!.counted
    }
    return sum
  }
}
