/**
 * CMD+F find engine (YAZ-968): matches, highlight decorations, active-match cycling, and
 * fold-reveal — driven through the FindChannel exactly as the FindBar will drive it, against
 * the REAL `createCrepe()` editor (the outlineFolding.test.ts idiom).
 *
 * The contract under test (locked in YAZ-967's confirmed-contract comment):
 *  - case-insensitive literal matching, per-textblock, so marks never split a match; a soft line
 *    break reads as one space, a hard break is a gap (YAZ-2691);
 *  - all matches carry FIND_MATCH_CLASS, exactly one carries FIND_ACTIVE_CLASS too;
 *  - next/prev wrap; the first active match is the first at/after the selection; the active
 *    HIGHLIGHT is what scrolls into view, not its block (YAZ-2691);
 *  - collapsed folds hiding a match expand SILENTLY (⌘Z panic-undo untouched) and re-collapse
 *    when the query stops matching inside them;
 *  - close restores search-revealed folds EXCEPT those hiding the active match (the landing),
 *    clears every decoration, and puts the selection on the active match;
 *  - while zoomed, only matches inside the zoomed subtree count;
 *  - after a query or a step the thread points at the active match, until the caret moves or the
 *    doc changes (YAZ-3166, `findThreadAnchor`);
 *  - a whole search session never reaches `markdownUpdated` (the save path).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { OPEN_ID_LINK } from '../wikilink/idLinkCaret'
import { getHeadingFoldKey, HEADING_FOLDED_ATTR, isHeadingCollapsed, undoLastHeadingFold } from '../outline/headingFolding'
import { OUTLINE_FOLDED_ATTR, undoLastFold } from '../outline/outlineFolding'
import { getOutlineFoldKey } from '../outline/outlineFoldKeys'
import { getZoomedItemPos } from '../outline/zoom'
import { createFindChannel, type FindChannel } from './findChannel'
import { FIND_ACTIVE_CLASS, FIND_MATCH_CLASS, findThreadAnchor } from './findInPage'
import { WIKILINK_CLASS, WIKILINK_SYNTAX_CLASS, createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { buildViewOnlyCatalogFromEntries, type ViewOnlyEntry } from '../../links/viewOnlyCatalog'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'>): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  let view: EditorView | null = null
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (view === null) throw new Error('no editor view')
  return { crepe, root, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** A mounted editor plus its channel, the way both hosts will wire it. */
async function mountFind(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'find'> = {}) {
  const channel = createFindChannel()
  const { crepe, root, view } = await mount({ defaultValue: markdown, find: channel, ...opts })
  return { crepe, root, view, channel }
}

/** Absolute doc position of the first occurrence of `needle` (within one text node). */
const posOfText = (doc: ProseNode, needle: string): number => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && node.text !== undefined) {
      const i = node.text.indexOf(needle)
      if (i !== -1) found = pos + i
    }
    return found === -1
  })
  if (found === -1) throw new Error(`"${needle}" not in doc`)
  return found
}

const matchEls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`.${FIND_MATCH_CLASS}`)]
const activeEls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`.${FIND_ACTIVE_CLASS}`)]
const foldedEls = (root: HTMLElement) => [...root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)]
const headingFoldedEls = (root: HTMLElement) => [...root.querySelectorAll(`[${HEADING_FOLDED_ATTR}="true"]`)]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The zoom test's keydown idiom: prosemirror-keymap reads key + keyCode off a real event. */
const press = (view: EditorView, key: string, keyCode: number, mod = false) => {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, metaKey: mod, bubbles: true, cancelable: true }))
}

