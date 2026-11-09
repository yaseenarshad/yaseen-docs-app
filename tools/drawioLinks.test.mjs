import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { DRAWIO_TAG } from './packDrawio.mjs'

/**
 * OUR link pills in draw.io (YAZ-4748, `desktop/drawio-overlay/js/yaseen-links.js`), run in a `vm` context against a
 * STAND-IN draw.io: the label calls, the model and the page events it touches. The real editor is the demo's.
 */
const LINKS_JS = fileURLToPath(new URL('../desktop/drawio-overlay/js/yaseen-links.js', import.meta.url))
const APP_MIN_JS = fileURLToPath(new URL(`../desktop/.cache/drawio/${DRAWIO_TAG}/js/app.min.js`, import.meta.url))

/** A page element as the events see it: `closest` finds a pill up the parents. */
function element(className = '', { parent = null, attrs = {}, rect = { left: 10, top: 20, right: 60, bottom: 40 } } = {}) {
  const el = {
    className,
    parent,
    getAttribute: (name) => attrs[name] ?? null,
    getBoundingClientRect: () => rect,
    closest: (selector) => {
      const wanted = selector.slice(1)
      for (let at = el; at !== null; at = at.parent) if (at.className.split(' ').includes(wanted)) return at
      return null
    },
    contains: (other) => {
      for (let at = other; at != null; at = at.parent) if (at === el) return true
      return false
    },
  }
  return el
}

