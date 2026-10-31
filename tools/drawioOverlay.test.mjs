import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { drawioConfig, drawioKeyOf } from '../client/src/diagrams/drawioProtocol.ts'
import { DIAGRAM_ACTIONS, DIAGRAM_EXTRA_CODES, DIAGRAM_KEYS } from '../shared/keys/diagram.ts'
import { DRAWIO_TAG } from './packDrawio.mjs'

/**
 * OUR draw.io overlay (🔒 YAZ-1802 D12a / D12b): the scripts parse, `PostConfig.js` behaves, and every
 * draw.io action the host or the overlay names exists in the pinned bundle. PostConfig runs in a
 * `vm` context against a STAND-IN draw.io — the handful of globals and graph calls it touches — so
 * the keymap's rules are pinned without a browser; the real editor is Yasin's feel pass.
 */
const OVERLAY_JS = fileURLToPath(new URL('../desktop/drawio-overlay/js/', import.meta.url))
const APP_MIN_JS = fileURLToPath(new URL(`../desktop/.cache/drawio/${DRAWIO_TAG}/js/app.min.js`, import.meta.url))

/** The globals PostConfig.js patches, each prototype method standing in for draw.io's original. */
function loadPostConfig({ fetchFonts = async () => ({ ok: true, text: async () => '@font-face {}' }), shortcuts = drawioConfig('adapt').keyboardShortcuts } = {}) {
  const posted = []
  const fontCss = []
  const listeners = []
  /** draw.io's own `window.focus`, before PostConfig.js wraps it. */
  const windowFocus = vi.fn()
  function Graph() {}
  Graph.prototype.isZoomWheelEvent = (evt) => evt.ctrlKey === true
  function EditorUi() {}
  EditorUi.prototype.createUi = function () {}
  // draw.io's own: lays the panels out at their widths (here, only what PostConfig.js adds to it).
  EditorUi.prototype.refresh = function () {}
  // draw.io's own: the configure reply's `keyboardShortcuts`, one by one (no ⌥ keys here: the tests need none).
  EditorUi.prototype.installKeyboardShortcuts = function () {
    for (const c of env.Editor.keyboardShortcuts ?? []) this.installKeyboardShortcut(c)
  }
  // draw.io's own: bind the action by name (null clears the key), and name the key beside the action — letters and digits only.
  EditorUi.prototype.installKeyboardShortcut = function (c) {
    const code = typeof c.keyCode === 'string' ? c.keyCode.toUpperCase().charCodeAt(0) : c.keyCode
    const table = this.keyHandler[c.control ? (c.shift ? 'controlShiftKeys' : 'controlKeys') : c.shift ? 'shiftKeys' : 'normalKeys']
    if (c.action === null) delete table[code]
    else table[code] = () => this.actions.get(c.action).funct()
    const name = /[0-9A-Z]/.test(String.fromCharCode(code)) ? String.fromCharCode(code) : undefined
    const action = this.actions.get(c.action)
    if (c.action !== null && action !== undefined && name !== undefined) action.shortcut = `${c.control ? '⌘+' : ''}${c.shift ? '⇧+' : ''}${name}`
  }
  // draw.io's own: Undo and Redo follow the undo history, never whether the graph takes edits.
  EditorUi.prototype.updateActionStates = function () {
    this.actions.get('undo').setEnabled(true)
    this.actions.get('redo').setEnabled(true)
  }
  // draw.io's own: what the last session left open comes back, and a multi-layer diagram opens Layers.
  EditorUi.prototype.restoreVisibleWindows = function () {
    this.opened.push('layers', 'outline')
  }
  EditorUi.prototype.showLayersDialog = function () {
    this.opened.push('layers')
  }
  // draw.io's own `simple` rule: a frame that grows past 1024 px opens Format — when it knows the last width.
  EditorUi.prototype.windowResized = function () {
    if (this.lastWindowWidth != null && this.lastWindowWidth < 1024 && this.frameWidth >= 1024) this.opened.push('format')
    this.lastWindowWidth = this.frameWidth
  }
  // draw.io's own page and view calls. Its embed load is `setFileData` — the first page at scale 1,
  // a fit of that page because it was never shown, then its `resetGraphView` scrolls home — and
  // after it `fitInitialView`.
  EditorUi.prototype.setFileData = function (pages) {
    Object.assign(this, { pages, currentPage: pages[0], fitted: false })
    this.editor.graph.view.scale = 1
    this.fitInitialView()
    Object.assign(this, { scroll: { x: 0, y: 0 }, fitted: false })
  }
  EditorUi.prototype.fitInitialView = function () {
    this.fitted = true
  }
  EditorUi.prototype.getPageById = function (id) {
    return this.pages.find((p) => p.getId() === id) ?? null
  }
  EditorUi.prototype.selectPage = function (page) {
    this.currentPage = page
  }
  EditorUi.prototype.saveScrollState = function () {
    return { ...this.scroll }
  }
  EditorUi.prototype.restoreScrollState = function (state) {
    this.scroll = { ...state }
  }
  function Menus() {}
  Menus.prototype.createPopupMenu = (menu) => menu.items.push('zoomIn', 'zoomOut')
  EditorUi.keyNames = { 8: 'Backspace', 13: 'Enter', 46: 'Delete' }
  const env = {
    Graph,
    EditorUi,
    Menus,
    mxSettings: { getSidebarWidth: () => 208, getFormatWidth: () => 240 },
    mxUtils: { indexOf: (array, item) => array.indexOf(item) },
    mxEvent: { CELLS_RESIZED: 'cellsResized', isMetaDown: (e) => e.metaKey === true, isAltDown: (e) => e.altKey === true, isShiftDown: (e) => e.shiftKey === true },
    mxConstants: {
      STYLE_SHAPE: 'shape',
      STYLE_FILLCOLOR: 'fillColor',
      STYLE_STROKECOLOR: 'strokeColor',
      STYLE_FONTCOLOR: 'fontColor',
      STYLE_LABEL_BACKGROUNDCOLOR: 'labelBackgroundColor',
      STYLE_IMAGE_BORDER: 'imageBorder',
      STYLE_FONTSIZE: 'fontSize',
      STYLE_FONTSTYLE: 'fontStyle',
      FONT_STRIKETHROUGH: 8,
      DEFAULT_FONTSIZE: 11,
      NONE: 'none',
    },
    Editor: { configureFontCss: (css) => fontCss.push(css), keyboardShortcuts: shortcuts, ctrlKey: '⌘', altKey: '⌥', shiftKey: '⇧' },
    mxClient: { IS_MAC: true },
    fetch: fetchFonts,
    console: { error: vi.fn() },
    parent: { postMessage: (data, origin) => posted.push({ ...JSON.parse(data), origin }) },
    addEventListener: (type, listener) => listeners.push({ type, listener }),
    focus: windowFocus,
    setTimeout,
  }
  env.window = env
  createContext(env)
  runInContext(readFileSync(`${OVERLAY_JS}PostConfig.js`, 'utf8'), env)
  /** A `message` event as the page sees it — from the host (`window.parent`) unless told otherwise; true when a listener stopped it. */
  const message = (data, source = env.parent) => {
    const evt = { data: JSON.stringify(data), source, stopImmediatePropagation: vi.fn() }
    for (const l of listeners) if (l.type === 'message') l.listener(evt)
    return evt.stopImmediatePropagation.mock.calls.length > 0
  }
  return { env, posted, fontCss, message, windowFocus }
}

