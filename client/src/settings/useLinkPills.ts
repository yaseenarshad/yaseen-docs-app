import { useCallback, useEffect, useRef, useState } from 'react'
import { LINK_PILLS_FILE, NO_LINK_PILLS, isDefaultLinkPills, linkPillsFile, sanitizeLinkPills, type LinkPills } from '@shared/linkPills'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's link pills look as the UI sees it (YAZ-4924): `.yaseendocs/link-pills.json` through the generic
 * vault-config door, sanitised on the way in, read again whenever that file changes — a write from another window, or
 * one that arrived by sync. The pattern of `useTextFormatting`. A vault with no file has today's look
 * (`NO_LINK_PILLS`), and nothing is created until `save`. A file that is not valid JSON shows today's look too, and a
 * save does not write over it. `useVaultScope` owns one for each vault.
 */
export interface LinkPillsState {
  /** Only what the reader changed. Its identity changes only when the look does, so a layer's style can be cached on it. */
  pills: LinkPills
  /** Shown at once; a write that fails falls back to what the file holds. Refused, with a notice, over a file that is not valid JSON. */
  save: (next: LinkPills) => void
}

/** The file or a change, sanitised; nothing left is `NO_LINK_PILLS`. */
function settled(raw: unknown): LinkPills {
  const clean = sanitizeLinkPills(raw)
  return isDefaultLinkPills(clean) ? NO_LINK_PILLS : clean
}

/** `root` is nullable because the scope hooks cannot be conditional: no vault, no bridge call, today's look. */
export function useLinkPills(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): LinkPillsState {
  const [pills, setPills] = useState(NO_LINK_PILLS)
  const malformed = useRef(false)

  useEffect(() => {
    setPills(NO_LINK_PILLS)
    malformed.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, LINK_PILLS_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          setPills(settled(raw))
        },
        (err: unknown) => {
          if (!live || !(err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG')) return
          malformed.current = true
          setPills(NO_LINK_PILLS)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === LINK_PILLS_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])

  const save = useCallback(
    (next: LinkPills) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the link pills: ${LINK_PILLS_FILE} is not valid JSON`, 'error')
      const clean = settled(next)
      setPills(clean)
      api.vaultConfig.write(root, LINK_PILLS_FILE, linkPillsFile(clean)).catch(() =>
        api.vaultConfig.read(root, LINK_PILLS_FILE).then(
          (raw) => setPills(settled(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { pills, save }
}
