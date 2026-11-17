import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../app/AppState'
import { useOverlay } from '../app/browserHistory'
import { openFile } from '../explore/openFile'
import { useCopyPath } from '../screens/copyPath'

/**
 * HOLD A FOLDER: in Search's tree, Favorites and Focus, a finger held on a folder row for `HOLD_MS` opens a
 * small menu: "Open folder page" (the folder's page and its views, read only, through the one file door `openFile`, so
 * the vault's "Clicking a link" says sheet or full screen) and "Copy path". A tap still opens or closes the folder: a
 * hold that fired eats the click that follows it. The row shows it is pressed (`data-pressing`, `search.css`) while
 * the finger stays. A finger that moves (a scroll) is no hold. The lift of the finger that opened the menu is no tap on
 * it (`eatLiftClick`, M4). In the search chunk: the first load does not carry it.
 */

/** How long a finger stays on a row before its menu opens (ms). */
export const HOLD_MS = 450
/** A finger that moves farther than this (px) scrolls: no hold. */
const SLOP = 10
/** After the finger that opened the menu lifts, a click this soon (ms) is that lift's own click, not a tap (M4). */
export const LIFT_GUARD_MS = 400

/**
 * M4 (sweep1): the menu opens while the finger is still down, over the row. When it lifts, the phone sends the click
 * of that touch where the finger was: on the menu's dim (or an item), which closed the menu at once. The lift
 * (pointerup, touchend or a cancel) always comes before its click: the first click in the `LIFT_GUARD_MS` after it is
 * eaten, in the capture phase, before the dim or an item sees it. A phone that sends no click after a long press loses
 * nothing: the guard ends by itself. Returns the guard's end.
 */
function eatLiftClick(): () => void {
  let until = Infinity
  let timer = 0
  const lifts = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const
  const end = () => {
    clearTimeout(timer)
    document.removeEventListener('click', onClick, true)
    for (const type of lifts) document.removeEventListener(type, onLift, true)
  }
  const onLift = () => {
    if (until !== Infinity) return
    until = Date.now() + LIFT_GUARD_MS
    timer = window.setTimeout(end, LIFT_GUARD_MS)
  }
  const onClick = (e: MouseEvent) => {
    if (until === Infinity) return
    end()
    if (Date.now() > until) return
    e.preventDefault()
    e.stopPropagation()
  }
  document.addEventListener('click', onClick, true)
  for (const type of lifts) document.addEventListener(type, onLift, true)
  return end
}

/** The props a folder row takes for the hold, by its folder path. */
export type HoldProps = {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void
  onPointerUp(): void
  onPointerCancel(): void
  onPointerLeave(): void
  onClickCapture(e: SyntheticEvent): void
  onContextMenu(e: SyntheticEvent): void
}

/** The hold of folder rows: `hold(path, label)` gives a row its props; `layer` is the menu, drawn over the screen. */
export function useFolderHold(): { hold: (path: string, label: string) => HoldProps; layer: ReactNode } {
  const press = useRef<{ timer: number; x: number; y: number; el: HTMLElement } | null>(null)
  const held = useRef(false)
  const liftGuard = useRef<(() => void) | null>(null)
  const [menu, setMenu] = useState<{ path: string; label: string } | null>(null)
  const stop = () => {
    const p = press.current
    if (p === null) return
    clearTimeout(p.timer)
    p.el.removeAttribute('data-pressing')
    press.current = null
  }
  useEffect(
    () => () => {
      stop()
      liftGuard.current?.()
    },
    [],
  )
  const hold = (path: string, label: string): HoldProps => ({
    onPointerDown(e) {
      if (e.button !== 0) return
      stop()
      held.current = false
      const el = e.currentTarget
      el.setAttribute('data-pressing', '')
      const timer = window.setTimeout(() => {
        stop()
        held.current = true
        liftGuard.current?.()
        liftGuard.current = eatLiftClick()
        setMenu({ path, label })
      }, HOLD_MS)
      press.current = { timer, x: e.clientX, y: e.clientY, el }
    },
    onPointerMove(e) {
      const p = press.current
      if (p !== null && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) stop()
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onClickCapture(e) {
      if (!held.current) return
      held.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    // The phone's own long-press menu (a link's, Android's) never shows over ours.
    onContextMenu: (e) => e.preventDefault(),
  })
  const close = () => {
    liftGuard.current?.()
    liftGuard.current = null
    setMenu(null)
  }
  // "Copy path" closes the menu; its toast, or the path to copy by hand, stays over Search (`useCopyPath`).
  const { copyPath, layer: copied } = useCopyPath()
  const copy = (path: string) => {
    close()
    void copyPath(path)
  }
  return {
    hold,
    layer: (
      <>
        {menu !== null && <FolderMenu folder={menu} onClose={close} onCopy={copy} />}
        {copied}
      </>
    ),
  }
}

/** The folder's menu, at the bottom of the screen over a dim, as the phone's own action sheets. */
function FolderMenu({ folder, onClose, onCopy }: { folder: { path: string; label: string }; onClose(): void; onCopy(path: string): void }) {
  const app = useApp()
  const first = useRef<HTMLButtonElement>(null)
  // An overlay of the app's one stack: a Back closes the menu, and Search stays.
  useOverlay(true, onClose)
  useEffect(() => {
    first.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const open = () => {
    onClose()
    // From Search, a tab screen, so ALWAYS a full page; its rows then open panels (`from: 'inside'`).
    openFile(app, { kind: 'folder', path: folder.path }, { from: 'tab' })
  }
  return createPortal(
    <div className="hold-menu">
      <div className="hold-menu__dim" onClick={onClose} aria-hidden="true" />
      <div className="hold-menu__sheet" role="menu" aria-label={folder.label}>
        <p className="hold-menu__title">{folder.label}</p>
        <button ref={first} type="button" role="menuitem" className="hold-menu__item" onClick={open}>
          Open folder page
        </button>
        <button type="button" role="menuitem" className="hold-menu__item" onClick={() => onCopy(folder.path)}>
          Copy path
        </button>
        <button type="button" role="menuitem" className="hold-menu__item hold-menu__item--cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
