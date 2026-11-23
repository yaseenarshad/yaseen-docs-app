import { BOARD_ID_KEY, BOARD_META_KEY, boardIdOf, FOLD_ARROWS_KEY, FORMER_IDS_KEY, formerBoardIdsOf, HOVER_LINKS_KEY, HOVER_OUTLINE_KEY, PICTURES_FOLDER_KEY, PICTURES_KEY, SWITCHED_KEY } from './drawingAssets'
import { canonicalPageId, pageIdNumber } from './pageId'
import { READ_ONLY_KEY } from './readOnly'
import { isFiniteNumber, isRecord } from './guards'

/**
 * THE SHAPE-BY-SHAPE BOARD MERGE (🔒 YAZ-1897 D1). When two machines both changed one `.excalidraw`
 * since they last agreed, sync hands this function the three versions git holds — the common
 * ancestor, the remote's, and ours — and gets back one board with everyone's work in it.
 *
 * Git's own line merge knows nothing about shapes (two people each ADDING a shape is a conflict to
 * it), so boards never reach it (D2); this is the only board merge there is. Per shape id:
 *  - changed on ONE side → that side, a delete included (a saved board keeps deleted shapes as
 *    `isDeleted: true` tombstones, and a shape missing from a side counts as deleted there);
 *  - changed on BOTH → an edit beats a delete (never lose work); otherwise the newest `updated`
 *    wins, then the higher `version`, then the lower `versionNonce` — Excalidraw's own tie rule — and
 *    a clash between two live edits is counted for the "kept the newest" notice;
 *  - a clashing shape keeps the union of both sides' `boundElements` (arrows and text bound to it),
 *    because load does not repair bindings and an arrow drawn on one machine would otherwise lose
 *    its anchor to the other machine's move;
 *  - a live shape whose PARENT — the box its text sits in (`containerId`), or its frame (`frameId`)
 *    — ended up deleted gets the parent back from the side that still had it: deleting a box deletes
 *    its text too, so "the edit beats the delete" has to keep the edited text's box with it (S9).
 *    A parent neither side kept is let go of instead (the reference is cleared).
 * The board's own settings (`appState`) and any other top-level key merge per key the same way,
 * ours winning a clash — except the `yaseendraw` dates block (🔒 YAZ-1834), which stays the file's
 * FIRST key with the earlier `createdAt` and the later `updatedAt` of the two, and whose switches
 * (Read only, pictures) each take the newest change (YAZ-3943 1E). Two board IDs (each Mac gave one before a sync): the
 * lower number, and the other in `formerIds` (YAZ-4071 7I).
 *
 * Pure and engine-free: it runs in the main process in the middle of a rebase. Answers null for
 * anything it must not merge — a side that is not a scene — and the caller keeps both copies.
 *
 * ⚡ YAZ-4279 D1, D4: the shapes' loop is `mergeElements`, which an OPEN board shares with another rule, 'per-property':
 * a shape both sides changed takes each property from the side that changed it, and one property changed on both sides,
 * a delete against an edit, or one id added on both sides is a clash only the user settles (the conflict bar). Both rules
 * ignore the engine's stamps: a version bump that moved nothing is no edit.
 */

interface BoardMerge {
  /** The merged board, written the way the app writes one: 2-space JSON and a trailing newline. */
  json: string
  /** Shapes BOTH sides edited (a delete is not an edit); the newest version of each was kept. */
  clashes: number
}

export type Element = Record<string, unknown> & { id: string }
type Scene = Record<string, unknown> & { elements: Element[] }

function parseScene(text: string): Scene | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || !Array.isArray(raw.elements)) return null
  if (!raw.elements.every((e) => isRecord(e) && typeof e.id === 'string')) return null
  return raw as Scene
}

/**
 * Structural equality for plain data, whatever the order of its keys: the app's writer keeps its order, but a shape the
 * engine restored and the same shape an AI wrote need not share one (YAZ-4279).
 */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a, inOrder) === JSON.stringify(b, inOrder)

/** A `JSON.stringify` replacer: each object's keys in one order. */
function inOrder(_key: string, value: unknown): unknown {
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(value).sort()) out[k] = value[k]
  return out
}

