/**
 * The New… box's place shortcuts (YAZ-4252 D2, D3): three folders of a vault the box can send a new item to, kept
 * in the vault, `<root>/.yaseendocs/new-places.json` = `{ version: 1, places: [rel | null, rel | null, rel | null] }`,
 * so they travel with it (favorites.json's idiom). A place is a VAULT-RELATIVE POSIX path ('' is the vault's own
 * folder); null is an empty shortcut ("+ Add place"). Pure: main reads and writes the file (`desktop/src/main/newPlaces.ts`).
 */
import { isRecord } from './guards'

export const NEW_PLACES_FILE = 'new-places.json'

/** How many shortcuts the box shows. */
export const NEW_PLACE_SLOTS = 3

/** The file on disk. */
export interface NewPlacesConfig {
  version: 1
  places: Array<string | null>
}

/** A stored place: '' (the vault) or a relative path with no `..` segment, no leading `/` and no NUL. */
export const isPlaceRel = (p: unknown): p is string => typeof p === 'string' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/** The three places of a parsed file, a bad one as empty; null when the file is not `{ version: 1, places: [] }`. */
export function parseNewPlaces(v: unknown): Array<string | null> | null {
  if (!isRecord(v) || v.version !== 1 || !Array.isArray(v.places)) return null
  const places: readonly unknown[] = v.places
  return Array.from({ length: NEW_PLACE_SLOTS }, (_, i) => {
    const p = places[i]
    return isPlaceRel(p) ? p : null
  })
}
