import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isRecord } from '@shared/guards'
import {
  VAULT_OVERRIDE_KEYS,
  VAULT_SETTINGS_DOC_KEYS,
  VAULT_SETTINGS_FILE,
  extractVaultOverrides,
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

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

function mergeSessionOverrides(base: VaultSettingsOverrides, session: VaultSettingsOverrides): VaultSettingsOverrides {
  const hasBase = Object.keys(base).length > 0
  const hasSession = Object.keys(session).length > 0
  if (!hasBase && !hasSession) return EMPTY_OVERRIDES
  if (!hasSession) return base
  if (!hasBase) return session
  return { ...base, ...session }
}

/**
 * Unified per-vault settings hook (YAZ-6546, YAZ-6555):
 * ONE `api.vaultConfig.read(root, 'settings.json')` + ONE `onChange` subscription per vault replaces
 * all 11 legacy `.yaseendocs/*.json` hooks inside `useVaultScope`.
 */
export function useVaultSettings(root: string | null, readOnly = false): VaultSettingsState {
  const [doc, setDoc] = useState<VaultSettingsDoc | null>(null)
  const [sessionOverrides, setSessionOverrides] = useState<VaultSettingsOverrides>(EMPTY_OVERRIDES)
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

  const commitDoc = useCallback(
    async (nextDoc: VaultSettingsDoc): Promise<void> => {
      const targetRoot = rootRef.current
      if (targetRoot === null) return
      docRef.current = nextDoc
      keepDoc(nextDoc)
      try {
        await api.vaultConfig.write(targetRoot, VAULT_SETTINGS_FILE, nextDoc, VAULT_SETTINGS_DOC_KEYS)
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
        setSessionOverrides((prev) => {
          const next: Record<string, unknown> = { ...prev }
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete next[k]
            else next[k] = v
          }
          for (const k of unset) delete next[k]
          const clean = Object.keys(next).length === 0 ? EMPTY_OVERRIDES : (next as VaultSettingsOverrides)
          return sameJson(prev, clean) ? prev : clean
        })
        return
      }
      if (malformedRef.current) return
      const nextDoc = patchVaultSettingsDoc(docRef.current, patch as Record<string, unknown>, unset)
      await commitDoc(nextDoc)
    },
    [commitDoc],
  )

  const setSection = useCallback(
    async (section: LegacySectionKey, value: Record<string, unknown> | undefined): Promise<void> => {
      if (rootRef.current === null || malformedRef.current) return
      const nextDoc = value === undefined ? patchVaultSettingsDoc(docRef.current, {}, [section]) : patchVaultSettingsDoc(docRef.current, { [section]: value })
      await commitDoc(nextDoc)
    },
    [commitDoc],
  )

  const resetAll = useCallback(async (): Promise<void> => {
    if (rootRef.current === null) return
    if (readOnlyRef.current) {
      setSessionOverrides(EMPTY_OVERRIDES)
      return
    }
    if (malformedRef.current) return
    const nextDoc = patchVaultSettingsDoc(docRef.current, {}, VAULT_OVERRIDE_KEYS)
    await commitDoc(nextDoc)
  }, [commitDoc])

  const overridesRef = useRef<VaultSettingsOverrides>(EMPTY_OVERRIDES)
  const overrides = useMemo(() => {
    const merged = mergeSessionOverrides(extractVaultOverrides(doc), sessionOverrides)
    if (sameJson(overridesRef.current, merged)) return overridesRef.current
    overridesRef.current = merged
    return merged
  }, [doc, sessionOverrides])

  return useMemo(
    () => ({
      doc,
      overrides,
      ready: root !== null && readRoot === root,
      malformed,
      setOverrides,
      setSection,
      resetAll,
    }),
    [doc, overrides, root, readRoot, malformed, setOverrides, setSection, resetAll],
  )
}
