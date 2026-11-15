/**
 * A board layer of the explore stack (YAZ-4943): a drawing (Excalidraw) or a diagram (draw.io), for READING only.
 * The body is the board embed's own view-only window (`editor/embed/boardWindow.ts`) in its `fill` mode: it fills
 * the layer, fitted on open; the wheel, a drag, ⌘ + the wheel and the window's zoom % pan and zoom freely; nothing is
 * ever written (no `onOptions`). A diagram's pages are tabs under the board. A click on a link of the board (its
 * pills, a shape's link) opens that page on top, as a page layer's links do. No Edit, no E, no page zoom pill: ↗
 * (or ⌘↵) opens the board in a tab to edit it. No "Reading" label (YAZ-4944): a board layer only reads. The window loads the board's picture once; a covered layer keeps it.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { fileKind } from '@shared/fileKind'
import type { ZoomStep } from '@shared/types'
import { api } from '../api'
import type { DiagramPageRef } from '../diagrams/renderDiagram'
import type { BoardLinkSpot } from '../editor/embed/boardLinks'
import { loadBoardWindow, type BoardWindowHandle } from '../editor/embed/types'
import { hrefTarget } from '../editor/pathPaste'
import { linkPath } from '../editor/wikilink/wikilinkPlugin'
import { usePageId } from '../search/showIds'
import { ExploreSteps, keepFocus, openRows, stepRows, type ExploreVault, type LayerSteps } from './ExplorePage'
import { HeadMore, useCompactHead } from './ExploreHeadMore'
import { PAGE_WIDTH } from './layers'
import { withKeys } from '@shared/keyLabel'

interface ExploreBoardProps {
  path: string
  title: string
  /** YAZ-4940: the vault's "Show IDs in the title"; On draws the board's ID after the title. */
  idInTitle?: boolean
  vault: ExploreVault
  /** ‹ › (round 3): a board opened from a search steps through its rows, as a page does. */
  steps?: LayerSteps
  /** A link on the board to a page of the window's vaults: a page or a board goes on top; another file opens in a tab. */
  onOpenLink: (path: string) => void
  onNotice: (message: string) => void
  onHeadDown?: (event: ReactMouseEvent) => void
  onHeadReset?: (event: ReactMouseEvent) => void
  onOpenInTab: () => void
  onHeadMenu: (x: number, y: number) => void
  onClose: () => void
  /** The stack's ⌘+ / ⌘− / ⌘0 reach the board's own zoom while this layer is in front: the layer hands its door. */
  registerZoom: (zoom: ((step: ZoomStep) => void) | null) => void
  /** This layer is the front one: the board takes the keyboard, so Esc, ⌘↵ and the board's keys are heard. */
  active: boolean
}

/** The board's name with no folders and no board extension (the window's `ref.name`). */
const boardName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(excalidraw|drawio)$/i, '')

/** A link that names a scheme (`https:`, `mailto:`) goes to the system; anything else is read as a path of the vault. */
const WEB = /^[a-z][a-z0-9+.-]*:/i

const NO_PAGES: { list: readonly DiagramPageRef[]; page: string | null } = { list: [], page: null }