/**
 * The engine's own stamps (YAZ-4279 D1). A version bump that moved nothing is no edit: the engine bumps them on load, and an
 * AI that writes the JSON leaves them as they were. So no side is picked by them, except as `newer`'s tie-break. `seed` is
 * the hand-drawn wobble: the engine's restore gives a shape that has none a random one, so it differs between two restores
 * of one file and is never an edit (4A-6).
 */
const STAMPS: ReadonlySet<string> = new Set(['version', 'versionNonce', 'updated', 'seed'])
const unstamped = (e: Element | undefined): string | undefined => (e === undefined ? undefined : JSON.stringify(e, (key, value) => (STAMPS.has(key) ? undefined : inOrder(key, value))))
/** One shape's content on two sides is the same, the stamps aside. */
export const sameShape = (a: Element | undefined, b: Element | undefined): boolean => unstamped(a) === unstamped(b)

export const alive = (e: Element | undefined): e is Element => e !== undefined && e.isDeleted !== true

const num = (v: unknown): number => (isFiniteNumber(v) ? v : 0)

/** Which of two edits of one shape is the newer: `updated`, then `version`, then the LOWER `versionNonce`; ours on a full tie. */
function newer(theirs: Element, mine: Element): Element {
  const byUpdated = num(theirs.updated) - num(mine.updated)
  if (byUpdated !== 0) return byUpdated > 0 ? theirs : mine
  const byVersion = num(theirs.version) - num(mine.version)
  if (byVersion !== 0) return byVersion > 0 ? theirs : mine
  return num(theirs.versionNonce) < num(mine.versionNonce) ? theirs : mine
}

const byId = (elements: readonly Element[]): Map<string, Element> => new Map(elements.map((e) => [e.id, e]))

/** Every id in first-seen order across the sides — theirs first, so a board's order follows the remote when `index` cannot decide. */
function idsInOrder(...sides: readonly Element[][]): string[] {
  const ids = new Set<string>()
  for (const side of sides) for (const e of side) ids.add(e.id)
  return [...ids]
}

/** `{ id, type }[]` bindings from both versions of a shape, first occurrence of each id kept. */
function unionBindings(a: unknown, b: unknown): Record<string, unknown>[] {
  const out = new Map<string, Record<string, unknown>>()
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const binding of list) if (isRecord(binding) && typeof binding.id === 'string' && !out.has(binding.id)) out.set(binding.id, binding)
  }
  return [...out.values()]
}

/** Per-key 3-way merge of two plain objects against their ancestor; ours wins a key both changed. */
function mergeRecord(base: Record<string, unknown>, theirs: Record<string, unknown>, mine: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const pick = same(mine[key], base[key]) ? theirs[key] : mine[key]
    if (pick !== undefined) out[key] = pick
  }
  return out
}

const recordOf = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

/**
 * One shape both sides changed, for an open board (YAZ-4279 D4): each property from the side that changed it, the bindings of
 * both. Null when both changed one property to different values — only the user can settle that (the conflict bar).
 */
function mergeShape(was: Element, theirs: Element, mine: Element): Element | null {
  const out: Element = { ...mine }
  for (const key of new Set([...Object.keys(was), ...Object.keys(theirs), ...Object.keys(mine)])) {
    if (STAMPS.has(key) || same(theirs[key], was[key]) || same(theirs[key], mine[key])) continue
    if (same(mine[key], was[key])) {
      if (theirs[key] === undefined) delete out[key]
      else out[key] = theirs[key]
    } else if (key === 'boundElements') out[key] = unionBindings(theirs[key], mine[key])
    else return null
  }
  return out
}

/** Git sync keeps the newest of a shape both sides edited; an open board merges it per property or refuses (YAZ-4279 D4). */
export type ClashRule = 'newest' | 'per-property'

export interface ElementsMerge {
  elements: Element[]
  /** Shapes BOTH sides edited (a delete is not an edit) whose newest version was kept: always 0 for 'per-property'. */
  clashes: number
}

/** What only the user can settle (YAZ-4279 D4): the ids of the shapes that clash, for the conflict bar's red outline (item 8). */
export interface ElementsClash {
  conflicts: string[]
}

/**
 * The shapes alone, 3-way (YAZ-4279 D1): git sync and an open board share it. 'per-property' answers the clash for what only
 * the user can settle — one property changed on both sides, a delete against an edit, or one id added on both sides.
 */
