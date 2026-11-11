/**
 * THE BOARD WINDOW'S CONTRACT (YAZ-4820): what a host (the note's `![[…]]` decorations, 2A; the image node view, 2B)
 * gives a window, and what the window gives back. The window (`boardWindow.ts`, 1B) knows nothing about ProseMirror;
 * a host knows nothing about pan, zoom or pictures. This file is types only, so a host can import it eagerly while the
 * window itself stays in a lazy chunk (`loadBoardWindow`).
 */
import type { EmbedOptions } from '@shared/embedOptions'

export type BoardKind = 'drawing' | 'diagram'

/** Which board a window shows. `path` is null when the link does not resolve (the "Missing …" state, item 22). */
export interface BoardRef {
  /** The vault root the board loads from (`drawing.load` / `diagram.load`). */
  root: string | null
  /** Vault-relative or absolute under `root`; null = not found. */
  path: string | null
  kind: BoardKind
  /** What the name pill and the missing state say: the board's name with no folders and no extension. */
  name: string
  /** The vault's name when the board is in another vault of the window (the pill's "(Engineer Skills)"), else null. */
  vault: string | null
  /** The pill icon's attributes (`LinkLook.icon`), absent → the kind's plain icon. */
  icon?: Record<string, string>
}

export type OpenHow = 'thisTab' | 'backgroundTab'

/** A host's side of one window. Every callback is optional where a host may not offer it (a read-only note, say). */
export interface BoardWindowHost {
  ref: BoardRef
  /** The options as the text holds them now; null = none written yet (the window fits, at the default size). */
  options: EmbedOptions | null
  /** False in a read-only note (item 24): pan and zoom work, nothing is reported to write, no handles. */
  editable: boolean
  /** The editor column's width in CSS px: the widest a window may be, and a new window's width (D11). */
  columnWidth: () => number
  /** The window moved, resized, locked or changed page. The host writes it (D4); the window already shows it. */
  onOptions?: (next: EmbedOptions) => void
  /** Double-click, or a click on the hover name pill (D12, item 6). */
  onOpen?: (how: OpenHow) => void
  /** Right-click (D12): the host builds the pill's rows and adds `BoardWindowHandle.menuRows()`. */
  onContextMenu?: (event: MouseEvent) => void
  /** A click selected the window (the host puts the selection on the embed). */
  onSelect?: () => void
  /** The round fold arrow (D13); absent = the arrow never shows. */
  onFold?: () => void
}

/** One row the window adds to its embed's menu (D12). `children` makes a flyout (Page ▸, Frame ▸). */
export interface WindowMenuRow {
  label: string
  run: () => void
  children?: WindowMenuRow[]
  disabled?: boolean
  /** The current choice of a flyout (the page shown, in Page ▸): the host draws the menu's ✓ (`hint: '✓'`). */
  checked?: boolean
}

/** The window as a host drives it. */
export interface BoardWindowHandle {
  /** The window's root element; the host puts it in its widget / node view. */
  readonly dom: HTMLElement
  /** New host facts (the text changed, a rename resolved, the note went read-only). Option changes are ignored while a gesture runs (item 17). */
  update(host: Partial<Omit<BoardWindowHost, 'columnWidth'>>): void
  /** The host's selection covers the whole embed: handles show, keys go to the window (D10). */
  setSelected(on: boolean): void
  /** Folded on a bullet (D13): the window unloads its picture and shows the pill line. */
  setFolded(on: boolean): void
  /** Show the fold arrow (the item is foldable). */
  setFoldable(on: boolean): void
  /** The embed rows for the host's menu: Fit drawing to frame, Lock view, Page ▸ / Frame ▸, View full size. */
  menuRows(): WindowMenuRow[]
  /** Fit the board in the window (Shift+1, the zoom % click, the menu). */
  fit(): void
  destroy(): void
}

/** The lazy window module: a host calls `loadBoardWindow()` once a window is near the screen. */
export interface BoardWindowModule {
  mountBoardWindow(host: BoardWindowHost): BoardWindowHandle
}

/** The one dynamic import of the window chunk; every host shares the promise. */
let loading: Promise<BoardWindowModule> | null = null
export function loadBoardWindow(): Promise<BoardWindowModule> {
  loading ??= import('./boardWindow')
  return loading
}
