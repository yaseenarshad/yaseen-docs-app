import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
// The one door to open a file (YAZ-5472). Q4: the Today button is a tab screen's first open, so ALWAYS a full page.
import { openFile } from '../explore/openFile'
import { Toast, useToast } from '../screens/Toast'

const load = () => import('./today')

/**
 * The "Today" button of the tab bar, right of Search (YAZ-5470): the frame shows it only in a vault with Daily pages on
 * (`.yaseendocs/daily-pages.json`, read with the vault's other tab settings: `app/vaultTabs.ts`, YAZ-5476). A tap opens
 * today's daily page, else the latest one before it (`today.ts`); with none at all, a short line.
 *
 * YAZ-5522 N6: MARKED (`aria-current="page"`, the selected tab's look) while the open screen is the page it opened, or
 * today's daily page however it was opened. It is no tab of its own (no `aria-selected`), so the tabs under it stay
 * unmarked, as they are on any page.
 */
/** The page the Today button opened last (for each phone's store), in which vault: it stays marked while that page is open. */
const openedOn = new WeakMap<object, { vault: string; path: string }>()

export function TodayTab() {
  const app = useApp()
  const { store } = app.services
  const vault = app.vaultKey
  const [toast, say] = useToast()
  const top = app.nav.stack.at(-1)
  const page = top?.kind === 'page' ? top.path : null
  const [isToday, setIsToday] = useState<string | null>(null)
  const opened = openedOn.get(store)
  useEffect(() => {
    if (vault === null || page === null || (opened?.vault === vault && opened.path === page)) return
    let live = true
    void load()
      .then((m) => m.findToday(store, vault, new Date((app.services.now ?? Date.now)())))
      .then((found) => live && found?.today === true && found.path === page && setIsToday(page), () => {})
    return () => void (live = false)
  }, [vault, page, store])
  if (vault === null) return null
  const marked = page !== null && ((opened?.vault === vault && opened.path === page) || isToday === page)
  const tap = () =>
    void load()
      .then((m) => m.findToday(store, vault, new Date((app.services.now ?? Date.now)())))
      .then((found) => {
        if (found === null) return say('No daily notes yet')
        openedOn.set(store, { vault, path: found.path })
        openFile(app, { kind: 'page', path: found.path }, { from: 'tab' })
      })
      .catch(() => say('Could not open the daily note'))
  return (
    <>
      <button type="button" className="tabbar__tab tabbar__today" aria-current={marked ? 'page' : undefined} onClick={tap}>
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
