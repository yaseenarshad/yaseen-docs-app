/**
 * The drawing keys (YAZ-3564 K1): the Excalidraw canvas and the app's own keys around it. Every engine action that
 * has a key, and every tool, is a row you can change (K6); the engine hears a change through one remap at the top
 * of its key handler (K5, `engine/packages/excalidraw/keyRemap.ts`), fed by `client/src/drawings/drawingKeys.ts`.
 * The engine's own hard-coded keys (Esc, Enter, Tab, arrows, Space, Delete, the colour letters, the size digits,
 * copy / paste, the pop-up keys) are built in. `drawingKeys.test.ts` reads the engine's real actions and tools and
 * fails on one with no row.
 *
 * Built-in rows that the engine splits by the selection never repeat a key: the colour letters (with a selection)
 * are the tool letters (without one), so their row names the letters in its hint and has no keys.
 */
import type { KeyRow } from './types'

/** A changeable drawing row. */
const key = (id: string, label: string, keys: readonly string[], hint?: string): KeyRow => ({ id: `drawing.${id}`, scope: 'drawing', label, keys, changeable: true, ...(hint === undefined ? {} : { hint }) })
/** A built-in drawing row. */
const fixed = (id: string, label: string, keys: readonly string[], hint?: string): KeyRow => ({ ...key(id, label, keys, hint), changeable: false })

const ARROWS = ['Up', 'Down', 'Left', 'Right']
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

