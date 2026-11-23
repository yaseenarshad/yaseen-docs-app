import { FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'
import { READ_ONLY_KEY } from '@shared/readOnly'
import type { ViewSet, ViewDef } from '../viewSchema'
import type { ColumnDecl } from '../folderSettingsRead'
import { defaultKeys, propertyKeys, propertyLabel } from '../engine'
import { canonicalKey } from './keys'
import { CARD_KEYS, DEFAULT_CARD_ORDER, cardPropertyKeys, cardRowsOf } from '../cardRows'

/**
 * Every key the menus can offer (GRO-2135): the view's shown keys first (as written, so
 * `view.order` round-trips), then `file.name` + the page's columns (YAZ-895 — a DECLARED column is offerable before
 * any page carries a value for it; since YAZ-1549 `propertyKeys` itself shows it by default), then every other field
 * the rows hold — Columns ⚙'s "Other properties in these pages" (YAZ-4713 C4) — then "File name" (`file.basename`,
 * YAZ-2420 🔒 D18), Folder (`file.folder`, a column since YAZ-4564 D26), Type (`file.kind`, YAZ-5047) where a row is a card
 * file or a folder row, and the formulas (the page's card counts left with YAZ-5793 D3: card facts are the Card
 * table's); de-duplicated by canonical
 * key. The rows are the pages' own fields less the app's keys (the folder host's `columnReservedKeys`, C1).
 */
export function allPropertyKeys(
  def: ViewSet,
  view: ViewDef,
  records: readonly IndexRecord[],
  columns: Record<string, ColumnDecl> = {},
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (key: string) => {
    const c = canonicalKey(key)
    if (seen.has(c)) return
    seen.add(c)
    out.push(key)
  }
  const declared = Object.keys(columns)
  for (const k of propertyKeys(def, view, records, declared)) add(k)
  // A view listing cards (YAZ-5319): the name, the card columns, the cards' declared columns and own properties
  // (YAZ-5385; `columns` are the card columns' types through the card lens), the Folder and the formulas; a page's own
  // properties are no card's.
  if (cardRowsOf(view)) {
    for (const k of DEFAULT_CARD_ORDER) add(k)
    // The card columns a new Card table hides (YAZ-5793): offered here, one click away.
    for (const k of CARD_KEYS) add(k)
    for (const k of Object.keys(columns)) add(`note.${k}`)
    for (const k of cardPropertyKeys(records)) add(k)
    add('file.folder')
    for (const name of Object.keys(def.formulas ?? {})) add(`formula.${name}`)
    return out
  }
  for (const k of defaultKeys(records, declared)) add(k)
  // The pages' other fields (C4): what a page with columns does not show by itself.
  const fields = new Set<string>()
  for (const r of records) for (const k of Object.keys(r.properties)) if (k !== READ_ONLY_KEY) fields.add(k)
  for (const k of [...fields].sort()) add(`note.${k}`)
  // The read-only switch is no auto-shown column (YAZ-3130 nit), but a reader may still show it.
  if (records.some((r) => READ_ONLY_KEY in r.properties)) add(`note.${READ_ONLY_KEY}`)
  add('file.ctime')
  add('file.basename')
  add('file.folder')
  // The Type column (YAZ-5047): offered where it tells rows apart — a card file (YAZ-5037) or a folder row among them; off by default.
  if (records.some((r) => r.kind === 'card' || r.name === FOLDER_SETTINGS_FILE)) add('file.kind')
  for (const name of Object.keys(def.formulas ?? {})) add(`formula.${name}`)
  return out
}

/** `keys` plus `extra` (first) when missing, so a select always lists its current value. */
function withKey(keys: readonly string[], extra: string): string[] {
  return keys.some(k => canonicalKey(k) === canonicalKey(extra)) ? [...keys] : [extra, ...keys]
}

/** Picker options for `keys` (+ `current` first when missing): canonical value, display label (YAZ-1466). */
export function propertyOptions(def: ViewSet, keys: readonly string[], current?: string): { value: string; label: string }[] {
  return (current ? withKey(keys, current) : keys).map((k) => ({ value: canonicalKey(k), label: propertyLabel(def, k) }))
}
