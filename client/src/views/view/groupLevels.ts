import { type GroupBySpec, type ViewDef, groupByLevels, MAX_GROUP_LEVELS } from '../viewSchema'
import { canonicalKey } from './keys'

/** Folder may group twice, the second level being the next folder down (YAZ-2541), as in the Sort menu. */
const FOLDER = 'file.folder'

/** A `groupBy` entry that names a column (YAZ-4544): the engine's own test (`shownGroupLevels`). */
const isLevel = (level: GroupBySpec | undefined): level is GroupBySpec => typeof level?.property === 'string'

/** The view's group levels, outer first: the entries that name a column (YAZ-4544). */
export const groupLevels = (v: ViewDef): GroupBySpec[] => groupByLevels(v).filter(isLevel)

/**
 * Write `levels`, then the entries with no column as they were (YAZ-4544), as the Sort menu's `writeGroup` does:
 * one level keeps the single-object form, none deletes `groupBy`. Callers pass whole levels, so each keeps
 * its `by`, `highlight` and `large` (YAZ-4588 D42).
 */
function setLevels(v: ViewDef, levels: GroupBySpec[]): void {
  const unusable = groupByLevels(v).filter((l) => !isLevel(l))
  const written = [...levels, ...unusable]
  if (written.length === 0) delete v.groupBy
  else v.groupBy = written.length === 1 && unusable.length === 0 ? levels[0] : written
}

/**
 * "Group by this column" (YAZ-4588 D42): this column alone. Its own level, when it is one, keeps its fields;
 * else it takes the first level's look (highlight, Large), as the header's first-level rule did (YAZ-4534).
 */
export function groupOnly(v: ViewDef, key: string): void {
  const c = canonicalKey(key)
  const levels = groupLevels(v)
  const own = levels.find((l) => canonicalKey(l.property) === c)
  const { highlight, large } = levels[0] ?? {}
  const fresh: GroupBySpec = { property: c, direction: 'ASC' }
  if (highlight !== undefined) fresh.highlight = highlight
  if (large !== undefined) fresh.large = large
  setLevels(v, [own === undefined ? fresh : { ...own, property: c }])
}

/** "Add as next group level" (YAZ-4588 D42): appends this column; nothing at `MAX_GROUP_LEVELS` (five), or on a repeat other than Folder. */
export function groupAppend(v: ViewDef, key: string): void {
  const c = canonicalKey(key)
  const levels = groupLevels(v)
  if (levels.length >= MAX_GROUP_LEVELS || (c !== FOLDER && levels.some((l) => canonicalKey(l.property) === c))) return
  setLevels(v, [...levels, { property: c, direction: 'ASC' }])
}

/** "Remove this group level" (YAZ-4588 D42): level `index` goes, and the levels below move up. */
export function groupRemoveLevel(v: ViewDef, index: number): void {
  setLevels(v, groupLevels(v).filter((_, i) => i !== index))
}

/** "Move up a level" / "Move down a level" (YAZ-3746 13V): level `index` swaps with its neighbour `by` (−1 outer, +1 inner); each keeps its fields. */
export function groupMoveLevel(v: ViewDef, index: number, by: -1 | 1): void {
  const levels = groupLevels(v)
  const to = index + by
  if (index < 0 || to < 0 || to >= levels.length) return
  ;[levels[index], levels[to]] = [levels[to], levels[index]]
  setLevels(v, levels)
}
