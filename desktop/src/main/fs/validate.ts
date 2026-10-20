import { isStringArray } from '@shared/guards'
import { BridgeFailure, requireAbsPath } from './fsUtils'

/**
 * The shape checks every IPC door repeated (YAZ-2201). A sandboxed renderer's arguments arrive as
 * `unknown`; each check refuses BAD_REQUEST in the exact wording the doors always used, since a
 * renderer may show it. What a value MEANS stays with the module that owns it.
 */

/** A door's request object. Any non-null object passes, arrays included, as every door checked it. */
export function requireRequest(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  return raw as Record<string, unknown>
}

/** An array of strings, any strings. */
export function requireStringArray(v: unknown, name: string): string[] {
  if (!isStringArray(v)) throw new BridgeFailure('BAD_REQUEST', `'${name}' must be a string array`)
  return v
}

/** Absolute paths only — one bad element refuses the whole call, named `name[i]` (Settings › Storage's `skip`, YAZ-3039). */
export function absPaths(v: unknown, name: string): string[] {
  if (!Array.isArray(v)) throw new BridgeFailure('BAD_REQUEST', `'${name}' must be an array of absolute paths`)
  return v.map((p, i) => requireAbsPath(p, `${name}[${i}]`))
}