function load() {
  const listeners = {}
  const cells = {}
  const page = {
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
    getSelection: () => null,
  }
  function Graph() {
    this.container = {}
    this.cellEditor = { textarea: null, getEditingCell: () => null }
    this.enabled = true
    this.refreshed = 0
    this.changed = []
  }
  // draw.io's own: the cell's label as written, and whether it is HTML (`html=1`).
  Graph.prototype.getLabel = (cell) => cell.label
  Graph.prototype.isHtmlLabel = (cell) => cell.html
  Graph.prototype.convertValueToString = (cell) => cell.label
  Graph.prototype.getModel = () => ({ getCell: (id) => cells[id] ?? null })
  Graph.prototype.getCellAt = (x, y) => (x === 5 && y === 7 ? cells.a : null)
  Graph.prototype.isEnabled = function () {
    return this.enabled
  }
  Graph.prototype.refresh = function () {
    this.refreshed++
  }
  // draw.io's own link doors: only `data:` is its custom link, which the editor handles; a web link opens a window.
  Graph.prototype.isCustomLink = (link) => link.substring(0, 5) === 'data:'
  Graph.prototype.openLink = vi.fn(() => 'window')
  function EditorUi() {}
  EditorUi.prototype.handleCustomLink = vi.fn()
  Graph.prototype.labelChanged = function (cell, value) {
    this.changed.push([cell.id, value])
    cell.label = value
  }
  const posted = []
  // draw.io's own label editor: the making half (drawioLinksEditor.test.mjs) wraps it; these tests do not use it.
  function mxCellEditor() {}
  mxCellEditor.prototype.setEditingValue = () => {}
  mxCellEditor.prototype.getCurrentValue = () => ''
  mxCellEditor.prototype.stopEditing = () => {}
  const env = {
    Graph,
    EditorUi,
    mxCellEditor,
    console: { error: vi.fn() },
    mxUtils: { convertPoint: (_container, x, y) => ({ x: x - 100, y: y - 100 }) },
    mxClient: { IS_MAC: true },
    setTimeout,
    document: { ...page, head: { appendChild: vi.fn() }, createElement: () => ({}) },
  }
  env.window = env
  createContext(env)
  runInContext(readFileSync(LINKS_JS, 'utf8'), env)
  const graph = new Graph()
  const cell = (id, label, html = true) => (cells[id] = { id, label, html })
  /** A label as drawn, without the pills' inline look (one test pins that). */
  const label = (c) => {
    const drawn = graph.getLabel(c)
    return typeof drawn === 'string' ? drawn.replace(/ style="[^"]*"/g, '') : drawn
  }
  /** The editor's half, as PostConfig.js installs it; returns its answer to the host's messages. */
  const install = () => env.yaseenLinks.installEditor({ editor: { graph } }, (msg) => posted.push(msg))
  /** A page event in the capture phase; true when the pills stopped it. */
  const fire = (type, init) => {
    const evt = { button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, clientX: 105, clientY: 107, ...init, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    for (const listener of listeners[type] ?? []) listener(evt)
    return evt.stopPropagation.mock.calls.length > 0
  }
  return { env, graph, cell, label, install, fire, posted, EditorUi }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const LOOK = { label: 'Roadmap', icon: 'data:image/png;base64,AAA' }

describe('yaseen-links.js: a label draws its links as pills (D1, D3)', () => {
  it('draws a found page with its icon and name, a missing one dim with no icon, and an icon not drawn yet as its empty box', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK, Gone: { label: 'Gone', missing: true }, 'YAZ-2': { label: 'Pricing' }, 'YAZ-3': { label: 'Plain', icon: null } })
    expect(label(cell('a', 'See [[YAZ-1]] and [[Gone]]'))).toBe(
      'See <span class="yaseen-pill yaseen-link-0"><img class="yaseen-pill__icon" src="data:image/png;base64,AAA">Roadmap</span>' +
        ' and <span class="yaseen-pill yaseen-link-1 yaseen-pill--missing">Gone</span>',
    )
    expect(label(cell('b', '[[YAZ-2]] [[YAZ-1]]'))).toBe(
      '<span class="yaseen-pill yaseen-link-2"><span class="yaseen-pill__icon"></span>Pricing</span> <span class="yaseen-pill yaseen-link-0"><img class="yaseen-pill__icon" src="data:image/png;base64,AAA">Roadmap</span>',
    )
    expect(label(cell('c', '[[YAZ-3]]'))).toBe('<span class="yaseen-pill yaseen-link-3">Plain</span>')
  })

  it('keeps raw text for a link with nothing to show, a plain-text label, and a label with no link', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'Note|': null, 'YAZ-1': LOOK })
    expect(label(cell('a', 'x [[Note|]] y'))).toBe('x [[Note|]] y')
    expect(label(cell('b', 'See [[YAZ-1]]', false))).toBe('See [[YAZ-1]]')
    expect(label(cell('c', 'no links'))).toBe('no links')
  })

  it('reads an HTML label’s link as written and escapes what it draws', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'Q&A': { label: '<b>Q&A</b>', icon: null } })
    expect(label(cell('a', '[[Q&amp;A]]'))).toBe('<span class="yaseen-pill yaseen-link-0">&lt;b&gt;Q&amp;A&lt;/b&gt;</span>')
  })

  it('carries each pill’s link as a numbered class — what draw.io’s HTML cleaner keeps — and reads it back', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK, 'Plan|the plan': { label: 'the plan' } })
    label(cell('a', '[[YAZ-1]] [[Plan|the plan]]'))
    expect(env.yaseenLinks.innerOf({ className: 'yaseen-pill yaseen-link-1' })).toBe('Plan|the plan')
    expect(env.yaseenLinks.innerOf({ className: 'yaseen-pill yaseen-link-0 yaseen-pill--missing' })).toBe('YAZ-1')
    expect(env.yaseenLinks.innerOf({ className: 'yaseen-pill yaseen-link-9' })).toBeNull()
    expect(env.yaseenLinks.innerOf({ className: 'yaseen-pill' })).toBeNull()
  })

  it('on the picture page (no editor) a link with no look stays raw text and nothing is asked', async () => {
    const { cell, label, posted } = load()
    expect(label(cell('a', '[[YAZ-9]]'))).toBe('[[YAZ-9]]')
    await settle()
    expect(posted).toEqual([])
  })

  it('in the editor, asks ONCE per batch for the links it draws, shows each by its written name meanwhile, and redraws on the answer', async () => {
    const { graph, cell, label, install, posted } = load()
    const answer = install()
    expect(label(cell('a', '[[YAZ-1]] [[Plan|the plan]]'))).toBe(
      '<span class="yaseen-pill yaseen-link-0"><span class="yaseen-pill__icon"></span>YAZ-1</span> ' +
        '<span class="yaseen-pill yaseen-link-1"><span class="yaseen-pill__icon"></span>the plan</span>',
    )
    label(cell('b', '[[YAZ-1]]'))
    await settle()
    expect(posted).toEqual([{ event: 'yaseenLinkLooks', inners: ['YAZ-1', 'Plan|the plan'] }])

    expect(answer({ action: 'yaseenLinkLooks', looks: { 'YAZ-1': LOOK } })).toBe(true)
    expect(graph.refreshed).toBe(1)
    expect(label(cell('c', '[[YAZ-1]]'))).toContain('Roadmap')
    // Still waiting for "Plan": a redraw does not ask again.
    label(cell('d', '[[Plan|the plan]]'))
    await settle()
    expect(posted).toHaveLength(1)
  })

  it('carries the board pill’s look inline — an exported SVG or PNG has no page stylesheet', () => {
    const { env, graph, cell } = load()
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK, Gone: { label: 'Gone', missing: true } })
    const found = graph.getLabel(cell('a', '[[YAZ-1]]'))
    expect(found).toMatch(/class="yaseen-pill yaseen-link-0" style="[^"]*background:light-dark\(#5b6cff1a,#7c8aff26\)/)
    expect(found).toMatch(/<img class="yaseen-pill__icon" style="[^"]*width:0\.75em/)
    const missing = graph.getLabel(cell('b', '[[Gone]]'))
    expect(missing).toMatch(/style="[^"]*color:light-dark\(#7a7a7a,#8f8f8f\)/)
    expect(missing).not.toContain('background')
  })
})

