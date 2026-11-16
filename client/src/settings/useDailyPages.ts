import { useCallback, useEffect, useRef, useState } from 'react'
import { DAILY_PAGES_FILE, DAILY_PAGES_KEYS, DAILY_PAGES_OFF, dailyPagesFile, readDailyPagesFile, sameDailyPages, type DailyPagesSettings } from '@shared/dailyPagesFile'
import { BridgeRequestError, api } from '../api'
import type { NoticeKind } from '../lib/notice'

/**
 * A vault's daily pages as the window sees them (YAZ-5491): `.yaseendocs/daily-pages.json` through the vault-config
 * door, the shape of `useTextFormatting`. Read when the vault opens and again whenever the file changes (another window,
 * another Mac by sync). `file` is null while the vault has no file: App then uses the app value
 * (`windowDailyPages`). A file that is not valid JSON reads as off and refuses a save, with a notice.
 * `useVaultScope` owns one for each vault.
 */
export interface DailyPagesState {
  /** The vault's file, sanitised; null when there is none. */
  file: DailyPagesSettings | null
  /** Shown at once; writes only a change. Refused, with a notice, over a file that is not valid JSON. */
  save: (next: DailyPagesSettings) => void
}

export function useDailyPages(root: string | null, onNotice: (text: string, icon?: NoticeKind) => void): DailyPagesState {
  const [file, setFile] = useState<DailyPagesSettings | null>(null)
  const malformed = useRef(false)
  const held = useRef<DailyPagesSettings | null>(null)
  held.current = file

  useEffect(() => {
    setFile(null)
    malformed.current = false
    if (root === null) return
    let live = true
    const load = (): void => {
      api.vaultConfig.read(root, DAILY_PAGES_FILE).then(
        (raw) => {
          if (!live) return
          malformed.current = false
          setFile(raw === null ? null : readDailyPagesFile(raw))
        },
        (err: unknown) => {
          if (!live || !(err instanceof BridgeRequestError && err.code === 'INVALID_CONFIG')) return
          malformed.current = true
          setFile(DAILY_PAGES_OFF)
        },
      )
    }
    load()
    const unsubscribe = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === DAILY_PAGES_FILE) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])

  const save = useCallback(
    (next: DailyPagesSettings) => {
      if (root === null) return
      if (malformed.current) return onNotice(`Can't save the daily pages: ${DAILY_PAGES_FILE} is not valid JSON`, 'error')
      const clean = readDailyPagesFile(dailyPagesFile(next))
      if (held.current !== null && sameDailyPages(held.current, clean)) return
      setFile(clean)
      api.vaultConfig.write(root, DAILY_PAGES_FILE, dailyPagesFile(clean), DAILY_PAGES_KEYS).catch(() =>
        api.vaultConfig.read(root, DAILY_PAGES_FILE).then(
          (raw) => setFile(raw === null ? null : readDailyPagesFile(raw)),
          () => undefined,
        ),
      )
    },
    [root, onNotice],
  )

  return { file, save }
}
