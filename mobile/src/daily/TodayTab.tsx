import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
// The one door to open a file (YAZ-5472): the daily note opens as a link does (a sheet when the vault says "explore").
import { openFile } from '../explore/openFile'
import { Toast, useToast } from '../screens/Toast'

/** The vault file that turns the button on (`@shared/dailyPagesFile`), written out: the first load skips its parser. */
const FILE = '.yaseendocs/daily-pages.json'
/** The answer last read for each vault, so a screen drawn again shows the button at once. */
const held = new Map<string, boolean>()
const load = () => import('./today')

/** On: the file says `"enabled": true`. The full check (the folder, the style) is the chunk's (`today.ts`). */
async function isOn(read: () => Promise<{ content: string | Uint8Array } | null>): Promise<boolean> {
  try {
    const file = await read()
    const text = file === null ? '' : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
    return (JSON.parse(text || 'null') as { enabled?: unknown } | null)?.enabled === true
  } catch {
    return false
  }
}

/**
 * The "Today" button of the tab bar, right of Search (YAZ-5470): only in a vault with Daily pages on. A tap opens today's
 * daily page, else the latest one before it (`today.ts`); with none at all, a short line. Read again at each sync that
 * brings a settings file, so the Mac's change shows.
 */
export function TodayTab() {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey
  const [on, setOn] = useState(() => (vault === null ? false : (held.get(vault) ?? false)))
  const [toast, say] = useToast()
  useEffect(() => {
    if (vault === null) return setOn(false)
    let live = true
    const read = () =>
      void isOn(() => store.read(vault, FILE)).then((next) => {
        held.set(vault, next)
        if (live) setOn(next)
      })
    read()
    const off = sync.subscribe((e) => {
      if (e.type === 'changed' && e.vault === vault && (e.diff === undefined || e.diff === null || e.settings.includes(FILE))) read()
    })
    return () => {
      live = false
      off()
    }
  }, [store, sync, vault])
  if (!on || vault === null) return null
  const tap = () =>
    void load()
      .then((m) => m.findToday(store, vault, new Date((app.services.now ?? Date.now)())))
      .then((found) => (found === null ? say('No daily notes yet') : openFile(app, { kind: 'page', path: found.path })))
      .catch(() => say('Could not open the daily note'))
  return (
    <>
      <button type="button" className="tabbar__tab tabbar__today" onClick={tap}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="11.5" rx="1.5" />
          <path d="M1.75 6.25h12.5M5 1.25V4m6-2.75V4" />
        </svg>
        Today
      </button>
      {toast !== null && <Toast text={toast} />}
    </>
  )
}
