/**
 * The drawing keys (YAZ-3564 K1): the Excalidraw canvas and the app's own keys around it. Every engine action that
 * has a key, and every tool, is a row you can change (K6); the engine hears a change through one remap at the top
 * of its key handler (K5, `engine/packages/excalidraw/keyRemap.ts`), fed by `client/src/drawings/drawingKeys.ts`.
 * The engine's own hard-coded keys (Esc, Enter, Tab, arrows, Space, Delete, the colour letters, the size digits,
 * copy / paste, the pop-up keys) are built in. `drawingKeys.test.ts` reads the engine's real actions and tools and
 * fails on one with no row.
 *
 * The keys that act only while something is selected (YAZ-4348) are built-in rows of their own, one per key, flagged
 * `withSelection`: each colour letter (R is Red with a selection, Rectangle without one; R the line, ⇧R the fill: YAZ-4277 D16) and each size
 * digit. Their key card shows them beside the tool on the same letter, and they clash with no row (`clashesOf`).
 * `drawingKeys.test.ts` reads the engine's letter and digit tables and fails when these rows drift from them.
 */
import type { KeyRow } from './types'

/** A changeable drawing row. */
const key = (id: string, label: string, keys: readonly string[], hint?: string): KeyRow => ({ id: `drawing.${id}`, scope: 'drawing', label, keys, changeable: true, ...(hint === undefined ? {} : { hint }) })
/** A built-in drawing row. */
const fixed = (id: string, label: string, keys: readonly string[], hint?: string): KeyRow => ({ ...key(id, label, keys, hint), changeable: false })

const ARROWS = ['Up', 'Down', 'Left', 'Right']

/** A built-in drawing key that acts only while something is selected (YAZ-4348): its letter is a tool's the rest of the time. */
const selected = (id: string, label: string, keys: readonly string[], hint: string): KeyRow => ({ ...fixed(id, label, keys, hint), withSelection: true })

/** The engine's colour letters (`SEMANTIC_COLOR_HOTKEYS`, `components/ColorPicker/colorPickerUtils.ts`), in its order. */
export const SELECTION_COLOURS: readonly (readonly [letter: string, name: string])[] = [
  ['T', 'Transparent'],
  ['B', 'Black'],
  ['W', 'White'],
  ['D', 'Gray'],
  ['R', 'Red'],
  ['P', 'Pink'],
  ['A', 'Grape'],
  ['V', 'Violet'],
  ['U', 'Blue'],
  ['C', 'Cyan'],
  ['E', 'Teal'],
  ['G', 'Green'],
  ['Y', 'Yellow'],
  ['O', 'Orange'],
  ['N', 'Bronze'],
]

/** The engine's size digits (`SELECTION_SIZE_PRESETS`, `selectionSizePresets.ts`): a text's font size, and anything else's long side. */
export const SELECTION_SIZES: readonly (readonly [digit: string, text: number, other: number])[] = [
  ['1', 12, 48],
  ['2', 16, 64],
  ['3', 20, 96],
  ['4', 24, 128],
  ['5', 32, 192],
  ['6', 40, 256],
  ['7', 56, 384],
  ['8', 72, 512],
  ['9', 96, 768],
  ['0', 128, 1024],
]

/**
 * The ⇧ letters that keep their own action with a selection (YAZ-4348 demo, Yasin: "Flip and eyedropper win"), so they
 * colour no fill (YAZ-4277 D16: ⇧ is the fill): the engine's `SHIFT_KEYS_KEPT_FROM_COLORS`. Violet and green fills come
 * from the picker.
 */
export const SHIFT_KEPT: Readonly<Record<string, string>> = { V: 'Flip vertical', G: 'the eyedropper' }

/**
 * A colour letter's row. On a one-colour icon the letter and its ⇧ both colour the icon itself, and T and ⇧T both
 * take off its outline (the engine's `actionApplySelectedSemanticColor`, YAZ-4353 1C; Yasin, audit 42: the text says
 * so, the key stays). No em dash in a label (YAZ-4421). The letter colours the line, ⇧ the fill (YAZ-4277 D16).
 */
const colourRow = ([letter, name]: readonly [string, string]): KeyRow =>
  letter === 'T'
    ? selected('colorTransparent', 'Transparent, with a selection (on an icon: takes off the outline)', ['T', 'Shift+T'], 'Colours the selection: no outline on a shape, no colour on a line or a text; ⇧T no fill on a shape, or no background on a free text')
    : SHIFT_KEPT[letter] !== undefined
    ? selected(`color${name}`, `${name}, with a selection`, [letter], `Colours the selection ${name.toLowerCase()}: a shape's outline, a line's or a text's colour, a picture's border, a one-colour icon. ⇧${letter} stays ${SHIFT_KEPT[letter]}; the fill's ${name.toLowerCase()} is in the picker`)
    : selected(
        `color${name}`,
        `${name}, with a selection (⇧${letter}: the fill)`,
        [letter, `Shift+${letter}`],
        `Colours the selection ${name.toLowerCase()}: a shape's outline, a line's or a text's colour, a picture's border, a one-colour icon. ⇧${letter} colours a shape's fill, or a free text's background; on a one-colour icon ${letter} and ⇧${letter} both colour the icon`,
      )

const sizeRow = ([digit, text, other]: readonly [string, number, number]): KeyRow =>
  selected(`size${digit}`, `Size: text ${text}, anything else ${other} on its long side, with a selection`, [digit], 'Sizes the selection as you see it at this zoom; a locked one keeps its size')

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
  key('textItalic', 'Italic', ['CmdOrCtrl+I'], 'A selected text; while you type, ⌘I stays'),
  key('textUnderline', 'Underline', ['CmdOrCtrl+U'], 'A selected text; while you type, ⌘U stays'),
  key('textStrikethrough', 'Strikethrough', ['CmdOrCtrl+Shift+X'], 'A selected text; while you type, ⌘⇧X stays'),
  // YAZ-4102 3E: highlight letters, as in a page (the page's ⌘⇧H); the text editor hears the changed key too.
  key('textHighlight', 'Highlight the selected letters', ['CmdOrCtrl+Shift+H'], 'While you type a text, as in a page; the toolbar has the other colours'),
  key('clearTextFormatting', 'Reset to default style', ['CmdOrCtrl+\\'], 'Every selected shape and text: black line, no fill, the Settings › Drawings and diagrams defaults; keeps place, size and words'),
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
  key('imagesPanel', 'Add tab of the canvas panel', ['CmdOrCtrl+F'], 'Puts the caret in its search field, from anywhere on the board'),
  key('componentsPanel', 'Add tab, on its Components chip', ['CmdOrCtrl+C'], 'With nothing selected; with a selection ⌘C copies'),
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
  // With a selection (YAZ-4348): the colour letters and the size digits, one row per key.
  ...SELECTION_COLOURS.map(colourRow),
  ...SELECTION_SIZES.map(sizeRow),
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
  'drawing.textItalic': 'toggleTextItalic',
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
  // YAZ-3943 demo 2: a changeable row names ONE action, the one the remap moves (the toolbar's picks have no key).
  'drawing.textHighlight': 'toggleTextHighlight',
}
