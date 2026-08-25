import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import { propertyKeys } from '../engine'
import { canonicalKey } from './keys'

/**
 * Every key the menus can offer (GRO-2135): the view's shown keys first (as written, so
 * `view.order` round-trips), then `file.name` + every note key seen, then the formulas;
 * de-duplicated by canonical key.
 */
export function allPropertyKeys(def: BaseDefinition, view: BaseView, records: readonly IndexRecord[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (key: string) => {
    const c = canonicalKey(key)
    if (seen.has(c)) return
    seen.add(c)
    out.push(key)
  }
  for (const k of propertyKeys(def, view, records)) add(k)
  for (const k of propertyKeys(def, { ...view, order: undefined }, records)) add(k)
  for (const name of Object.keys(def.formulas ?? {})) add(`formula.${name}`)
  return out
}

/** `keys` plus `extra` (first) when missing, so a select always lists its current value. */
export function withKey(keys: readonly string[], extra: string): string[] {
  return keys.some(k => canonicalKey(k) === canonicalKey(extra)) ? [...keys] : [extra, ...keys]
}