export const DRAWING_KEYS: readonly KeyRow[] = [
  // The tools (the engine's `TOOLS`, `components/Tools.tsx`); a tool with no letter can still get one.
  key('selection', 'Selection tool', ['V'], 'Or the lasso, when it is the selection you prefer'),
  key('hand', 'Hand tool', ['H'], 'Press it again for the tool before'),
  key('rectangle', 'Rectangle', ['R']),
  key('diamond', 'Diamond', []),
  key('ellipse', 'Ellipse', ['O']),
  key('arrow', 'Arrow', ['A'], 'Again: sharp, curved, elbow'),
  key('line', 'Line', ['D', 'L']),
  key('freedraw', 'Pen', ['W', 'P', 'X']),
  key('text', 'Text', ['T'], 'Starts a text where the pointer is'),
  key('image', 'Insert an image', []),
  key('eraser', 'Eraser', []),
  key('frame', 'Frame', ['F']),
  key('autoshape', 'Draw a shape, it becomes the shape', ['Shift+X']),
  key('embeddable', 'Web embed', []),
  key('laser', 'Laser pointer', ['E', 'K']),
  key('lasso', 'Lasso', []),
  // The engine's actions (`engine/packages/excalidraw/actions`).
  key('duplicate', 'Duplicate', ['CmdOrCtrl+D'], '⌥-drag duplicates too'),
  key('group', 'Group', ['CmdOrCtrl+G']),
  key('ungroup', 'Ungroup', ['CmdOrCtrl+Shift+G']),
  key('link', 'Add a link', ['CmdOrCtrl+K']),
  key('lock', 'Lock / unlock the selection', ['CmdOrCtrl+Shift+L']),
  key('copyStyles', 'Copy styles', ['CmdOrCtrl+Alt+C']),
  key('pasteStyles', 'Paste styles', ['CmdOrCtrl+Alt+V']),
  key('copyAsPng', 'Copy as PNG', ['Alt+Shift+C']),
  key('sendBackward', 'Send backward', ['CmdOrCtrl+[']),
  key('bringForward', 'Bring forward', ['CmdOrCtrl+]']),
  key('sendToBack', 'Send to back', ['CmdOrCtrl+Alt+[']),
  key('bringToFront', 'Bring to front', ['CmdOrCtrl+Alt+]']),
  key('alignTop', 'Align top', ['CmdOrCtrl+Shift+Up']),
  key('alignBottom', 'Align bottom', ['CmdOrCtrl+Shift+Down']),
  key('alignLeft', 'Align left', ['CmdOrCtrl+Shift+Left']),
  key('alignRight', 'Align right', ['CmdOrCtrl+Shift+Right']),
  key('distributeHorizontally', 'Distribute horizontally', ['Alt+H']),
  key('distributeVertically', 'Distribute vertically', ['Alt+V']),
  key('flipHorizontal', 'Flip horizontal', ['Shift+H']),
  key('flipVertical', 'Flip vertical', ['Shift+V']),
  key('textBold', 'Bold', ['CmdOrCtrl+B'], 'A selected text; while you type, ⌘B stays'),
  key('textUnderline', 'Underline', ['CmdOrCtrl+U'], 'A selected text; while you type, ⌘U stays'),
  key('textStrikethrough', 'Strikethrough', ['CmdOrCtrl+Shift+X'], 'A selected text; while you type, ⌘⇧X stays'),
  key('clearTextFormatting', 'Clear text formatting', ['CmdOrCtrl+\\']),
  key('decreaseFontSize', 'Smaller text', ['CmdOrCtrl+Shift+,'], 'While you type, ⌘⇧< stays'),
  key('increaseFontSize', 'Larger text', ['CmdOrCtrl+Shift+.'], 'While you type, ⌘⇧> stays'),
  key('zoomIn', 'Zoom in', ['CmdOrCtrl+=', 'Shift+=']),
  key('zoomOut', 'Zoom out', ['CmdOrCtrl+-', 'Shift+-']),
  key('resetZoom', 'Zoom to 100%', ['CmdOrCtrl+0', 'Shift+0']),
  key('zoomToFit', 'Zoom to fit everything', ['Shift+1']),
  key('zoomToFitSelectionInViewport', 'Zoom to the selection', ['Shift+2']),
  key('zoomToFitSelection', 'Zoom to fit the selection', ['Shift+3']),
  key('gridMode', 'Grid on / off', ["CmdOrCtrl+'"]),
  key('objectsSnapMode', 'Snap to shapes on / off', ['Alt+S']),
  key('zenMode', 'Zen mode', ['Alt+Z']),
  key('viewMode', 'View mode', ['Alt+R']),
  key('stats', 'Stats panel', ['Alt+/']),
  // Engine actions this app turns off (`UI_OPTIONS` in `ExcalidrawSurface.tsx`): listed, with no key.
  fixed('openFile', 'Open a file', [], 'Off in this app: the vault opens files'),
  fixed('saveToFile', 'Save to the file', [], 'Off in this app: ⌘S is "Save the drawing now"'),
  fixed('saveAs', 'Save as', [], "Off in this app: ⌘⇧S is the menu's Export Excalidraw drawing"),
  fixed('toggleTheme', 'Dark / light canvas', [], "Off in this app: the canvas follows the app's appearance"),
  // The app's own keys on a drawing tab (`DrawingEditor.tsx`, `ExcalidrawSurface.tsx`).
  key('saveNow', 'Save the drawing now', ['CmdOrCtrl+S'], 'It autosaves anyway'),
  key('imagesPanel', 'Images tab of the canvas panel', ['CmdOrCtrl+F'], 'Press again to close the panel'),
  key('componentsPanel', 'Components tab of the canvas panel', ['CmdOrCtrl+C'], 'With nothing selected; with a selection ⌘C copies'),
  // Built in: typing, editing and pop-up keys (K6).
  fixed('escape', 'Deselect, or stop what is in progress', ['Escape'], 'Ends a line being drawn, a crop, the laser, a shape menu and a web embed'),
  fixed('enter', 'Edit the selected text, label, line or frame', ['Enter'], 'Crops a selected image; ends a crop or a line being drawn; with the laser, keeps the marks'),
  fixed('laserKeep', 'With the laser: make the marks part of the drawing', ['Shift+Enter']),
  fixed('lineEditor', 'Edit the points of the selected line or arrow', ['CmdOrCtrl+Enter']),
  fixed('convert', 'Change the type of the selected shape', ['Tab', 'Shift+Tab']),
  fixed('nudge', 'Move the selection', [...ARROWS, ...ARROWS.map((a) => `Shift+${a}`)], '⇧ moves it farther'),
  fixed('flowchartAdd', 'Add a linked shape on that side', ARROWS.map((a) => `CmdOrCtrl+${a}`), 'Press again for more; let go of ⌘ to place them'),
  fixed('flowchartGo', 'Go to the linked shape on that side', ARROWS.map((a) => `Alt+${a}`)),
  fixed('pan', 'Pan the canvas', ['Space'], 'Hold it and drag'),
  fixed('pageScroll', 'Scroll the canvas a page', ['PageUp', 'PageDown', 'Shift+PageUp', 'Shift+PageDown'], '⇧ scrolls sideways'),
  fixed('delete', 'Delete the selection', ['Backspace', 'Delete']),
  fixed('copyPaste', 'Copy, cut and paste', ['CmdOrCtrl+C', 'CmdOrCtrl+X', 'CmdOrCtrl+V']),
  fixed('undo', 'Undo', ['CmdOrCtrl+Z']),
  fixed('redo', 'Redo', ['CmdOrCtrl+Shift+Z', 'CmdOrCtrl+Y']),
  fixed('selectAll', 'Select all', ['CmdOrCtrl+A']),
  fixed('help', 'Keyboard shortcuts', ['Shift+/']),
  fixed('toolLock', 'Keep the tool after drawing', ['Q']),
  fixed('colors', 'Colour the selection', [], "T B W D R P A V U C E G Y O N: transparent, black, white, gray, red, pink, grape, violet, blue, cyan, teal, green, yellow, orange, bronze; with ⇧ the outline. The tool letters, while something is selected"),
  fixed('sizes', 'Size the selection', DIGITS, 'Text 12 to 128; anything else 48 to 1024 on its long side'),
  fixed('backgroundColors', 'Open the background colours', ['G'], 'With a shape tool and nothing selected'),
  fixed('strokeColors', 'Open the stroke colours', ['S'], 'With a shape tool and nothing selected'),
  fixed('fonts', 'Open the fonts', ['Shift+F'], 'With the text tool, or a text selected'),
  fixed('eyedropper', 'Pick a colour off the canvas', ['I', 'Shift+G', 'Shift+S'], 'I or ⇧G for the background, ⇧S for the stroke'),
  fixed('textEditing', 'While you type a text: indent, outdent, finish', [], 'Tab / ⇧Tab or ⌘] / ⌘[ indent and outdent a list; ⌘⏎ or Esc ends the text'),
  // The presentation player (`presentation/PresentationPlayer.tsx`): its arrows, Space and Esc are the canvas's keys too.
  fixed('presentSteps', 'In a presentation: next and previous slide', [], '→, Page Down or Space: next; ←, Page Up: previous; Esc: back to the deck'),
  fixed('presentEnds', 'In a presentation: first / last slide', ['Home', 'End']),
  fixed('presentTools', 'In a presentation: show or hide the tools', ['Shift+T']),
]

