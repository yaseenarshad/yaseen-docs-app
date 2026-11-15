/**
 * THE DOCKED COURSE AND THE TOUR LAYER (YAZ-5365): what each tells the other, in the course's chunk.
 *
 * - The course says where it sits while it is docked (`setCourseArea`; null in full size or closed). The tour layer
 *   leaves that box out of its dim (the course stays usable) and puts its coach card beside it, never under it.
 * - The tour layer says where the control it lights is (`setLitBox`; null with none). A docked corner moves away from
 *   it (`cornerAvoiding`), so the light never sits under the course.
 */
import type { Box } from './tourEngine'

let area: Box | null = null
let lit: Box | null = null
const litListeners = new Set<(box: Box | null) => void>()

const same = (a: Box | null, b: Box | null): boolean =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

export function setCourseArea(box: Box | null): void {
  area = box
}
export const courseArea = (): Box | null => area

export function setLitBox(box: Box | null): void {
  if (same(lit, box)) return
  lit = box
  litListeners.forEach((fn) => fn(box))
}
export const litBox = (): Box | null => lit
export function onLitBox(fn: (box: Box | null) => void): () => void {
  litListeners.add(fn)
  return () => litListeners.delete(fn)
}
