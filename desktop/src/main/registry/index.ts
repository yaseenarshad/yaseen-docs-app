import type { RegistryPropertyDef, RegistryPropertyKind, RegistryResponse, RegistryScope, RegistryTypeDef } from '@shared/types'
import { REGISTRY_PROPERTY_KINDS } from '@shared/types'
import { BridgeFailure, requireAbsPath, requireDir } from '../fs/fsUtils'
import { readConfigDetailed, subscribeConfig, writeConfig } from '../vaultConfig'

/**
 * Type & property registry (Bible A, GRO-2201): `<root>/.yaseendocs/types.json` read and written
 * through the vaultConfig plumbing (GRO-2188). Electron-free, like the vault index.
 *
 * Lazy (LOCKED): `getRegistry` never creates anything; the first successful mutation creates the
 * dotfolder and the file. Every mutation is a read-modify-write on the raw parsed object — only
 * the keys the mutation names are touched, then the whole object is re-serialised, so unknown
 * fields at every level (top, type, property) survive external tools' additions byte-for-nothing-lost.
 * Mutations are serialised per root (the store's write-chain idiom) so two can't interleave reads.
 *
 * Corrupt / newer files (R2.5): unparsable JSON, a non-object root or a missing/non-numeric
 * `version` read as an empty registry plus an `error` string, and every mutation rejects
 * `INVALID_CONFIG` — the file is NEVER overwritten or moved aside (the opposite of the app-state
 * store's policy, deliberately: app state is disposable, the user's schema is not). A numeric
 * `version` > 1 reads best-effort (known fields consumed, no error) but also refuses mutations:
 * writing a v1 shape over a newer file would destroy fields this version doesn't know.
 */

export const REGISTRY_FILE = 'types.json'

const TYPE_NAME = /^[a-z][a-z0-9-]*$/
const PROPERTY_NAME = /^[a-z][a-z0-9_]*$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------- input validation (strict at the IPC boundary: a write is config, not content) ----------

function requireTypeName(name: unknown): string {
  if (typeof name !== 'string' || !TYPE_NAME.test(name)) {
    throw new BridgeFailure('BAD_REQUEST', `type names are kebab-case (${String(TYPE_NAME)})`, { path: String(name) })
  }
  return name
}

function requirePropertyName(name: unknown): string {
  if (typeof name !== 'string' || !PROPERTY_NAME.test(name)) {
    throw new BridgeFailure('BAD_REQUEST', `property names are snake_case (${String(PROPERTY_NAME)})`, { path: String(name) })
  }
  if (name === 'page_type') {
    throw new BridgeFailure('BAD_REQUEST', "'page_type' is the identity property and is never a declared one")
  }
  return name
}

function requireScope(scope: unknown): RegistryScope {
  if (scope === 'vault') return 'vault'
  if (isRecord(scope) && typeof scope.type === 'string') return { type: requireTypeName(scope.type) }
  throw new BridgeFailure('BAD_REQUEST', "scope must be 'vault' or { type }")
}

/** Known fields only, each type-checked; unknown keys are ignored (the `setFolder` patch posture). */
function requirePropertyDef(raw: unknown): RegistryPropertyDef {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'property def must be an object')
  if (typeof raw.kind !== 'string' || !(REGISTRY_PROPERTY_KINDS as readonly string[]).includes(raw.kind)) {
    throw new BridgeFailure('BAD_REQUEST', `'kind' must be one of ${REGISTRY_PROPERTY_KINDS.join(', ')}`)
  }
  const def: RegistryPropertyDef = { kind: raw.kind as RegistryPropertyKind }
  if (raw.target !== undefined) {
    if (typeof raw.target !== 'string') throw new BridgeFailure('BAD_REQUEST', "'target' must be a string")
    def.target = raw.target
  }
  if (raw.required !== undefined) {
    if (typeof raw.required !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'required' must be a boolean")
    def.required = raw.required
  }
  return def
}

