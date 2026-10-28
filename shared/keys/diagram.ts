/**
 * The diagram keys (YAZ-3564 K1): draw.io v31.5.2's own key table as the app ships it. Its bindings are draw.io's
 * (`createKeyHandler`, the App block, the alt maps and `initPages` in the pinned `js/app.min.js`), with the app's
 * changes on top (`client/src/diagrams/drawioProtocol.ts`: the Excalidraw tool letters, ⌘\ and ⌘⇧X) and the
 * selection keys of `desktop/drawio-overlay/js/PostConfig.js` (colour letters, sizes). `tools/drawioOverlay.test.mjs`
 * reads the pinned bundle and fails on a binding with no row here.
 *
 * draw.io's `control` is ⌘ or ⌃ (⌘ on a Mac): its keys are written `CmdOrCtrl`. A changeable row's key reaches
 * draw.io as its named action (`DIAGRAM_ACTIONS`) in the `configure` reply, so a change applies to the next
 * diagram that opens (K4). Built in (K6): keys draw.io binds to code instead of a named action, Enter, Backspace,
 * Delete, arrows, Esc, the colour letters and sizes, copy / cut / paste.
 */
import type { KeyRow } from './types'

const NONE = 'With nothing selected'
/** The Excalidraw fork's colour letters (PostConfig.js `COLOURS`), transparent first. */
const COLOUR_LETTERS = ['T', 'B', 'W', 'D', 'R', 'P', 'A', 'V', 'U', 'C', 'E', 'G', 'Y', 'O', 'N']

/** A changeable row and its draw.io action. */
type Bound = KeyRow & { action: string }
const key = (name: string, label: string, keys: readonly string[], { action = name, hint }: { action?: string; hint?: string } = {}): Bound => ({
  id: `diagram.${name}`,
  scope: 'diagram',
  label,
  ...(hint === undefined ? {} : { hint }),
  keys,
  changeable: true,
  action,
})
const fixed = (name: string, label: string, keys: readonly string[], hint?: string): KeyRow => ({
  id: `diagram.${name}`,
  scope: 'diagram',
  label,
  ...(hint === undefined ? {} : { hint }),
  keys,
  changeable: false,
})

