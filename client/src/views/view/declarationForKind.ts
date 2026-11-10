import type { PropertyDecl, PropertyKind } from '@shared/types'
import { formatFits } from '../columnFormat'

/**
 * A declaration re-typed to `kind`, with the fields that belong to OTHER kinds dropped (YAZ-1549):
 * `options` / `optionSort` ride only on the choice kinds (a choice kind is born with an empty list),
 * `target` only on the link kinds, `from` only on Linked mentions, a `format` only on the kind it was made for (YAZ-4591). Every kind switch — "+ Add column" at save, the detail panel's
 * Type select, "Make relation" — goes through this one rule, so a target typed under Link can never
 * ride into a Text declaration and a Select's options never outlive the Select.
 */
export function declarationForKind(decl: Partial<PropertyDecl> | undefined, kind: PropertyKind): PropertyDecl {
  const next: PropertyDecl = { ...decl, kind }
  if (kind === 'select' || kind === 'multi-select') {
    if (next.options === undefined) next.options = []
  } else {
    delete next.options
    delete next.optionSort
  }
  // A Linked mentions column's `from` (YAZ-4739) rides only on that kind.
  if (kind !== 'mentions') delete next.from
  if (kind !== 'link' && kind !== 'multi-link') delete next.target
  else if (next.target !== undefined && next.target.trim() === '') delete next.target
  if (next.format !== undefined && !formatFits(kind, next.format)) delete next.format
  // An Image column's look (YAZ-4802) rides only on that kind.
  if (kind !== 'image') {
    delete next.size
    delete next.shape
  }
  // No undefined field (YAZ-4637 M1): the disk never holds one, so a declaration with one would never match its echo.
  for (const field of Object.keys(next) as (keyof PropertyDecl)[]) if (next[field] === undefined) delete next[field]
  return next
}
