import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { NEW_PLACE_SLOTS, NEW_PLACES_FILE, parseNewPlaces, type NewPlacesConfig } from '@shared/newPlaces'
import { BridgeFailure, createRootChain, requireAbsPath } from './fs/fsUtils'
import { toAbs, toRel, under } from './favorites'
import { readConfigDetailed, subscribeConfig, writeConfig } from './vaultConfig'

/**
 * The New… box's place shortcuts in the vault (YAZ-4252 D3): `<root>/.yaseendocs/new-places.json`
 * (`shared/newPlaces.ts`), icons.json's idiom over the vaultConfig plumbing: VAULT-RELATIVE paths in the file,
 * ABSOLUTE paths on the bridge, created on the first write and never by a read, written atomically, watched (an own
 * write or an external edit pushes `newPlaces:changed`).
 *
 * Corrupt-file policy (favorites' R2.5): unparsable JSON or a wrong shape reads as three empty shortcuts and refuses
 * every write with `INVALID_CONFIG`; the file is never overwritten. A bad entry inside a good file reads as empty.
 */

type Raw = { state: 'absent' } | { state: 'ok'; places: Array<string | null> } | { state: 'bad'; file: string }

async function readRaw(root: string): Promise<Raw> {
  const res = await readConfigDetailed(root, NEW_PLACES_FILE)
  if (res.state === 'absent') return res
  const places = res.state === 'malformed' ? null : parseNewPlaces(res.value)
  return places === null ? { state: 'bad', file: path.join(root, VAULT_CONFIG_DIR, NEW_PLACES_FILE) } : { state: 'ok', places }
}

const EMPTY = (): Array<string | null> => Array.from({ length: NEW_PLACE_SLOTS }, () => null)

/** Writes on one root never interleave. */
const chained = createRootChain()

/** The vault's three shortcuts, absolute (null for an empty one); absent or malformed → three empty. Never creates anything. */
export async function getNewPlaces(root: string): Promise<Array<string | null>> {
  const r = requireAbsPath(root, 'root')
  const raw = await readRaw(r)
  return raw.state === 'ok' ? raw.places.map((rel) => (rel === null ? null : toAbs(r, rel))) : EMPTY()
}

/** Replace the shortcuts: three absolute folders inside `root`, or null; creates the dotfolder and file on the first write. */
export async function setNewPlaces(root: string, places: unknown): Promise<void> {
  const r = requireAbsPath(root, 'root')
  if (!Array.isArray(places) || places.length !== NEW_PLACE_SLOTS) throw new BridgeFailure('BAD_REQUEST', `new places must be ${NEW_PLACE_SLOTS} folders or null`)
  for (const p of places) {
    if (p !== null && (typeof p !== 'string' || !path.isAbsolute(p) || !under(r, p))) throw new BridgeFailure('BAD_REQUEST', 'a new place must be inside the vault', { path: String(p) })
  }
  await chained(r, async () => {
    const raw = await readRaw(r)
    if (raw.state === 'bad') throw new BridgeFailure('INVALID_CONFIG', 'new-places.json is malformed; fix or delete it', { path: raw.file })
    const value: NewPlacesConfig = { version: 1, places: (places as Array<string | null>).map((p) => (p === null ? null : toRel(r, p))) }
    await writeConfig(r, NEW_PLACES_FILE, value)
  })
}

/** Fires after any change to new-places.json, an own write or an external edit. Returns an unsubscribe. */
export function subscribeNewPlaces(root: string, listener: (change: { root: string }) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    if (c.name === NEW_PLACES_FILE) listener({ root: r })
  })
}
