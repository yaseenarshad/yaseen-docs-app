import { useEffect } from 'react'
import { flushSync } from 'react-dom'
import type { AppModel } from '../app/AppState'
import type { Route } from '../app/nav'
import { dropAllTexts, dropText, heldText } from '../page/heldText'
import { CardView, PageView } from '../screens/PageScreen'
import type { VaultStore } from '../store'
import { preloadSheets } from './sheets'

/**
 * YAZ-5589: ANY PAGE OPENS AT ONCE, drawn: from Search, Recent, Favorites, Focus, a link, a panel, the page arrows, a
 * card file. Before, a tap showed the empty waiting screen while the page view's chunk loaded, then the page's bars
 * with no text while it read its text, the vault's data and look, and warmed the Markdown renderer: the "flash" and the
 * "refresh" look of every open.
 *
 * Now (`openFile` and the arrows go through `whenReady`):
 *  - once the app is idle after its start, the reader is read AHEAD (`useReaderAhead`): the page view's and the card
 *    view's chunks, the panels' chunk, the vault's data and look, the renderer's warm-up;
 *  - a page on the screen reads ahead the pages its arrows and its first links open (`readAheadPaths`);
 *  - a tap whose page is read (its text held: `heldText.ts`) opens it in the SAME frame; any other keeps the screen
 *    under (no empty screen) while its text is read, a few ms, then opens it drawn, in one frame (at most `WAIT` ms).
 */
interface Reader {
  vault: string
  store: VaultStore
  repoName: string
}
let reader: Reader | null = null
/** The vault whose data, look and renderer are read ahead (`warmPage`); a page then only needs its text. */
let warmVault: string | null = null
/** The longest a tap keeps the screen under while its page is read: then it opens anyway (it reads the rest itself). */
export const WAIT = 400

const pageChunk = () => PageView.preload().then(() => import('../page/PageView'))
const routePath = (route: Route): string | null => (route.kind === 'page' || route.kind === 'card' ? route.path : null)

/** The data, the look, the renderer of `vault`, and the chunks: read once (again after another vault opens). */
function warm(r: Reader): Promise<void> {
  return Promise.all([pageChunk(), CardView.preload(), preloadSheets()])
    .then(([m]) => m.warmPage(r.store, r.vault, r.repoName))
    .then(() => {
      if (reader === r) warmVault = r.vault
    })
}

/** Reads `paths` ahead (their stored text), with the reader warm. */
export function readAheadPaths(vault: string, paths: readonly string[]): Promise<void> {
  const r = reader
  if (r === null || r.vault !== vault) return Promise.resolve()
  const todo = paths.filter((p) => heldText(vault, p) === undefined)
  return warm(r)
    .then(() => pageChunk())
    .then((m) => Promise.all(todo.map((p) => m.primePage(r.store, vault, r.repoName, p))))
    .then(
      () => undefined,
      () => undefined,
    )
}

/** Everything `route` needs to draw in its first frame is on hand. */
export function isReady(vault: string | null, route: Route): boolean {
  const path = routePath(route)
  if (path === null) return true
  return vault !== null && warmVault === vault && heldText(vault, path) !== undefined
}

let latest = 0
/** The longest a tap waits for a screen's chunk (on the phone it is cached: a few ms); then the screen opens anyway. */
const CHUNK_WAIT = 3000
/**
 * Opens `route` with `open`: now when it is read ahead; else once its screen's chunk is loaded and its text is read
 * (at most `WAIT` ms for the text), the screen under staying until then (a newer tap wins). Another kind of screen (a
 * folder, a drawing, Settings) opens now.
 */
export function whenReady(vault: string | null, route: Route, open: () => void): void {
  const mine = ++latest
  const path = routePath(route)
  if (path === null || vault === null || reader?.vault !== vault || isReady(vault, route)) return open()
  let done = false
  const go = () => {
    if (done || mine !== latest) return
    done = true
    // In one step: the screen, its text drawn (the page's effects run before the browser paints).
    flushSync(open)
  }
  const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  setTimeout(go, CHUNK_WAIT)
  const chunk = route.kind === 'card' ? CardView.preload() : pageChunk()
  void Promise.all([chunk, preloadSheets()])
    .then(() => Promise.race([readAheadPaths(vault, [path]), later(WAIT)]))
    .then(go, go)
}

/** The shell: the open vault's reader, read ahead once the app is idle after its start (and after a sync change). */
export function useReaderAhead(app: Pick<AppModel, 'phase' | 'vaultKey' | 'vault' | 'services'>): void {
  const vault = app.phase === 'ready' ? app.vaultKey : null
  const repoName = app.vault?.repo.split('/')[1] ?? ''
  const { store, sync } = app.services
  useEffect(() => {
    if (vault === null) return
    const r: Reader = { vault, store, repoName }
    reader = r
    if (warmVault !== vault) warmVault = null
    const idle = typeof requestIdleCallback === 'function'
    const ahead = () => void warm(r).catch(() => {})
    const later = idle ? requestIdleCallback(ahead, { timeout: 2500 }) : setTimeout(ahead, 600)
    // A text read ahead that the sync changed is read again at the next open (never drawn old, then new).
    const off = sync.subscribe((event) => {
      if (event.type !== 'changed' || event.vault !== vault) return
      const diff = event.diff
      if (diff == null) return dropAllTexts()
      for (const path of [...diff.changed, ...diff.removed, ...diff.renamed.map((n) => n.from)]) dropText(vault, path)
    })
    return () => {
      off()
      if (reader === r) reader = null
      if (idle) cancelIdleCallback(later as number)
      else clearTimeout(later)
    }
  }, [vault, store, sync, repoName])
}
