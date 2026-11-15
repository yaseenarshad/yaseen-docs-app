import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../app/AppState'
import { interceptBrowserBack } from '../app/browserHistory'
import { browserFacts, whereAmI } from '../pwa/homeScreen'
import { swipeIsOurs } from '../app/edgeSwipe'
import { useVaultData, type VaultData } from '../search/vaultData'
import { folderOf } from '../page/pageLook'
import { MenuTitle, isCut } from '../page/menuTitle'
import { countWords, linkCounts, type LinkCounts } from './linkCounts'
import { SheetContent, titleOf } from './SheetBody'
import { SHEET_MS } from './sheetDrag'
import { sheetMotion, type SheetMotion } from './sheetMotion'
import { MAX_MOUNTED, closeAll, closeTop, dropTop, keepScroll, setAnimatedClose, sheetStack, subscribeSheets, type Sheet, type SheetRoute } from './sheets'
import './explore.css'
import '../page/pageNav.css'

/**
 * THE SHEETS ON THE SCREEN (YAZ-5472), a chunk of its own: loaded on the first open, or when the app is idle.
 *
 * Over the whole app (the tabs too), in `document.body`: the screen under them stays as it is, mounted, at its scroll
 * place. Each sheet has its dim under it, so each sheet down the stack is a little darker, and the one under the top
 * sheet steps back (a little smaller, a little up), as on iOS. A tap on the dim above the top sheet closes it, as do a
 * drag down (`sheetMotion.ts`), the left-edge Back, and Escape. Only the top `MAX_MOUNTED` sheets are drawn; an older
 * one keeps its route and scroll place in the stack, and is drawn again when the stack comes back down to it.
 */
export default function SheetLayer() {
  const stack = useSyncExternalStore(subscribeSheets, sheetStack)
  const app = useApp()
  const mounted = stack.slice(-MAX_MOUNTED)
  const top = stack.at(-1)

  // Each sheet opened goes to this phone's Recent (YAZ-5457), as `go` records a page opened full screen.
  const recorded = useRef(new Set<number>())
  useEffect(() => {
    if (top === undefined || recorded.current.has(top.id)) return
    recorded.current.add(top.id)
    const { store } = app.services
    void import('../search/recent').then((m) => m.remember(store, app.vaultKey, top.route))
  }, [top, app.services, app.vaultKey])

  useEffect(() => {
    if (top === undefined) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeTop()
    document.addEventListener('keydown', onKey)
    // YAZ-5499: in a Safari tab, Safari's own back swipe closes the top sheet, as the app's swipe does in the Home Screen app.
    interceptBrowserBack(() => (closeTop(), true))
    return () => {
      document.removeEventListener('keydown', onKey)
      interceptBrowserBack(null)
    }
  }, [top])

  if (mounted.length === 0) return null
  return createPortal(
    <div className="explore-layer">
      {mounted.map((sheet, i) => (
        <SheetView key={sheet.id} sheet={sheet} level={i} depth={mounted.length - 1 - i} />
      ))}
    </div>,
    document.body,
  )
}

/** The sheet's head: the page's folder (as Mochi shows the deck), else its name. */
export function headWords(data: VaultData | null, route: SheetRoute): string {
  const folder = folderOf(route.path)
  if (route.kind === 'card' && data?.byPath[route.path]?.kind !== 'card') return titleOf(data, route.path)
  return folder === '' ? titleOf(data, route.path) : folder.split('/').join(' / ')
}

