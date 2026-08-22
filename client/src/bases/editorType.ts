import type { IndexRecord, RegistryPropertyKind, RegistryResponse } from '@shared/types'
import { canonicalKey } from './view/filterRows'

/**
 * Editor type inference for inline cell editors (5B, GRO-2142). Locked precedence, as amended
 * by the 5E relation contract (GRO-2120 comment 1f28abb4 §5): a registry declaration on the
 * view's pinned type wins, then a vault-wide registry declaration, then an explicit
 * `.obsidian/types.json` assignment (an imported artifact ranks below the vault's own schema);
 * otherwise the note's own YAML value decides; a note without the key borrows the dominant
 * value type across the view's records; text is the final fallback. `file.*` and `formula.*`
 * never get an editor. The per-column halves are computed once per render via `columnTyping`;
 * `cellEditor` adds the per-note value on top.
 */

export type EditorKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'link' | 'multi-link'

/** Per-column typing facts; null = the column is read-only (`file.*` / `formula.*`). `target` rides along from a registry link/multi-link declaration to constrain the picker. */
export type ColumnTyping = { assigned: EditorKind | null; dominant: EditorKind | null; target?: string } | null

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

/** `RegistryPropertyKind` → editor, 1:1 (contract §5; `multi-link` is the chips editor with link suggestions). */
const REGISTRY_KIND: Record<RegistryPropertyKind, EditorKind> = {
  text: 'text',
  number: 'number',
  date: 'date',
  checkbox: 'checkbox',
  list: 'list',
  link: 'link',
  'multi-link': 'multi-link',
}

/**
 * The column-wide typing facts for `key` over the view's records, the registry (5E) and the
 * assigned `.obsidian/types.json` types. `pinned` is the view's pinned type (`pinnedType`);
 * only then do type-scoped registry declarations apply.
 */
export function columnTyping(
  key: string,
  records: readonly IndexRecord[],
  types: Record<string, string> | undefined,
  registry?: RegistryResponse | null,
  pinned?: string | null,
): ColumnTyping {
  const c = canonicalKey(key)
  if (!c.startsWith('note.')) return null
  const bare = c.slice(5)
  const dominant = dominantKind(records, bare)
  const declared = (pinned != null ? registry?.types[pinned]?.properties[bare] : undefined) ?? registry?.properties[bare]
  if (declared !== undefined) return { assigned: REGISTRY_KIND[declared.kind], dominant, target: declared.target }
  const name = types?.[bare]
  return { assigned: (name !== undefined ? ASSIGNED[name] : undefined) ?? null, dominant }
}

/** The editor for one cell; null = read-only. */
export function cellEditor(raw: unknown, column: ColumnTyping): EditorKind | null {
  if (column === null) return null
  return column.assigned ?? valueKind(raw) ?? column.dominant ?? 'text'
}
