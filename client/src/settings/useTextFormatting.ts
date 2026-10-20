import { useCallback, useEffect, useRef, useState } from 'react'
import { TEXT_FORMATTING_FILE, sanitizeTextFormatting, textFormattingFile, type TextFormatting } from '@shared/textFormatting'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's text formatting as the UI sees it (YAZ-3066, D10): `.yaseendocs/text-formatting.json`
 * through the generic vault-config door, sanitised on the way in, read again whenever that file
 * changes — a write from another window, or one that arrived by sync. The pattern of
 * `useReviewSettings`. A vault with no file has the app's look (`{}`), and nothing is created
 * until `save`. A file that is not valid JSON shows the app's look too, and a save does not write
 * over it (D10). `useVaultScope` owns one for each vault.
 */
export interface TextFormattingState {
  /** Only what the reader changed. Its identity changes only when the formatting does, so a layer's style can be cached on it. */
  formatting: TextFormatting
  /** Shown at once; a write that fails falls back to what the file holds. Refused, with a notice, over a file that is not valid JSON. */
  save: (next: TextFormatting) => void
}

/** The app's look: one object, so a vault with no file never hands out a new one. */
export const NO_TEXT_FORMATTING: TextFormatting = Object.freeze({})

/** The file or a change, sanitised; nothing left is `NO_TEXT_FORMATTING`. */
function settled(raw: unknown): TextFormatting {
  const clean = sanitizeTextFormatting(raw)
  return Object.keys(clean).length === 0 ? NO_TEXT_FORMATTING : clean
}

/** `root` is nullable because the scope hooks cannot be conditional: no vault, no bridge call, the app's look. */
export function useTextFormatting(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): TextFormattingState {
  const [formatting, setFormatting] = useState(NO_TEXT_FORMATTING)
  const malformed = useRef(false)

  useEffect(() => {
    setFormatting(NO_TEXT_FORMATTING)
    malformed.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, TEXT_FORMATTING_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          setFormatting(settled(raw))
        },
        (err: unknown) => {
          if (!live || !(err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG')) return
          malformed.current = true
          setFormatting(NO_TEXT_FORMATTING)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === TEXT_FORMATTING_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])

  const save = useCallback(
    (next: TextFormatting) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the text formatting: ${TEXT_FORMATTING_FILE} is not valid JSON`, 'error')
      const clean = settled(next)
      setFormatting(clean)
      api.vaultConfig.write(root, TEXT_FORMATTING_FILE, textFormattingFile(clean)).catch(() =>
        api.vaultConfig.read(root, TEXT_FORMATTING_FILE).then(
          (raw) => setFormatting(settled(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { formatting, save }
}