describe('matching and decorations', () => {
  it('finds case-insensitive literal matches and paints all of them, one active', async () => {
    const { root, channel } = await mountFind('apple Apple APPLE banana')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 0 })
    expect(matchEls(root)).toHaveLength(3)
    expect(activeEls(root)).toHaveLength(1)
    expect(activeEls(root)[0].textContent).toBe('apple')
  })

  it('clears matches when the query empties', async () => {
    const { root, channel } = await mountFind('apple apple')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(2)
    channel.setQuery('')
    expect(channel.getState()).toMatchObject({ total: 0, activeIndex: -1 })
    expect(matchEls(root)).toHaveLength(0)
  })

  it('matches across mark boundaries within a block', async () => {
    const { root, channel } = await mountFind('say wo**rld** now')
    channel.open()
    channel.setQuery('world')
    expect(channel.getState().total).toBe(1)
    expect(matchEls(root).map((el) => el.textContent).join('')).toBe('world')
  })

  it('matches a phrase across a soft line break, which reads as one space — but never across a hard break (YAZ-2691)', async () => {
    const soft = await mountFind('one technology\nis deflationary now')
    soft.channel.open()
    soft.channel.setQuery('technology is deflationary')
    expect(soft.channel.getState().total).toBe(1)
    expect(matchEls(soft.root).map((el) => el.textContent).join('')).toBe('technology is deflationary')
    soft.channel.setQuery('technologyis')
    expect(soft.channel.getState().total).toBe(0)

    const hard = await mountFind('one technology\\\nis deflationary now')
    hard.channel.open()
    hard.channel.setQuery('technology is deflationary')
    expect(hard.channel.getState().total).toBe(0)
    hard.channel.setQuery('deflationary')
    expect(hard.channel.getState().total).toBe(1)
  })

  it('recomputes matches when the document changes mid-search', async () => {
    const { view, channel } = await mountFind('apple banana')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(1)
    view.dispatch(view.state.tr.insertText('apple ', posOfText(view.state.doc, 'banana')))
    expect(channel.getState().total).toBe(2)
  })
})

describe('cycling', () => {
  it('starts at the first match after the selection and wraps both ways', async () => {
    const { view, channel } = await mountFind('apple one apple two apple three')
    const afterFirst = posOfText(view.state.doc, 'one')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, afterFirst)))
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().activeIndex).toBe(1)
    channel.next()
    expect(channel.getState().activeIndex).toBe(2)
    channel.next()
    expect(channel.getState().activeIndex).toBe(0)
    channel.prev()
    expect(channel.getState().activeIndex).toBe(2)
  })

  it('scrolls the active HIGHLIGHT, not the block that holds it — a block can be taller than the window (YAZ-2691)', async () => {
    // jsdom has no scrollIntoView: the engine's optional call lands on this recorder, then it is removed again.
    const scrolled: Element[] = []
    const proto = Element.prototype as { scrollIntoView?: () => void }
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const { channel } = await mountFind('apple one apple two')
      channel.open()
      channel.setQuery('apple')
      channel.next()
      expect(scrolled).toHaveLength(2)
      for (const el of scrolled) expect(el.classList.contains(FIND_ACTIVE_CLASS)).toBe(true)
      expect(scrolled[0]).not.toBe(scrolled[1])
    } finally {
      delete proto.scrollIntoView
    }
  })
})

