import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../app/AppState'
import { useMenuToggle } from '../app/menuToggle'
import { browserFacts, whereAmI } from '../pwa/homeScreen'
import { swipeIsOurs } from '../app/edgeSwipe'
import { useVaultData, type VaultData } from '../search/vaultData'
import { folderOf } from '../page/pageLook'
import { MenuTitle, isCut } from '../page/menuTitle'
import { useCopyPath } from '../screens/copyPath'
import { SheetContent, titleOf } from './SheetBody'
import { sheetMotion, type SheetMotion } from './sheetMotion'
import { MAX_MOUNTED, closeAll, closeTop, dropSheet, keepScroll, setAnimatedClose, sheetStack, subscribeSheets, type Sheet, type SheetRoute } from './sheets'
import './explore.css'
import '../page/pageNav.css'

/**
 * THE SHEETS ON THE SCREEN, a chunk of its own: loaded on the first open, or when the app is idle.
 *
 * Over the whole app (the tabs too), in `document.body`: the screen under them stays as it is, mounted, at its scroll
 * place. Each sheet has its dim under it, so each sheet down the stack is a little darker. YAZ-5540: a sheet never moves
 * for the sheets over it: no step back, no scale, on an open or a close (only the top sheet slides). Each sheet sits a
 * little lower than the one under it (`SHEET_STEP`, by its place in the whole stack, which never changes while it
 * lives), so the top edge of the one under shows above it, still. A tap on the dim above the top sheet closes it, as do a
 * drag down (`sheetMotion.ts`), the left-edge Back, and Escape. Only the top `MAX_MOUNTED` sheets are drawn; an older
 * one keeps its route and scroll place in the stack, and is drawn again when the stack comes back down to it.
 */
/** The steps down a sheet sits, at most: past it, a sheet sits where the one under it does. */
const SHEET_STEPS = 6

export default function SheetLayer() {
  const stack = useSyncExternalStore(subscribeSheets, sheetStack)
  const app = useApp()
  const mounted = stack.slice(-MAX_MOUNTED)
  const below = stack.length - mounted.length
  const top = stack.at(-1)

  // Each sheet opened goes to this phone's Recent, as `go` records a page opened full screen.
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
    // Safari's own Back in a tab closes the top sheet through its history entry (`sheets.ts`, `openOverlay`).
    return () => document.removeEventListener('keydown', onKey)
  }, [top])

  if (mounted.length === 0) return null
  return createPortal(
    <div className="explore-layer">
      {mounted.map((sheet, i) => (
        <SheetView key={sheet.id} sheet={sheet} level={i} depth={mounted.length - 1 - i} step={Math.min(below + i, SHEET_STEPS)} />
      ))}
    </div>,
    document.body,
  )
}

/** A card's text is not needed by the sheet (its old foot counted the card's links). */
const noText = () => {}

/** A folder's name: its `.folder.md`'s title, else its last part (the tree's row says the same). */
const folderName = (data: VaultData | null, dir: string): string => data?.folders.find((f) => f.folder === dir)?.title.trim() || dir.slice(dir.lastIndexOf('/') + 1)

/** The sheet's head: the page's folder (as Mochi shows the deck), else its name. */
export function headWords(data: VaultData | null, route: SheetRoute): string {
  // A folder's page: the folders it is in, else "Folder".
  if (route.kind === 'folder') return route.path.includes('/') ? folderOf(route.path).split('/').join(' / ') : 'Folder'
  const folder = folderOf(route.path)
  if (route.kind === 'card' && data?.byPath[route.path]?.kind !== 'card') return titleOf(data, route.path)
  return folder === '' ? titleOf(data, route.path) : folder.split('/').join(' / ')
}

function SheetView({ sheet, level, depth, step }: { sheet: Sheet; level: number; depth: number; step: number }) {
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
  const isTop = depth === 0
  const isNew = useRef(sheet.scroll === 0)
  // The ⋯ menu is an overlay of its own: a Back closes it, and the sheet stays. The app's one rule for menus: ⋯ again,
  // a tap outside (only that: the dim's tap leaves the sheet open), Escape or Back closes it.
  useMenuToggle(menu, () => setMenu(false), (target) => head.current?.querySelector('.explore-sheet__more')?.contains(target) === true || head.current?.querySelector('.explore-sheet__menu')?.contains(target) === true)

  // The top sheet's motion; the one under it gets it when the top one goes.
  useLayoutEffect(() => {
    if (!isTop || box.current === null || head.current === null || body.current === null || mark.current === null || dim.current === null) return
    const m = sheetMotion(
      { box: box.current, head: head.current, body: body.current, top: mark.current, dim: dim.current },
      { onClosed: () => dropSheet(sheet.id), edge: swipeIsOurs(whereAmI(browserFacts())) },
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

  const restore = () => {
    if (sheet.scroll > 0 && body.current !== null) body.current.scrollTop = sheet.scroll
  }
  const full = () => {
    setMenu(false)
    closeAll()
    app.go({ type: 'open', route: sheet.route })
  }
  const { copyPath, layer } = useCopyPath()
  const copy = async () => {
    setMenu(false)
    await copyPath(sheet.route.path)
  }
  const route = sheet.route
  const title = route.kind === 'folder' ? folderName(data, route.path) : route.kind === 'card' ? (data?.byPath[route.path]?.cards?.find((c) => c.id?.toLowerCase() === route.id.toLowerCase())?.title ?? '') || route.id : titleOf(data, route.path)
  const place = depth === 0 ? '' : depth === 1 ? ' explore-sheet--under' : ' explore-sheet--under explore-sheet--deep'
  return (
    <>
      <div ref={dim} className={isTop ? 'explore-dim explore-dim--top' : 'explore-dim'} style={{ zIndex: level * 2 }} onClick={isTop ? closeTop : undefined} aria-hidden="true" />
      <div className={`explore-sheet${place}`} style={{ zIndex: level * 2 + 1, '--sheet-step': step } as CSSProperties} aria-hidden={isTop ? undefined : true}>
        <div ref={box} className="explore-sheet__box" role="dialog" aria-modal={isTop} aria-label={title} tabIndex={-1}>
          <div ref={head} className="explore-sheet__head">
            <span className="explore-sheet__grab" aria-hidden="true" />
            <span className="explore-sheet__where">{headWords(data, sheet.route)}</span>
            <button type="button" className="explore-sheet__more" aria-label="More" aria-expanded={menu}
              onClick={() => {
                // Measured once, as the menu opens: is the head's line cut ("…")?
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
            {/* No sticky foot; a page's "Linked mentions" is at the end of its text (`SheetPage`), and scrolls. */}
            <SheetContent route={sheet.route} onDrawn={restore} onText={noText} />
          </div>
          {layer}
        </div>
      </div>
    </>
  )
}
