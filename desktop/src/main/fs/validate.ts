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
  if (!Array.isArray(v)) return refuse(`'${name}' must be an array of absolute paths`)
  return v.map((p, i) => requireAbsPath(p, `${name}[${i}]`))
}

/** The share doors' scalar checks (YAZ-3040, Draw's `fs/validate.ts`): each refuses BAD_REQUEST in the words the renderer shows. */
const refuse = (message: string): never => {
  throw new BridgeFailure('BAD_REQUEST', message)
}

/** A non-empty string. */
export const str = (v: unknown, name: string): string => (typeof v === 'string' && v !== '' ? v : refuse(`'${name}' must be a non-empty string`))

/** Absent, or any string. */
export const optStr = (v: unknown, name: string): string | undefined => (v === undefined || typeof v === 'string' ? v : refuse(`'${name}' must be a string`))

/** A string or null; a door that also allows absence checks for it first. */
export const strOrNull = (v: unknown, name: string): string | null => (v === null || typeof v === 'string' ? v : refuse(`'${name}' must be a string or null`))

export const bool = (v: unknown, name: string): boolean => (typeof v === 'boolean' ? v : refuse(`'${name}' must be a boolean`))

export const optBool = (v: unknown, name: string): boolean | undefined => (v === undefined ? v : bool(v, name))
