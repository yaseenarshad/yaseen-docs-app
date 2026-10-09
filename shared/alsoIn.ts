import { canonicalNoteId, isNoteId } from './noteId'

/** A note's shortcuts (YAZ-2290 D2): the ids of the folders it also appears in. The app's own key, never a column to delete. */
export const ALSO_IN_KEY = 'also_in'

/** `also_in` as written, one entry per item: a scalar is ONE entry (the index's own tolerance, `extractAliases`), and none is none. */
export function alsoInEntries(properties: Record<string, unknown>): unknown[] {
  const raw = properties[ALSO_IN_KEY]
  return Array.isArray(raw) ? raw : raw == null ? [] : [raw]
}

/**
 * The folder ids a note names, each as the index holds an id (YAZ-2677 R2: `yaz-12` written by hand
 * names the folder `YAZ-12`). Non-strings and anything that is no id are ignored quietly; an entry
 * that names no folder of the vault is too, where the id is looked up.
 */
export const alsoIn = (properties: Record<string, unknown>): string[] => alsoInEntries(properties).filter(isNoteId).map(canonicalNoteId)