function geometry(x, y, width, height, relative = false) {
  return { x, y, width, height, relative, clone: () => geometry(x, y, width, height, relative) }
}

/** A cell as the stand-in graph keeps it: the raw style, parsed as `getCellStyle` would hand it over. */
function cell(raw, { label = '', edge = false, children = 0, locked = false, geo = geometry(0, 0, 100, 50) } = {}) {
  const style = Object.fromEntries(raw.split(';').filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]))
  return { raw, style, label, edge, children, locked, geo }
}

/** One editor: createUi + installKeyboardShortcuts run as draw.io would, on a stand-in graph and key handler. */
function openEditor(env) {
  let selection = []
  const listeners = {}
  const model = {
    isEdge: (c) => c.edge,
    isVertex: (c) => !c.edge,
    getStyle: (c) => c.raw,
    getChildCount: (c) => c.children,
    getGeometry: (c) => c.geo,
    setGeometry: (c, geo) => (c.geo = geo),
    beginUpdate() {},
    endUpdate() {},
  }
  const graph = {
    getModel: () => model,
    getCellStyle: (c) => c.style,
    convertValueToString: (c) => c.label,
    isSelectionEmpty: () => selection.length === 0,
    getSelectionCells: () => selection,
    getEditableCells: (cs) => cs.filter((c) => !c.locked),
    setCellStyles: (key, value, cs) => cs.forEach((c) => (c.style[key] = value)),
    toggleCellStyleFlags: (key, flag) => selection.forEach((c) => (c.style[key] = Number(c.style[key] ?? 0) ^ flag)),
    updateCellSize: vi.fn(),
    addListener: (name, listener) => (listeners[name] = listener),
    refresh: vi.fn(),
    enabled: true,
    isEnabled() {
      return this.enabled
    },
    setEnabled(value) {
      this.enabled = value
    },
    cellEditor: { focusContainer: vi.fn() },
    editing: false,
    isEditing() {
      return this.editing
    },
    stopEditing: vi.fn(),
    clearSelection: vi.fn(() => (selection = [])),
  }
  const actionState = {}
  /** draw.io's actions by name: each one made the first time it is asked for, as a stand-in for draw.io's own. */
  const actionMap = {}
  const actions = {
    get: (name) => (typeof name === 'string' ? (actionMap[name] ??= { funct: vi.fn(), isEnabled: () => true, shortcut: `draw.io's ${name}`, setEnabled: (on) => (actionState[name] = on) }) : undefined),
    addAction: (name, funct) => (actionMap[name] = { funct, isEnabled: () => true, shortcut: null }),
  }
  const bold = vi.fn()
  const duplicate = vi.fn()
  const keyHandler = {
    normalKeys: {},
    shiftKeys: {},
    controlKeys: { 66: bold, 68: duplicate },
    controlShiftKeys: {},
    isControlDown: (evt) => evt.ctrlKey === true || evt.metaKey === true,
    // draw.io's own rule: a bare A–Z with cells selected is nothing (typing edits the label).
    getFunction(evt) {
      if (evt.keyCode >= 65 && evt.keyCode <= 90 && selection.length > 0 && !evt.shiftKey && !evt.altKey && !this.isControlDown(evt)) return null
      const table = this.isControlDown(evt) ? (evt.shiftKey ? this.controlShiftKeys : this.controlKeys) : evt.shiftKey ? this.shiftKeys : this.normalKeys
      return table[evt.keyCode] ?? null
    },
  }
  // An EditorUi as draw.io builds it: its prototype's methods, PostConfig's wraps included.
  const ui = Object.assign(Object.create(env.EditorUi.prototype), { editor: { graph }, keyHandler, hsplitPosition: 208, hsplit: { style: {} }, setAdaptiveColors: vi.fn(), actions, opened: [] })
  env.EditorUi.prototype.createUi.call(ui)
  env.EditorUi.prototype.installKeyboardShortcuts.call(ui)
  return {
    ui,
    bold,
    duplicate,
    graph,
    actionState,
    action: (name) => actionMap[name],
    select: (...cs) => (selection = cs),
    /** A keydown as draw.io's handler takes it (a letter or a keyCode); true when something was bound to it. */
    press(key, mods = {}) {
      const run = keyHandler.getFunction({ keyCode: typeof key === 'number' ? key : key.toUpperCase().charCodeAt(0), ...mods })
      run?.call(keyHandler)
      return run != null
    },
    resized: (cs, previous) => listeners.cellsResized(graph, { getProperty: (name) => ({ cells: cs, previous })[name] }),
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

const RECT = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#1e1e1e;'
const NO_FILL_RECT = 'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#1e1e1e;'
const TEXT = 'text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;fontSize=20;'
const AI_TITLE = 'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=none;fontSize=32;'
const EDGE = 'edgeStyle=none;html=1;'
const FREEHAND = 'shape=stencil(eJzt);lineShape=1;strokeColor=#1e1e1e;'
const CLASSIC_FREEHAND = 'shape=stencil(eJzt);fillColor=none;strokeColor=#1e1e1e;'
const IMAGE = 'shape=image;aspect=fixed;image=data:image/png,x;'

describe('the overlay scripts', () => {
  it('every one parses', () => {
    const scripts = readdirSync(OVERLAY_JS).filter((name) => name.endsWith('.js'))
    expect(scripts).toContain('PostConfig.js')
    for (const name of scripts) execFileSync(process.execPath, ['--check', `${OVERLAY_JS}${name}`])
  })
})

describe('PostConfig.js (🔒 YAZ-1802 D12a / D12b), against a stand-in draw.io', () => {
  it('says yaseenReady once the font sheet is in draw.io — and still says it when the sheet will not load', async () => {
    const ok = loadPostConfig()
    await settle()
    expect(ok.fontCss).toEqual(['@font-face {}'])
    expect(ok.posted).toEqual([{ event: 'yaseenReady', origin: '*' }])

    const broken = loadPostConfig({ fetchFonts: async () => Promise.reject(new Error('offline')) })
    await settle()
    expect(broken.posted).toEqual([{ event: 'yaseenReady', origin: '*' }])
  })

  it('opens every diagram with the shapes panel collapsed, and ⌘-wheel zooms like ctrl-wheel', () => {
    const { env } = loadPostConfig()
    const { ui } = openEditor(env)
    expect(ui.hsplitPosition).toBe(0)
    expect(env.mxSettings.getSidebarWidth()).toBeNull()
    expect(env.Graph.prototype.isZoomWheelEvent({ metaKey: true })).toBe(true)
    expect(env.Graph.prototype.isZoomWheelEvent({ ctrlKey: true })).toBe(true)
    expect(env.Graph.prototype.isZoomWheelEvent({})).toBe(false)
  })

  it('YAZ-3719: a closed shapes panel has no drag strip, so a press at the frame’s left edge reaches the sidebar edge', () => {
    const { env } = loadPostConfig()
    const { ui } = openEditor(env)
    ui.refresh()
    expect(ui.hsplit.style.visibility).toBe('hidden')
    ui.hsplitPosition = 232 // the toolbar button, View › Shapes or ⌘⇧K
    ui.refresh()
    expect(ui.hsplit.style.visibility).toBe('')
    ui.hsplitPosition = 0 // the open panel dragged shut
    ui.refresh()
    expect(ui.hsplit.style.visibility).toBe('hidden')
  })

  it('YAZ-3420 D1: nothing else opens by itself — no saved Format width, no restored windows, no Layers for layers, no panel on a wider frame', () => {
    const { env } = loadPostConfig()
    const { ui } = openEditor(env)
    expect(env.mxSettings.getFormatWidth()).toBe(0)
    ui.restoreVisibleWindows()
    ui.showLayersDialog()
    for (const width of [800, 1400, 700, 1600]) {
      ui.frameWidth = width
      ui.windowResized()
    }
    expect(ui.opened).toEqual([])
  })

  it('YAZ-3420 D2: a load flagged yaseenKeepView keeps the page (by id, then by place), the zoom and the scroll; anything else is draw.io’s fit', () => {
    const { env, message } = loadPostConfig()
    const { ui, graph } = openEditor(env)
    const page = (id) => ({ getId: () => id })
    const view = { scale: 1, setScale(scale) { this.scale = scale } }
    graph.view = view
    /** The host's load, then what draw.io does with it: `setFileData` (with its own page fit inside), then `fitInitialView`. */
    const load = (pages, keepView) => {
      message({ action: 'load', xml: '<mxfile/>', yaseenKeepView: keepView })
      ui.setFileData(pages)
      ui.fitInitialView()
      return [ui.currentPage.getId(), view.scale, ui.scroll, ui.fitted]
    }
    Object.assign(ui, { pages: [page('a'), page('b')], scroll: { x: 300, y: 120 } })
    ui.currentPage = ui.pages[1]
    view.scale = 1.5
    // K1, K5: the same page by id, though a page was added before it.
    expect(load([page('new'), page('a'), page('b')], true)).toEqual(['b', 1.5, { x: 300, y: 120 }, false])
    // K4: new ids — the page at the same place.
    expect(load([page('x'), page('y'), page('z')], true)).toEqual(['z', 1.5, { x: 300, y: 120 }, false])
    // K3: that page and its place are gone — draw.io's first page and fit.
    expect(load([page('q')], true)).toEqual(['q', 1, { x: 0, y: 0 }, true])
    // K6: a load with no flag (the tab's first) fits, and a flag never outlives its load.
    view.scale = 2
    expect(load([page('q'), page('r')], false)).toEqual(['q', 1, { x: 0, y: 0 }, true])
    ui.fitInitialView()
    expect(ui.fitted).toBe(true)
    // A file draw.io cannot read throws in `setFileData`: the next fit (a page shown for the first time) is draw.io's own.
    message({ action: 'load', xml: '<mxfile/>', yaseenKeepView: true })
    expect(() => ui.setFileData(null)).toThrow()
    ui.fitted = false
    ui.fitInitialView()
    expect([ui.currentPage.getId(), ui.fitted]).toEqual(['q', true])
  })

  it('ends the EMPTY canvas right-click menu with draw.io’s Grid toggle, and leaves a selection’s menu alone', () => {
    const { env } = loadPostConfig()
    const shape = cell(RECT)
    const editor = openEditor(env)
    const popup = () => {
      const menu = { items: [], addSeparator: () => menu.items.push('-') }
      env.Menus.prototype.createPopupMenu.call({ editorUi: editor.ui, addMenuItems: (m, names) => m.items.push(...names) }, menu, null, {})
      return menu.items
    }
    expect(popup()).toEqual(['zoomIn', 'zoomOut', '-', 'grid'])
    editor.select(shape)
    expect(popup()).toEqual(['zoomIn', 'zoomOut'])
  })

  describe('colour letters, with a selection — the Excalidraw fork’s rule', () => {
    it('fill a shape with the LIGHT shade and, with Shift, stroke it with the dark one — a no-fill rectangle gets filled too', () => {
      const { env } = loadPostConfig()
      const [shape, hollow] = [cell(RECT), cell(NO_FILL_RECT)]
      const editor = openEditor(env)
      editor.select(shape, hollow)
      expect(editor.press('r')).toBe(true)
      expect([shape.style.fillColor, hollow.style.fillColor]).toEqual(['#ffc9c9', '#ffc9c9'])
      editor.press('u', { shiftKey: true })
      expect([shape.style.strokeColor, shape.style.fillColor]).toEqual(['#1971c2', '#ffc9c9'])
    })

    it('give text the dark shade as its font colour and, with Shift, the light shade as its background — text being anything that LOOKS like text', () => {
      const { env } = loadPostConfig()
      const [text, title] = [cell(TEXT, { label: 'Note' }), cell(AI_TITLE, { label: 'Find the bottleneck' })]
      const editor = openEditor(env)
      editor.select(text, title)
      editor.press('g')
      expect([text.style.fontColor, title.style.fontColor]).toEqual(['#2f9e44', '#2f9e44'])
      editor.press('g', { shiftKey: true })
      expect([text.style.labelBackgroundColor, title.style.labelBackgroundColor]).toEqual(['#b2f2bb', '#b2f2bb'])
      expect(title.style.fillColor).toBe('none')
    })

    it('stroke lines and both freehand pens with the dark shade, and border an image — Shift or not', () => {
      const { env } = loadPostConfig()
      const cells = [cell(EDGE, { edge: true }), cell(FREEHAND), cell(CLASSIC_FREEHAND), cell(IMAGE)]
      const editor = openEditor(env)
      editor.select(...cells)
      editor.press('o')
      expect(cells.map((c) => c.style.strokeColor ?? c.style.imageBorder)).toEqual(['#e8590c', '#e8590c', '#e8590c', '#e8590c'])
      editor.press('v', { shiftKey: true })
      expect(cells.map((c) => c.style.strokeColor ?? c.style.imageBorder)).toEqual(['#6741d9', '#6741d9', '#6741d9', '#6741d9'])
      expect(cells[3].style.strokeColor).toBeUndefined()
    })

    it('t, b and w are one value wherever they land', () => {
      const { env } = loadPostConfig()
      const [shape, text] = [cell(RECT), cell(TEXT, { label: 'Note' })]
      const editor = openEditor(env)
      editor.select(shape, text)
      editor.press('t')
      expect([shape.style.fillColor, text.style.fontColor]).toEqual(['none', 'none'])
      editor.press('b')
      expect([shape.style.fillColor, text.style.fontColor]).toEqual(['#1e1e1e', '#1e1e1e'])
      editor.press('w', { shiftKey: true })
      expect([shape.style.strokeColor, text.style.labelBackgroundColor]).toEqual(['#ffffff', '#ffffff'])
    })

    it('leave a locked cell as it is', () => {
      const { env } = loadPostConfig()
      const locked = cell(RECT, { locked: true })
      const editor = openEditor(env)
      editor.select(locked)
      editor.press('r')
      expect(locked.style.fillColor).toBe('#ffffff')
    })
  })

  it('leaves a letter to draw.io with nothing selected (the configure reply’s tools) and with ⌘ or ⌥ held', () => {
    const { env } = loadPostConfig()
    const shape = cell(RECT)
    const editor = openEditor(env)
    editor.ui.keyHandler.normalKeys[82] = vi.fn()
    expect(editor.press('r')).toBe(true)
    expect(editor.ui.keyHandler.normalKeys[82]).toHaveBeenCalledOnce()
    editor.select(shape)
    editor.press('r', { metaKey: true })
    editor.press('r', { altKey: true })
    expect(shape.style.fillColor).toBe('#ffffff')
    // A letter that is no colour starts typing into the label, as draw.io intends.
    expect(editor.press('x')).toBe(false)
  })

  it('1–0 set a text’s font size and give anything else a new long side, aspect and centre kept', () => {
    const { env } = loadPostConfig()
    const text = cell(TEXT, { label: 'Note' })
    const shape = cell(RECT, { geo: geometry(0, 0, 100, 50) })
    const edge = cell(EDGE, { edge: true, geo: geometry(0, 0, 0, 0, true) })
    const editor = openEditor(env)
    editor.select(text, shape, edge)
    editor.press('3')
    expect(text.style.fontSize).toBe(20)
    expect(editor.graph.updateCellSize).toHaveBeenCalledWith(text, true)
    expect(shape.geo).toMatchObject({ x: 2, y: 1, width: 96, height: 48 })
    editor.press('0')
    expect(text.style.fontSize).toBe(128)
    expect(shape.geo).toMatchObject({ x: -462, y: -231, width: 1024, height: 512 })
    expect(edge.geo).toMatchObject({ width: 0, height: 0 })
    expect(editor.press('3', { shiftKey: true })).toBe(false)
  })

  it('⌘⇧X toggles strikethrough', () => {
    const { env } = loadPostConfig()
    const text = cell(TEXT, { label: 'Note' })
    const editor = openEditor(env)
    editor.select(text)
    editor.press('x', { metaKey: true, shiftKey: true })
    expect(text.style.fontStyle).toBe(8)
    editor.press('x', { metaKey: true, shiftKey: true })
    expect(text.style.fontStyle).toBe(0)
  })

  it('⌘B is draw.io’s bold and nothing else: the sidebar key is the menu’s ⌘⇧B since YAZ-3564 D10, so nothing goes up to the host', async () => {
    const { env, posted } = loadPostConfig()
    await settle()
    const shape = cell(RECT)
    const editor = openEditor(env)
    editor.select(shape)
    editor.press('b', { metaKey: true })
    expect(editor.bold).toHaveBeenCalledOnce()
    expect(posted.filter((m) => m.event === 'shortcut')).toHaveLength(0)
  })

  describe('the user’s diagram keys, through the configure reply (YAZ-3564 K4, K12, K15)', () => {
    const open = (hotkeys) => {
      const { env } = loadPostConfig({ shortcuts: drawioConfig('adapt', hotkeys, {}, true).keyboardShortcuts })
      const editor = openEditor(env)
      const text = cell(TEXT, { label: 'Note' })
      editor.select(text)
      return { editor, text }
    }

    it('a remapped key works, the old one does nothing, and the action shows the new key — a ⌘, too, which draw.io cannot name', () => {
      const { editor, text } = open({ 'diagram.strikethrough': 'CmdOrCtrl+Shift+,' })
      expect(editor.press('x', { metaKey: true, shiftKey: true })).toBe(false)
      expect(editor.press(188, { metaKey: true, shiftKey: true })).toBe(true)
      expect(text.style.fontStyle).toBe(8)
      expect(editor.action('yaseenStrikethrough').shortcut).toBe('⌘+⇧+,')
      expect(open({}).editor.action('yaseenStrikethrough').shortcut).toBe('⌘+⇧+X')
    })

    it('a cleared key does nothing, and its action shows no key; so do the actions whose letters the tools took', () => {
      const { editor } = open({ 'diagram.duplicate': null })
      expect(editor.press('d', { metaKey: true })).toBe(false)
      expect(editor.action('duplicate').shortcut).toBeNull()
      for (const name of ['insertNote', 'insertRhombus']) expect(editor.action(name).shortcut).toBeNull()
    })

    it('⌃ and ⌘ apart on a Mac: a diagram key on ⌃D leaves ⌘D its own, and an App key on ⌃D does not clear ⌘D', () => {
      const { editor } = open({ 'diagram.bold': 'Control+D' })
      expect(editor.press('d', { ctrlKey: true })).toBe(true)
      expect(editor.action('bold').funct).toHaveBeenCalledOnce()
      expect(editor.action('bold').shortcut).toBe('⌃+D')
      editor.press('d', { metaKey: true })
      expect(editor.duplicate).toHaveBeenCalledOnce()
      expect(open({ 'app.search': 'Control+D' }).editor.press('d', { metaKey: true })).toBe(true)
    })
  })

  it('the host’s yaseenAdaptiveColors moves draw.io’s DEFAULT and re-draws — a file’s own value is kept, and draw.io never sees the message (🔒 YAZ-1802 D16)', () => {
    const { env, message } = loadPostConfig()
    const editor = openEditor(env)
    expect(message({ action: 'yaseenAdaptiveColors', value: 'none' })).toBe(true)
    expect(env.Graph.defaultAdaptiveColors).toBe('none')
    expect(editor.ui.setAdaptiveColors).toHaveBeenLastCalledWith('default')
    expect(editor.graph.refresh).toHaveBeenCalledOnce()
    editor.graph.adaptiveColors = 'none'
    message({ action: 'yaseenAdaptiveColors', value: 'auto' })
    expect(env.Graph.defaultAdaptiveColors).toBe('auto')
    expect(editor.ui.setAdaptiveColors).toHaveBeenLastCalledWith('none')
  })

  it('skips draw.io\'s window.focus() for a load the host flags with yaseenKeepFocus, and only during that load (YAZ-3084)', async () => {
    const { env, message, windowFocus: focus } = loadPostConfig()
    message({ action: 'load', xml: '<mxfile/>', yaseenKeepFocus: true })
    env.window.focus()
    expect(focus).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0)) // after the flag's own timer
    env.window.focus()
    expect(focus).toHaveBeenCalledOnce()
    message({ action: 'load', xml: '<mxfile/>' })
    env.window.focus()
    expect(focus).toHaveBeenCalledTimes(2)
  })

  it('the host\u2019s yaseenReadOnly turns the graph off and on; draw.io never sees the message (YAZ-3076 D2)', () => {
    const { env, message } = loadPostConfig()
    const editor = openEditor(env)
    const shape = cell(RECT)
    editor.select(shape)
    editor.graph.editing = true
    expect(message({ action: 'yaseenReadOnly', value: true })).toBe(true)
    expect(editor.graph.isEnabled()).toBe(false)
    // A cell selected before keeps no Format panel, and a label being typed is cancelled, never applied (`stopEditing(cancel)`).
    expect(editor.graph.stopEditing).toHaveBeenCalledWith(true)
    expect(editor.graph.isSelectionEmpty()).toBe(true)
    // The toolbar's Undo and Redo do not edit a read-only diagram either.
    expect(editor.actionState).toMatchObject({ undo: false, redo: false })
    expect(message({ action: 'yaseenReadOnly', value: false })).toBe(true)
    expect(editor.graph.isEnabled()).toBe(true)
    expect(editor.actionState).toMatchObject({ undo: true, redo: true })
  })

  it('YAZ-3123: with a label being typed, the label is cancelled with draw.io\u2019s focus pull silenced, and the pull is put back after', () => {
    const { env, message } = loadPostConfig()
    const editor = openEditor(env)
    const pull = vi.fn()
    editor.graph.cellEditor = { focusContainer: pull }
    // draw.io's own wrap: `stopEditing` ends with `this.focusContainer()` on the cell editor.
    editor.graph.stopEditing.mockImplementation(() => editor.graph.cellEditor.focusContainer())
    editor.graph.editing = true
    expect(message({ action: 'yaseenReadOnly', value: true })).toBe(true)
    expect(editor.graph.stopEditing).toHaveBeenCalledWith(true)
    expect(pull).not.toHaveBeenCalled()
    expect(editor.graph.cellEditor.focusContainer).toBe(pull)
  })

  it('YAZ-3119: with no label being typed, yaseenReadOnly never calls stopEditing — draw.io\u2019s wrap of it focuses its container, which takes the keyboard from the host', () => {
    const { env, message } = loadPostConfig()
    const editor = openEditor(env)
    expect(message({ action: 'yaseenReadOnly', value: true })).toBe(true)
    expect(editor.graph.isEnabled()).toBe(false)
    expect(editor.graph.stopEditing).not.toHaveBeenCalled()
  })

  it('leaves every other message, and the same one from anywhere but the host, to draw.io', () => {
    const { env, message } = loadPostConfig()
    openEditor(env)
    expect(message({ action: 'load', xml: '<mxfile/>' })).toBe(false)
    expect(message({ action: 'yaseenAdaptiveColors', value: 'none' }, {})).toBe(false)
    expect(message({ action: 'yaseenReadOnly', value: true }, {})).toBe(false)
    expect(env.Graph.defaultAdaptiveColors).toBeUndefined()
  })

  it('a corner drag scales a text’s font with its height; a side drag and a shape’s label do not', () => {
    const { env } = loadPostConfig()
    const text = cell(TEXT, { label: 'Note', geo: geometry(0, 0, 200, 60) })
    const shape = cell(RECT, { label: 'Box', geo: geometry(0, 0, 200, 60) })
    const editor = openEditor(env)
    const before = geometry(0, 0, 100, 30)
    editor.resized([text, shape], [before, before])
    expect(text.style.fontSize).toBe(40)
    expect(shape.style.fontSize).toBeUndefined()
    text.geo = geometry(0, 0, 300, 60)
    editor.resized([text], [geometry(0, 0, 200, 60)])
    expect(text.style.fontSize).toBe(40)
  })
})

