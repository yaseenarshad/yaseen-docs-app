import { isStringArray } from '@shared/guards'
import { BridgeFailure } from './fsUtils'

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

/** A non-empty string (YAZ-3038, Draw's `fs/validate.ts`): the canvas panel's doors name slugs, ids and keys with it. */
export function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new BridgeFailure('BAD_REQUEST', `'${name}' must be a non-empty string`)
  return v
}

/** A string or null; a door that also allows absence checks for it first. */
export function strOrNull(v: unknown, name: string): string | null {
  if (v !== null && typeof v !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${name}' must be a string or null`)
  return v
}
