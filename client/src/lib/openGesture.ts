/**
 * The one open rule for a folder's Table and Board (YAZ-1557), mouse and keyboard alike:
 * plain → the current tab, ⌘ → a background tab (the app-wide I3 rule, GRO-2235), ⌥ → the right
 * panel. ⇧ is the selection gesture everywhere (YAZ-1336 🔒 D2) and ⌃ is unclaimed, so either
 * vetoes the open: the surface then does whatever a plain gesture does short of opening.
 */
export type OpenTarget = 'current' | 'background' | 'right'

/** Satisfied by React's mouse AND keyboard events, so a click and an Enter share one rule. */
export interface Modifiers {
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  ctrlKey: boolean
}

/** The prop names both views already carry; a surface without a pane simply omits its handler. */
export interface OpenHandlers {
  onOpenFile?: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
}

export function openTarget(e: Modifiers): OpenTarget | null {
  if (e.shiftKey || e.ctrlKey) return null
  if (e.metaKey) return 'background'
  if (e.altKey) return 'right'
  return 'current'
}

/** Open `path` where the gesture says; returns the target so a caller can react to "nothing". */
export function openByGesture(e: Modifiers, path: string, handlers: OpenHandlers): OpenTarget | null {
  const target = openTarget(e)
  if (target === 'background') handlers.onOpenFileBackground?.(path)
  else if (target === 'right') handlers.onOpenFileRight?.(path)
  else if (target === 'current') handlers.onOpenFile?.(path)
  return target
}

/**
 * Enter's open (YAZ-4605 D56): ⇧Enter opens the page in the folder page's mini window, or switches an open one to it;
 * every other Enter is `openByGesture`. A ⇧-click is not this: it stays the selection gesture.
 */
export function openByKey(e: Modifiers, path: string, handlers: OpenHandlers & { onOpenWindow?: (path: string) => void }): OpenTarget | 'window' | null {
  if (e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey) {
    handlers.onOpenWindow?.(path)
    return 'window'
  }
  return openByGesture(e, path, handlers)
}

/** Where a plain click on a Calendar or Board card opens (YAZ-5582): Settings › Folder pages, or the view's own choice. */
export type CardClick = 'window' | 'background'

/**
 * A click on a Calendar or Board card (YAZ-5582), the ONE rule both views use: a plain click opens the page where
 * `choice` says (the mini window or a background tab); the modifiers keep the open rule's meaning (⌘ a background
 * tab, ⌥ the right panel, ⇧ / ⌃ nothing). A host with no mini window opens a background tab instead.
 */
export function openCardByClick(e: Modifiers, path: string, choice: CardClick, handlers: Pick<OpenHandlers, 'onOpenFileRight' | 'onOpenFileBackground'> & { onOpenWindow?: (path: string) => void }): OpenTarget | 'window' | null {
  const target = openTarget(e)
  if (target === null) return null
  if (target === 'right') {
    handlers.onOpenFileRight?.(path)
    return 'right'
  }
  if (target === 'current' && choice === 'window' && handlers.onOpenWindow !== undefined) {
    handlers.onOpenWindow(path)
    return 'window'
  }
  handlers.onOpenFileBackground?.(path)
  return 'background'
}
