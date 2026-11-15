import { lazy, Suspense, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from '../app/browserHistory'
import { useMenuToggle } from '../app/menuToggle'
import { useCopyPath } from '../screens/copyPath'
import { MenuTitle, isCut } from './menuTitle'
import type { PageFolds } from './folds'
import './find/pageTools.css'

/**
 * THE PAGE'S TOOLS: one "⋯" in the top bar opens a small menu, "Find in page" and "Headings". Each loads its
 * own chunk only when it is first used (`find/FindBar.tsx`, `find/HeadingsSheet.tsx`): an open page costs nothing more.
 *
 * Why a ⋯ and not a 🔍: the top bar holds Back, the kind icon, the title, the ID chip, the dot and the ⚙ on a 375 pt
 * screen; one more 44 pt button is all it has room for, and the page has two tools (and a Comment button is coming).
 * Safari keeps "Find on Page" in a menu too.
 *
 * The find bar shows under the top bar (the frame's line for a notice), so the page's text stays in view; the headings
 * list is a sheet from the bottom, over the page, closed by a tap outside it, ✕ or Escape.
 *
 * The sheet is drawn in the FRAME (`.app`, `overFrame`), not in the page. The page's scroll box
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
 * The same ⋯ for a card's own view: "Find in card" (`find`); a card has no headings (`headings: false`). `label` names
 * the button and menu. The card's actions are on the card's own ⋯, on its head, not here.
 */
export interface ToolsFor {
  title: string
  path: string
  drawing?: boolean
  label?: string
  find?: string
  headings?: boolean
  /** YAZ-5568: the page's folds (none: the page does not fold, `folding: false`, a card): "Collapse all" / "Expand all". */
  folds?: PageFolds | null
  /**
   * YAZ-5568: the page's own "Folding" (the Mac's page cog row, `folding: true | false` in its frontmatter): "Folding on
   * this page", a check row; none: the phone cannot write this page (no comments path, a card).
   */
  folding?: { on: boolean; set(on: boolean): void } | null
  /**
   * YAZ-5591: the page's own "Sticky headings" (`sticky-headings: true | false` in its frontmatter, the phone's own key):
   * "Sticky headings on this page", a check row; none: the phone cannot write this page.
   */
  sticky?: { on: boolean; set(on: boolean): void } | null
}

/** The Mac's fold-all icons (`FoldAllButton.tsx`'s shape): two chevrons up to collapse, down to expand. */
const foldAllIcon = (collapse: boolean) => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={collapse ? 'M4.5 7 8 4l3.5 3M4.5 12 8 9l3.5 3' : 'M4.5 4 8 7l3.5-3M4.5 9 8 12l3.5-3'} />
  </svg>
)

export function usePageTools(host: RefObject<HTMLElement | null>, file: ToolsFor): { button: ReactNode; bar: ReactNode; sheet: ReactNode } {
  const { label = 'Page tools', find = 'Find in page', headings = true } = file
  const [menu, setMenu] = useState(false)
  const [tool, setTool] = useState<PageTool>(null)
  const [cut, setCut] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // The open tool is an overlay: a Back closes it, and the page stays. The menu: the app's one rule for menus: ⋯
  // again, a tap outside (only that), Escape or Back closes it.
  useOverlay(tool !== null, () => setTool(null))
  useMenuToggle(menu, () => setMenu(false), (target) => box.current?.contains(target) === true)
  const pick = (next: PageTool) => {
    setMenu(false)
    setTool(next)
  }
  // Measured once, as the menu opens: is the top bar's title cut ("…")?
  const toggle = () => {
    if (!menu) setCut(isCut(box.current?.closest('.topbar')?.querySelector('.topbar__title')))
    setMenu(!menu)
  }
  // Read as the menu draws (it draws again each time it opens).
  const foldNext = menu && file.folds != null ? file.folds.next() : 'none'
  const foldAll = () => {
    setMenu(false)
    file.folds?.setAll(foldNext === 'collapse')
  }
  const folding = () => {
    setMenu(false)
    file.folding?.set(!file.folding.on)
  }
  const sticky = () => {
    setMenu(false)
    file.sticky?.set(!file.sticky.on)
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
              {/* YAZ-5568: the Mac's fold-all button's rule: Collapse all while anything is open, else Expand all. */}
              {foldNext !== 'none' && (
                <button type="button" role="menuitem" className="page-tools__item" onClick={foldAll}>
                  <span aria-hidden="true" className="page-tools__icon">
                    {foldAllIcon(foldNext === 'collapse')}
                  </span>{' '}
                  {foldNext === 'collapse' ? 'Collapse all' : 'Expand all'}
                </button>
              )}
              {menu && file.folding != null && (
                <button type="button" role="menuitemcheckbox" aria-checked={file.folding.on} className="page-tools__item" onClick={folding}>
                  <span aria-hidden="true" className="page-tools__icon">
                    {file.folding.on ? '✓' : ''}
                  </span>{' '}
                  Folding on this page
                </button>
              )}
              {menu && file.sticky != null && (
                <button type="button" role="menuitemcheckbox" aria-checked={file.sticky.on} className="page-tools__item" onClick={sticky}>
                  <span aria-hidden="true" className="page-tools__icon">
                    {file.sticky.on ? '✓' : ''}
                  </span>{' '}
                  Sticky headings on this page
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
 * A sheet or a panel over the whole screen goes in the frame (`.app`: the top bar, the screen, the page
 * arrows, the tab bar), after them, so that its `position: fixed` and `z-index` are the screen's and nothing at the
 * bottom paints over it; never inside the page's masked scroll box. The frame is `from`'s (else the document's body).
 */
export function overFrame(from: Element | null, sheet: ReactNode): ReactNode {
  return createPortal(sheet, from?.closest('.app') ?? document.body)
}
