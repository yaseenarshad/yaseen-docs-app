import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isRecord } from '@shared/guards'
import {
  GLOBAL_INHERITING_OVERRIDE_KEYS,
  VAULT_SETTINGS_FILE,
  VAULT_SETTINGS_VERSION,
  extractVaultOverrides,
  isVaultOwnedChromeKey,
  patchVaultSettingsDoc,
  type LegacySectionKey,
  type VaultOverrideKey,
  type VaultSettingsDoc,
  type VaultSettingsOverrides,
} from '@shared/vaultSettings'
import { BridgeRequestError, api } from '../api'

export interface VaultSettingsState {
  /** Raw parsed `<vault>/.yaseendocs/settings.json` doc, or null when absent / no vault. */
  doc: VaultSettingsDoc | null
  /** Effective sparse per-vault overrides (`extractVaultOverrides(doc)` merged with in-session read-only overrides). */
  overrides: VaultSettingsOverrides
  /** True once `settings.json` has been read (or found missing) for the current vault root. */
  ready: boolean
  /** True when `settings.json` could not be parsed as valid JSON (`INVALID_CONFIG`). */
  malformed: boolean
  /**
   * Sparse-patch override keys in `<vault>/.yaseendocs/settings.json`.
   * When `readOnly` is true, writes only to in-memory `sessionOverrides` and never touches disk.
   */
  setOverrides: (patch: Partial<VaultSettingsOverrides>, unset?: readonly VaultOverrideKey[]) => Promise<void>
  /** Write or clear one consolidated legacy settings section inside `<vault>/.yaseendocs/settings.json`. */
  setSection: (section: LegacySectionKey, value: Record<string, unknown> | undefined) => Promise<void>
  /** Clear all 36 `VAULT_OVERRIDE_KEYS` from `settings.json` while preserving consolidated legacy sections. */
  resetAll: () => Promise<void>
}

const EMPTY_OVERRIDES: VaultSettingsOverrides = Object.freeze({})
const SESSION_UNSET = Symbol('vault-settings-session-unset')
type SessionOverrideMap = Readonly<Record<string, unknown>>
type SessionSectionMap = Readonly<Record<string, Record<string, unknown> | typeof SESSION_UNSET>>
const EMPTY_SESSION_SECTIONS: SessionSectionMap = Object.freeze({})

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

function mergeSessionOverrides(base: VaultSettingsOverrides, session: SessionOverrideMap): VaultSettingsOverrides {
  const sessionEntries = Object.entries(session)
  const hasBase = Object.keys(base).length > 0
  if (!hasBase && sessionEntries.length === 0) return EMPTY_OVERRIDES
  if (sessionEntries.length === 0) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of sessionEntries) {
    if (v === SESSION_UNSET) delete out[k]
    else out[k] = v
  }
  return Object.keys(out).length === 0 ? EMPTY_OVERRIDES : (out as VaultSettingsOverrides)
}

function mergeSessionSections(base: VaultSettingsDoc | null, sections: SessionSectionMap): VaultSettingsDoc | null {
  const entries = Object.entries(sections)
  if (entries.length === 0) return base
  const out: Record<string, unknown> = base !== null ? { ...base } : { version: VAULT_SETTINGS_VERSION }
  for (const [k, v] of entries) {
    if (v === SESSION_UNSET) delete out[k]
    else out[k] = v
  }
  return out as unknown as VaultSettingsDoc
}

/**
 * Unified per-vault settings hook (YAZ-6546, YAZ-6555):
 * ONE `api.vaultConfig.read(root, 'settings.json')` + ONE `onChange` subscription per vault replaces
 * all 11 legacy `.yaseendocs/*.json` hooks inside `useVaultScope`.
 */
