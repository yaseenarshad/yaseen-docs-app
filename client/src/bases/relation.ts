import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView } from './baseFile'
import { andLeaves } from './newNote'
import { exprToRule } from './view/filterRows'

/**
 * Relation-column helpers (5E, GRO-2217; contract GRO-2120 comment 73479ea3 §4). A view
 * *pins a type* when the effective filter conjunction (base `filters` AND view `filters`)
 * contains the canonical `page_type == "<x>"` leaf — the same and-reachable walk 5D's
 * `deriveSeed` uses, so both features read the conjunction identically; `or`/`not` branches
 * never pin. Pinned → relation declarations save to `{ type: x }`, unpinned → `'vault'`.
 */

/** The type this view pins, or null (vault scope). The last pinning leaf wins, like `deriveSeed`'s seeds. */
export function pinnedType(def: BaseDefinition, view: BaseView): string | null {
  const leaves: string[] = []
  andLeaves(def.filters, leaves)
  andLeaves(view.filters, leaves)
  let type: string | null = null
  for (const src of leaves) {
    const rule = exprToRule(src)
    if (rule !== null && rule.property === 'note.page_type' && rule.op === 'is') type = rule.value
  }
  return type
}

/**
 * Picker candidates for a relation column: basenames of the records whose `page_type` equals
 * `target`, filtered client-side over the index (§4). A target no page carries (unregistered
 * or absent type) falls back to ALL basenames — report-don't-block, never an error (§3).
 */
export function relationBasenames(records: readonly IndexRecord[], target: string): string[] {
  const matches = records.filter((r) => r.properties.page_type === target).map((r) => r.basename)
  return matches.length > 0 ? matches : records.map((r) => r.basename)
}