/**
 * What each drawing row is to the engine (K5): the action it runs (`Action.name`), or `tool:<type>` for a tool.
 * A built-in row may stand for several actions. Rows the app handles itself (Save now, the panel tabs) and the
 * engine's hard-coded keys have none.
 */
export const DRAWING_ACTIONS: Readonly<Record<string, string | readonly string[]>> = {
  ...Object.fromEntries(
    ['selection', 'hand', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'eraser', 'frame', 'autoshape', 'embeddable', 'laser', 'lasso'].map((tool) => [`drawing.${tool}`, `tool:${tool}`]),
  ),
  'drawing.duplicate': 'duplicateSelection',
  'drawing.group': 'group',
  'drawing.ungroup': 'ungroup',
  'drawing.link': 'hyperlink',
  'drawing.lock': 'toggleElementLock',
  'drawing.copyStyles': 'copyStyles',
  'drawing.pasteStyles': 'pasteStyles',
  'drawing.copyAsPng': 'copyAsPng',
  'drawing.sendBackward': 'sendBackward',
  'drawing.bringForward': 'bringForward',
  'drawing.sendToBack': 'sendToBack',
  'drawing.bringToFront': 'bringToFront',
  'drawing.alignTop': 'alignTop',
  'drawing.alignBottom': 'alignBottom',
  'drawing.alignLeft': 'alignLeft',
  'drawing.alignRight': 'alignRight',
  'drawing.distributeHorizontally': 'distributeHorizontally',
  'drawing.distributeVertically': 'distributeVertically',
  'drawing.flipHorizontal': 'flipHorizontal',
  'drawing.flipVertical': 'flipVertical',
  'drawing.textBold': 'toggleTextBold',
  'drawing.textUnderline': 'toggleTextUnderline',
  'drawing.textStrikethrough': 'toggleTextStrikethrough',
  'drawing.clearTextFormatting': 'clearSelectedTextFormatting',
  'drawing.decreaseFontSize': 'decreaseFontSize',
  'drawing.increaseFontSize': 'increaseFontSize',
  'drawing.zoomIn': 'zoomIn',
  'drawing.zoomOut': 'zoomOut',
  'drawing.resetZoom': 'resetZoom',
  'drawing.zoomToFit': 'zoomToFit',
  'drawing.zoomToFitSelectionInViewport': 'zoomToFitSelectionInViewport',
  'drawing.zoomToFitSelection': 'zoomToFitSelection',
  'drawing.gridMode': 'gridMode',
  'drawing.objectsSnapMode': 'objectsSnapMode',
  'drawing.zenMode': 'zenMode',
  'drawing.viewMode': 'viewMode',
  'drawing.stats': 'stats',
  'drawing.openFile': 'loadScene',
  'drawing.saveToFile': 'saveToActiveFile',
  'drawing.saveAs': 'saveFileToDisk',
  'drawing.toggleTheme': 'toggleTheme',
  'drawing.escape': ['deselect', 'finalize'],
  'drawing.delete': 'deleteSelectedElements',
  'drawing.copyPaste': 'cut',
  'drawing.undo': 'undo',
  'drawing.redo': 'redo',
  'drawing.selectAll': 'selectAll',
  'drawing.help': 'toggleShortcuts',
}
