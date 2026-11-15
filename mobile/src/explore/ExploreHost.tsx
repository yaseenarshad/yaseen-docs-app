import { useEffect, useSyncExternalStore } from 'react'
import { useApp } from '../app/AppState'
import { lazyScreen } from '../screens/LazyScreen'
import { readJson } from '../search/vaultData'
import { LINK_CLICK_PATH, sanitizeLinkClick, setLinkClick } from './openFile'
import { closeAll, loadSheetLayer, openSheet, preloadSheets, setSheetsPreload, sheetStack, subscribeSheets } from './sheets'

/** The sheets' own chunk: not in the first load. */
const SheetLayer = lazyScreen(loadSheetLayer, { waiting: <></> })
// YAZ-5589: the preload goes through the screen, so a panel opened after it draws with no empty waiting frame.
setSheetsPreload(SheetLayer.preload)

/**
 * The sheets' place in the app, next to the shell: it draws the stack (its chunk) while a sheet is open,
 * reads the vault's "Clicking a link" (`link-click.json`) for `openFile`, preloads the chunk when the app is idle,
 * and closes every sheet when another vault opens.
 */
export function ExploreHost() {
  const app = useApp()
  const stack = useSyncExternalStore(subscribeSheets, sheetStack)
  const vault = app.phase === 'ready' ? app.vaultKey : null
  const { store, sync } = app.services

  useEffect(() => {
    closeAll()
    if (vault === null) return
    let live = true
    const read = () => void readJson(store, vault, LINK_CLICK_PATH).then((raw) => live && setLinkClick(vault, sanitizeLinkClick(raw)))
    read()
    const off = sync.subscribe((event) => event.type === 'changed' && event.vault === vault && read())
    // The first link opens with no wait: the chunk loads once the app is idle.
    const idle = typeof requestIdleCallback === 'function'
    const later = idle ? requestIdleCallback(() => void preloadSheets(), { timeout: 5000 }) : setTimeout(() => void preloadSheets(), 3000)
    return () => {
      live = false
      off()
      if (idle) cancelIdleCallback(later as number)
      else clearTimeout(later)
    }
  }, [vault, store, sync])

  // A temporary door for the fixtures and the dev server (not in the real build): `__notecardsOpenSheet({ kind: 'page', path })`.
  useEffect(() => {
    if (import.meta.env.MODE === 'production') return
    ;(globalThis as { __notecardsOpenSheet?: typeof openSheet }).__notecardsOpenSheet = openSheet
  }, [])

  return vault !== null && stack.length > 0 ? <SheetLayer /> : null
}
