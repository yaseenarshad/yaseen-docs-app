import type { IndexRecord } from '@shared/types'
import { canonicalKey } from './view/filterRows'

/**
 * Editor type inference for inline cell editors (5B, GRO-2142). Locked precedence: an explicit
 * `.obsidian/types.json` assignment wins over any inference from values; otherwise the note's
 * own YAML value decides; a note without the key borrows the dominant value type across the
 * view's records; text is the final fallback. `file.*` and `formula.*` never get an editor.
 * The per-column halves (assignment + dominance) are computed once per render via
 * `columnTyping`; `cellEditor` adds the per-note value on top.
 */

export type EditorKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'link'

/** Per-column typing facts; null = the column is read-only (`file.*` / `formula.*`). */
export type ColumnTyping = { assigned: EditorKind | null; dominant: EditorKind | null } | null

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/
const WIKILINK = /^\[\[[^[\]]+\]\]$/

/** The editor a raw YAML value asks for; null when the note has no value for the key. */
export function valueKind(raw: unknown): EditorKind | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'boolean') return 'checkbox'
  if (typeof raw === 'number') return 'number'
  if (Array.isArray(raw)) return 'list'
  if (typeof raw === 'string') return ISO_DATE.test(raw) ? 'date' : WIKILINK.test(raw) ? 'link' : 'text'
  return 'text'
}

/** Obsidian's assigned type names → our editors; unknown names do not assign. */
const ASSIGNED: Record<string, EditorKind> = {
  text: 'text',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  datetime: 'date',
  multitext: 'list',
  tags: 'list',
  aliases: 'list',
}

/** Most common value kind for `bare` across `records`; ties go to the first kind seen. */
function dominantKind(records: readonly IndexRecord[], bare: string): EditorKind | null {
  const counts = new Map<EditorKind, number>()
  for (const r of records) {
    const k = valueKind(r.properties[bare])
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: EditorKind | null = null
  let n = 0
  for (const [k, c] of counts) {
    if (c > n) {
      best = k
      n = c
    }
  }
  return best
}

/** The column-wide typing facts for `key` over the view's records + assigned types. */
export function columnTyping(
  key: string,
  records: readonly IndexRecord[],
  types: Record<string, string> | undefined,
): ColumnTyping {
  const c = canonicalKey(key)
  if (!c.startsWith('note.')) return null
  const bare = c.slice(5)
  const name = types?.[bare]
  return { assigned: (name !== undefined ? ASSIGNED[name] : undefined) ?? null, dominant: dominantKind(records, bare) }
}

/** The editor for one cell; null = read-only. */
export function cellEditor(raw: unknown, column: ColumnTyping): EditorKind | null {
  if (column === null) return null
  return column.assigned ?? valueKind(raw) ?? column.dominant ?? 'text'
}