/** The thread's anchor (YAZ-3166): bulletThreading.test.ts and sectionIndent.test.ts check what it draws. */
describe('the thread anchor', () => {
  it('is the active match after a query and a step, and null with no query, after a caret move and after close', async () => {
    const { view, channel } = await mountFind('apple one apple two')
    expect(findThreadAnchor(view.state)).toBeNull()
    channel.open()
    expect(findThreadAnchor(view.state)).toBeNull()
    channel.setQuery('apple')
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple one'))
    channel.next()
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple two'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOfText(view.state.doc, 'one'))))
    expect(findThreadAnchor(view.state)).toBeNull()
    // The next step brings it back; close lands the caret there and the anchor is the caret again.
    channel.next()
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple one'))
    channel.close()
    expect(findThreadAnchor(view.state)).toBeNull()
    expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'apple one'))
  })

  it('a click or a key in the note gives it back, also when the caret does not move (YAZ-3200)', async () => {
    const { view, channel } = await mountFind('apple one apple two')
    channel.open()
    channel.setQuery('apple')
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple one'))
    // A click on the caret's own spot moves nothing, so no selection reaches the find state.
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(findThreadAnchor(view.state)).toBeNull()
    channel.next()
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple two'))
    // A modifier alone is not a key in the note; an arrow key at the end of the doc moves nothing.
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift' }))
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple two'))
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    expect(findThreadAnchor(view.state)).toBeNull()
  })

  it('stays on the match when an update sets the same selection, like the redraw of a hover (YAZ-3205)', async () => {
    const { view, channel } = await mountFind('apple one apple two')
    channel.open()
    channel.setQuery('apple')
    const match = posOfText(view.state.doc, 'apple one')
    expect(findThreadAnchor(view.state)).toBe(match)
    // The caret does not move: a hover's class change makes ProseMirror read the DOM and set the selection it already has.
    view.dispatch(view.state.tr.setSelection(view.state.selection))
    expect(findThreadAnchor(view.state)).toBe(match)
  })

  it('stays on the match through the reveal of a collapsed fold, and an edit gives it back', async () => {
    // The query is the first transaction: Milkdown's trailing paragraph (an appended doc change) rides on it.
    const { root, view, channel } = await mountFind('* Parent\n  * hidden apple\n* visible banana\n', {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(foldedEls(root)).toHaveLength(0)
    expect(findThreadAnchor(view.state)).toBe(posOfText(view.state.doc, 'apple'))
    view.dispatch(view.state.tr.insertText('x', posOfText(view.state.doc, 'banana')))
    expect(channel.getState().total).toBe(1)
    expect(findThreadAnchor(view.state)).toBeNull()
  })
})