function SheetView({ sheet, level, depth }: { sheet: Sheet; level: number; depth: number }) {
  const app = useApp()
  const data = useVaultData()
  const box = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const dim = useRef<HTMLDivElement>(null)
  const motion = useRef<SheetMotion | null>(null)
  const [menu, setMenu] = useState(false)
  const [cut, setCut] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [cardText, setCardText] = useState<string | undefined>(undefined)
  const [counts, setCounts] = useState<LinkCounts | null>(null)
  const isTop = depth === 0
  const isNew = useRef(sheet.scroll === 0)

  // The top sheet's motion; the one under it gets it when the top one goes.
  useLayoutEffect(() => {
    if (!isTop || box.current === null || head.current === null || body.current === null || mark.current === null || dim.current === null) return
    const m = sheetMotion(
      { box: box.current, head: head.current, body: body.current, top: mark.current, dim: dim.current },
      { onClosed: dropTop, edge: swipeIsOurs(whereAmI(browserFacts())) },
    )
    motion.current = m
    if (isNew.current) m.open()
    isNew.current = false
    setAnimatedClose(() => m.close())
    box.current.focus({ preventScroll: true })
    return () => {
      setAnimatedClose(null)
      m.destroy()
      motion.current = null
    }
  }, [isTop])

  // Unmounted (more than `MAX_MOUNTED` sheets over it): its scroll place stays with its route.
  useLayoutEffect(() => {
    const el = body.current
    return () => {
      if (el !== null) keepScroll(sheet.id, el.scrollTop)
    }
  }, [sheet.id])

  // The counts after the slide up (the map of every link is built once for the vault's data).
  useEffect(() => {
    if (data === null) return
    const timer = setTimeout(() => setCounts(linkCounts(data, sheet.route, cardText)), isTop ? SHEET_MS : 0)
    return () => clearTimeout(timer)
  }, [data, sheet.route, cardText, isTop])

  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(timer)
  }, [toast])

  const restore = () => {
    if (sheet.scroll > 0 && body.current !== null) body.current.scrollTop = sheet.scroll
  }
  const full = () => {
    setMenu(false)
    closeAll()
    app.go({ type: 'open', route: sheet.route })
  }
  const copy = async () => {
    setMenu(false)
    try {
      await navigator.clipboard.writeText(sheet.route.path)
      setToast(`Copied: ${sheet.route.path}`)
    } catch {
      setToast(sheet.route.path)
    }
  }
  const route = sheet.route
  const title = route.kind === 'card' ? (data?.byPath[route.path]?.cards?.find((c) => c.id?.toLowerCase() === route.id.toLowerCase())?.title ?? '') || route.id : titleOf(data, route.path)
  const place = depth === 0 ? '' : depth === 1 ? ' explore-sheet--under' : ' explore-sheet--under explore-sheet--deep'
  return (
    <>
      <div ref={dim} className={isTop ? 'explore-dim explore-dim--top' : 'explore-dim'} style={{ zIndex: level * 2 }} onClick={isTop ? closeTop : undefined} aria-hidden="true" />
      <div className={`explore-sheet${place}`} style={{ zIndex: level * 2 + 1 }} aria-hidden={isTop ? undefined : true}>
        <div ref={box} className="explore-sheet__box" role="dialog" aria-modal={isTop} aria-label={title} tabIndex={-1}>
          <div ref={head} className="explore-sheet__head">
            <span className="explore-sheet__grab" aria-hidden="true" />
            <span className="explore-sheet__where">{headWords(data, sheet.route)}</span>
            <button type="button" className="explore-sheet__more" aria-label="More" aria-expanded={menu}
              onClick={() => {
                // YAZ-5498: measured once, as the menu opens: is the head's line cut ("…")?
                if (!menu) setCut(isCut(head.current?.querySelector('.explore-sheet__where')))
                setMenu(!menu)
              }}
            >
              ⋯
            </button>
            {menu && (
              <div className={cut ? 'explore-sheet__menu explore-sheet__menu--titled' : 'explore-sheet__menu'} role="menu">
                {cut && <MenuTitle title={title} path={route.path} />}
                <button type="button" role="menuitem" onClick={full}>
                  {app.unit('Open full page')}
                </button>
                <button type="button" role="menuitem" onClick={() => void copy()}>
                  Copy path
                </button>
                <button type="button" role="menuitem" onClick={closeTop}>
                  Close
                </button>
              </div>
            )}
          </div>
          <div ref={body} className="explore-sheet__body">
            <div ref={mark} className="explore-sheet__top" aria-hidden="true" />
            <SheetContent route={sheet.route} onDrawn={restore} onText={setCardText} />
          </div>
          <p className="explore-sheet__foot" aria-live="off">
            {counts === null ? ' ' : countWords(counts)}
          </p>
          {toast !== null && (
            <p className="page-toast explore-sheet__toast" role="status">
              {toast}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
