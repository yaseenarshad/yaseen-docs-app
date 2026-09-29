/**
 * The type guards every parser in the app shares (YAZ-2201): written once, so "a plain object"
 * cannot mean one thing in the state file and another in a view schema.
 */

/** A plain JSON object. `typeof [] === 'object'`, so the array check is part of the question. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** An array of strings only. */
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