export function mergeElements(base: readonly Element[], theirs: readonly Element[], mine: readonly Element[], rule: 'newest'): ElementsMerge
export function mergeElements(base: readonly Element[], theirs: readonly Element[], mine: readonly Element[], rule: ClashRule): ElementsMerge | ElementsClash
export function mergeElements(base: readonly Element[], theirs: readonly Element[], mine: readonly Element[], rule: ClashRule): ElementsMerge | ElementsClash {
  const b = byId(base)
  const t = byId(theirs)
  const m = byId(mine)
  const merged = new Map<string, Element>()
  /** Shapes taken from both sides at once: they keep both sides' bindings below. */
  const both = new Set<string>()
  const conflicts: string[] = []
  let clashes = 0

  for (const id of idsInOrder([...theirs], [...mine])) {
    const was = b.get(id)
    const tv = t.get(id)
    const mv = m.get(id)
    let pick: Element | undefined
    if (sameShape(tv, was)) pick = mv
    else if (sameShape(mv, was) || sameShape(tv, mv)) pick = tv
    else if (!alive(tv) && !alive(mv)) pick = tv === undefined || mv === undefined ? (tv ?? mv) : newer(tv, mv) // deleted on both
    else if (rule === 'per-property') {
      const shape = alive(tv) && alive(mv) && was !== undefined ? mergeShape(was, tv, mv) : null
      if (shape === null) {
        conflicts.push(id)
        continue
      }
      pick = shape
      both.add(id)
    } else if (alive(tv) !== alive(mv)) pick = alive(tv) ? tv : mv // an edit beats a delete
    else {
      pick = newer(tv as Element, mv as Element)
      both.add(id)
      clashes++
    }
    if (pick !== undefined) merged.set(id, pick)
  }

  if (conflicts.length > 0) return { conflicts }

  // A shape both sides edited keeps every binding either side gave it ('newest'), or the ones `mergeShape` chose
  // ('per-property'), as long as the bound element survived.
  for (const id of both) {
    const pick = merged.get(id) as Element
    const kept = rule === 'newest' ? unionBindings(t.get(id)?.boundElements, m.get(id)?.boundElements) : unionBindings(pick.boundElements, null)
    const bindings = kept.filter((x) => alive(merged.get(x.id as string)))
    merged.set(id, { ...pick, boundElements: bindings.length > 0 ? bindings : null })
  }

  // S9: an edited child keeps its parent. Repeats until settled — a revived box may sit in a deleted frame.
  for (let settled = false; !settled; ) {
    settled = true
    for (const e of [...merged.values()]) {
      if (!alive(e)) continue
      for (const key of ['containerId', 'frameId'] as const) {
        const parentId = e[key]
        if (typeof parentId !== 'string' || alive(merged.get(parentId))) continue
        const kept = [t.get(parentId), m.get(parentId)].find(alive)
        if (kept !== undefined) merged.set(parentId, kept)
        else merged.set(e.id, { ...(merged.get(e.id) as Element), [key]: null })
        settled = false
      }
    }
  }

  // Excalidraw orders a scene by fractional `index`; a board written before indices existed keeps the sequence above.
  let elements = [...merged.values()]
  if (elements.every((e) => typeof e.index === 'string')) {
    elements = elements.sort((x, y) => (x.index === y.index ? (x.id < y.id ? -1 : 1) : (x.index as string) < (y.index as string) ? -1 : 1))
  }
  return { elements, clashes }
}

export function mergeBoards(baseText: string, theirsText: string, mineText: string): BoardMerge | null {
  const base = parseScene(baseText)
  const theirs = parseScene(theirsText)
  const mine = parseScene(mineText)
  if (base === null || theirs === null || mine === null) return null
  const { elements, clashes } = mergeElements(base.elements, theirs.elements, mine.elements, 'newest')

  // The rest of the top level, per key — without the parts merged on their own (and without stringifying every shape again).
  const rest = ({ elements: _e, appState: _a, files: _f, [BOARD_META_KEY]: _m, ...other }: Scene): Record<string, unknown> => other
  const top = mergeRecord(rest(base), rest(theirs), rest(mine))
  const meta = mergeMeta(theirs[BOARD_META_KEY], mine[BOARD_META_KEY])
  const doc: Record<string, unknown> = { ...(meta === null ? {} : { [BOARD_META_KEY]: meta }), ...top, elements }
  if ('appState' in mine || 'appState' in theirs) doc.appState = mergeRecord(recordOf(base.appState), recordOf(theirs.appState), recordOf(mine.appState))
  if ('files' in mine || 'files' in theirs) doc.files = { ...recordOf(theirs.files), ...recordOf(mine.files) }
  return { json: `${JSON.stringify(doc, null, 2)}\n`, clashes }
}

