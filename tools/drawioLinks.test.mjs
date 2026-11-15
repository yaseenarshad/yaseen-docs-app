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
function element(className = '', { parent = null, rect = { left: 10, top: 20, right: 60, bottom: 40 } } = {}) {
  const el = {
    className,
    parent,
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
  /** Each cell's drawn state: its label's node, as draw.io's view keeps it (`state.text.node`). */
  const states = {}
  const page = {
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
    getSelection: () => null,
  }
  function Graph() {
    this.container = {}
    this.cellEditor = { textarea: null, getEditingCell: () => null }
    this.enabled = true
    this.redrawn = 0
    this.changed = []
    this.view = {
      states: { visit: (visitor) => Object.entries(states).forEach(([id, state]) => visitor(id, state)) },
      invalidate: () => {},
      validate: () => this.redrawn++,
    }
  }
  // draw.io's own: the cell's label as written. Its editor's graph calls a label HTML with `html=1` or
  // `whiteSpace=wrap`; the cell renderer keeps the markup of `html=1` only (it escapes the other).
  Graph.prototype.getLabel = (cell) => cell.label
  Graph.prototype.isHtmlLabel = (cell) => cell.html !== false
  Graph.prototype.getCurrentCellStyle = (cell) => (cell.html === true ? { html: '1' } : cell.html === 'wrap' ? { whiteSpace: 'wrap' } : {})
  Graph.prototype.convertValueToString = (cell) => cell.label
  Graph.prototype.getModel = () => ({ getCell: (id) => cells[id] ?? null })
  // The point of the pointer is over cell `a` (the old way found the cell by the point).
  Graph.prototype.getCellAt = (x, y) => (x === 5 && y === 7 ? cells.a : null)
  Graph.prototype.isEnabled = function () {
    return this.enabled
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
  // draw.io's own: every place that draws a label asks the cell renderer, which asks `graph.getLabel`.
  function mxCellRenderer() {}
  mxCellRenderer.prototype.getLabelValue = (state) => state.view.graph.getLabel(state.cell)
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
    mxCellRenderer,
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
  const renderer = new mxCellRenderer()
  const cell = (id, label, html = true) => {
    cells[id] = { id, label, html }
    states[id] = { cell: cells[id], text: { node: element() } }
    return cells[id]
  }
  /** The cell's label node, where its pills are drawn. */
  const nodeOf = (id) => states[id].text.node
  /** A label as the cell renderer draws it (the canvas, autosize, the SVG export). */
  const drawn = (c) => renderer.getLabelValue({ cell: c, style: graph.getCurrentCellStyle(c), view: { graph } })
  /** The same, without the pills' inline look (one test pins that). */
  const label = (c) => {
    const value = drawn(c)
    return typeof value === 'string' ? value.replace(/ style="[^"]*"/g, '') : value
  }
  /** The editor's half, as PostConfig.js installs it; returns its answer to the host's messages. */
  const install = () => env.yaseenLinks.installEditor({ editor: { graph } }, (msg) => posted.push(msg))
  /** The editor's half with a link source: the host's first `yaseenLinkOpens` turns its link work on (A3). */
  const installLinked = (opens = ['M', 'MS']) => {
    const answer = install()
    answer({ action: 'yaseenLinkOpens', opens })
    return answer
  }
  /** A page event in the capture phase; true when the pills stopped it. */
  const fire = (type, init) => {
    const evt = { button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, clientX: 105, clientY: 107, ...init, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    for (const listener of listeners[type] ?? []) listener(evt)
    return evt.stopPropagation.mock.calls.length > 0
  }
  return { env, graph, cell, nodeOf, drawn, label, install, installLinked, fire, posted, EditorUi }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const LOOK = { label: 'Roadmap', icon: 'data:image/png;base64,AAA' }

describe('yaseen-links.js: a label draws its links as pills (D1, D3)', () => {
  it('draws a found page with its icon and name, a missing one dim with no icon, and an icon not drawn yet as its empty box', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK, Gone: { label: 'Gone', missing: true }, 'YAZ-2': { label: 'Pricing' }, 'YAZ-3': { label: 'Plain', icon: null } })
    expect(label(cell('a', 'See [[YAZ-1]] and [[Gone]]'))).toBe(
      'See <span class="yaseen-pill yaseen-link-YAZ-1"><img src="data:image/png;base64,AAA">Roadmap</span>' + ' and <span class="yaseen-pill yaseen-link-Gone">Gone</span>',
    )
    expect(label(cell('b', '[[YAZ-2]] [[YAZ-1]]'))).toBe(
      '<span class="yaseen-pill yaseen-link-YAZ-2"><span></span>Pricing</span> <span class="yaseen-pill yaseen-link-YAZ-1"><img src="data:image/png;base64,AAA">Roadmap</span>',
    )
    expect(label(cell('c', '[[YAZ-3]]'))).toBe('<span class="yaseen-pill yaseen-link-YAZ-3">Plain</span>')
  })

  it('keeps raw text for a link with nothing to show, a plain-text label, a wrapped label with no html=1, and a label with no link', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'Note|': null, 'YAZ-1': LOOK })
    expect(label(cell('a', 'x [[Note|]] y'))).toBe('x [[Note|]] y')
    expect(label(cell('b', 'See [[YAZ-1]]', false))).toBe('See [[YAZ-1]]')
    // draw.io calls it an HTML label, but its cell renderer escapes it: a pill would show as its markup.
    expect(label(cell('w', 'See [[YAZ-1]]', 'wrap'))).toBe('See [[YAZ-1]]')
    expect(label(cell('c', 'no links'))).toBe('no links')
  })

  it('A1: draws the pills in the cell renderer only — graph.getLabel stays the raw [[link]], so draw.io’s own read-and-write (Find/Replace) keeps it', () => {
    const { env, graph, cell, label } = load()
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK })
    const c = cell('a', 'See [[YAZ-1]]')
    expect(label(c)).toContain('Roadmap')
    expect(graph.getLabel(c)).toBe('See [[YAZ-1]]')
    // Find/Replace: `A=L.getLabel(t); L.model.setValue(t, …)`.
    graph.labelChanged(c, graph.getLabel(c).replace('See', 'Read'))
    expect(c.label).toBe('Read [[YAZ-1]]')
  })

  it('reads an HTML label’s link as written and escapes what it draws', () => {
    const { env, cell, label } = load()
    env.yaseenLinks.setLooks({ 'Q&A': { label: '<b>Q&A</b>', icon: null } })
    expect(label(cell('a', '[[Q&amp;A]]'))).toBe('<span class="yaseen-pill yaseen-link-Q%26A">&lt;b&gt;Q&amp;A&lt;/b&gt;</span>')
  })

  it('A7: carries each pill’s link in its class — what draw.io’s HTML cleaner keeps — and reads it back, with no table that grows', () => {
    const { env, cell, drawn } = load()
    env.yaseenLinks.setLooks({ 'Plan|the plan': { label: 'the plan' } })
    const pill = /class="(yaseen-pill [^"]*)"/.exec(drawn(cell('a', '[[Plan|the plan]]')))[1]
    expect(pill).toBe('yaseen-pill yaseen-link-Plan%7Cthe%20plan')
    expect(env.yaseenLinks.innerOf({ className: pill })).toBe('Plan|the plan')
    // A page of the picture page that never drew it reads it too.
    expect(load().env.yaseenLinks.innerOf({ className: 'yaseen-pill yaseen-link-YAZ-9' })).toBe('YAZ-9')
    expect(env.yaseenLinks.innerOf({ className: 'yaseen-pill yaseen-link-%E0%A4%A' })).toBeNull()
    expect(env.yaseenLinks.innerOf({ className: 'yaseen-pill' })).toBeNull()
  })

  it('A7: the answer that passes the cap is kept (the old ones go), and the picture page’s looks are each request’s alone', () => {
    const { env, cell, label } = load()
    const many = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`P${i}`, { label: `Page ${i}` }]))
    env.yaseenLinks.setLooks(many)
    env.yaseenLinks.setLooks({ New: { label: 'Fresh', icon: null } })
    expect(label(cell('a', '[[New]]'))).toContain('Fresh')
    expect(label(cell('b', '[[P1]]'))).toBe('[[P1]]')
    // The picture page: each request carries every look it needs, and replaces the last one's.
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK }, true)
    expect(label(cell('c', '[[New]] [[YAZ-1]]'))).toMatch(/^\[\[New\]\] <span/)
    env.yaseenLinks.setLooks(null, true)
    expect(label(cell('d', '[[YAZ-1]]'))).toBe('[[YAZ-1]]')
  })

  it('on the picture page (no editor) a link with no look stays raw text and nothing is asked', async () => {
    const { cell, label, posted } = load()
    expect(label(cell('a', '[[YAZ-9]]'))).toBe('[[YAZ-9]]')
    await settle()
    expect(posted).toEqual([])
  })

  it('A3: in an editor with no link source (no yaseenLinkOpens) labels stay raw text, nothing is asked, and a shape’s link stays draw.io’s', async () => {
    const { graph, cell, label, install, posted } = load()
    const answer = install()
    expect(label(cell('a', '[[YAZ-1]]'))).toBe('[[YAZ-1]]')
    expect(graph.isCustomLink('[[YAZ-1]]')).toBe(false)
    expect(graph.openLink('/vault/Plan.md')).toBe('window')
    await settle()
    expect(posted).toEqual([])
    // The host's first word turns the link work on, and the labels draw again.
    answer({ action: 'yaseenLinkOpens', opens: ['M'] })
    expect(graph.redrawn).toBe(1)
    expect(label(cell('b', '[[YAZ-1]]'))).toContain('yaseen-pill')
    answer({ action: 'yaseenLinkOpens', opens: ['M', 'MS'] })
    expect(graph.redrawn).toBe(1)
  })

  it('in the editor, asks ONCE per batch for the links it draws, shows each by its written name meanwhile, and redraws on the answer', async () => {
    const { graph, cell, label, installLinked, posted } = load()
    const answer = installLinked()
    expect(label(cell('a', '[[YAZ-1]] [[Plan|the plan]]'))).toBe(
      '<span class="yaseen-pill yaseen-link-YAZ-1"><span></span>YAZ-1</span> ' + '<span class="yaseen-pill yaseen-link-Plan%7Cthe%20plan"><span></span>the plan</span>',
    )
    label(cell('b', '[[YAZ-1]]'))
    await settle()
    expect(posted).toEqual([{ event: 'yaseenLinkLooks', inners: ['YAZ-1', 'Plan|the plan'] }])

    const before = graph.redrawn
    expect(answer({ action: 'yaseenLinkLooks', looks: { 'YAZ-1': LOOK } })).toBe(true)
    expect(graph.redrawn).toBe(before + 1)
    expect(label(cell('c', '[[YAZ-1]]'))).toContain('Roadmap')
    // A8: the same look again redraws nothing.
    answer({ action: 'yaseenLinkLooks', looks: { 'YAZ-1': { ...LOOK } } })
    expect(graph.redrawn).toBe(before + 1)
    // Still waiting for "Plan": a redraw does not ask again.
    label(cell('d', '[[Plan|the plan]]'))
    await settle()
    expect(posted).toHaveLength(1)
  })

  it('carries the board pill’s look inline — an exported SVG or PNG has no page stylesheet', () => {
    const { env, cell, drawn } = load()
    env.yaseenLinks.setLooks({ 'YAZ-1': LOOK, Gone: { label: 'Gone', missing: true } })
    const found = drawn(cell('a', '[[YAZ-1]]'))
    expect(found).toMatch(/class="yaseen-pill yaseen-link-YAZ-1" style="[^"]*background:light-dark\(#5b6cff1a,#7c8aff26\)/)
    expect(found).toMatch(/<img style="[^"]*width:0\.75em/)
    const missing = drawn(cell('b', '[[Gone]]'))
    expect(missing).toMatch(/style="[^"]*color:light-dark\(#7a7a7a,#8f8f8f\)/)
    expect(missing).not.toContain('background')
  })

  it('A18: a fault in the look batch is logged, never thrown', async () => {
    const { env, cell, label } = load()
    env.yaseenLinks.installEditor({ editor: { graph: new env.Graph() } }, () => {
      throw new Error('boom')
    })({ action: 'yaseenLinkOpens', opens: [] })
    label(cell('a', '[[YAZ-1]]'))
    await settle()
    expect(env.console.error).toHaveBeenCalledWith('Yaseen links', 'looks', expect.any(Error))
  })
})