function requireTypePatch(raw: unknown): Partial<RegistryTypeDef> {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'type def must be an object')
  const patch: Partial<RegistryTypeDef> = {}
  for (const key of ['displayName', 'pluralName', 'folder'] as const) {
    const value = raw[key]
    if (value !== undefined) {
      if (typeof value !== 'string') throw new BridgeFailure('BAD_REQUEST', `'${key}' must be a string`)
      patch[key] = value
    }
  }
  if (raw.properties !== undefined) {
    if (!isRecord(raw.properties)) throw new BridgeFailure('BAD_REQUEST', "'properties' must be an object")
    const properties: Record<string, RegistryPropertyDef> = {}
    for (const [name, def] of Object.entries(raw.properties)) properties[requirePropertyName(name)] = requirePropertyDef(def)
    patch.properties = properties
  }
  return patch
}

// ---------- reading (best-effort: known fields consumed, names passed through as data) ----------

function parsePropertyDefs(raw: unknown): Record<string, RegistryPropertyDef> {
  const out: Record<string, RegistryPropertyDef> = {}
  if (!isRecord(raw)) return out
  for (const [name, def] of Object.entries(raw)) {
    if (!isRecord(def)) continue
    // An unknown or missing `kind` string is preserved on disk and read as text (forward compat).
    const kind = typeof def.kind === 'string' && (REGISTRY_PROPERTY_KINDS as readonly string[]).includes(def.kind) ? (def.kind as RegistryPropertyKind) : 'text'
    const clean: RegistryPropertyDef = { kind }
    if (typeof def.target === 'string') clean.target = def.target
    if (typeof def.required === 'boolean') clean.required = def.required
    out[name] = clean
  }
  return out
}

function parseTypes(raw: unknown): Record<string, RegistryTypeDef> {
  const out: Record<string, RegistryTypeDef> = {}
  if (!isRecord(raw)) return out
  for (const [name, def] of Object.entries(raw)) {
    if (!isRecord(def)) continue
    const clean: RegistryTypeDef = { properties: parsePropertyDefs(def.properties) }
    for (const key of ['displayName', 'pluralName', 'folder'] as const) {
      if (typeof def[key] === 'string') clean[key] = def[key]
    }
    out[name] = clean
  }
  return out
}

const empty = (root: string, error?: string): RegistryResponse =>
  error === undefined ? { root, version: 1, types: {}, properties: {} } : { root, version: 1, types: {}, properties: {}, error }

/** Why a raw document refuses mutations; null when it is a mutable v1 object. */
function immutableReason(raw: unknown): string | null {
  if (!isRecord(raw)) return 'types.json is not a JSON object'
  if (raw.version === 1) return null
  if (typeof raw.version === 'number' && Number.isFinite(raw.version) && raw.version > 1) {
    return `types.json has version ${raw.version}, written by a newer app version`
  }
  return "types.json has a missing or invalid 'version'"
}

async function read(root: string): Promise<RegistryResponse> {
  const res = await readConfigDetailed(root, REGISTRY_FILE)
  if (res.state === 'absent') return empty(root)
  if (res.state === 'malformed') return empty(root, `types.json is not valid JSON: ${res.error}`)
  const raw = res.value
  const reason = immutableReason(raw)
  const record = raw as Record<string, unknown>
  // A numeric version > 1 is readable best-effort (no error); everything else immutable is corrupt.
  if (reason !== null && !(isRecord(raw) && typeof record.version === 'number' && record.version > 1)) return empty(root, reason)
  return { root, version: record.version as number, types: parseTypes(record.types), properties: parsePropertyDefs(record.properties) }
}

/** Empty registry (no error) when the file does not exist; never creates anything. */
export async function getRegistry(root: string): Promise<RegistryResponse> {
  const r = requireAbsPath(root, 'root')
  await requireDir(r)
  return read(r)
}

// ---------- mutation (serialised read-modify-write per root; unknown fields preserved) ----------

/** Per-root promise chain, the store's idiom: two mutations (or notify re-reads) can't interleave. */
const chains = new Map<string, Promise<unknown>>()

