import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
// The one door to open a file. Q4: the Today button is a tab screen's first open, so ALWAYS a full page.
import { openFile } from '../explore/openFile'
import { PageView } from '../screens/PageScreen'
import { Toast, useToast } from '../screens/Toast'
import type { VaultStore } from '../store'

const load = () => import('./today')

/**
 * The "Today" button of the tab bar, right of Search: the frame shows it only in a vault with Daily pages on
 * (`.yaseendocs/daily-pages.json`, read with the vault's other tab settings: `app/vaultTabs.ts`). A tap opens
 * today's daily page, else the latest one before it (`today.ts`); with none at all, a short line.
 *
 * YAZ-5522 N6: MARKED (`aria-current="page"`, the selected tab's look) while the open screen is the page it opened, or
 * today's daily page however it was opened. It is no tab of its own (no `aria-selected`), so the tabs under it stay
 * unmarked, as they are on any page.
 *
 * YAZ-5589: AT ONCE, as Search. Once the app is idle after its start (and again after each sync change of the vault),
 * the button reads its page AHEAD: its chunk (`today.ts`), which page it opens, the page view's chunk, and that page's
 * text, the vault's look and the renderer's warm-up (`primePage`). Then a tap opens the page in the same frame: no
 * empty screen while a chunk loads, no wait for the storage. Before that (or on a new day), the tap reads all of it
 * first while the screen under stays, then opens the page drawn.
 */
/** The page the Today button opened last (for each phone's store), in which vault: it stays marked while that page is open. */
const openedOn = new WeakMap<object, { vault: string; path: string }>()

interface Ahead {
  vault: string
  /** The phone's local day it was read on: on another day the tap reads again. */
  day: string
  path: string
}
/** Today's page read ahead, for each phone's store. */
const aheadOn = new WeakMap<VaultStore, Ahead>()
/** A read ahead under way, for each phone's store. */
const readingOn = new WeakMap<VaultStore, Promise<void>>()

const dayOf = (now: Date) => now.toDateString()

/** Which page the tap opens, with everything it needs to draw read (chunks, text, look, renderer); null: none. */
async function readToday(store: VaultStore, vault: string, repoName: string, now: Date): Promise<string | null> {
  // The page view's chunk: its screen then draws with no wait (`lazyScreen`); `primePage` is in that same chunk.
  const [m, page] = await Promise.all([load(), PageView.preload().then(() => import('../page/PageView'))])
  const found = await m.findToday(store, vault, now)
  if (found === null) return null
  // The page still opens when a part of the read fails (it then reads it itself).
  await page.primePage(store, vault, repoName, found.path).catch(() => {})
  return found.path
}

export function TodayTab() {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey
  const repoName = app.vault?.repo.split('/')[1] ?? ''
  const [toast, say] = useToast()
  const top = app.nav.stack.at(-1)
  const page = top?.kind === 'page' ? top.path : null
  const [isToday, setIsToday] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const opened = openedOn.get(store)
  const nowDate = () => new Date((app.services.now ?? Date.now)())
  useEffect(() => {
    if (vault === null || page === null || (opened?.vault === vault && opened.path === page)) return
    let live = true
    void load()
      .then((m) => m.findToday(store, vault, nowDate()))
      .then((found) => live && found?.today === true && found.path === page && setIsToday(page), () => {})
    return () => void (live = false)
  }, [vault, page, store]) // eslint-disable-line react-hooks/exhaustive-deps

  // YAZ-5589: the read ahead, once the app is idle; again after a sync change of the vault (a new daily page).
  useEffect(() => {
    if (vault === null) return
    let live = true
    const mark = () => {
      const known = aheadOn.get(store)
      if (live && button.current !== null) button.current.dataset.ahead = known?.vault === vault && known.day === dayOf(nowDate()) ? 'ready' : 'no'
    }
    const readAhead = () => {
      const now = nowDate()
      const known = aheadOn.get(store)
      if (known?.vault === vault && known.day === dayOf(now)) return mark()
      if (readingOn.has(store)) return void readingOn.get(store)!.then(mark)
      const reading = readToday(store, vault, repoName, now)
        .then((path) => {
          if (path === null) aheadOn.delete(store)
          else aheadOn.set(store, { vault, day: dayOf(now), path })
        })
        .catch(() => {})
        .finally(() => readingOn.delete(store))
      readingOn.set(store, reading)
      void reading.then(mark)
    }
    const idle = typeof requestIdleCallback === 'function'
    const later = idle ? requestIdleCallback(readAhead, { timeout: 2000 }) : setTimeout(readAhead, 500)
    const off = sync.subscribe((event) => {
      if (event.type !== 'changed' || event.vault !== vault) return
      aheadOn.delete(store)
      readAhead()
    })
    return () => {
      live = false
      off()
      if (idle) cancelIdleCallback(later as number)
      else clearTimeout(later)
    }
  }, [vault, store, sync, repoName]) // eslint-disable-line react-hooks/exhaustive-deps

  if (vault === null) return null
  const marked = page !== null && ((opened?.vault === vault && opened.path === page) || isToday === page)
  const open = (path: string) => {
    openedOn.set(store, { vault, path })
    openFile(app, { kind: 'page', path }, { from: 'tab' })
  }
  const tap = () => {
    const now = nowDate()
    const known = aheadOn.get(store)
    // Read ahead: the page opens now, in this frame.
    if (known?.vault === vault && known.day === dayOf(now)) return open(known.path)
    void readToday(store, vault, repoName, now)
      .then((path) => (path === null ? say('No daily notes yet') : open(path)))
      .catch(() => say('Could not open the daily note'))
  }
  return (
    <>
      <button ref={button} type="button" className="tabbar__tab tabbar__today" aria-current={marked ? 'page' : undefined} onClick={tap}>
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
