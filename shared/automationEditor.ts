/**
 * The drawing engine actions a live drawing tab runs by name (YAZ-4515): the CLI action → the engine's own action,
 * the one its menus, keys and context menu run. The view actions also run on a Read only board.
 */
export const DRAWING_ACTIONS = {
  selectAll: 'selectAll', deleteSelection: 'deleteSelectedElements', duplicate: 'duplicateSelection', group: 'group', ungroup: 'ungroup',
  bringForward: 'bringForward', sendBackward: 'sendBackward', bringToFront: 'bringToFront', sendToBack: 'sendToBack',
  alignTop: 'alignTop', alignBottom: 'alignBottom', alignLeft: 'alignLeft', alignRight: 'alignRight',
  alignVerticallyCentered: 'alignVerticallyCentered', alignHorizontallyCentered: 'alignHorizontallyCentered',
  distributeHorizontally: 'distributeHorizontally', distributeVertically: 'distributeVertically',
  flipHorizontal: 'flipHorizontal', flipVertical: 'flipVertical', toggleLock: 'toggleElementLock',
  zoomIn: 'zoomIn', zoomOut: 'zoomOut', resetZoom: 'resetZoom', zoomToFit: 'zoomToFit', zoomToFitSelection: 'zoomToFitSelection',
} as const
export type DrawingAction = keyof typeof DRAWING_ACTIONS
export const DRAWING_VIEW_ACTIONS: readonly DrawingAction[] = ['zoomIn', 'zoomOut', 'resetZoom', 'zoomToFit', 'zoomToFitSelection']

export type EditorAction =
  | { action: 'select'; anchor: number; head: number }
  | { action: 'replace'; text: string }
  | { action: 'format'; format: 'bold' | 'italic' | 'code' | 'strike' }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'save' }
  | { action: 'selectElements'; ids: string[] }
  | { action: DrawingAction }
export type EditorOperation = { command: 'editor.action'; tab: string; revision: string; edit: EditorAction }

/** The export box's settings (YAZ-4515). Omitted = the box's current value. PDF takes no scale or embedded scene. */
export interface BoardExportOptions { background?: boolean; darkMode?: boolean; scale?: 1 | 2 | 3; embedScene?: boolean; selectionOnly?: boolean }
export type BoardImageFormat = 'png' | 'svg' | 'pdf'
export type BoardExportOperation = { command: 'board.export'; tab: string; kind: 'drawing' | 'diagram'; format: BoardImageFormat; options: BoardExportOptions }
/** What a live board export hands main: image bytes, or the SVG main prints as the PDF. */
export type BoardImageData = { format: 'png' | 'svg'; data: Uint8Array } | { format: 'pdf'; svg: string; width: number; height: number }
export type BoardImage = BoardImageData & { path: string; dirty: boolean }
