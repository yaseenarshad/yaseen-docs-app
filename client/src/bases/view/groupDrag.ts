import { type DragEvent as ReactDragEvent, useEffect, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { BaseView } from '../baseFile'
import type { Group } from '../engine'
import type { Value } from '../expr'
import { canonicalKey } from './filterRows'
import { groupKeyOf } from './GroupHeader'

/**
 * Drag between groups (5C, GRO-2143): shared by the board's columns and the grouped table's
 * sections. The views own the transient HTML5 drag state through `useGroupDrag`; BaseView owns
 * the optimistic moves (`PendingMove`, applied to the records BEFORE the engine runs, so the
 * card lands in its target group with sort/summaries/values all consistent) and commits them
 * through 5A's `writeProperty`.
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

/** One committed-but-not-yet-indexed move, keyed by note path in BaseView's state. */
export interface PendingMove {
  /** Bare frontmatter key being written. */
  key: string
  /** The raw YAML value written; undefined = the key was deleted ("No value" drop). */
  value: unknown
  /** The note's raw value when the move was committed; the entry clears when the index moves off it. */
  prevRaw: unknown
}

/**
 * The bare frontmatter key `groupBy` names, or null when the grouping is not a note property —
 * what a drop writes, and what the group "+" seeds. Null disables drag in both views.
 */
export function groupByKey(view: BaseView): string | null {
  const property = view.groupBy?.property
  if (typeof property !== 'string') return null
  const c = canonicalKey(property)
  return c.startsWith('note.') ? c.slice(5) : null
}

/** `records` with the pending moves patched in, for the engine (same clearing discipline as 5B). */
export function applyMoves(records: readonly IndexRecord[], moves: Record<string, PendingMove>): IndexRecord[] {
  return records.map((r) => {
    const mv = moves[r.path]
    if (mv === undefined) return r
    const properties = { ...r.properties }
    if (mv.value === undefined) delete properties[mv.key]
    else properties[mv.key] = mv.value
    return { ...r, properties }
  })
}

export interface GroupDrag {
  /** The dragged card's path, its source group key, and that group's VALUE (the element a swap removes). */
  drag: { path: string; gk: string; key: Value | null } | null
  /** `groupKeyOf` of the hovered drop target (never the source group). */
  over: string | null
  /** Spread on each draggable card/row, with the group it is being dragged out of. */
  source: (path: string, group: Group) => Record<string, unknown>
  /** Spread on each column/section drop target (a group's own rows included — events bubble). */
  target: (group: Group) => Record<string, unknown>
}

/**
 * The HTML5 drag wiring for one view. A drop onto ANOTHER group fires `onMove` one of two ways:
 * scalar grouping → `onMove(path, value)` with the target's raw YAML value read off that group's
 * first row (so the written type matches what its members already carry), or undefined for
 * "No value" (deletes the key); fanned-out grouping → `onMove(path, undefined, swap)` with a
 * `GroupSwap` naming the element to remove (the source group's value) and the one to add. Esc
 * cancels: real drags fire `dragend` on Esc, jsdom (and any missed dragend) goes through a
 * document keydown listener. `dataTransfer` is guarded — jsdom's synthetic drag events have none.
 */
export function useGroupDrag(
  key: string | null,
  onMove: (path: string, value: unknown, swap?: GroupSwap) => void,
): GroupDrag {
  const [drag, setDrag] = useState<{ path: string; gk: string; key: Value | null } | null>(null)
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
    source: (path, group) =>
      key === null
        ? {}
        : {
            draggable: true,
            onDragStart: (e: ReactDragEvent) => {
              e.dataTransfer?.setData('text/plain', path)
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
              setDrag({ path, gk: groupKeyOf(group.key), key: group.key })
            },
            onDragEnd: clear,
          },
    target: (group) => {
      if (key === null) return {}
      const gk = groupKeyOf(group.key)
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
          // Fanned out (D3): the row is in several groups, so swap the element it left for the
          // one it entered rather than overwriting the whole value with a neighbour's list.
          if (group.fannedOut) return onMove(d.path, undefined, { remove: d.key, add: group.key })
          if (group.key === null) onMove(d.path, undefined)
          else if (group.rows.length > 0) onMove(d.path, group.rows[0].record.properties[key])
        },
      }
    },
  }
}
