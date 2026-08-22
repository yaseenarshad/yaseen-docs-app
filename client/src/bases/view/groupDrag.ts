import { type DragEvent as ReactDragEvent, useEffect, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { BaseView } from '../baseFile'
import type { Group } from '../engine'
import { canonicalKey } from './filterRows'
import { groupKeyOf } from './GroupHeader'

/**
 * Drag between groups (5C, GRO-2143): shared by the board's columns and the grouped table's
 * sections. The views own the transient HTML5 drag state through `useGroupDrag`; BaseView owns
 * the optimistic moves (`PendingMove`, applied to the records BEFORE the engine runs, so the
 * card lands in its target group with sort/summaries/values all consistent) and commits them
 * through 5A's `writeProperty`.
 */

/** One committed-but-not-yet-indexed move, keyed by note path in BaseView's state. */
export interface PendingMove {
  /** Bare frontmatter key being written. */
  key: string
  /** The raw YAML value written; undefined = the key was deleted ("No value" drop). */
  value: unknown
  /** The note's raw value when the move was committed; the entry clears when the index moves off it. */
  prevRaw: unknown
}

/** The bare frontmatter key a drop writes; null (drag disabled) unless the grouping is a note property. */
export function dragKey(view: BaseView): string | null {
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
  /** The dragged card's path + source group key; null when no drag is in flight. */
  drag: { path: string; gk: string } | null
  /** `groupKeyOf` of the hovered drop target (never the source group). */
  over: string | null
  /** Spread on each draggable card/row. */
  source: (path: string, gk: string) => Record<string, unknown>
  /** Spread on each column/section drop target (a group's own rows included — events bubble). */
  target: (group: Group) => Record<string, unknown>
}

/**
 * The HTML5 drag wiring for one view. `onMove(path, value)` fires on a drop onto ANOTHER
 * group with the target's raw YAML value — read off the target group's first row so the
 * written type matches what that group's members already carry — or undefined for "No value"
 * (deletes the key). Esc cancels: real drags fire `dragend` on Esc, jsdom (and any missed
 * dragend) goes through a document keydown listener. `dataTransfer` is guarded — jsdom's
 * synthetic drag events have none.
 */
export function useGroupDrag(key: string | null, onMove: (path: string, value: unknown) => void): GroupDrag {
  const [drag, setDrag] = useState<{ path: string; gk: string } | null>(null)
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
    source: (path, gk) =>
      key === null
        ? {}
        : {
            draggable: true,
            onDragStart: (e: ReactDragEvent) => {
              e.dataTransfer?.setData('text/plain', path)
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
              setDrag({ path, gk })
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
          if (group.key === null) onMove(d.path, undefined)
          else if (group.rows.length > 0) onMove(d.path, group.rows[0].record.properties[key])
        },
      }
    },
  }
}
