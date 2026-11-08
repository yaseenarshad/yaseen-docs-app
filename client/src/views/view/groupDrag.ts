import { type DragEvent as ReactDragEvent, useEffect, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { type ViewDef, shownGroupLevels } from '../viewSchema'
import type { Group } from '../engine'
import type { Value } from '../expr'
import { canonicalKey } from './keys'
import { groupKeyOf, groupPathKeyOf } from './GroupHeader'
import { writableKey } from '../readOnlyRows'

/**
 * Drag between groups (5C, GRO-2143): shared by the board's columns and the grouped table's
 * sections. The views own the transient HTML5 drag state through `useGroupDrag`; ViewsPane owns
 * the optimistic moves (`PendingMove`, applied to the records BEFORE the engine runs, so the
 * card lands in its target group with sort/summaries/values all consistent) and commits them
 * through the host's writer (`FolderHost.writeValues`).
 */

/**
 * A drop between FANNED-OUT groups (YAZ-671 D3): the row belongs to several groups, so the drop
 * describes an edit rather than a value — drop the element it was dragged out of, add the one it
 * was dropped into, leave every other value on the page alone. Either side is null at the
 * "No value" group: dragging out of it adds only, dropping onto it removes only.
 */
export interface GroupSwap {
  remove: Value | null
  add: Value | null
}

/** One property write inside a pending move. */
export interface PendingWrite {
  /** Bare frontmatter key being written. */
  key: string
  /** The raw YAML value written; undefined = the key was deleted ("No value" drop). */
  value: unknown
  /** The note's raw value when the move was committed; the entry clears when the index moves off it. */
  prevRaw: unknown
}

/**
 * One committed-but-not-yet-indexed move, keyed by note path in ViewsPane's state. A drop into a
 * different branch (🔒 YAZ-745, every level since YAZ-4531) carries one write per level that
 * differs, innermost first: they apply, clear and — on any one failing — drop as a single unit, so
 * the row is never left half-moved.
 */
export type PendingMove = PendingWrite[]

/**
 * The bare frontmatter key `groupBy` names at `level`, or null when THAT level is not a note
 * property — what a drop there writes, and what its group "+" seeds. Null disables the level's
 * own drag and "+" (YAZ-1101) while the other level keeps working.
 */
export function groupByKey(view: ViewDef, level = 0): string | null {
  // `level` counts the engine's levels (`shownGroupLevels`, YAZ-4531), as a `GroupSpot` does.
  const property = shownGroupLevels(view)[level]?.property
  // A key the app owns (`readonly`, YAZ-3122) is grouped by, never written by a drop or seeded by a "+".
  return typeof property === 'string' ? writableKey(property) : null
}

/** Whether `groupBy` at `level` is the Folder: nothing to write or drag there, but its group "+" has a place — that folder. */
export const groupsByFolder = (view: ViewDef, level = 0): boolean => {
  const property = shownGroupLevels(view)[level]?.property
  return typeof property === 'string' && canonicalKey(property) === 'file.folder'
}

/** Whether a level's groups take a new note: one it can seed, or — grouped by Folder — place. */
export const groupTakesNew = (view: ViewDef, level: number): boolean => groupByKey(view, level) !== null || groupsByFolder(view, level)

/** `records` with the pending moves patched in, for the engine (same clearing discipline as 5B). */
export function applyMoves(records: readonly IndexRecord[], moves: Record<string, PendingMove>): IndexRecord[] {
  return records.map((r) => {
    const mv = moves[r.path]
    if (mv === undefined) return r
    const properties = { ...r.properties }
    for (const w of mv) {
      if (w.value === undefined) delete properties[w.key]
      else properties[w.key] = w.value
    }
    return { ...r, properties }
  })
}

/**
 * Where a group sits in a nested view (YAZ-1101): its `groupBy` level and the groups it hangs
 * under, outer first — one per level above it (YAZ-4531). Omitted = a top-level group, which
 * single-level views pass nothing for and behave exactly as before.
 */
export interface GroupSpot {
  level: number
  ancestors: readonly Group[]
}

/** A top-level group's spot. */
export const TOP_SPOT: GroupSpot = { level: 0, ancestors: [] }

/** The spot of a group's children, one level down. */
export const childSpot = (parent: Group, at: GroupSpot): GroupSpot => ({ level: at.level + 1, ancestors: [...at.ancestors, parent] })

/** A group's persisted collapse key and drop identity at its spot (`groupPathKeyOf`). */
export const spotKey = (group: Group, at: GroupSpot): string =>
  at.level === 0 ? groupKeyOf(group.key) : groupPathKeyOf([...at.ancestors.map((a) => a.key), group.key])

/**
 * The level-aware half of a drop (YAZ-1101): the level the row landed on — which property the move
 * writes — and, for each ancestor level whose value differs from the row's own branch, that
 * ancestor's write, nearest first, committed after the level's own so the row lands where it was
 * dropped (🔒 YAZ-745, YAZ-4531). An ancestor level that is unwritable writes nothing.
 */
export interface GroupDrop {
  level: number
  /** Each differing ancestor level's write: its whole `value`, or — a fanned-out level (YAZ-4636 T2) — the `swap` inside the row's list. */
  ancestors?: { key: string; value?: unknown; swap?: GroupSwap }[]
}

type DragState = { path: string; gk: string; key: Value | null; branch: readonly string[]; values: readonly (Value | null)[] }

export interface GroupDrag {
  /** The dragged card's path, its source group key, that group's VALUE (the element a swap removes) and, for each group on its branch, outer first, its `groupKeyOf` and its value. */
  drag: DragState | null
  /** Group key of the hovered drop target (never the source group), inner groups scoped by their ancestors. */
  over: string | null
  /**
   * Spread on each draggable card/row, with the group it is being dragged out of and where that group
   * sits. `locked` (a read-only note, YAZ-3076 D6 S53) makes it no drag source: a move writes a property.
   */
  source: (path: string, group: Group, at?: GroupSpot, locked?: boolean) => Record<string, unknown>
  /** Spread on each column/section drop target (a group's own rows included — events bubble). */
  target: (group: Group, at?: GroupSpot) => Record<string, unknown>
}

/**
 * The HTML5 drag wiring for one view. A drop onto ANOTHER group fires `onMove` one of two ways:
 * scalar grouping → `onMove(path, value)` with the target's raw YAML value read off that group's
 * first row (so the written type matches what its members already carry), or undefined for
 * "No value" (deletes the key); fanned-out grouping → `onMove(path, undefined, swap)` with a
 * `GroupSwap` naming the element to remove (the source group's value) and the one to add. Esc
 * cancels: real drags fire `dragend` on Esc, jsdom (and any missed dragend) goes through a
 * document keydown listener. `dataTransfer` is guarded — jsdom's synthetic drag events have none.
 *
 * `keys` is one write key PER `groupBy` level (YAZ-1101): a level whose key is null shows its
 * sections but takes no drops, while the other level keeps working, and every drop reports the
 * level it landed on so the caller writes THAT property.
 */
export function useGroupDrag(
  keys: readonly (string | null)[],
  onMove: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void,
): GroupDrag {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const clear = () => {
    setDrag(null)
    setOver(null)
  }

  useEffect(() => {
    if (drag === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drag])

  return {
    drag,
    over,
    // A row stays draggable while ANY level accepts drops; the target side rejects the rest.
    source: (path, group, at = TOP_SPOT, locked = false) =>
      locked || !keys.some((k) => k !== null)
        ? {}
        : {
            draggable: true,
            onDragStart: (e: ReactDragEvent) => {
              e.dataTransfer?.setData('text/plain', path)
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
              setDrag({ path, gk: spotKey(group, at), key: group.key, branch: [...at.ancestors, group].map((g) => groupKeyOf(g.key)), values: [...at.ancestors, group].map((g) => g.key) })
            },
            onDragEnd: clear,
          },
    target: (group, at = TOP_SPOT) => {
      const key = keys[at.level] ?? null
      if (key === null) return {}
      const gk = spotKey(group, at)
      return {
        onDragOver: (e: ReactDragEvent) => {
          if (drag === null || drag.gk === gk) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (over !== gk) setOver(gk)
        },
        onDragLeave: (e: ReactDragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          if (over === gk) setOver(null)
        },
        onDrop: (e: ReactDragEvent) => {
          e.preventDefault()
          const d = drag
          clear()
          if (d === null || d.gk === gk) return
          // 🔒 YAZ-745, YAZ-4531: a nested drop carries the write of each ancestor level whose value
          // differs from the row's own branch — read off that ancestor's first row, like the level's
          // own value — so the row LANDS where it was dropped. A level that matches writes nothing.
          const drop: GroupDrop = { level: at.level }
          for (let level = at.level - 1; level >= 0; level--) {
            const ancestor = at.ancestors[level]
            const ancestorKey = d.branch[level] === groupKeyOf(ancestor.key) ? null : keys[level] ?? null
            if (ancestorKey === null) continue
            // A fanned-out ancestor level (YAZ-4636 T2): the row is in several of its groups, so the level swaps the
            // element it left for the one it entered, as the row's own level does below; a neighbour's whole list
            // would drop the row's other elements and add the neighbour's.
            if (ancestor.fannedOut) {
              ;(drop.ancestors ??= []).push({ key: ancestorKey, swap: { remove: d.values[level], add: ancestor.key } })
              continue
            }
            const raw = ancestor.rows[0]?.record.properties[ancestorKey] ?? (ancestor.optionValue === undefined ? undefined : ancestor.optionValue)
            if (raw !== undefined) (drop.ancestors ??= []).push({ key: ancestorKey, value: raw })
          }
          // Fanned out (D3): the row is in several groups, so swap the element it left for the
          // one it entered rather than overwriting the whole value with a neighbour's list.
          if (group.fannedOut) return onMove(d.path, undefined, { remove: d.key, add: group.key }, drop)
          if (group.key === null) onMove(d.path, undefined, undefined, drop)
          else if (group.optionValue !== undefined) onMove(d.path, group.optionValue, undefined, drop)
          else if (group.rows.length > 0) onMove(d.path, group.rows[0].record.properties[key], undefined, drop)
        },
      }
    },
  }
}