describe('fold reveal', () => {
  const FOLDED_DOC = `* Parent
  * hidden apple
* visible banana
`

  it('expands a collapsed fold that hides a match, silently (⌘Z stays free)', async () => {
    const { root, view, channel } = await mountFind(FOLDED_DOC, {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    expect(foldedEls(root).length).toBeGreaterThan(0)
    channel.open()
    channel.setQuery('apple')
    expect(foldedEls(root)).toHaveLength(0)
    // Silent: the reveal is not a revertible fold action — panic-undo has nothing to grab.
    expect(undoLastFold(view.state)).toBe(false)
  })

  it('re-collapses a revealed fold when the query stops matching inside it', async () => {
    const { root, channel } = await mountFind(FOLDED_DOC, {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(foldedEls(root)).toHaveLength(0)
    channel.setQuery('banana')
    expect(foldedEls(root).length).toBeGreaterThan(0)
  })

  it('close restores revealed folds except the one hiding the active match, and lands the selection there', async () => {
    const doc = `* Parent
  * apple one
* Fruit
  * apple two
`
    const { root, view, channel } = await mountFind(doc, {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0), getOutlineFoldKey('Fruit', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState()).toMatchObject({ total: 2, activeIndex: 0 })
    expect(foldedEls(root)).toHaveLength(0)
    channel.close()
    // The landing (Parent, hiding the active match) stays open; Fruit folds back.
    const folded = foldedEls(root)
    expect(folded).toHaveLength(1)
    expect(folded[0].textContent).toContain('apple two')
    expect(matchEls(root)).toHaveLength(0)
    expect(channel.getState().open).toBe(false)
    expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'apple one'))
  })
})

/** The heading twin (YAZ-1140): a collapsed SECTION hides matches the same way a collapsed bullet does. */
describe('heading fold reveal', () => {
  const FOLDED_HEADINGS = `# Alpha

hidden apple

# Beta

visible banana
`
  /** `Alpha` is the doc's first node, so its section folds from position 0. */
  const ALPHA = 0

  it('expands a collapsed heading section that hides a match, silently (⌘Z stays free)', async () => {
    const { root, view, channel } = await mountFind(FOLDED_HEADINGS, {
      headingFolding: { seedCollapsedKeys: () => new Set([getHeadingFoldKey('Alpha', 0)]) },
    })
    expect(headingFoldedEls(root).length).toBeGreaterThan(0)
    channel.open()
    channel.setQuery('apple')
    expect(headingFoldedEls(root)).toHaveLength(0)
    // Silent: the reveal is not a revertible fold action — panic-undo has nothing to grab.
    expect(undoLastHeadingFold(view.state)).toBe(false)
  })

  it('re-collapses a revealed heading section when the query stops matching inside it', async () => {
    const { root, view, channel } = await mountFind(FOLDED_HEADINGS, {
      headingFolding: { seedCollapsedKeys: () => new Set([getHeadingFoldKey('Alpha', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(isHeadingCollapsed(view.state, ALPHA)).toBe(false)
    channel.setQuery('banana')
    expect(isHeadingCollapsed(view.state, ALPHA)).toBe(true)
    expect(headingFoldedEls(root).length).toBeGreaterThan(0)
  })
})

describe('zoom', () => {
  it('only matches inside the zoomed subtree while zoomed', async () => {
    const doc = `* Alpha here
  * apple in zoom
* Beta
  * apple outside
`
    const { view, channel } = await mountFind(doc, { zoom: { title: () => 'Notes' } })
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(2)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOfText(view.state.doc, 'Alpha'))))
    press(view, '.', 190, true) // Mod-. zooms into the caret's item
    expect(getZoomedItemPos(view.state)).not.toBeNull()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(1)
  })
})

describe('escape and the save path', () => {
  it('Escape in the editor closes an open find', async () => {
    const { view, channel } = await mountFind('apple')
    channel.open()
    channel.setQuery('apple')
    press(view, 'Escape', 27)
    expect(channel.getState().open).toBe(false)
  })

  it('a whole search session never reaches markdownUpdated and leaves the markdown unchanged', async () => {
    const onMarkdownUpdated = vi.fn()
    const doc = `* Parent
  * hidden apple
* apple two
`
    const { crepe, channel } = await mountFind(doc, {
      onMarkdownUpdated,
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    const before = getMarkdownForSave(crepe)
    channel.open()
    channel.setQuery('apple')
    channel.next()
    channel.prev()
    channel.close()
    await sleep(400) // outlast the listener's ~200ms debounce
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(before)
  })
})

describe('pills (YAZ-3744 S9, S17)', () => {
  const PATHS: Record<string, string> = { 'YAS-466': '/v/AR v2 plan.md', Named: '/v/Named.md', 'docs/subs/Named': '/v/docs/subs/Named.md' }
  const LINE = 'pad [[YAS-466]] and [[LN Scenarios Diagram.drawio]] and [[Named]] tail\n'
  // 'pad [[YAS-466]] …': the ID link starts at 5 (paragraph content starts at 1).
  const ID_FROM = 5

  async function mountPills(markdown = LINE) {
    const wikilinks = createWikilinkResolveSource()
    // A vault with IDs (`YAS`): an ID no note has is a missing note (S10).
    wikilinks.update((target) => PATHS[target] ?? null, [], [], true, ['YAS'])
    const viewOnlyLinks = createViewOnlyLinkSource()
    viewOnlyLinks.update(buildViewOnlyCatalogFromEntries('/v', [
      { path: '/v/LN Scenarios Diagram.drawio', name: 'LN Scenarios Diagram.drawio', kind: 'diagram' },
    ] as ViewOnlyEntry[]))
    return mountFind(markdown, { wikilinks, viewOnlyLinks })
  }
  const titleEl = (root: HTMLElement) => root.querySelector<HTMLElement>('.ProseMirror-widget.wikilink')!
  /** The line as drawn: without the text the wikilink plugin hides. */
  const shownLine = (root: HTMLElement) => {
    const line = root.querySelector('.ProseMirror p')!.cloneNode(true) as HTMLElement
    line.querySelectorAll(`.${WIKILINK_SYNTAX_CLASS}`).forEach((el) => el.remove())
    return line.textContent
  }

  it('finds an ID pill by its title: one match, the title widget marked', async () => {
    const { root, channel } = await mountPills()
    expect(titleEl(root).textContent).toBe('AR v2 plan')
    channel.open()
    channel.setQuery('ar v2 plan')
    expect(channel.getState()).toMatchObject({ total: 1, activeIndex: 0 })
    expect(matchEls(root)).toEqual([titleEl(root)])
    expect(activeEls(root)).toEqual([titleEl(root)])
    channel.setQuery('zzz')
    expect(titleEl(root).classList.contains(FIND_MATCH_CLASS)).toBe(false)
  })

  it('a match in the hidden ID is one match that marks the pill, not hidden text', async () => {
    const { root, channel } = await mountPills()
    channel.open()
    channel.setQuery('YAS-466')
    expect(channel.getState().total).toBe(1)
    expect(matchEls(root)).toEqual([titleEl(root)])
    expect(root.querySelector(`.${WIKILINK_SYNTAX_CLASS}.${FIND_MATCH_CLASS}`)).toBeNull()
  })

  it('a pill counts once, however many matches its hidden text holds (YAZ-3910 A4)', async () => {
    const { root, channel } = await mountPills('x [[docs/subs/Named]] y\n')
    channel.open()
    channel.setQuery('s') // three in the hidden `docs/subs/`, none in the name
    expect(channel.getState()).toMatchObject({ total: 1, activeIndex: 0 })
    expect(matchEls(root).map((el) => el.textContent).join('')).toBe('Named')
  })

  it('a missing note (S10): its ID marks the "Missing note" widget, one match (YAZ-3910 A1)', async () => {
    const { root, channel } = await mountPills('pad [[YAS-999]] tail\n')
    expect(titleEl(root).textContent).toBe('Missing note · YAS-999')
    channel.open()
    channel.setQuery('YAS-999') // in the widget's text and in the hidden ID: one pill, one match
    expect(channel.getState()).toMatchObject({ total: 1, activeIndex: 0 })
    expect(matchEls(root)).toEqual([titleEl(root)])
    expect(activeEls(root)).toEqual([titleEl(root)])
    channel.setQuery('missing')
    expect(channel.getState().total).toBe(1)
    expect(matchEls(root)).toEqual([titleEl(root)])
  })

  it('a match in a hidden extension marks the pill\'s shown name', async () => {
    const { root, channel } = await mountPills()
    channel.open()
    channel.setQuery('drawio')
    expect(channel.getState().total).toBe(1)
    const marked = matchEls(root)
    expect(marked.map((el) => el.textContent).join('')).toBe('LN Scenarios Diagram')
    expect(marked.every((el) => el.classList.contains(WIKILINK_CLASS) && el.classList.contains(FIND_ACTIVE_CLASS))).toBe(true)
  })

  it('an open link ("Edit link" put the caret inside it, YAZ-3935) is searched as plain text', async () => {
    const { root, view, channel } = await mountPills()
    channel.open()
    channel.setQuery('named]]')
    expect(channel.getState().total).toBe(1)
    expect(matchEls(root).map((el) => el.textContent).join('')).toBe('Named') // the pill, its `]]` hidden
    channel.close()
    const inside = posOfText(view.state.doc, 'Named') + 2
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)).setMeta(OPEN_ID_LINK, true))
    channel.open()
    channel.setQuery('named]]')
    expect(channel.getState().total).toBe(1)
    expect(matchEls(root).map((el) => el.textContent).join('')).toBe('Named]]')
  })

  it('S17: stepping to an ID pill and closing leaves the caret at its edge, the title shown', async () => {
    const { root, view, channel } = await mountPills('pad [[YAS-466]] mid [[YAS-466#Intro]] plan\n')
    channel.open()
    channel.setQuery('plan')
    // The first pill's title, the second pill's title, then the word.
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 0 })
    channel.close()
    expect(view.state.selection.empty && view.state.selection.head).toBe(ID_FROM)
    expect(titleEl(root).textContent).toBe('AR v2 plan')
    expect(shownLine(root)).toBe('pad AR v2 plan mid AR v2 planIntro plan')

    // A shown sub part of an ID link: the caret D1 steps out lands on an edge, never inside.
    const second = posOfText(view.state.doc, '[[YAS-466#Intro]]')
    channel.open()
    channel.setQuery('intro')
    expect(channel.getState().total).toBe(1)
    channel.close()
    expect([second, second + '[[YAS-466#Intro]]'.length]).toContain(view.state.selection.head)
    expect(shownLine(root)).toBe('pad AR v2 plan mid AR v2 planIntro plan')
  })
})
