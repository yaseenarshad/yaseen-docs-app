// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Making a pill in draw.io (YAZ-4748 2-, `desktop/drawio-overlay/js/yaseen-links.js`): the label editor (D6), paste, the
 * `[[` picker's half (D5) and the sidebar drop (D4). These live on the page (selection, ranges, nodes), so they run in
 * jsdom against a STAND-IN draw.io: its cell editor and the graph calls they make. jsdom has no `execCommand`, so text
 * goes in by the script's own fallback; the real editor's undo is the demo's.
 */
// jsdom gives `import.meta.url` no file scheme: the script is found from the run's folder (the repo, or `tools/`).
const SCRIPT = 'desktop/drawio-overlay/js/yaseen-links.js'
const LINKS_JS = readFileSync([SCRIPT, `../${SCRIPT}`].map((p) => path.resolve(process.cwd(), p)).find(existsSync), 'utf8')

/** The script's page listeners, taken off after each test: jsdom keeps one page for the file. */
const added = []
// jsdom's ranges have no boxes; the caret's box is the editor's then.
Range.prototype.getClientRects ??= () => []

function load({ linked = true } = {}) {
  const listen = document.addEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    added.push([type, listener, options])
    listen(type, listener, options)
  }
  const posted = []
  const textarea = document.createElement('div')
  textarea.contentEditable = 'true'
  document.body.appendChild(textarea)
  // draw.io's canvas clipboard: a hidden editable box that takes the canvas's copy, cut and paste.
  const clipboardElt = document.createElement('div')
  clipboardElt.contentEditable = 'true'
  document.body.appendChild(clipboardElt)
  const inserted = []
  const imported = []
  let editingCell = null
  function mxCellEditor(graph) {
    this.graph = graph
    this.textarea = textarea
  }
  // draw.io's own: the editor shows the value, and reads its HTML back.
  mxCellEditor.prototype.setEditingValue = function (_state, value) {
    this.textarea.innerHTML = value
  }
  mxCellEditor.prototype.getCurrentValue = function () {
    return this.textarea.innerHTML
  }
  mxCellEditor.prototype.stopEditing = function () {
    editingCell = null
  }
  mxCellEditor.prototype.getEditingCell = () => editingCell
  function mxCellRenderer() {}
  mxCellRenderer.prototype.getLabelValue = (state) => state.view.graph.getLabel(state.cell)
  function Graph() {}
  Graph.prototype.getLabel = (cell) => cell.label
  Graph.prototype.isHtmlLabel = () => true
  const graph = new Graph()
  /** One model: its undo steps are counted, and each insert notes how deep in a step it is. */
  const model = { depth: 0, steps: 0, beginUpdate: () => model.depth++ === 0 && model.steps++, endUpdate: () => model.depth--, getGeometry: () => ({ height: 30 }), getCell: () => null }
  Object.assign(graph, {
    enabled: true,
    container: document.body,
    view: { scale: 1, translate: { x: 0, y: 0 }, states: { visit: () => {} }, invalidate: vi.fn(), validate: vi.fn() },
    isEnabled: () => graph.enabled,
    isEditing: (cell) => (cell == null ? editingCell !== null : cell === editingCell),
    getModel: () => model,
    getCurrentCellStyle: () => ({ html: '1' }),
    getDefaultParent: () => 'layer',
    insertVertex: (parent, id, value, x, y) => {
      const cell = { value, x, y, depth: model.depth }
      inserted.push(cell)
      return cell
    },
    updateCellSize: vi.fn(),
    setSelectionCells: vi.fn(),
    getInsertPoint: () => ({ x: 40, y: 50 }),
  })
  graph.cellEditor = new mxCellEditor(graph)
  // draw.io's editor: the shape links (D8) wrap its handling of custom links.
  function EditorUi() {}
  EditorUi.prototype.handleCustomLink = () => {}
  Object.assign(globalThis, {
    Graph,
    EditorUi,
    mxCellEditor,
    mxCellRenderer,
    mxUtils: { convertPoint: (_c, x, y) => ({ x, y }) },
    mxClient: { IS_MAC: true },
  })
  new Function(LINKS_JS)()
  const links = globalThis.yaseenLinks
  links.setLooks({ 'YAZ-1': { label: 'Roadmap', icon: null }, 'YAZ-7': { label: 'Plan', icon: null } })
  const ui = {
    editor: { graph },
    clipboardElt,
    importFiles: (files, x, y) => imported.push({ names: files.map((f) => f.name), x, y }),
    // draw.io's own text paste: a text cell of its own.
    insertTextAt: vi.fn(() => ['draw.io text cell']),
  }
  const answer = links.installEditor(ui, (msg) => posted.push(msg))
  // A window with a link source: the host's first word turns the frame's link work on (A3).
  if (linked) answer({ action: 'yaseenLinkOpens', opens: ['M', 'MS'] })
  /** Opens the label editor on a cell with `label`, as draw.io does, with the caret at the end. */
  const edit = (label) => {
    editingCell = { id: 'a' }
    graph.cellEditor.setEditingValue({ cell: editingCell, style: { html: '1' } }, label)
    caretAtEnd()
  }
  const caretAtEnd = () => {
    const range = document.createRange()
    range.selectNodeContents(textarea)
    range.collapse(false)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
  }
  return { links, graph, model, ui, textarea, clipboardElt, posted, answer, edit, caretAtEnd, inserted, imported }
}

