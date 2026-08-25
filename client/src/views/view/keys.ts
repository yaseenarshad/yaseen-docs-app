/**
 * The ONE canonical spelling of a view property key, shared by every menu, view and typing
 * rung (GRO-2135). TOMBSTONE (YAZ-846): this file was `view/filterRows.ts`, the Filter menu's
 * rule ↔ expression model — `ruleToExpr` / `exprToRule` / `inferType` / `operatorsFor` /
 * `toGroup` / `fromGroup` / `countRules`. The Filter BUTTON died with the `ViewsPane`
 * amputation (a folder page's set IS the lookup and stores no filters, 🔒 Q3), taking the
 * menu and every one of those helpers with it. The engine's filter EVALUATION is untouched
 * and lives where it always did (`engine.ts` `compileFilter` + `expr/`), as do `viewSchema.ts`'s
 * `FilterNode` types — a hand-written `filters:` block still runs, it just has no builder UI.
 */

/** `status` → `note.status`; `file.x` / `formula.x` / `note.x` unchanged. */
export function canonicalKey(key: string): string {
  return key.startsWith('file.') || key.startsWith('formula.') || key.startsWith('note.') ? key : `note.${key}`
}