describe('yaseen-links.js: the editor’s pointer on a pill (D2)', () => {
  /** A drawn pill of `[[YAZ-1]]`, in `parent` (a cell's label node, or nothing). */
  let pill = () => element()
  const loadDrawn = () => {
    const env = load()
    env.env.yaseenLinks.setLooks({ 'YAZ-1': LOOK })
    const drawn = /class="(yaseen-pill [^"]*)"/.exec(env.label(env.cell('z', '[[YAZ-1]]')))[1]
    pill = (parent = null) => element(drawn, { parent })
    return env
  }

  it('a press with an open gesture is the host’s: it posts the click and draw.io never sees the press, its up or its click', () => {
    const { cell, nodeOf, installLinked, fire, posted } = loadDrawn()
    cell('a', '[[YAZ-1]]')
    installLinked(['M', 'MS'])
    const target = element('', { parent: pill(nodeOf('a')) })
    expect(fire('pointerdown', { target, metaKey: true })).toBe(true)
    expect(posted).toEqual([{ event: 'yaseenLinkClick', inner: 'YAZ-1', cellId: 'a', mods: { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } }])
    expect(fire('pointerup', { target })).toBe(true)
    expect(fire('click', { target })).toBe(true)
    // The next press is draw.io's again.
    expect(fire('mousedown', { target: element() })).toBe(false)
  })

  it('A4: the pill’s cell is the one whose label holds the pill — an edge label, a label below its shape — never the cell under the point', () => {
    const { cell, nodeOf, installLinked, fire, posted } = loadDrawn()
    // The pointer's point is over cell `a`; the pill is drawn in `edge-label`'s label and in `icon`'s label below it.
    cell('a', 'a shape')
    cell('edge-label', '[[YAZ-1]]')
    cell('icon', '[[YAZ-1]]')
    installLinked(['M'])
    fire('pointerdown', { target: pill(nodeOf('edge-label')), metaKey: true })
    fire('contextmenu', { target: pill(nodeOf('icon')) })
    expect(posted.map((m) => m.cellId)).toEqual(['edge-label', 'icon'])
  })

  it('a plain press on an editable diagram is draw.io’s (it selects); the read-only table opens with it', () => {
    const { installLinked, fire, posted } = loadDrawn()
    const answer = installLinked(['M'])
    expect(fire('pointerdown', { target: pill() })).toBe(false)
    expect(posted).toEqual([])
    answer({ action: 'yaseenLinkOpens', opens: ['', 'M'] })
    expect(fire('pointerdown', { target: pill() })).toBe(true)
    expect(posted).toHaveLength(1)
  })

  it('a right-click, or a ⌃-click on a Mac, opens the app’s link menu at the pointer — never draw.io’s', () => {
    const { installLinked, fire, posted } = loadDrawn()
    installLinked()
    expect(fire('pointerdown', { target: pill(), button: 2 })).toBe(true)
    expect(fire('pointerup', { target: pill(), button: 2 })).toBe(true)
    expect(fire('contextmenu', { target: pill(), clientX: 105, clientY: 107 })).toBe(true)
    // A pill in no drawn label: the host's menu still opens; only Edit link needs the cell.
    expect(posted).toEqual([{ event: 'yaseenLinkMenu', inner: 'YAZ-1', cellId: null, x: 105, y: 107 }])
    expect(fire('pointerdown', { target: pill(), ctrlKey: true })).toBe(true)
    expect(fire('contextmenu', { target: element() })).toBe(false)
    // An element with no link in its class is no pill.
    expect(fire('contextmenu', { target: element('yaseen-pill') })).toBe(false)
  })

  it('a fault in a listener is logged, never thrown: draw.io would show it as an alert that blocks the editor', () => {
    const { env, graph, installLinked, fire } = loadDrawn()
    installLinked()
    graph.view.states.visit = () => {
      throw new Error('boom')
    }
    expect(() => fire('contextmenu', { target: pill() })).not.toThrow()
    expect(env.console.error).toHaveBeenCalledWith('Yaseen links', 'contextmenu', expect.any(Error))
  })

  it('leaves a pill inside the open label editor to the editor', () => {
    const { graph, installLinked, fire, posted } = loadDrawn()
    installLinked(['M'])
    const textarea = element('geContentEditable')
    graph.cellEditor.textarea = textarea
    expect(fire('pointerdown', { target: pill(textarea), metaKey: true })).toBe(false)
    expect(fire('mouseover', { target: pill(textarea) })).toBe(false)
    expect(posted).toEqual([])
  })

  it('hover posts the pill and its box once, and its end when the pointer leaves, presses or the view moves', () => {
    const { installLinked, fire, posted } = loadDrawn()
    installLinked()
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
    const { graph, installLinked, fire, posted, EditorUi } = load()
    const openLink = graph.openLink
    const handle = EditorUi.prototype.handleCustomLink
    installLinked()
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
  it('puts the text in place of the first link that reads as `inner`, escaped in an HTML label, as one labelChanged', () => {
    const { graph, cell, installLinked } = load()
    cell('a', 'See [[Q&amp;A]] and [[Q&amp;A]]')
    cell('b', 'plain [[Old]] text', false)
    const answer = installLinked()
    expect(answer({ action: 'yaseenLinkReplace', cellId: 'a', inner: 'Q&A', text: '[[R<1>]]' })).toBe(true)
    expect(answer({ action: 'yaseenLinkReplace', cellId: 'b', inner: 'Old', text: 'Old page' })).toBe(true)
    expect(graph.changed).toEqual([
      ['a', 'See [[R&lt;1&gt;]] and [[Q&amp;A]]'],
      ['b', 'plain Old page text'],
    ])
  })

  it('A15: finds a link with a quote, an apostrophe or a non-breaking space as the label editor wrote it', () => {
    const { graph, cell, installLinked } = load()
    cell('a', "x [[Q&amp;A's]] y")
    cell('b', '[[My&nbsp;Page]] z')
    cell('c', '[[Say "hi"]]')
    const answer = installLinked()
    answer({ action: 'yaseenLinkReplace', cellId: 'a', inner: "Q&A's", text: 'QA' })
    answer({ action: 'yaseenLinkReplace', cellId: 'b', inner: 'My Page', text: 'Mine' })
    answer({ action: 'yaseenLinkReplace', cellId: 'c', inner: 'Say "hi"', text: 'Hi' })
    expect(graph.changed).toEqual([
      ['a', 'x QA y'],
      ['b', 'Mine z'],
      ['c', 'Hi'],
    ])
  })

  it('changes nothing on a read-only diagram, for a gone cell, or for a link no longer in the label', () => {
    const { graph, cell, installLinked } = load()
    cell('a', '[[YAZ-1]]')
    const answer = installLinked()
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
  it('each draw.io internal the pills use is in the pinned bundle', () => {
    const app = readFileSync(APP_MIN_JS, 'utf8')
    const internals = {
      // A1: the pills draw in the cell renderer; the graph's instance renderer asks the prototype at call time.
      'mxCellRenderer.getLabelValue asks graph.getLabel': /mxCellRenderer\.prototype\.getLabelValue=function\(a\)\{return a\.view\.graph\.getLabel\(a\.cell\)\}/,
      'Graph sets the instance getLabelValue, which calls the prototype’s': /this\.cellRenderer\.getLabelValue=function\((\w+)\)\{var (\w+)=mxCellRenderer\.prototype\.getLabelValue\.apply\(this,arguments\);\1\.view\.graph\.isHtmlLabel\(\1\.cell\)&&\("0"==mxUtils\.getValue\(\1\.style,"html","0"\)\?\2=mxUtils\.htmlEntities/,
      'autosize measures through cellRenderer.getLabelValue': /mxGraph\.prototype\.getPreferredSizeForCell=function[\s\S]{0,1600}?this\.cellRenderer\.getLabelValue\(/,
      'Graph.isHtmlLabel': /Graph\.prototype\.isHtmlLabel\s*=\s*function/,
      'mxGraph.getCurrentCellStyle': /mxGraph\.prototype\.getCurrentCellStyle\s*=\s*function/,
      'Graph.convertValueToString': /Graph\.prototype\.convertValueToString\s*=\s*function/,
      'mxGraph.labelChanged': /mxGraph\.prototype\.labelChanged\s*=\s*function/,
      'mxDictionary.visit': /mxDictionary\.prototype\.visit\s*=\s*function/,
      'mxGraphView.invalidate': /mxGraphView\.prototype\.invalidate\s*=\s*function/,
      'mxGraphView.validate': /mxGraphView\.prototype\.validate\s*=\s*function/,
      'mxUtils.convertPoint': /convertPoint\s*:\s*function/,
      'cellEditor.textarea': /this\.textarea\s*=\s*document\.createElement\("div"\)/,
      'dark mode sets color-scheme': /classList\.add\("geDarkMode"\),\w+\.style\.colorScheme="dark"/,
      // 2-: the label editor, a new text box, a picture drop, the canvas paste.
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
      'EditorUi.insertTextAt (draw.io’s own text paste)': /EditorUi\.prototype\.insertTextAt=function\(c,d,l,n,/,
      'the canvas paste comes from ui.clipboardElt': /l\.contentEditable=!0;l\.innerHTML="&nbsp;";this\.clipboardElt=l;/,
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