describe('yaseen-links.js: the editor’s pointer on a pill (D2)', () => {
  /** A drawn pill of `[[YAZ-1]]`: the label draws it first, so its number is the one the page knows. */
  let pill = () => element()
  const loadDrawn = () => {
    const env = load()
    env.env.yaseenLinks.setLooks({ 'YAZ-1': LOOK })
    const drawn = /class="(yaseen-pill [^"]*)"/.exec(env.label(env.cell('z', '[[YAZ-1]]')))[1]
    pill = (parent = null) => element(drawn, { parent })
    return env
  }

  it('a press with an open gesture is the host’s: it posts the click and draw.io never sees the press, its up or its click', () => {
    const { cell, install, fire, posted } = loadDrawn()
    cell('a', '[[YAZ-1]]')
    const answer = install()
    answer({ action: 'yaseenLinkOpens', opens: ['M', 'MS'] })
    const target = element('', { parent: pill() })
    expect(fire('pointerdown', { target, metaKey: true })).toBe(true)
    expect(posted).toEqual([{ event: 'yaseenLinkClick', inner: 'YAZ-1', cellId: 'a', mods: { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } }])
    expect(fire('pointerup', { target })).toBe(true)
    expect(fire('click', { target })).toBe(true)
    // The next press is draw.io's again.
    expect(fire('mousedown', { target: element() })).toBe(false)
  })

  it('a plain press on an editable diagram is draw.io’s (it selects); the read-only table opens with it', () => {
    const { install, fire, posted } = loadDrawn()
    const answer = install()
    answer({ action: 'yaseenLinkOpens', opens: ['M'] })
    expect(fire('pointerdown', { target: pill() })).toBe(false)
    expect(posted).toEqual([])
    answer({ action: 'yaseenLinkOpens', opens: ['', 'M'] })
    expect(fire('pointerdown', { target: pill() })).toBe(true)
    expect(posted).toHaveLength(1)
  })

  it('a right-click, or a ⌃-click on a Mac, opens the app’s link menu at the pointer — never draw.io’s', () => {
    const { install, fire, posted } = loadDrawn()
    install()
    expect(fire('pointerdown', { target: pill(), button: 2 })).toBe(true)
    expect(fire('pointerup', { target: pill(), button: 2 })).toBe(true)
    expect(fire('contextmenu', { target: pill(), clientX: 105, clientY: 107 })).toBe(true)
    // No cell under the point in this stand-in: the host's menu still opens; only Edit link needs the cell.
    expect(posted).toEqual([{ event: 'yaseenLinkMenu', inner: 'YAZ-1', cellId: null, x: 105, y: 107 }])
    expect(fire('pointerdown', { target: pill(), ctrlKey: true })).toBe(true)
    expect(fire('contextmenu', { target: element() })).toBe(false)
    // A pill whose number this page never drew is no pill.
    expect(fire('contextmenu', { target: element('yaseen-pill yaseen-link-99') })).toBe(false)
  })

  it('a fault in a listener is logged, never thrown: draw.io would show it as an alert that blocks the editor', () => {
    const { env, graph, install, fire } = loadDrawn()
    install()
    graph.getCellAt = () => {
      throw new Error('boom')
    }
    expect(() => fire('contextmenu', { target: pill() })).not.toThrow()
    expect(env.console.error).toHaveBeenCalledWith('Yaseen links', 'contextmenu', expect.any(Error))
  })

  it('leaves a pill inside the open label editor to the editor', () => {
    const { graph, install, fire, posted } = loadDrawn()
    const answer = install()
    answer({ action: 'yaseenLinkOpens', opens: ['M'] })
    const textarea = element('geContentEditable')
    graph.cellEditor.textarea = textarea
    expect(fire('pointerdown', { target: pill(textarea), metaKey: true })).toBe(false)
    expect(fire('mouseover', { target: pill(textarea) })).toBe(false)
    expect(posted).toEqual([])
  })

  it('hover posts the pill and its box once, and its end when the pointer leaves, presses or the view moves', () => {
    const { install, fire, posted } = loadDrawn()
    install()
    const on = pill()
    fire('mouseover', { target: element('', { parent: on }) })
    fire('mouseover', { target: on })
    expect(posted).toEqual([{ event: 'yaseenLinkHover', inner: 'YAZ-1', rect: { left: 10, top: 20, right: 60, bottom: 40 } }])
    // Moving inside the pill is no leave.
    fire('mouseout', { target: on, relatedTarget: element('', { parent: on }) })
    expect(posted).toHaveLength(1)
    fire('mouseout', { target: on, relatedTarget: element() })
    expect(posted[1]).toEqual({ event: 'yaseenLinkHover', inner: null, rect: null })
    fire('mouseover', { target: on })
    fire('wheel', {})
    expect(posted.at(-1)).toEqual({ event: 'yaseenLinkHover', inner: null, rect: null })
  })
})