const BOUND: readonly Bound[] = [
  // The tools, with nothing selected (🔒 YAZ-1802 D12b): Excalidraw's letters on draw.io's insert actions.
  key('insertRectangle', 'Rectangle', ['R'], { hint: NONE }),
  key('insertEllipse', 'Ellipse', ['O'], { hint: NONE }),
  key('insertText', 'Text', ['T'], { hint: NONE }),
  key('insertEdge', 'Arrow / line', ['A', 'D', 'L', 'C'], { hint: NONE }),
  key('insertFreehand', 'Freehand pen', ['W', 'P', 'X'], { hint: NONE }),
  // draw.io's own letters for these went to the tools above (its S and F are cleared: Excalidraw's S and F are other tools).
  key('insertNote', 'Note shape', []),
  key('insertRhombus', 'Rhombus', []),
  key('insertLink', 'Insert link', []),

  // Edit
  key('undo', 'Undo', ['CmdOrCtrl+Z']),
  key('redo', 'Redo', ['CmdOrCtrl+Shift+Z', 'CmdOrCtrl+Y']),
  key('duplicate', 'Duplicate', ['CmdOrCtrl+D']),
  key('deleteAll', 'Delete with connections', ['CmdOrCtrl+Backspace', 'CmdOrCtrl+Delete']),
  key('selectAll', 'Select all', ['CmdOrCtrl+A']),
  key('selectNone', 'Select none', ['CmdOrCtrl+Shift+A']),
  key('selectVertices', 'Select shapes', ['CmdOrCtrl+Shift+I']),
  key('selectEdges', 'Select lines', ['CmdOrCtrl+Shift+E']),
  key('group', 'Group', ['CmdOrCtrl+G']),
  key('ungroup', 'Ungroup', ['CmdOrCtrl+Shift+U']),
  key('lockUnlock', 'Lock / unlock', ['CmdOrCtrl+L']),
  key('toFront', 'To front', ['CmdOrCtrl+Shift+F']),
  key('toBack', 'To back', ['CmdOrCtrl+Shift+B']),
  key('bringForward', 'Bring forward', ['CmdOrCtrl+Alt+Shift+F']),
  key('sendBackward', 'Send backward', ['CmdOrCtrl+Alt+Shift+B']),
  key('turn', 'Turn / rotate 90°', ['CmdOrCtrl+R']),
  key('autosize', 'Autosize', ['CmdOrCtrl+Shift+Y']),
  key('findReplace', 'Find / replace', ['CmdOrCtrl+F']),
  key('editData', 'Edit data', ['CmdOrCtrl+M']),
  key('editStyle', 'Edit style', ['CmdOrCtrl+E']),
  key('editGeometry', 'Edit geometry', ['CmdOrCtrl+Shift+M']),
  key('tags', 'Edit tags', ['CmdOrCtrl+K']),
  key('editLink', 'Edit link', ['Alt+Shift+L']),
  key('editTooltip', 'Edit tooltip', ['Alt+Shift+T']),
  key('editNote', 'Edit note', ['Alt+Shift+N']),
  key('editConnectionPoints', 'Edit connection points', [], { hint: 'draw.io’s ⌥⇧Q is Copy style' }),

  // Style and text
  key('bold', 'Bold', ['CmdOrCtrl+B']),
  key('italic', 'Italic', ['CmdOrCtrl+I']),
  key('underline', 'Underline', ['CmdOrCtrl+U']),
  key('strikethrough', 'Strikethrough', ['CmdOrCtrl+Shift+X'], { action: 'yaseenStrikethrough' }),
  key('removeFormat', 'Clear formatting', ['CmdOrCtrl+\\']),
  key('superscript', 'Superscript', ['CmdOrCtrl+.']),
  key('subscript', 'Subscript', ['CmdOrCtrl+,']),
  key('increaseFontSize', 'Bigger font', ['CmdOrCtrl+Shift+]']),
  key('decreaseFontSize', 'Smaller font', ['CmdOrCtrl+Shift+[']),
  key('copyStyle', 'Copy style', ['Alt+Shift+Q']),
  key('pasteStyle', 'Paste style', ['Alt+Shift+W']),
  key('setAsDefaultStyle', 'Set as default style', ['CmdOrCtrl+Shift+D']),
  key('clearDefaultStyle', 'Clear default style', ['CmdOrCtrl+Shift+R']),
  key('copySize', 'Copy size', ['Alt+Shift+F']),
  key('pasteSize', 'Paste size', ['Alt+Shift+V']),
  key('copyData', 'Copy data', ['Alt+Shift+B']),
  key('pasteData', 'Paste data', ['Alt+Shift+E']),
  key('clearWaypoints', 'Clear waypoints', ['Alt+Shift+R']),
  key('copyAsImage', 'Copy as image', ['CmdOrCtrl+Alt+X']),
  key('copyAsSvg', 'Copy as SVG', ['CmdOrCtrl+Alt+Shift+X']),
  key('synchronize', 'Synchronize', ['Alt+Shift+S']),
  key('runLastLayout', 'Run the last layout', ['CmdOrCtrl+Alt+T']),

  // View
  key('zoomIn', 'Zoom in', ['CmdOrCtrl+=']),
  key('zoomOut', 'Zoom out', ['CmdOrCtrl+-']),
  key('customZoom', 'Custom zoom', ['CmdOrCtrl+0']),
  key('fitWindow', 'Fit the window', ['CmdOrCtrl+Shift+H']),
  key('fitPage', 'Fit the page', ['CmdOrCtrl+J']),
  key('fitTwoPages', 'Fit two pages', ['CmdOrCtrl+Shift+J']),
  key('grid', 'Grid', ['CmdOrCtrl+Shift+G']),
  key('format', 'Format panel', ['CmdOrCtrl+Shift+P']),
  key('outline', 'Outline', ['CmdOrCtrl+Shift+O']),
  key('layers', 'Layers', ['CmdOrCtrl+Shift+L']),
  key('toggleShapes', 'Shapes panel', ['CmdOrCtrl+Shift+K']),
  key('connectionArrows', 'Connection arrows', ['Alt+Shift+A']),
  key('connectionPoints', 'Connection points', ['Alt+Shift+O']),
  key('adaptiveColors', 'Dark-mode colours', ['CmdOrCtrl+Shift+6']),
  key('previousPage', 'Previous page', ['CmdOrCtrl+Shift+PageUp']),
  key('nextPage', 'Next page', ['CmdOrCtrl+Shift+PageDown']),

  // File
  key('save', 'Save now', ['CmdOrCtrl+S'], { hint: 'It autosaves anyway' }),
  key('saveAs', 'Save as', ['CmdOrCtrl+Shift+S']),
  key('print', 'Print', ['CmdOrCtrl+P']),
]

