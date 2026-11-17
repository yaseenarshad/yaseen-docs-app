import { useCallback, useEffect, useRef, useState } from 'react'
import { CARD_LOOK_FILE, CARD_LOOK_KEYS, cardLookFile, cardLookOf, sanitizeCardLook, type CardLook, type CardLookSettings } from '@shared/cardLook'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's card look as the UI sees it (YAZ-5484): `.yaseendocs/card-look.json` through the generic vault-config door,
 * sanitised on the way in, read again whenever that file changes (another window, a sync). The pattern of
 * `useTextFormatting`. `look` is null while the vault has NO file: the app's settings then draw its cards (the
 * fallback), and nothing is created until `save`. A file that is not valid JSON shows the defaults (`{}`), and a save
 * does not write over it. `useVaultScope` owns one for each vault.
 */
export interface CardLookState {
  /** The file's look (only what differs from the defaults), or null with no file. Its identity changes only when the look does. */
  look: CardLook | null
  /** The whole look: written at once (only what differs from the defaults); a write that fails reads the file again. */
  save: (next: CardLookSettings) => void
}

/** A file with nothing but its version: one object, so a reload of the same file hands out the same look. */
const EMPTY: CardLook = Object.freeze({})
const settled = (raw: unknown): CardLook => {
  const clean = sanitizeCardLook(raw)
  return Object.keys(clean).length === 0 ? EMPTY : clean
}
const same = (a: CardLook | null, b: CardLook | null): boolean => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))

/** `root` is nullable because the scope hooks cannot be conditional: no vault, no bridge call, no file. */
export function useCardLook(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): CardLookState {
  const [look, setLook] = useState<CardLook | null>(null)
  const malformed = useRef(false)
  // A reload that reads the same look keeps the object: the layers' styles are cached on it.
  const keep = useCallback((next: CardLook | null) => setLook((prev) => (same(prev, next) ? prev : next)), [])

  useEffect(() => {
    setLook(null)
    malformed.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, CARD_LOOK_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          keep(raw === null || raw === undefined ? null : settled(raw))
        },
        (err: unknown) => {
          if (!live || !(err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG')) return
          malformed.current = true
          keep(EMPTY)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === CARD_LOOK_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root, keep])

  const save = useCallback(
    (next: CardLookSettings) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the card look: ${CARD_LOOK_FILE} is not valid JSON`, 'error')
      const clean = settled(cardLookOf(next))
      keep(clean)
      api.vaultConfig.write(root, CARD_LOOK_FILE, cardLookFile(clean), CARD_LOOK_KEYS).catch(() =>
        api.vaultConfig.read(root, CARD_LOOK_FILE).then(
          (raw) => keep(raw === null || raw === undefined ? null : settled(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice, keep],
  )

  return { look, save }
}