/** A page event the script hears in the capture phase; returns the event. */
function fire(target, type, init = {}, Kind = Event) {
  const evt = new Kind(type, { bubbles: true, cancelable: true, ...init })
  for (const [key, value] of Object.entries(init)) if (!(key in evt)) Object.defineProperty(evt, key, { value })
  target.dispatchEvent(evt)
  return evt
}

const clipboard = (text) => ({ getData: (type) => (type === 'text/plain' ? text : '') })

afterEach(() => {
  for (const [type, listener, options] of added.splice(0)) document.removeEventListener(type, listener, options)
  delete document.addEventListener
  document.body.replaceChildren()
  delete globalThis.yaseenLinks
})

describe('the label editor keeps a pill one unit (D6)', () => {
  it('opens with each [[link]] as a pill that is no text to type into, and saves the raw link again — the pill stays', () => {
    const { textarea, graph, edit } = load()
    edit('See [[YAZ-1]] now')
    const pill = textarea.querySelector('.yaseen-pill')
    expect(pill.textContent).toBe('Roadmap')
    expect(pill.contentEditable).toBe('false')
    expect(graph.cellEditor.getCurrentValue()).toBe('See [[YAZ-1]] now')
    expect(textarea.querySelector('.yaseen-pill')).toBe(pill)
  })

  it('reads the editor as the picker does: a pill as its raw link, a line break as \\n', () => {
    const { links, textarea, edit } = load()
    edit('See [[YAZ-1]]<br>next<div>block</div>')
    expect(links.modelOf(textarea).text).toBe('See [[YAZ-1]]\nnext\nblock')
  })

  it('copies a pill out of a label as its [[link]] text', () => {
    const { textarea, edit } = load()
    edit('See [[YAZ-1]] now')
    const range = document.createRange()
    range.selectNodeContents(textarea)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
    const data = {}
    const evt = fire(textarea, 'copy', { clipboardData: { setData: (type, value) => (data[type] = value) } })
    expect(evt.defaultPrevented).toBe(true)
    expect(data['text/plain']).toBe('See [[YAZ-1]] now')
  })
})