describe('yaseen-links.js: a shape’s own link (D8)', () => {
  it('a [[link]], a vault path or a yaseendocs:// link goes to the host with the last press’s keys; a web link stays draw.io’s', () => {
    const { graph, install, fire, posted, EditorUi } = load()
    const openLink = graph.openLink
    const handle = EditorUi.prototype.handleCustomLink
    install()
    fire('pointerdown', { target: element(), metaKey: true })
    expect(graph.isCustomLink('[[YAZ-1]]')).toBe(true)
    expect(graph.isCustomLink('https://example.com')).toBe(false)
    expect(graph.isCustomLink('data:page/id,p2')).toBe(true)
    // draw.io's own custom link (a page link) stays its own; ours goes up.
    new EditorUi().handleCustomLink('data:page/id,p2')
    expect(handle).toHaveBeenCalledWith('data:page/id,p2')
    new EditorUi().handleCustomLink('[[YAZ-1]]')
    expect(handle).toHaveBeenCalledTimes(1)
    graph.openLink('/vault/Plan.md')
    graph.openLink('yaseendocs://open?path=x')
    expect(posted).toEqual([
      { event: 'yaseenShapeLink', link: '[[YAZ-1]]', mods: { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } },
      { event: 'yaseenShapeLink', link: '/vault/Plan.md', mods: { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } },
      { event: 'yaseenShapeLink', link: 'yaseendocs://open?path=x', mods: { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } },
    ])
    expect(graph.openLink('https://example.com')).toBe('window')
    expect(openLink).toHaveBeenCalledWith('https://example.com')
  })
})

describe('yaseen-links.js: Edit link and Remove link (the host’s replace)', () => {
  it('puts the text in place of the first raw link, escaped in an HTML label, as one labelChanged', () => {
    const { graph, cell, install } = load()
    cell('a', 'See [[Q&amp;A]] and [[Q&amp;A]]')
    cell('b', 'plain [[Old]] text', false)
    const answer = install()
    expect(answer({ action: 'yaseenLinkReplace', cellId: 'a', inner: 'Q&A', text: '[[R<1>]]' })).toBe(true)
    expect(answer({ action: 'yaseenLinkReplace', cellId: 'b', inner: 'Old', text: 'Old page' })).toBe(true)
    expect(graph.changed).toEqual([
      ['a', 'See [[R&lt;1&gt;]] and [[Q&amp;A]]'],
      ['b', 'plain Old page text'],
    ])
  })

  it('changes nothing on a read-only diagram, for a gone cell, or for a link no longer in the label', () => {
    const { graph, cell, install } = load()
    cell('a', '[[YAZ-1]]')
    const answer = install()
    answer({ action: 'yaseenLinkReplace', cellId: 'a', inner: 'YAZ-2', text: 'x' })
    answer({ action: 'yaseenLinkReplace', cellId: 'zz', inner: 'YAZ-1', text: 'x' })
    graph.enabled = false
    answer({ action: 'yaseenLinkReplace', cellId: 'a', inner: 'YAZ-1', text: 'x' })
    expect(graph.changed).toEqual([])
  })

  it('leaves every other message to PostConfig.js', () => {
    const { install } = load()
    expect(install()({ action: 'yaseenReadOnly', value: true })).toBe(false)
  })
})