/** The draw.io action of each changeable row, by row id: the `configure` reply binds a changed key to it. */
export const DIAGRAM_ACTIONS: Readonly<Record<string, string>> = Object.fromEntries(BOUND.map((r) => [r.id, r.action]))

/**
 * draw.io's other key codes for a row's default key, with the same modifiers: the number pad's + and −, Firefox's
 * = and −, and the 222 that draw.io also reads as plus. A changed row clears them with its default key.
 */
export const DIAGRAM_EXTRA_CODES: Readonly<Record<string, readonly number[]>> = {
  'diagram.zoomIn': [107, 61, 222],
  'diagram.zoomOut': [109, 173],
  'diagram.increaseFontSize': [107],
  'diagram.decreaseFontSize': [109],
}

export const DIAGRAM_KEYS: readonly KeyRow[] = [
  ...BOUND.map(({ action: _action, ...row }): KeyRow => row),
  // Built in: typing keys, and keys draw.io binds to code instead of a named action.
  fixed('colour', 'Colour the selection', COLOUR_LETTERS, "Transparent, black, white, gray, red, pink, grape, violet, blue, cyan, teal, green, yellow, orange, bronze: a shape's fill, a text's colour, a line's stroke, an image's border"),
  fixed('colourOther', "A shape's outline, a text's background", COLOUR_LETTERS.map((l) => `Shift+${l}`), 'Shift and a colour letter'),
  fixed('size', 'Size the selection', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], 'Text 12 to 128, anything else 48 to 1024 on its long side'),
  fixed('clipboard', 'Cut / copy / paste', ['CmdOrCtrl+X', 'CmdOrCtrl+C', 'CmdOrCtrl+V']),
  fixed('delete', 'Delete', ['Backspace', 'Delete']),
  fixed('deleteLabels', 'Delete the labels', ['Shift+Backspace', 'Shift+Delete']),
  fixed('editLabel', 'Edit the label', ['F2', 'Enter'], 'Enter with nothing selected fits the diagram'),
  fixed('duplicateInPlace', 'Duplicate in place', ['CmdOrCtrl+Enter']),
  fixed('escape', 'Cancel / clear the selection', ['Escape']),
  fixed('move', 'Move the selection', ['Up', 'Down', 'Left', 'Right'], '⇧ by the grid, ⌘ resizes, ⌥⇧ adds a connected shape; with nothing selected ⌘ ← → picks a page and ⇧ ← → moves it'),
  fixed('searchShapes', 'Search the shapes', ['/']),
  fixed('resetView', 'Reset the view', ['Home']),
  fixed('home', 'Go home', ['Shift+Home']),
  fixed('refresh', 'Refresh', ['End']),
  fixed('collapse', 'Collapse', ['CmdOrCtrl+Home']),
  fixed('expand', 'Expand', ['CmdOrCtrl+End']),
  fixed('exitGroup', 'Exit the group', ['CmdOrCtrl+Shift+Home']),
  fixed('enterGroup', 'Enter the group', ['CmdOrCtrl+Shift+End']),
]