describe('cut in a label (A10)', () => {
  const selectAll = (textarea) => {
    const range = document.createRange()
    range.selectNodeContents(textarea)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
  }

  it('cuts through the editing commands, so ⌘Z brings the text back; with none it deletes by hand', () => {
    const { textarea, edit } = load()
    edit('See [[YAZ-1]] now')
    selectAll(textarea)
    document.execCommand = vi.fn(() => true)
    try {
      const data = {}
      fire(textarea, 'cut', { clipboardData: { setData: (type, value) => (data[type] = value) } })
      expect(data['text/plain']).toBe('See [[YAZ-1]] now')
      expect(document.execCommand).toHaveBeenCalledWith('delete')
      // The command did the delete (here a stand-in): the page was not cut by hand as well.
      expect(textarea.textContent).toBe('See Roadmap now')
      document.execCommand = vi.fn(() => false)
      fire(textarea, 'cut', { clipboardData: { setData: () => {} } })
      expect(textarea.textContent).toBe('')
    } finally {
      delete document.execCommand
    }
  })
})

describe('paste (2A)', () => {
  it('on the canvas: asks the host about a path, and the link it answers is a new text box at the insert point, as one undo step', () => {
    const { clipboardElt, posted, answer, inserted, model } = load()
    const evt = fire(clipboardElt, 'paste', { clipboardData: clipboard('/vault/Plan.md') })
    expect(evt.defaultPrevented).toBe(true)
    expect(posted).toEqual([{ event: 'yaseenPaste', id: 1, text: '/vault/Plan.md' }])
    answer({ action: 'yaseenPasteAnswer', id: 1, link: '[[YAZ-7]]' })
    expect(inserted).toEqual([{ value: '[[YAZ-7]]', x: 40, y: 50, depth: 1 }])
    expect(model.steps).toBe(1)
    expect(model.depth).toBe(0)
  })

  it('A12: on the canvas, a path that is no page is draw.io’s own text paste', () => {
    const { clipboardElt, graph, ui, posted, answer, inserted } = load()
    fire(clipboardElt, 'paste', { clipboardData: clipboard('/not/a/page') })
    answer({ action: 'yaseenPasteAnswer', id: posted[0].id, link: null })
    expect(inserted).toEqual([])
    expect(ui.insertTextAt).toHaveBeenCalledWith('/not/a/page', 40, 50, false)
    expect(graph.setSelectionCells).toHaveBeenLastCalledWith(['draw.io text cell'])
  })

  it('A2: a path pasted in one of draw.io’s fields (Edit Link, Find, a panel) goes in the field', () => {
    const { posted } = load()
    for (const tag of ['input', 'textarea']) {
      const field = document.body.appendChild(document.createElement(tag))
      expect(fire(field, 'paste', { clipboardData: clipboard('/vault/Plan.md') }).defaultPrevented).toBe(false)
    }
    const editable = document.body.appendChild(document.createElement('div'))
    editable.contentEditable = 'true'
    expect(fire(editable, 'paste', { clipboardData: clipboard('yaseendocs://open?path=x') }).defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })

  it('in a label: the answer goes in at the caret as its pill, drawn with the look the host sent with it (A13); no link is the text as it is', () => {
    const { textarea, posted, answer, edit } = load()
    edit('x ')
    fire(textarea, 'paste', { clipboardData: clipboard('/vault/Plan.md') })
    answer({ action: 'yaseenPasteAnswer', id: posted[0].id, link: '[[YAZ-9]]', looks: { 'YAZ-9': { label: 'Nine', icon: null } } })
    expect(textarea.querySelector('.yaseen-pill').textContent).toBe('Nine')
    fire(textarea, 'paste', { clipboardData: clipboard('/not/a/page') })
    answer({ action: 'yaseenPasteAnswer', id: posted.at(-1).id, link: null })
    expect(textarea.textContent).toContain('/not/a/page')
  })

  it('a copied [[link]] goes in a label as its pill at once; other text, two lines and ⌘⇧V are draw.io’s', () => {
    const { textarea, posted, edit } = load()
    edit('')
    expect(fire(textarea, 'paste', { clipboardData: clipboard('[[YAZ-1]]') }).defaultPrevented).toBe(true)
    expect(textarea.querySelector('.yaseen-pill').textContent).toBe('Roadmap')
    expect(fire(textarea, 'paste', { clipboardData: clipboard('plain words') }).defaultPrevented).toBe(false)
    expect(fire(textarea, 'paste', { clipboardData: clipboard('/vault/a.md\n/vault/b.md') }).defaultPrevented).toBe(false)
    fire(textarea, 'keydown', { key: 'V', metaKey: true, shiftKey: true }, KeyboardEvent)
    expect(fire(textarea, 'paste', { clipboardData: clipboard('/vault/Plan.md') }).defaultPrevented).toBe(false)
    expect(posted.filter((m) => m.event === 'yaseenPaste')).toEqual([])
  })

  it('A11: a ⌘⇧V that made no paste does not keep the next paste plain', () => {
    const { clipboardElt, posted } = load()
    fire(clipboardElt, 'keydown', { key: 'v', metaKey: true, shiftKey: true }, KeyboardEvent)
    fire(clipboardElt, 'keydown', { key: 'a' }, KeyboardEvent)
    expect(fire(clipboardElt, 'paste', { clipboardData: clipboard('/vault/Plan.md') }).defaultPrevented).toBe(true)
    expect(posted).toEqual([{ event: 'yaseenPaste', id: 1, text: '/vault/Plan.md' }])
  })

  it('a read-only diagram leaves every paste to draw.io', () => {
    const { graph, clipboardElt, posted } = load()
    graph.enabled = false
    expect(fire(clipboardElt, 'paste', { clipboardData: clipboard('/vault/Plan.md') }).defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })

  it('A3: with no link source every paste, the [[ typing and the sidebar drop stay draw.io’s', () => {
    const { textarea, clipboardElt, posted, answer, edit, caretAtEnd } = load({ linked: false })
    expect(fire(clipboardElt, 'paste', { clipboardData: clipboard('/vault/Plan.md') }).defaultPrevented).toBe(false)
    edit('x ')
    expect(fire(textarea, 'paste', { clipboardData: clipboard('/vault/Plan.md') }).defaultPrevented).toBe(false)
    expect(fire(textarea, 'paste', { clipboardData: clipboard('[[YAZ-1]]') }).defaultPrevented).toBe(false)
    textarea.append('[[pl')
    caretAtEnd()
    fire(textarea, 'input')
    answer({ action: 'yaseenSidebarDrag', on: true })
    fire(document.body, 'dragover')
    expect(fire(document.body, 'drop', { dataTransfer: { files: [new File(['x'], 'A.md', { type: 'text/markdown' })] } }).defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })
})

describe('the [[ picker’s half (2A, D5)', () => {
  it('tells the host the editor only while [[ is open before the caret, and once more when it closes', () => {
    const { textarea, posted, edit, caretAtEnd } = load()
    edit('plain')
    fire(textarea, 'input')
    expect(posted).toEqual([])
    textarea.append(' [[pl')
    caretAtEnd()
    fire(textarea, 'input')
    expect(posted).toEqual([{ event: 'yaseenEditor', state: expect.objectContaining({ text: 'plain [[pl', caret: 10, typed: true, cellId: 'a' }) }])
    textarea.append(']]')
    caretAtEnd()
    fire(textarea, 'input')
    expect(posted.at(-1)).toEqual({ event: 'yaseenEditor', state: null })
  })

  it('A9: a keystroke’s input and its selection change post the state once', () => {
    const { textarea, posted, edit, caretAtEnd } = load()
    edit('[[pl')
    fire(textarea, 'input')
    fire(document, 'selectionchange')
    expect(posted.filter((m) => m.event === 'yaseenEditor')).toHaveLength(1)
    textarea.append('a')
    caretAtEnd()
    fire(textarea, 'input')
    expect(posted.filter((m) => m.event === 'yaseenEditor')).toHaveLength(2)
  })

  it('while the host’s picker is open, its keys go up and never reach draw.io', () => {
    const { textarea, posted, answer, edit } = load()
    edit('[[pl')
    answer({ action: 'yaseenPickerOpen', open: true })
    expect(fire(textarea, 'keydown', { key: 'ArrowDown' }, KeyboardEvent).defaultPrevented).toBe(true)
    expect(posted.at(-1)).toEqual({ event: 'yaseenEditorKey', key: 'ArrowDown' })
    answer({ action: 'yaseenPickerOpen', open: false })
    expect(fire(textarea, 'keydown', { key: 'Enter' }, KeyboardEvent).defaultPrevented).toBe(false)
  })

  it('a pick puts the link in place of the typed [[ as its pill', () => {
    const { textarea, answer, edit } = load()
    edit('See [[pl')
    answer({ action: 'yaseenEditorReplace', start: 4, end: 8, text: '[[YAZ-7]]' })
    expect(textarea.textContent).toBe('See Plan')
    expect(textarea.querySelector('.yaseen-pill').contentEditable).toBe('false')
  })
})

describe('the sidebar drop (2B, D4)', () => {
  const file = (name, type) => new File(['x'], name, { type })
  const drop = (files, at = { clientX: 100, clientY: 200 }) => fire(document.body, 'drop', { dataTransfer: { files }, ...at })
  /** The OS drag over the page, as Chromium fires it before the drop. */
  const over = () => fire(document.body, 'dragover')

  it('takes a drop of pages only while the sidebar drags them; boxes stack down in one undo step, pictures go below the last', () => {
    const { posted, answer, inserted, imported, model } = load()
    over()
    expect(drop([file('A.md', 'text/markdown')]).defaultPrevented).toBe(false)
    answer({ action: 'yaseenSidebarDrag', on: true })
    over()
    expect(drop([file('A.md', 'text/markdown'), file('B.md', 'text/markdown'), file('p.png', 'image/png')]).defaultPrevented).toBe(true)
    // A6: the host links only the pages, by their names; the picture is the frame's.
    expect(posted).toEqual([{ event: 'yaseenDrop', id: 1, names: ['A.md', 'B.md'] }])
    answer({ action: 'yaseenDropLinks', id: 1, links: ['[[YAZ-1]]', '[[YAZ-7]]'] })
    expect(inserted).toEqual([
      { value: '[[YAZ-1]]', x: 100, y: 200, depth: 1 },
      { value: '[[YAZ-7]]', x: 100, y: 240, depth: 1 },
    ])
    expect(model.steps).toBe(1)
    expect(imported).toEqual([{ names: ['p.png'], x: 100, y: 280 }])
  })

  it('A5: the host’s "off" that comes before the drop does not lose it; after one taken drop a Finder drop is draw.io’s', () => {
    const { posted, answer } = load()
    answer({ action: 'yaseenSidebarDrag', on: true })
    over()
    // main ended the drag at the release; its word is here before the OS drop.
    answer({ action: 'yaseenSidebarDrag', on: false })
    expect(drop([file('A.md', 'text/markdown')]).defaultPrevented).toBe(true)
    answer({ action: 'yaseenSidebarDrag', on: true })
    over()
    expect(drop([file('A.md', 'text/markdown')]).defaultPrevented).toBe(true)
    // No end came from the host: the next drag (from Finder) is still not ours.
    over()
    expect(drop([file('C.md', 'text/markdown')]).defaultPrevented).toBe(false)
    expect(posted.map((m) => m.id)).toEqual([1, 2])
  })

  it('A5: a sidebar drag that left the page and ended elsewhere leaves the next drop to draw.io', () => {
    const { posted, answer } = load()
    answer({ action: 'yaseenSidebarDrag', on: true })
    over()
    fire(document.body, 'dragleave', { relatedTarget: null })
    answer({ action: 'yaseenSidebarDrag', on: false })
    expect(drop([file('A.md', 'text/markdown')]).defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })

  it('leaves a drop of pictures only to draw.io; a read-only diagram takes the drop and adds nothing', () => {
    const { graph, posted, answer } = load()
    answer({ action: 'yaseenSidebarDrag', on: true })
    over()
    expect(drop([file('p.png', 'image/png')]).defaultPrevented).toBe(false)
    graph.enabled = false
    answer({ action: 'yaseenSidebarDrag', on: true })
    over()
    expect(drop([file('A.md', 'text/markdown')]).defaultPrevented).toBe(true)
    expect(posted).toEqual([])
  })
})