describe.skipIf(!existsSync(APP_MIN_JS))(`every draw.io internal yaseen-links.js leans on exists in the pinned ${DRAWIO_TAG}`, () => {
  it('a rename would turn the pills back into text without an error', () => {
    const app = readFileSync(APP_MIN_JS, 'utf8')
    const internals = {
      'Graph.getLabel': /Graph\.prototype\.getLabel\s*=\s*function/,
      'mxCellRenderer.getLabelValue asks graph.getLabel': /mxCellRenderer\.prototype\.getLabelValue=function\(a\)\{return a\.view\.graph\.getLabel\(a\.cell\)\}/,
      'Graph.isHtmlLabel': /Graph\.prototype\.isHtmlLabel\s*=\s*function/,
      'Graph.convertValueToString': /Graph\.prototype\.convertValueToString\s*=\s*function/,
      'mxGraph.labelChanged': /mxGraph\.prototype\.labelChanged\s*=\s*function/,
      'mxGraph.getCellAt': /mxGraph\.prototype\.getCellAt\s*=\s*function/,
      'mxGraph.refresh': /mxGraph\.prototype\.refresh\s*=\s*function/,
      'mxUtils.convertPoint': /convertPoint\s*:\s*function/,
      'cellEditor.textarea': /this\.textarea\s*=\s*document\.createElement\("div"\)/,
      'dark mode sets color-scheme': /classList\.add\("geDarkMode"\),\w+\.style\.colorScheme="dark"/,
      // 2-: the label editor, a new text box, a picture drop.
      'mxCellEditor.setEditingValue': /mxCellEditor\.prototype\.setEditingValue\s*=\s*function/,
      'mxCellEditor.getCurrentValue': /mxCellEditor\.prototype\.getCurrentValue\s*=\s*function/,
      'mxCellEditor.stopEditing': /mxCellEditor\.prototype\.stopEditing\s*=\s*function/,
      'mxCellEditor.getEditingCell': /mxCellEditor\.prototype\.getEditingCell\s*=\s*function/,
      'startEditing sets the value through setEditingValue': /this\.setEditingValue\(d,this\.getInitialValue\(/,
      'Graph.getInsertPoint': /Graph\.prototype\.getInsertPoint\s*=\s*function/,
      'mxGraph.insertVertex': /mxGraph\.prototype\.insertVertex\s*=\s*function/,
      'Graph.updateCellSize': /updateCellSize\s*=\s*function/,
      'mxGraph.setSelectionCells': /mxGraph\.prototype\.setSelectionCells\s*=\s*function/,
      'EditorUi.importFiles': /EditorUi\.prototype\.importFiles\s*=\s*function/,
      // D8: a shape's link.
      'Graph.isCustomLink': /Graph\.prototype\.isCustomLink\s*=\s*function/,
      'EditorUi.handleCustomLink': /EditorUi\.prototype\.handleCustomLink\s*=\s*function/,
      'the editor\'s customLinkClicked calls ui.handleCustomLink': /customLinkClicked=function\(\w+,\w+\)\{var \w+=!1;try\{[^}]*\}?[^;]*;\w+\.handleCustomLink\(/,
      'Graph.openLink': /Graph\.prototype\.openLink\s*=\s*function/,
      'a link hint asks isCustomLink, then customLinkClicked': /this\.graph\.isCustomLink\(e\)&&\(mxEvent\.isTouchEvent\(d\)\|\|!mxEvent\.isPopupTrigger\(d\)\)&&this\.graph\.customLinkClicked\(e\)/,
    }
    for (const [name, pattern] of Object.entries(internals)) expect(pattern.test(app), name).toBe(true)
  })
})