function chained<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(root) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  chains.set(
    root,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

/** `fn` edits the raw document in place and says whether anything changed; unchanged skips the write. */
async function mutate(root: string, fn: (raw: Record<string, unknown>) => boolean): Promise<void> {
  await requireDir(root)
  const res = await readConfigDetailed(root, REGISTRY_FILE)
  let raw: Record<string, unknown>
  if (res.state === 'absent') {
    raw = { version: 1, types: {}, properties: {} } // lazy creation: the first mutation makes the skeleton
  } else if (res.state === 'malformed') {
    throw new BridgeFailure('INVALID_CONFIG', `types.json is unreadable and will not be overwritten: ${res.error}`, { path: res.file })
  } else {
    const reason = immutableReason(res.value)
    if (reason !== null) throw new BridgeFailure('INVALID_CONFIG', `${reason}; mutations are refused so nothing is lost`)
    raw = res.value as Record<string, unknown>
  }
  if (fn(raw)) await writeConfig(root, REGISTRY_FILE, raw)
}

/** The value at `obj[key]` as a record, replacing non-record garbage with a fresh one. */
function ensureRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = obj[key]
  if (isRecord(current)) return current
  const fresh: Record<string, unknown> = {}
  obj[key] = fresh
  return fresh
}

/** Upsert a type (merge: absent fields keep their stored values; properties replaces whole-map only when given). */
export async function setType(root: string, name: string, def: Partial<RegistryTypeDef>): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requireTypeName(name)
  const patch = requireTypePatch(def)
  return chained(r, () =>
    mutate(r, (raw) => {
      const types = ensureRecord(raw, 'types')
      const existing = types[n]
      types[n] = isRecord(existing) ? { ...existing, ...patch } : { properties: {}, ...patch }
      return true
    }),
  )
}

/** Removing an unknown type is a no-op (and never creates the file). */
export async function removeType(root: string, name: string): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requireTypeName(name)
  return chained(r, () =>
    mutate(r, (raw) => {
      if (!isRecord(raw.types) || !(n in raw.types)) return false
      delete raw.types[n]
      return true
    }),
  )
}

/** Upsert one property def in a type's schema or the vault-wide map; creates the type entry on demand. */
export async function setProperty(root: string, scope: RegistryScope, name: string, def: RegistryPropertyDef): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const s = requireScope(scope)
  const n = requirePropertyName(name)
  const d = requirePropertyDef(def)
  return chained(r, () =>
    mutate(r, (raw) => {
      const holder = s === 'vault' ? ensureRecord(raw, 'properties') : ensureRecord(ensureRecord(ensureRecord(raw, 'types'), s.type), 'properties')
      holder[n] = d
      return true
    }),
  )
}

/** Removing an unknown property (or from an unknown type) is a no-op. */
export async function removeProperty(root: string, scope: RegistryScope, name: string): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const s = requireScope(scope)
  const n = requirePropertyName(name)
  return chained(r, () =>
    mutate(r, (raw) => {
      let holder: unknown = raw.properties
      if (s !== 'vault') {
        const type = isRecord(raw.types) ? raw.types[s.type] : undefined
        holder = isRecord(type) ? type.properties : undefined
      }
      if (!isRecord(holder) || !(n in holder)) return false
      delete holder[n]
      return true
    }),
  )
}

/**
 * Fires with the freshly-read registry after any change to types.json — an own mutation
 * (vaultConfig notifies synchronously) or an external edit (its dotfolder watcher). Re-reads run
 * through the same per-root chain as mutations, so notifications deliver in order. Returns an
 * unsubscribe.
 */
export function subscribeRegistry(root: string, listener: (registry: RegistryResponse) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (change) => {
    if (change.name !== REGISTRY_FILE) return
    void chained(r, async () => {
      try {
        listener(await read(r))
      } catch (err) {
        console.warn(`[registry] re-read of ${r} failed: ${String(err)}`) // e.g. the root vanished mid-notify
      }
    })
  })
}
