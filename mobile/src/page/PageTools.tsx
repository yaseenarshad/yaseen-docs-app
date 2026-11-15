import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from '../app/browserHistory'
import { useCopyPath } from '../screens/copyPath'
import { MenuTitle, isCut } from './menuTitle'
import './find/pageTools.css'

/**
 * THE PAGE'S TOOLS (YAZ-5456): one "⋯" in the top bar opens a small menu, "Find in page" and "Headings". Each loads its
 * own chunk only when it is first used (`find/FindBar.tsx`, `find/HeadingsSheet.tsx`): an open page costs nothing more.
 *
 * Why a ⋯ and not a 🔍: the top bar holds Back, the kind icon, the title, the ID chip, the dot and the ⚙ on a 375 pt
 * screen; one more 44 pt button is all it has room for, and the page has two tools (and a Comment button is coming).
 * Safari keeps "Find on Page" in a menu too.
 *
 * The find bar shows under the top bar (the frame's line for a notice), so the page's text stays in view; the headings
 * list is a sheet from the bottom, over the page, closed by a tap outside it, ✕ or Escape.
 *
 * YAZ-5497: the sheet is drawn in the FRAME (`.app`, `overFrame`), not in the page. The page's scroll box
 * (`.screen--reader`) has a soft fade at its bottom, a `mask-image`: a masked element clips all it holds, a fixed child
 * too, and is a stacking context, so a sheet in it was cut off at the box's end and faded, under the page arrows and the
 * tab bar whatever its `z-index`.
 */
const FindBar = lazy(() => import('./find/FindBar'))
const HeadingsSheet = lazy(() => import('./find/HeadingsSheet'))

export type PageTool = 'find' | 'headings' | null

/**
 * The open file the ⋯ is for. YAZ-5498: when the top bar cuts its title, the menu shows `title` whole, and the folder
 * of `path`. A page, a card and a card file have the two tools; a drawing (no text to find, no headings) has "Copy path".
 *
 * YAZ-5504: the same ⋯ for a card's own view: `section` puts the card actions first (a section of rows, closed with
 * `close`), then "Find in card" (`find`); a card has no headings (`headings: false`). `label` names the button and menu.
 */
export interface ToolsFor {
  title: string
  path: string
  drawing?: boolean
  label?: string
  find?: string
  headings?: boolean
  section?: (close: () => void) => ReactNode
}

export function usePageTools(host: RefObject<HTMLElement | null>, file: ToolsFor): { button: ReactNode; bar: ReactNode; sheet: ReactNode } {
  const { label = 'Page tools', find = 'Find in page', headings = true, section } = file
  const [menu, setMenu] = useState(false)
  const [tool, setTool] = useState<PageTool>(null)
  const [cut, setCut] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // YAZ-5518: the menu and the open tool are overlays: a Back closes them, one at a time, and the page stays.
  useOverlay(menu, () => setMenu(false))
  useOverlay(tool !== null, () => setTool(null))
  useEffect(() => {
    if (!menu) return
    const away = (e: Event) => {
      if (!(e.target instanceof Node) || box.current?.contains(e.target) !== true) setMenu(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [menu])
  const pick = (next: PageTool) => {
    setMenu(false)
    setTool(next)
  }
  // YAZ-5498: measured once, as the menu opens: is the top bar's title cut ("…")?
  const toggle = () => {
    if (!menu) setCut(isCut(box.current?.closest('.topbar')?.querySelector('.topbar__title')))
    setMenu(!menu)
  }
  const { copyPath, layer } = useCopyPath()
  const copy = async () => {
    setMenu(false)
    await copyPath(file.path)
  }
  const button = (
    <div className="page-tools" ref={box}>
      <button type="button" className="icon-btn page-tools__btn" aria-label={label} aria-haspopup="menu" aria-expanded={menu} onClick={toggle}>
        ⋯
      </button>
      {menu && (
        <div className={cut ? 'page-tools__menu page-tools__menu--titled' : 'page-tools__menu'} role="menu" aria-label={label}>
          {cut && <MenuTitle title={file.title} path={file.path} />}
          {section !== undefined && (
            <>
              {section(() => setMenu(false))}
              <hr className="page-tools__line" />
            </>
          )}
          {file.drawing === true ? (
            <button type="button" role="menuitem" className="page-tools__item" onClick={() => void copy()}>
              <span aria-hidden="true">⧉</span> Copy path
            </button>
          ) : (
            <>
              <button type="button" role="menuitem" className="page-tools__item" onClick={() => pick('find')}>
                <span aria-hidden="true">🔍</span> {find}
              </button>
              {headings && (
                <button type="button" role="menuitem" className="page-tools__item" onClick={() => pick('headings')}>
                  <span aria-hidden="true">☰</span> Headings
                </button>
              )}
            </>
          )}
        </div>
      )}
      {layer}
    </div>
  )
  const close = () => setTool(null)
  return {
    button,
    bar: tool === 'find' && (
      <Suspense fallback={<div className="find-line find-line--wait" aria-busy="true" />}>
        <FindBar host={host} onClose={close} />
      </Suspense>
    ),
    sheet:
      tool === 'headings' &&
      overFrame(
        host.current,
        <Suspense fallback={null}>
          <HeadingsSheet host={host} onClose={close} />
        </Suspense>,
      ),
  }
}

/**
 * YAZ-5497: a sheet or a panel over the whole screen goes in the frame (`.app`: the top bar, the screen, the page
 * arrows, the tab bar), after them, so that its `position: fixed` and `z-index` are the screen's and nothing at the
 * bottom paints over it; never inside the page's masked scroll box. The frame is `from`'s (else the document's body).
 */
export function overFrame(from: Element | null, sheet: ReactNode): ReactNode {
  return createPortal(sheet, from?.closest('.app') ?? document.body)
}
