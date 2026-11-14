/**
 * The filter operators' names (GRO-2135; `filterRows.ts` gives each its rules). Alone in this file, with no import, so
 * a reader of a view's grammar (`viewGrammar.ts`: a table's comment, and through it a card's table, `cardRender.ts`)
 * names them without the folder pages' code and the bridge behind it: the phone's typecheck reads no bridge (YAZ-5309).
 */
export type OperatorId =
  | 'is' | 'isNot' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'isEmpty' | 'isNotEmpty'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge'
  | 'dateIs' | 'dateBefore' | 'dateAfter' | 'dateIsToday' | 'dateInThisWeek' | 'dateInThisMonth'
  | 'checked' | 'unchecked'
  | 'hasTag' | 'inFolder' | 'hasLink'
  | 'isAnyOf' | 'isNoneOf' | 'hasAnyOf' | 'hasNoneOf' | 'hasAllOf'