describe.skipIf(!existsSync(APP_MIN_JS))(`every draw.io action we name exists in the pinned ${DRAWIO_TAG}`, () => {
  it('the configure reply’s keyboard shortcuts, every diagram row’s action, the Grid menu item and the live theme', () => {
    const app = readFileSync(APP_MIN_JS, 'utf8')
    const shortcuts = drawioConfig('adapt').keyboardShortcuts
    const named = [...new Set([...shortcuts.map((s) => s.action), ...Object.values(DIAGRAM_ACTIONS)]), 'grid', 'darkMode', 'lightMode']
    // `yaseen…` actions are PostConfig.js's own (`addAction` in its installKeyboardShortcuts). `addAction` drops a
    // name's trailing '...' ("editData..." is `editData`); bold, italic and underline come from one font-style helper.
    for (const action of named.filter((a) => typeof a === 'string' && !a.startsWith('yaseen'))) {
      expect(app, action).toMatch(new RegExp(`(addAction|put)\\("${action}(\\.\\.\\.)?"|\\w\\("${action}",mxConstants\\.FONT_`))
    }
    expect(readFileSync(`${OVERLAY_JS}PostConfig.js`, 'utf8')).toContain("addAction('yaseenStrikethrough'")
  })

  /**
   * The diagram drift test (YAZ-3564 K1): draw.io's key table as the pinned bundle builds it — `createKeyHandler`,
   * the App block, the alt maps and `initPages`, in the bundle's order, so a later binding wins — then the app's
   * defaults on top (the configure reply with no change). Every binding left must be a row's key, and a changeable
   * row's key must be bound to its own action; every changeable row's key must be a real binding.
   */
  it('every binding of draw.io’s key table is a diagram row, and every changeable row is a binding of its action', () => {
    const app = readFileSync(APP_MIN_JS, 'utf8')
    const id = (k) => `${k.control ? '⌘' : ''}${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.keyCode}`
    /** [at, key, action] — action null clears, '(code)' is a binding to code. */
    const found = []
    for (const m of app.matchAll(/bindAction\((\d+),\s*(!0|!1),\s*"(\w+)"(?:,\s*(!0|!1))?\)/g)) {
      // ⌘S saveAndExit and ⌘⇧S save are bound only with `saveAndExit=1`; the frame URL says 0.
      if (app.slice(Math.max(0, m.index - 400), m.index).includes('urlParams.saveAndExit')) continue
      found.push([m.index, { keyCode: +m[1], control: m[2] === '!0', shift: m[4] === '!0' }, m[3]])
    }
    for (const m of app.matchAll(/\.(bindKey|bindShiftKey|bindControlKey|bindControlShiftKey)\((\d+),\s*(function|null)/g)) {
      found.push([m.index, { keyCode: +m[2], control: m[1].includes('Control'), shift: m[1].includes('Shift') }, m[3] === 'null' ? null : '(code)'])
    }
    const altMap = (name) => ({ control: name.startsWith('ctrl'), shift: name.includes('Shift'), alt: true })
    for (const m of app.matchAll(/EditorUi\.prototype\.(altShiftActions|ctrlAltShiftActions|ctrlAltActions|altActions)=\{([^}]*)\}/g)) {
      for (const e of m[2].matchAll(/(\d+):"(\w+)"/g)) found.push([m.index, { keyCode: +e[1], ...altMap(m[1]) }, e[2]])
    }
    for (const m of app.matchAll(/this\.(altShiftActions|ctrlAltShiftActions|ctrlAltActions|altActions)\[(\d+)\]="(\w+)"/g)) found.push([m.index, { keyCode: +m[2], ...altMap(m[1]) }, m[3]])
    // The pinned v31.5.2 has 102 (99 bindings and the 3 clipboard clears); a much smaller count means a pattern above went blind.
    expect(found.length).toBeGreaterThan(90)

    const table = new Map()
    const apply = (key, action) => (action === null ? table.delete(id(key)) : table.set(id(key), action))
    for (const [, key, action] of found.sort((a, b) => a[0] - b[0])) apply(key, action)
    for (const s of drawioConfig('adapt').keyboardShortcuts.filter((e) => 'action' in e && !('yaseenMacCtrl' in e))) {
      // Only the app's own defaults here: the menu's chords clear keys a row keeps (an App key shows it as Blocked, K3).
      if (s.action === null && typeof s.keyCode === 'number' && s.control === true) continue
      apply({ ...s, keyCode: typeof s.keyCode === 'string' ? s.keyCode.charCodeAt(0) : s.keyCode }, s.action)
    }

    /** Each row's keys as draw.io's table holds them, with the other codes of its default key. */
    const rowOf = new Map()
    for (const row of DIAGRAM_KEYS) {
      for (const key of row.keys) {
        const k = drawioKeyOf(key)
        expect(k, `${row.id} ${key}`).not.toBeNull()
        for (const keyCode of [k.keyCode, ...(DIAGRAM_EXTRA_CODES[row.id] ?? [])]) rowOf.set(id({ ...k, keyCode }), row)
      }
    }
    for (const [key, action] of table) {
      const row = rowOf.get(key)
      expect(row, `draw.io binds ${key} (${action}): no diagram row has it`).toBeDefined()
      if (row.changeable) expect(DIAGRAM_ACTIONS[row.id], `${row.id} on ${key}`).toBe(action)
    }
    for (const row of DIAGRAM_KEYS.filter((r) => r.changeable)) {
      for (const key of row.keys) expect(table.get(id(drawioKeyOf(key))), `${row.id} ${key}`).toBe(DIAGRAM_ACTIONS[row.id])
    }
  })

  it('the diagram rows: unique ids, one row per action, and no default key twice outside the selection-only rows', () => {
    const ids = DIAGRAM_KEYS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const actions = Object.values(DIAGRAM_ACTIONS)
    expect(new Set(actions).size).toBe(actions.length)
    // The colour letters and sizes act on a selection; the tool letters need nothing selected.
    const selectionOnly = new Set(['diagram.colour', 'diagram.colourOther', 'diagram.size'])
    const keys = DIAGRAM_KEYS.filter((r) => !selectionOnly.has(r.id)).flatMap((r) => r.keys.map((k) => JSON.stringify(drawioKeyOf(k))))
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })

  it('every draw.io internal PostConfig.js wraps, replaces or leans on — a rename would drop a feature without an error', () => {
    const app = readFileSync(APP_MIN_JS, 'utf8')
    const internals = {
      'Graph.isZoomWheelEvent': /Graph\.prototype\.isZoomWheelEvent\s*=\s*function/,
      'mxSettings.getSidebarWidth': /getSidebarWidth\s*:\s*function/,
      'EditorUi.createUi': /EditorUi\.prototype\.createUi\s*=\s*function/,
      'EditorUi.hsplitPosition': /\.hsplitPosition\s*=/,
      // YAZ-3719
      'the drag strip is this.hsplit': /this\.hsplit\s*=\s*this\.createDiv\("geHsplit"\)/,
      'refresh sets the shapes panel to hsplitPosition': /EditorUi\.prototype\.refresh\s*=\s*function[^}]*this\.sidebarContainer\.style\.width\s*=\s*this\.hsplitPosition/,
      'Menus.createPopupMenu': /Menus\.prototype\.createPopupMenu\s*=\s*function/,
      'Menus.addMenuItems': /Menus\.prototype\.addMenuItems\s*=\s*function/,
      'EditorUi.installKeyboardShortcuts': /EditorUi\.prototype\.installKeyboardShortcuts\s*=\s*function/,
      'keyHandler': /this\.keyHandler\s*=/,
      'mxKeyHandler.getFunction': /mxKeyHandler\.prototype\.getFunction\s*=\s*function/,
      'mxKeyHandler.isControlDown': /isControlDown\s*=\s*function/,
      'mxKeyHandler.bindControlKey': /bindControlKey\s*=\s*function/,
      'mxKeyHandler.bindControlShiftKey': /bindControlShiftKey\s*=\s*function/,
      // YAZ-3564: the configure reply's keys, their shown keys, and draw.io's one `control` for ⌃ and ⌘ (K15).
      'EditorUi.installKeyboardShortcut': /EditorUi\.prototype\.installKeyboardShortcut\s*=\s*function/,
      'installKeyboardShortcuts reads Editor.keyboardShortcuts': /this\.installKeyboardShortcut\(Editor\.keyboardShortcuts\[c\]\)/,
      'installKeyboardShortcut sets action.shortcut': /\.shortcut=\(c\.control\?Editor\.ctrlKey\+"\+":""\)/,
      'EditorUi.keyNames': /EditorUi\.keyNames\s*=\s*\{/,
      'Actions.addAction': /Actions\.prototype\.addAction\s*=\s*function/,
      'draw.io reads ⌘ as ⌃ on a Mac': /isControlDown=function\(z\)\{return mxEvent\.isControlDown\(z\)\|\|mxClient\.IS_MAC&&z\.metaKey\}/,
      'controlKeys[66] is bold': /\.controlKeys\[/,
      '⌘B bound to bold': /bindAction\(66,\s*!0,\s*"bold"\)/,
      'CELLS_RESIZED carries "previous"': /CELLS_RESIZED,\s*"cells",\s*\w+,\s*"bounds",\s*\w+,\s*"previous"/,
      'Graph.defaultAdaptiveColors': /Graph\.defaultAdaptiveColors\s*=/,
      'EditorUi.setAdaptiveColors': /EditorUi\.prototype\.setAdaptiveColors\s*=\s*function/,
      'graph.adaptiveColors': /\.adaptiveColors\s*=/,
      'Editor.configureFontCss': /Editor\.configureFontCss\s*=\s*function/,
      'Graph.toggleCellStyleFlags': /toggleCellStyleFlags\s*=\s*function/,
      'Graph.getEditableCells': /getEditableCells\s*=\s*function/,
      'Graph.updateCellSize': /updateCellSize\s*=\s*function/,
      'mxGraph.setEnabled': /mxGraph\.prototype\.setEnabled\s*=\s*function/,
      'mxGraph.isEnabled': /mxGraph\.prototype\.isEnabled\s*=\s*function/,
      'mxGraph.stopEditing': /mxGraph\.prototype\.stopEditing\s*=\s*function/,
      'mxGraph.isEditing': /mxGraph\.prototype\.isEditing\s*=\s*function/,
      'stopEditing ends with focusContainer()': /this\.focusContainer\(\)\};mxCellEditor\.prototype\.focusContainer\s*=\s*function/,
      'EditorUi sets cellEditor.focusContainer': /\.cellEditor\.focusContainer\s*=/,
      'mxGraph.clearSelection': /mxGraph\.prototype\.clearSelection\s*=\s*function/,
      'EditorUi.updateActionStates': /EditorUi\.prototype\.updateActionStates\s*=\s*function/,
      'actions.get("undo")': /this\.actions\.get\("undo"\)\.setEnabled/,
      // YAZ-3420 D1
      'mxSettings.getFormatWidth': /getFormatWidth\s*:\s*function/,
      'createUi reads getFormatWidth': /this\.formatWidth\s*=\s*mxSettings\.getFormatWidth\(\)/,
      'EditorUi.restoreVisibleWindows': /EditorUi\.prototype\.restoreVisibleWindows\s*=\s*function/,
      'EditorUi.showLayersDialog': /EditorUi\.prototype\.showLayersDialog\s*=\s*function/,
      'EditorUi.windowResized': /EditorUi\.prototype\.windowResized\s*=\s*function/,
      'windowResized asks lastWindowWidth': /null!=this\.lastWindowWidth&&this\.lastWindowWidth/,
      // YAZ-3420 D2
      'EditorUi.fitInitialView': /EditorUi\.prototype\.fitInitialView\s*=\s*function/,
      'EditorUi.setFileData': /EditorUi\.prototype\.setFileData\s*=\s*function/,
      'the embed load is setFileData, then fitInitialView': /this\.setFileData\(\w+\);Editor\.fitDiagramOnLoad&&this\.fitInitialView\(\)/,
      'Editor.fitDiagramOnLoad on': /Editor\.fitDiagramOnLoad\s*=\s*!0/,
      'EditorUi.getPageById': /EditorUi\.prototype\.getPageById\s*=\s*function/,
      'EditorUi.selectPage': /EditorUi\.prototype\.selectPage\s*=\s*function/,
      'EditorUi.saveScrollState': /EditorUi\.prototype\.saveScrollState\s*=\s*function/,
      'EditorUi.restoreScrollState': /EditorUi\.prototype\.restoreScrollState\s*=\s*function/,
    }
    for (const [name, pattern] of Object.entries(internals)) expect(app, name).toMatch(pattern)
  })
})