export function useVaultSettings(root: string | null, readOnly = false): VaultSettingsState {
  const [doc, setDoc] = useState<VaultSettingsDoc | null>(null)
  const [sessionOverrides, setSessionOverrides] = useState<SessionOverrideMap>(EMPTY_OVERRIDES)
  const [sessionSections, setSessionSections] = useState<SessionSectionMap>(EMPTY_SESSION_SECTIONS)
  const [readRoot, setReadRoot] = useState<string | null>(null)
  const [malformed, setMalformed] = useState(false)

  const docRef = useRef<VaultSettingsDoc | null>(null)
  docRef.current = doc
  const malformedRef = useRef(false)
  malformedRef.current = malformed
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const rootRef = useRef<string | null>(root)
  rootRef.current = root

  const keepDoc = useCallback((next: VaultSettingsDoc | null) => {
    setDoc((prev) => (sameJson(prev, next) ? prev : next))
  }, [])

  useEffect(() => {
    docRef.current = null
    malformedRef.current = false
    setDoc(null)
    setSessionOverrides(EMPTY_OVERRIDES)
    setSessionSections(EMPTY_SESSION_SECTIONS)
    setMalformed(false)
    setReadRoot(null)
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, VAULT_SETTINGS_FILE).then(
        (raw) => {
          if (!live) return
          malformedRef.current = false
          setMalformed(false)
          const parsed = isRecord(raw) ? (raw as unknown as VaultSettingsDoc) : null
          docRef.current = parsed
          keepDoc(parsed)
          setReadRoot(root)
        },
        (err: unknown) => {
          if (!live) return
          if (err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG') {
            malformedRef.current = true
            setMalformed(true)
            docRef.current = null
            keepDoc(null)
          }
          setReadRoot(root)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === VAULT_SETTINGS_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root, keepDoc])

  /**
   * Optimistically update local `doc`, then send ONLY the touched keys + narrowed `known` list to main's
   * serialized `writeConfig` so concurrent writes (two windows or pre-read writes) never clobber unrelated
   * keys or sections already on disk (YAZ-6546).
   */
  const commitPatch = useCallback(
    async (nextDoc: VaultSettingsDoc, writePayload: Record<string, unknown>, known: readonly string[]): Promise<void> => {
      const targetRoot = rootRef.current
      if (targetRoot === null) return
      docRef.current = nextDoc
      keepDoc(nextDoc)
      try {
        await api.vaultConfig.write(targetRoot, VAULT_SETTINGS_FILE, writePayload, known)
      } catch {
        if (rootRef.current !== targetRoot) return
        try {
          const raw = await api.vaultConfig.read(targetRoot, VAULT_SETTINGS_FILE)
          if (rootRef.current !== targetRoot) return
          const recovered = isRecord(raw) ? (raw as unknown as VaultSettingsDoc) : null
          docRef.current = recovered
          keepDoc(recovered)
        } catch {
          // Keep current state if re-read also fails.
        }
      }
    },
    [keepDoc],
  )

  const setOverrides = useCallback(
    async (patch: Partial<VaultSettingsOverrides>, unset: readonly VaultOverrideKey[] = []): Promise<void> => {
      if (rootRef.current === null) return
      if (readOnlyRef.current) {
        const baseOverrides = extractVaultOverrides(docRef.current)
        setSessionOverrides((prev) => {
          const next: Record<string, unknown> = { ...prev }
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) {
              if (Object.hasOwn(baseOverrides, k)) next[k] = SESSION_UNSET
              else delete next[k]
            } else {
              next[k] = v
            }
          }
          for (const k of unset) {
            if (Object.hasOwn(baseOverrides, k)) next[k] = SESSION_UNSET
            else delete next[k]
          }
          return Object.keys(next).length === 0 ? EMPTY_OVERRIDES : next
        })
        return
      }
      if (malformedRef.current) return
      const nextDoc = patchVaultSettingsDoc(docRef.current, patch as Record<string, unknown>, unset)
      const writePayload: Record<string, unknown> = { version: VAULT_SETTINGS_VERSION }
      const known = new Set<string>(['version'])
      for (const [k, v] of Object.entries(patch)) {
        known.add(k)
        if (v !== undefined) writePayload[k] = v
      }
      for (const k of unset) {
        known.add(k)
        delete writePayload[k]
      }
      await commitPatch(nextDoc, writePayload, [...known])
    },
    [commitPatch],
  )

  const setSection = useCallback(
    async (section: LegacySectionKey, value: Record<string, unknown> | undefined): Promise<void> => {
      if (rootRef.current === null) return
      if (readOnlyRef.current) {
        setSessionSections((prev) => ({
          ...prev,
          [section]: value === undefined ? SESSION_UNSET : value,
        }))
        return
      }
      if (malformedRef.current) return
      const nextDoc = value === undefined ? patchVaultSettingsDoc(docRef.current, {}, [section]) : patchVaultSettingsDoc(docRef.current, { [section]: value })
      const writePayload: Record<string, unknown> = value === undefined ? { version: VAULT_SETTINGS_VERSION } : { version: VAULT_SETTINGS_VERSION, [section]: value }
      await commitPatch(nextDoc, writePayload, ['version', section])
    },
    [commitPatch],
  )

  const resetAll = useCallback(async (): Promise<void> => {
    if (rootRef.current === null) return
    if (readOnlyRef.current) {
      const baseKeys = Object.keys(extractVaultOverrides(docRef.current)).filter((k) => !isVaultOwnedChromeKey(k))
      setSessionOverrides((prev) => {
        const next: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(prev)) {
          if (isVaultOwnedChromeKey(k)) next[k] = v
        }
        for (const k of baseKeys) next[k] = SESSION_UNSET
        return Object.keys(next).length === 0 ? EMPTY_OVERRIDES : next
      })
      return
    }
    if (malformedRef.current) return
    const nextDoc = patchVaultSettingsDoc(docRef.current, {}, GLOBAL_INHERITING_OVERRIDE_KEYS)
    await commitPatch(nextDoc, { version: VAULT_SETTINGS_VERSION }, ['version', ...GLOBAL_INHERITING_OVERRIDE_KEYS])
  }, [commitPatch])

  const effectiveDoc = useMemo(() => mergeSessionSections(doc, sessionSections), [doc, sessionSections])

  const overridesRef = useRef<VaultSettingsOverrides>(EMPTY_OVERRIDES)
  const overrides = useMemo(() => {
    const merged = mergeSessionOverrides(extractVaultOverrides(doc), sessionOverrides)
    if (sameJson(overridesRef.current, merged)) return overridesRef.current
    overridesRef.current = merged
    return merged
  }, [doc, sessionOverrides])

  return useMemo(
    () => ({
      doc: effectiveDoc,
      overrides,
      ready: root !== null && readRoot === root,
      malformed,
      setOverrides,
      setSection,
      resetAll,
    }),
    [effectiveDoc, overrides, root, readRoot, malformed, setOverrides, setSection, resetAll],
  )
}