/**
 * The switches of the block (YAZ-3943 1E): Read only, "pictures out", the link preview on hover (demo 2), the fold
 * arrows (YAZ-4277 D5) and the hover outline (YAZ-4469 demo). The default is no key. A board's own pictures folder
 * (`picturesFolder`, demo round 3) rides with "pictures out": one switch, one time.
 */
const SWITCHES = [READ_ONLY_KEY, PICTURES_KEY, HOVER_LINKS_KEY, FOLD_ARROWS_KEY, HOVER_OUTLINE_KEY]
const RIDES_WITH: Readonly<Record<string, readonly string[]>> = { [PICTURES_KEY]: [PICTURES_FOLDER_KEY] }

/** When the switch `key` of `block` last changed; a switch with no time is older than any change. */
const switchTime = (block: Record<string, unknown>, key: string): number => {
  const times = block[SWITCHED_KEY]
  return isRecord(times) && isFiniteNumber(times[key]) ? times[key] : -Infinity
}

/**
 * The dates block both machines stamped: the board was born at the earlier time and last changed at the later one.
 * Each switch takes the side that changed it last (YAZ-3943 1E), "off" (no key) included, with its time: so "pictures
 * out" on one Mac never loses to the other Mac's untouched "inside". Two switches with no time keep the old rule.
 */
function mergeMeta(theirs: unknown, mine: unknown): Record<string, unknown> | null {
  if (!isRecord(theirs) || !isRecord(mine)) return isRecord(mine) ? mine : isRecord(theirs) ? theirs : null
  const pick = (f: (a: number, b: number) => number, key: string) => (isFiniteNumber(theirs[key]) && isFiniteNumber(mine[key]) ? f(theirs[key], mine[key]) : (mine[key] ?? theirs[key]))
  const meta: Record<string, unknown> = { ...theirs, ...mine, createdAt: pick(Math.min, 'createdAt'), updatedAt: pick(Math.max, 'updatedAt') }
  const times: Record<string, unknown> = { ...recordOf(theirs[SWITCHED_KEY]), ...recordOf(mine[SWITCHED_KEY]) }
  for (const key of SWITCHES) {
    const [t, m] = [switchTime(theirs, key), switchTime(mine, key)]
    if (t === m) continue
    const newest = t > m ? theirs : mine
    for (const k of [key, ...(RIDES_WITH[key] ?? [])]) {
      if (k in newest) meta[k] = newest[k]
      else delete meta[k]
    }
    times[key] = Math.max(t, m)
  }
  if (Object.keys(times).length > 0) meta[SWITCHED_KEY] = times
  // YAZ-4071 7I: each Mac gave the board its own ID. One fixed rule, so both Macs keep the same one: the lower number. The
  // other goes to `formerIds`, with every ID either side held before, so a link to any of them still opens the board.
  const [t, m] = [boardIdOf(theirs), boardIdOf(mine)]
  const former = new Set([...formerBoardIdsOf(theirs), ...formerBoardIdsOf(mine)])
  if (t !== undefined && m !== undefined && canonicalPageId(t) !== canonicalPageId(m)) {
    const [keep, lose] = idOrder(t, m) <= 0 ? [t, m] : [m, t]
    meta[BOARD_ID_KEY] = keep
    former.add(lose)
  }
  former.delete(meta[BOARD_ID_KEY] as string)
  if (former.size > 0) meta[FORMER_IDS_KEY] = [...former].sort()
  else delete meta[FORMER_IDS_KEY]
  return meta
}

/** The order of two board IDs: the lower number first; IDs with no number (another tool's), or one number, by their text. */
function idOrder(a: string, b: string): number {
  const [x, y] = [pageIdNumber(a) ?? Infinity, pageIdNumber(b) ?? Infinity]
  return x !== y ? x - y : a < b ? -1 : a > b ? 1 : 0
}
