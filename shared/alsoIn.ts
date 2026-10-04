import { isNoteId } from './noteId'

/** A notecard's shortcuts (YAZ-2290 D2): the ids of the folders it also appears in. The app's own key, never a column to delete. */
export const ALSO_IN_KEY = 'also_in'

/** `also_in` as written, one entry per item: a scalar is ONE entry (the index's own tolerance, `extractAliases`), and none is none. */
export function alsoInEntries(properties: Record<string, unknown>): unknown[] {
  const raw = properties[ALSO_IN_KEY]
  return Array.isArray(raw) ? raw : raw == null ? [] : [raw]
}

/** The folder ids a notecard names. Non-strings and anything that is no id are ignored quietly. */
export const alsoIn = (properties: Record<string, unknown>): string[] => alsoInEntries(properties).filter(isNoteId)