export function ExploreBoard({ path, title, idInTitle = false, vault, steps, onOpenLink, onNotice, onHeadDown, onHeadReset, onOpenInTab, onHeadMenu, onClose, registerZoom, active }: ExploreBoardProps) {
  const pageId = usePageId(idInTitle ? vault.wikilinks : undefined, path)
  const boxRef = useRef<HTMLDivElement>(null)
  // A head narrower than it needs folds into ⋯ (YAZ-4956).
  const headRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  useCompactHead(headRef, titleRef)
  const handle = useRef<BoardWindowHandle | null>(null)
  const [pages, setPages] = useState(NO_PAGES)
  const [failed, setFailed] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active
  // The doors, read at the click: the window is made once per board, and the stack's callbacks may change identity.
  const doors = useRef({ onOpenLink, onNotice, vault })
  doors.current = { onOpenLink, onNotice, vault }

  const { root } = vault
  useEffect(() => {
    const box = boxRef.current
    if (box === null) return
    let live = true
    let win: BoardWindowHandle | null = null
    setPages(NO_PAGES)
    setFailed(false)
    /** A link of the board: a `[[link]]` resolves as the vault's pills do; an address goes to the system or the vault. */
    const open = (spot: BoardLinkSpot): void => {
      const { vault: v, onOpenLink: go, onNotice: say } = doors.current
      if (spot.wiki) {
        const target = linkPath(spot.inner, v.wikilinks, v.viewOnlyLinks)
        if (target === null) say(`"${spot.inner}" is not in this vault`)
        else go(target)
        return
      }
      const inApp = WEB.test(spot.inner) ? null : hrefTarget(spot.inner, { root: v.root, pagePath: path, candidates: v.wikilinkCandidates })
      if (inApp !== null) go(inApp)
      else void api.shell.openLink({ href: spot.inner, sourcePath: path })
    }
    void loadBoardWindow().then(
      (mod) => {
        if (!live) return
        try {
          win = mod.mountBoardWindow({
            ref: { root, path, kind: fileKind(path) === 'diagram' ? 'diagram' : 'drawing', name: boardName(path), vault: null },
            options: null,
            // Reading only: never locked here (`fill`), and with no `onOptions` nothing is ever written.
            editable: false,
            fill: true,
            columnWidth: () => box.clientWidth || PAGE_WIDTH,
            scrollRoot: null,
            onLink: open,
            onPages: (list, page) => setPages((prev) => (prev.list === list && prev.page === page ? prev : { list, page })),
          })
        } catch {
          setFailed(true)
          return
        }
        box.replaceChildren(win.dom)
        handle.current = win
        // Selected: the window's own keys (⌘+ ⌘− ⌘0, Shift+1) work while it has the keyboard.
        win.setSelected(true)
        if (activeRef.current) win.dom.focus({ preventScroll: true })
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
      handle.current = null
      win?.destroy()
      win?.dom.remove()
    }
  }, [path, root])

  // The front layer's board takes the keyboard; a layer uncovered again takes it back.
  useEffect(() => {
    if (active) handle.current?.dom.focus({ preventScroll: true })
  }, [active])

  // ⌘+ / ⌘− / ⌘0 of the menu (the stack catches them first): the board's own zoom, at its centre.
  useEffect(() => {
    registerZoom((step) => {
      const key = step === 0 ? '0' : step > 0 ? '=' : '-'
      handle.current?.handleKey(new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true }))
    })
    return () => registerZoom(null)
  }, [registerZoom])

  return (
    <>
      <div
        ref={headRef}
        className="explore__head"
        onMouseDown={onHeadDown}
        onDoubleClick={onHeadReset}
        onContextMenu={(e) => {
          e.preventDefault()
          onHeadMenu(e.clientX, e.clientY)
        }}
      >
        <span ref={titleRef} className="explore__title" title={path}>
          {title}
        </span>
        {pageId !== undefined && <span className="explore__id">{pageId}</span>}
        {/* The parts a narrow layer folds into ⋯ one by one (YAZ-4956, YAZ-4986), the ID stays; `display: contents`, so a wide head is laid out as before. */}
        <span className="explore__fold">
          {steps !== undefined && <ExploreSteps steps={steps} />}
          <button type="button" className="explore__button" data-fold-part="open" onMouseDown={keepFocus} onClick={onOpenInTab} title={withKeys('Open in a tab to edit it, and close the stack', '⌘↵')} aria-label="Open in a tab">
            ↗
          </button>
        </span>
        <HeadMore sections={() => [steps === undefined ? [] : stepRows(steps), openRows(onOpenInTab, pageId, onNotice)]} />
        <button type="button" className="explore__button" onMouseDown={keepFocus} onClick={onClose} title="Close this layer (Esc)" aria-label="Close this layer">
          ×
        </button>
      </div>
      <div className="explore__body explore__body--board" data-explore-board>
        {failed && <p className="editor-msg">Can&apos;t show &quot;{title}&quot;</p>}
        {/* The window's own element goes in here (not React's). */}
        <div ref={boxRef} className="explore__board" />
        {/* A diagram's pages (draw.io's tabs): a click shows that page, fitted; nothing is written. */}
        {pages.list.length >= 2 && (
          <div className="explore__pages" role="tablist" aria-label="Pages">
            {pages.list.map((p, i) => {
              const on = p.id === (pages.page ?? pages.list[0].id) || (pages.page === null && i === 0)
              return (
                <button key={p.id} type="button" role="tab" className="explore__page" aria-selected={on} title={p.name} onMouseDown={keepFocus} onClick={() => handle.current?.showPage(p.id)}>
                  {p.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
