/**
 * The table of contents engine (YAZ-2700), against the REAL `createCrepe()` editor (the
 * findInPage.test.ts idiom) and through the `TocChannel` exactly as the host wires it.
 *
 * The contract under test:
 *  - the scan lists H1-H3 outside lists, walks a blockquote, names an empty heading
 *    `Untitled heading`, ignores H4-H6, and keeps a heading with nothing under it;
 *  - a note with fewer than two such headings is read by its BULLETS instead: every labelled item
 *    of the document's own lists (bulleted or numbered), three levels deep, the level its depth
 *    and the text its label; a note with two headings or more never has its bullets read;
 *  - the reader may choose the source for one note (D14, the channel's `setSource`): `headings` is
 *    every H1-H3 of the note, the ones inside bullets at any depth too, and no bullet; `bullets`
 *    is the bullets whatever headings there are; a chosen source with under two rows publishes
 *    those and never falls back; the choice is scanned at once, and one set before the editor
 *    exists is what the FIRST scan goes by;
 *  - it runs once at view creation and then 150 ms after the LAST document change — a keystroke
 *    only restarts the timer, a caret move starts none;
 *  - the channel says hidden while a bullet zoom is active;
 *  - a jump unfolds what hides its row and the row's own fold, puts the caret at the start of its
 *    text, focuses the note and scrolls the row to the top — and never reaches `markdownUpdated`;
 *  - the scroll spy: the last shown row at or above the scroller's top + 40px, the first when
 *    none is, the last one in view at the very bottom; a row inside a fold is skipped, and a
 *    remembered position is trusted only while its node is still a row's own element.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TocSource } from '@shared/types'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { isHeadingCollapsed, setHeadingFoldSet } from '../outline/headingFolding'
import { isOutlineItemCollapsed, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos } from '../outline/zoom'
import { createTocChannel, type TocChannel } from './tocChannel'
import { SCAN_DELAY_MS, scanAllHeadings, scanBullets, scanHeadings, scanNote } from './tocPlugin'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** `prepare` gets the channel BEFORE the editor exists, as the host has it: the place to set a saved source, or to listen from the first scan on. */
async function mountToc(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue' | 'toc'> = {}, prepare?: (channel: TocChannel) => void) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const channel = createTocChannel()
  prepare?.(channel)
  const crepe = createCrepe({ root, defaultValue: markdown, toc: channel, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  let view: EditorView | null = null
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (view === null) throw new Error('no editor view')
  return { crepe, root, view: view as EditorView, channel }
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Absolute doc position of the first occurrence of `needle` (within one text node). */
const posOfText = (doc: ProseNode, needle: string): number => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && node.text !== undefined) {
      const i = node.text.indexOf(needle)
      if (i !== -1) found = pos + i
    }
    return true
  })
  if (found === -1) throw new Error(`text "${needle}" not found`)
  return found
}

const texts = (headings: readonly { level: number; text: string }[]): string[] => headings.map(({ level, text }) => `${level} ${text}`)

const DOC = `# Part 1

Intro paragraph.

## Section A

Alpha body.

### Deep dive

Deep body.

## Section B

Beta body.

# Part 2

Closing.
`

/** A bullet note: one list, no headings. "Too deep" is a fourth level. */
const BULLETS = `* Alpha
  * Alpha one
    * Alpha one deep
      * Too deep
  * Alpha two
* Beta
  * Beta one
* Gamma
`
const BULLET_ROWS = ['1 Alpha', '2 Alpha one', '3 Alpha one deep', '2 Alpha two', '1 Beta', '2 Beta one', '1 Gamma']

/** The landing flash as the engine asks for it: a band held for 45% of 1300 ms, then faded. */
const FLASH_COLOUR = 'color-mix(in srgb, var(--accent) 34%, transparent)'
const FLASH_ON = { background: FLASH_COLOUR, boxShadow: `0 0 0 6px ${FLASH_COLOUR}`, borderRadius: '4px' }
const FLASH_OFF = { background: 'transparent', boxShadow: '0 0 0 6px transparent', borderRadius: '4px' }
const FLASH = [[{ ...FLASH_ON, offset: 0 }, { ...FLASH_ON, offset: 0.45 }, { ...FLASH_OFF, offset: 1 }], { duration: 1300, easing: 'ease-out' }] as const

describe('the heading scan', () => {
  it('lists H1-H3 in document order, each with the position of its node', async () => {
    const { view } = await mountToc(DOC)
    const found = scanHeadings(view.state.doc)
    expect(texts(found)).toEqual(['1 Part 1', '2 Section A', '3 Deep dive', '2 Section B', '1 Part 2'])
    for (const heading of found) expect(view.state.doc.nodeAt(heading.pos)?.type.name).toBe('heading')
  })

  it('skips a heading inside a list, at any depth', async () => {
    const { view } = await mountToc(`# Top\n\n* # In a bullet\n  * ## Deeper\n\n## After\n\nBody.\n`)
    expect(texts(scanHeadings(view.state.doc))).toEqual(['1 Top', '2 After'])
  })

  it('walks a blockquote', async () => {
    const { view } = await mountToc(`# Top\n\n> ## Quoted\n>\n> Words.\n\nBody.\n`)
    expect(texts(scanHeadings(view.state.doc))).toEqual(['1 Top', '2 Quoted'])
  })

  it('names an empty heading "Untitled heading"', async () => {
    const { view } = await mountToc(`# Top\n\n##\n\nBody.\n`)
    expect(texts(scanHeadings(view.state.doc))).toEqual(['1 Top', '2 Untitled heading'])
  })

  it('ignores H4-H6', async () => {
    const { view } = await mountToc(`# Top\n\n#### Four\n\n##### Five\n\n###### Six\n\n### Three\n`)
    expect(texts(scanHeadings(view.state.doc))).toEqual(['1 Top', '3 Three'])
  })

  it('keeps a heading with nothing under it — no section to fold, still a place to go', async () => {
    const { view } = await mountToc(`## Empty\n\n## After\n\nBody.\n\n# Tail\n`)
    expect(texts(scanHeadings(view.state.doc))).toEqual(['2 Empty', '2 After', '1 Tail'])
  })
})

describe('the bullet scan', () => {
  it('a note with no headings is read by its bullets: levels 1-3 by depth, nothing deeper, each with the position of its list item', async () => {
    const { view } = await mountToc(BULLETS)
    const note = scanNote(view.state.doc)
    expect(note.bullets).toBe(true)
    expect(texts(note.rows)).toEqual(BULLET_ROWS)
    for (const row of note.rows) expect(view.state.doc.nodeAt(row.pos)?.type.name).toBe('list_item')
  })

  it('one heading is not a structure: the bullets under it are the rows', async () => {
    const { view } = await mountToc(`# Title\n\n* Alpha\n  * Child\n* Beta\n`)
    const note = scanNote(view.state.doc)
    expect(note.bullets).toBe(true)
    expect(texts(note.rows)).toEqual(['1 Alpha', '2 Child', '1 Beta'])
  })

  it('two headings are: the bullets of such a note are not rows at all', async () => {
    const { view } = await mountToc(`# Top\n\n* Alpha\n  * Child\n* Beta\n\n## After\n\n* Gamma\n`)
    const note = scanNote(view.state.doc)
    expect(note.bullets).toBe(false)
    expect(texts(note.rows)).toEqual(['1 Top', '2 After'])
  })

  it('a numbered list counts, and its numbered children', async () => {
    const { view } = await mountToc(`1. First\n   1. Inner\n2. Second\n`)
    expect(texts(scanBullets(view.state.doc))).toEqual(['1 First', '2 Inner', '1 Second'])
  })

  it('two top-level lists are both read, in document order', async () => {
    const { view } = await mountToc(`* Alpha\n  * Child\n\nBetween.\n\n1. First\n2. Second\n`)
    expect(texts(scanNote(view.state.doc).rows)).toEqual(['1 Alpha', '2 Child', '1 First', '1 Second'])
  })

  it('a bullet whose first block is a heading is a row with that text, at its bullet depth and not its heading level', async () => {
    const { view } = await mountToc(`* ### Topic\n  * # Under\n* Plain\n`)
    const note = scanNote(view.state.doc)
    expect(note.bullets).toBe(true)
    expect(texts(note.rows)).toEqual(['1 Topic', '2 Under', '1 Plain'])
  })

  it('a bullet with no label is no row; its children are, at their own depth', async () => {
    const { view } = await mountToc(`* Alpha\n* \n  * Under empty\n    * Deeper\n`)
    expect(texts(scanBullets(view.state.doc))).toEqual(['1 Alpha', '2 Under empty', '3 Deeper'])
  })

  it('a bullet that really reads "Untitled item" is a row', async () => {
    const { view } = await mountToc(`* Untitled item\n* Beta\n`)
    expect(texts(scanBullets(view.state.doc))).toEqual(['1 Untitled item', '1 Beta'])
  })

  it('a list inside a blockquote does not count', async () => {
    const { view } = await mountToc(`> * Quoted\n> * Also quoted\n\n* Alpha\n* Beta\n`)
    expect(texts(scanNote(view.state.doc).rows)).toEqual(['1 Alpha', '1 Beta'])
  })

  it('neither gives two rows: what the headings gave, one or none', async () => {
    const one = await mountToc(`# Title\n\n* Only bullet\n`)
    expect(scanNote(one.view.state.doc)).toEqual({ bullets: false, rows: [{ level: 1, text: 'Title', pos: 0 }] })
    const none = await mountToc(`Words.\n\n* Only bullet\n`)
    expect(scanNote(none.view.state.doc)).toEqual({ bullets: false, rows: [] })
  })
})

describe('the reader\'s choice of source (YAZ-2700 D14)', () => {
  /** A note of both kinds: headings outside lists (so Auto is headings), headings inside bullets at three depths, one in a blockquote, plain bullets. */
  const MIXED = `# Top

* # In a bullet
  * Plain child
  * ## Deeper
    * ### Deepest
      * #### Four
* Plain bullet

> ## Quoted

## After
`
  /** All bullets; two of them the reader made into headings. */
  const TOPICS = `* Alpha
* # Topic one
  * Child
* Beta
  * ## Topic two
    * Under
`
  const from = (source: TocSource | null) => (channel: TocChannel) => channel.setSource(source)

  it('Headings: every H1-H3 in document order — inside a bullet at any depth, in a blockquote, outside — each at its heading level, and no plain bullet', async () => {
    const { view } = await mountToc(MIXED)
    const found = scanAllHeadings(view.state.doc)
    expect(texts(found)).toEqual(['1 Top', '1 In a bullet', '2 Deeper', '3 Deepest', '2 Quoted', '2 After'])
    for (const heading of found) expect(view.state.doc.nodeAt(heading.pos)?.type.name).toBe('heading')
    expect(scanNote(view.state.doc, 'headings')).toEqual({ bullets: false, rows: found })
    // Auto on the same note: the headings outside lists alone.
    expect(texts(scanNote(view.state.doc).rows)).toEqual(['1 Top', '2 Quoted', '2 After'])
  })

  it('Headings on a note that is all bullets: exactly the bullets the reader made into headings', async () => {
    const { channel } = await mountToc(TOPICS, {}, from('headings'))
    expect(channel.getState().headings).toEqual([
      { level: 1, text: 'Topic one' },
      { level: 2, text: 'Topic two' },
    ])
  })

  it('Bullets: the bullets of the note, though it has two headings and more', async () => {
    const { view, channel } = await mountToc(MIXED, {}, from('bullets'))
    expect(scanNote(view.state.doc, 'bullets').bullets).toBe(true)
    expect(texts(channel.getState().headings)).toEqual(['1 In a bullet', '2 Plain child', '2 Deeper', '3 Deepest', '1 Plain bullet'])
  })

  it('a chosen source with under two rows publishes those: it never falls back to the other', async () => {
    // Auto would give this note its seven bullets.
    const noHeadings = await mountToc(BULLETS, {}, from('headings'))
    expect(noHeadings.channel.getState().headings).toEqual([])
    // Auto would give this one its five headings.
    const noBullets = await mountToc(DOC, {}, from('bullets'))
    expect(noBullets.channel.getState().headings).toEqual([])
    const oneBullet = await mountToc(`# Top\n\n* Only bullet\n\n## After\n`, {}, from('bullets'))
    expect(oneBullet.channel.getState().headings).toEqual([{ level: 1, text: 'Only bullet' }])
    const oneHeading = await mountToc(`* Alpha\n* # Only topic\n* Beta\n`, {}, from('headings'))
    expect(oneHeading.channel.getState().headings).toEqual([{ level: 1, text: 'Only topic' }])
  })

  it('a source set before the editor exists is what the FIRST scan goes by: the Auto list is never published', async () => {
    const published: string[][] = []
    const { channel } = await mountToc(MIXED, {}, (early) => {
      early.setSource('bullets')
      early.subscribe(() => published.push(texts(early.getState().headings)))
    })
    expect(published).toEqual([['1 In a bullet', '2 Plain child', '2 Deeper', '3 Deepest', '1 Plain bullet']])
    expect(texts(channel.getState().headings)).toEqual(published[0])
  })

  it('a change of source is scanned AT ONCE, with no 150 ms wait; the same source again scans nothing', async () => {
    const { channel } = await mountToc(MIXED)
    const publish = vi.spyOn(channel, 'publish')
    vi.useFakeTimers()
    channel.setSource('headings')
    expect(texts(channel.getState().headings)).toEqual(['1 Top', '1 In a bullet', '2 Deeper', '3 Deepest', '2 Quoted', '2 After'])
    channel.setSource('bullets')
    expect(texts(channel.getState().headings)).toEqual(['1 In a bullet', '2 Plain child', '2 Deeper', '3 Deepest', '1 Plain bullet'])
    channel.setSource(null)
    expect(texts(channel.getState().headings)).toEqual(['1 Top', '2 Quoted', '2 After'])
    expect(publish).toHaveBeenCalledTimes(3)
    channel.setSource(null)
    expect(publish).toHaveBeenCalledTimes(3)
    // And nothing was left waiting: the scans were not timers.
    vi.advanceTimersByTime(SCAN_DELAY_MS * 2)
    expect(publish).toHaveBeenCalledTimes(3)
  })

  it('typing stays debounced under a chosen source: an edit is published 150 ms after it, by that source', async () => {
    const { view, channel } = await mountToc(TOPICS, {}, from('headings'))
    const publish = vi.spyOn(channel, 'publish')
    vi.useFakeTimers()
    view.dispatch(view.state.tr.insertText('!', posOfText(view.state.doc, 'Topic two') + 'Topic two'.length))
    vi.advanceTimersByTime(SCAN_DELAY_MS - 1)
    expect(publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(texts(channel.getState().headings)).toEqual(['1 Topic one', '2 Topic two!'])
  })

  describe('the jump and the scroll spy under Headings', () => {
    /** "Deep topic" is the label of a bullet three deep; "Beta topic" of a top one. Both bullets have children, so both can fold. */
    const NESTED = `* Alpha
  * Inner
    * ## Deep topic
      * Under deep
* # Beta topic
  * Under beta
`
    it('a heading inside folded bullets: every bullet above it opens, and the bullet it is the label of — and no other; the caret is in the heading', async () => {
      const { view, channel } = await mountToc(NESTED, {}, from('headings'))
      expect(texts(channel.getState().headings)).toEqual(['2 Deep topic', '1 Beta topic'])
      // "Under deep" is a fourth level and no bullet row, so the fourth row is "Beta topic".
      const [alpha, inner, deepTopic, betaTopic] = scanBullets(view.state.doc).map(({ pos }) => pos)
      setOutlineFoldSet([alpha, inner, deepTopic, betaTopic], true)(view.state, view.dispatch)
      for (const pos of [alpha, inner, deepTopic, betaTopic]) expect(isOutlineItemCollapsed(view.state, pos)).toBe(true)
      channel.jump(0)
      expect(isOutlineItemCollapsed(view.state, alpha)).toBe(false)
      expect(isOutlineItemCollapsed(view.state, inner)).toBe(false)
      // Its own bullet: the reader asked for the topic, not its one line.
      expect(isOutlineItemCollapsed(view.state, deepTopic)).toBe(false)
      expect(isOutlineItemCollapsed(view.state, betaTopic)).toBe(true)
      expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'Deep topic'))
      expect(view.state.selection.$from.parent.type.name).toBe('heading')
      expect(view.hasFocus()).toBe(true)
    })

    it('a heading in a bullet under a folded heading section: the section opens too', async () => {
      const { view, channel } = await mountToc(`# Part\n\n* Alpha\n  * ## Inside\n\n# Other\n`, {}, from('headings'))
      expect(texts(channel.getState().headings)).toEqual(['1 Part', '2 Inside', '1 Other'])
      const [alpha] = scanBullets(view.state.doc).map(({ pos }) => pos)
      setHeadingFoldSet([0], true)(view.state, view.dispatch)
      setOutlineFoldSet([alpha], true)(view.state, view.dispatch)
      channel.jump(1)
      expect(isHeadingCollapsed(view.state, 0)).toBe(false)
      expect(isOutlineItemCollapsed(view.state, alpha)).toBe(false)
      expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'Inside'))
    })

    it('lands and flashes the heading element itself, not the bullet around it', async () => {
      const { view, channel } = await mountToc(NESTED, {}, from('headings'))
      const scrollIntoView = vi.fn()
      const animate = vi.fn()
      Object.assign(HTMLElement.prototype, { scrollIntoView, animate })
      try {
        channel.jump(0)
        const heading = view.nodeDOM(scanAllHeadings(view.state.doc)[0].pos) as HTMLElement
        expect(heading.tagName).toBe('H2')
        expect(scrollIntoView.mock.contexts).toEqual([heading])
        expect(animate.mock.contexts).toEqual([heading])
        expect(animate).toHaveBeenCalledWith(...FLASH)
      } finally {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
      }
    })

    it('never reaches the save path: no markdownUpdated, markdown unchanged', async () => {
      const onMarkdownUpdated = vi.fn()
      const { crepe, view, channel } = await mountToc(NESTED, { onMarkdownUpdated }, from('headings'))
      const before = getMarkdownForSave(crepe)
      const [alpha, inner, deepTopic] = scanBullets(view.state.doc).map(({ pos }) => pos)
      setOutlineFoldSet([alpha, inner, deepTopic], true)(view.state, view.dispatch)
      channel.jump(0)
      channel.jump(1)
      channel.setSource('bullets')
      channel.setSource(null)
      // Crepe's listener debounces `markdownUpdated` by 200 ms.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(onMarkdownUpdated).not.toHaveBeenCalled()
      expect(getMarkdownForSave(crepe)).toBe(before)
    })

    it('the scroll spy trusts an h1-h3 inside a list item as it does one outside, and only while the rows are headings', async () => {
      const { view, channel } = await mountToc(NESTED, {}, from('headings'))
      const tops = [-50, 300]
      scanAllHeadings(view.state.doc).forEach(({ pos }, i) => {
        const element = view.nodeDOM(pos) as HTMLElement
        expect(element.closest('.milkdown-list-item-block')).not.toBeNull()
        Object.defineProperty(element, 'offsetParent', { configurable: true, get: () => document.body })
        element.getBoundingClientRect = () => new DOMRect(0, tops[i], 600, 30)
      })
      const scroller = document.createElement('div')
      scroller.getBoundingClientRect = () => new DOMRect(0, 100, 800, 500)
      Object.defineProperties(scroller, { scrollTop: { value: 700 }, clientHeight: { value: 500 }, scrollHeight: { value: 3000 } })
      expect(channel.current([0, 1], scroller)).toBe(0)
      // The rows turned into bullets: no list item has been laid out, so none of them has a box.
      channel.setSource('bullets')
      expect(channel.current([0, 1], scroller)).toBe(-1)
      channel.setSource('headings')
      expect(channel.current([0, 1], scroller)).toBe(0)
    })
  })
})

describe('when it scans', () => {
  it('publishes the headings at view creation, without positions', async () => {
    const { channel } = await mountToc(DOC)
    expect(channel.getState().headings).toEqual([
      { level: 1, text: 'Part 1' },
      { level: 2, text: 'Section A' },
      { level: 3, text: 'Deep dive' },
      { level: 2, text: 'Section B' },
      { level: 1, text: 'Part 2' },
    ])
  })

  it('publishes a bullet note in the same shape: nothing in it says the rows are bullets', async () => {
    const { channel } = await mountToc(`* Alpha\n  * # Child\n* Beta\n`)
    expect(channel.getState().headings).toEqual([
      { level: 1, text: 'Alpha' },
      { level: 2, text: 'Child' },
      { level: 1, text: 'Beta' },
    ])
  })

  it('a second heading turns a bullet note into a note of headings, 150 ms after it', async () => {
    const { view, channel } = await mountToc(`# Title\n\n* Alpha\n* Beta\n`)
    expect(texts(channel.getState().headings)).toEqual(['1 Alpha', '1 Beta'])
    vi.useFakeTimers()
    const { heading } = view.state.schema.nodes
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, heading.create({ level: 2 }, view.state.schema.text('Second'))))
    vi.advanceTimersByTime(SCAN_DELAY_MS - 1)
    expect(texts(channel.getState().headings)).toEqual(['1 Alpha', '1 Beta'])
    vi.advanceTimersByTime(1)
    expect(texts(channel.getState().headings)).toEqual(['1 Title', '2 Second'])
  })

  it('an edit is published 150 ms after it, not before', async () => {
    const { view, channel } = await mountToc(DOC)
    vi.useFakeTimers()
    view.dispatch(view.state.tr.insertText('!', posOfText(view.state.doc, 'Section A') + 'Section A'.length))
    vi.advanceTimersByTime(SCAN_DELAY_MS - 1)
    expect(channel.getState().headings[1].text).toBe('Section A')
    vi.advanceTimersByTime(1)
    expect(channel.getState().headings[1].text).toBe('Section A!')
  })

  it('a keystroke only restarts the timer: three edits 100 ms apart make ONE scan, 150 ms after the last', async () => {
    const { view, channel } = await mountToc(DOC)
    const publish = vi.spyOn(channel, 'publish')
    vi.useFakeTimers()
    for (const letter of ['x', 'y', 'z']) {
      view.dispatch(view.state.tr.insertText(letter, posOfText(view.state.doc, 'Part 2') + 'Part 2'.length))
      vi.advanceTimersByTime(100)
    }
    expect(publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SCAN_DELAY_MS - 100)
    expect(publish).toHaveBeenCalledTimes(1)
    // Each letter went in right after "Part 2", so the last one typed stands first.
    expect(channel.getState().headings[4].text).toBe('Part 2zyx')
  })

  it('a caret move starts no scan', async () => {
    const { view, channel } = await mountToc(DOC)
    const publish = vi.spyOn(channel, 'publish')
    vi.useFakeTimers()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOfText(view.state.doc, 'Alpha'))))
    vi.advanceTimersByTime(SCAN_DELAY_MS * 2)
    expect(publish).not.toHaveBeenCalled()
  })

  it('an edit to a paragraph is scanned but tells the subscribers nothing', async () => {
    const { view, channel } = await mountToc(DOC)
    const listener = vi.fn()
    channel.subscribe(listener)
    vi.useFakeTimers()
    view.dispatch(view.state.tr.insertText(' More.', posOfText(view.state.doc, 'Alpha body.') + 'Alpha body.'.length))
    vi.advanceTimersByTime(SCAN_DELAY_MS)
    expect(listener).not.toHaveBeenCalled()
  })

  it('a destroyed editor scans no more: the pending timer goes with the view', async () => {
    const { crepe, view, channel } = await mountToc(DOC)
    const publish = vi.spyOn(channel, 'publish')
    view.dispatch(view.state.tr.insertText('!', posOfText(view.state.doc, 'Part 2') + 'Part 2'.length))
    await crepe.destroy()
    mounted.pop()?.root.remove()
    await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY_MS + 50))
    expect(publish).not.toHaveBeenCalled()
    // Unbound: the commands are no-ops again.
    expect(() => channel.jump(0)).not.toThrow()
  })
})

describe('hidden while a bullet is zoomed', () => {
  /** `Mod-.` / `Mod-Shift-.` as zoom.test.ts presses them (a real keyboard shifts `.` into `>`). */
  const pressZoom = (view: EditorView, out = false): void => {
    const event = new KeyboardEvent('keydown', { key: out ? '>' : '.', code: 'Period', keyCode: 190, metaKey: true, shiftKey: out, bubbles: true, cancelable: true } as KeyboardEventInit)
    view.someProp('handleKeyDown', (handler) => handler(view, event))
  }

  it('says hidden when the zoom starts and shown again when it ends', async () => {
    const { view, channel } = await mountToc(`# Top\n\n## Under\n\n* Bullet\n  * Child\n`, { zoom: { fileName: 'notes.md', title: () => 'Notes' } })
    expect(channel.getState().hidden).toBe(false)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOfText(view.state.doc, 'Bullet') + 1)))
    pressZoom(view)
    expect(getZoomedItemPos(view.state)).not.toBeNull()
    expect(channel.getState().hidden).toBe(true)
    // The headings are still the note's: only the flag moved.
    expect(texts(channel.getState().headings)).toEqual(['1 Top', '2 Under'])
    pressZoom(view, true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(channel.getState().hidden).toBe(false)
  })
})

describe('the jump', () => {
  /** jsdom has neither; the engine calls both only when they exist. */
  const stubLanding = () => {
    const scrollIntoView = vi.fn()
    const animate = vi.fn()
    Object.assign(HTMLElement.prototype, { scrollIntoView, animate })
    return {
      scrollIntoView,
      animate,
      restore: () => {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
      },
    }
  }

  it('puts the caret at the start of the heading text, focuses the note, scrolls the heading to the top and flashes it once', async () => {
    const { view, channel } = await mountToc(DOC)
    const landing = stubLanding()
    try {
      channel.jump(3)
      const target = scanHeadings(view.state.doc)[3]
      expect(target.text).toBe('Section B')
      expect(view.state.selection.from).toBe(target.pos + 1)
      expect(view.state.selection.empty).toBe(true)
      expect(view.hasFocus()).toBe(true)
      expect(landing.scrollIntoView).toHaveBeenCalledTimes(1)
      expect(landing.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      const landed = landing.scrollIntoView.mock.contexts[0] as HTMLElement
      expect(landed.tagName).toBe('H2')
      expect(landed.textContent).toContain('Section B')
      expect(landing.animate).toHaveBeenCalledTimes(1)
      expect(landing.animate).toHaveBeenCalledWith(...FLASH)
    } finally {
      landing.restore()
    }
  })

  it('skips the flash under prefers-reduced-motion, and still lands', async () => {
    const { view, channel } = await mountToc(DOC)
    const landing = stubLanding()
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('prefers-reduced-motion') }))
    ;(window as unknown as Record<string, unknown>).matchMedia = matchMedia
    try {
      channel.jump(1)
      expect(view.state.selection.from).toBe(scanHeadings(view.state.doc)[1].pos + 1)
      expect(landing.scrollIntoView).toHaveBeenCalledTimes(1)
      expect(landing.animate).not.toHaveBeenCalled()
    } finally {
      delete (window as unknown as Record<string, unknown>).matchMedia
      landing.restore()
    }
  })

  it('works where the DOM has neither scrollIntoView nor animate (jsdom as it comes)', async () => {
    const { view, channel } = await mountToc(DOC)
    expect(() => channel.jump(4)).not.toThrow()
    expect(view.state.selection.from).toBe(scanHeadings(view.state.doc)[4].pos + 1)
  })

  it('unfolds every collapsed section hiding the heading, and no other', async () => {
    const { view, channel } = await mountToc(DOC)
    const [part1, sectionA, deepDive, sectionB] = scanHeadings(view.state.doc).map(({ pos }) => pos)
    setHeadingFoldSet([part1, sectionA, sectionB], true)(view.state, view.dispatch)
    expect(isHeadingCollapsed(view.state, part1)).toBe(true)
    channel.jump(2)
    // "Deep dive" sits inside Section A inside Part 1: both open. Section B hides something else.
    expect(isHeadingCollapsed(view.state, part1)).toBe(false)
    expect(isHeadingCollapsed(view.state, sectionA)).toBe(false)
    expect(isHeadingCollapsed(view.state, sectionB)).toBe(true)
    expect(view.state.selection.from).toBe(deepDive + 1)
  })

  it('opens the heading itself when it is the folded one: the reader asked for the section, not its one line', async () => {
    const { view, channel } = await mountToc(DOC)
    const [, sectionA, , sectionB] = scanHeadings(view.state.doc).map(({ pos }) => pos)
    setHeadingFoldSet([sectionA, sectionB], true)(view.state, view.dispatch)
    channel.jump(1)
    expect(isHeadingCollapsed(view.state, sectionA)).toBe(false)
    expect(isHeadingCollapsed(view.state, sectionB)).toBe(true)
  })

  it('finds the heading in the LIVE document: an edit above it, not yet scanned, does not send the jump astray', async () => {
    const { view, channel } = await mountToc(DOC)
    vi.useFakeTimers()
    view.dispatch(view.state.tr.insertText('A much longer first paragraph. ', posOfText(view.state.doc, 'Intro paragraph.')))
    channel.jump(4)
    const target = scanHeadings(view.state.doc)[4]
    expect(target.text).toBe('Part 2')
    expect(view.state.selection.from).toBe(target.pos + 1)
  })

  it('an index past the end does nothing', async () => {
    const { view, channel } = await mountToc(DOC)
    const before = view.state.selection.from
    expect(() => channel.jump(99)).not.toThrow()
    expect(view.state.selection.from).toBe(before)
  })

  it('two headings with the same name are two rows, and each goes to its own heading', async () => {
    const { view, channel } = await mountToc(`# Notes\n\nFirst.\n\n# Notes\n\nSecond.\n`)
    expect(texts(channel.getState().headings)).toEqual(['1 Notes', '1 Notes'])
    const [first, second] = scanHeadings(view.state.doc).map(({ pos }) => pos)
    expect(second).toBeGreaterThan(first)
    channel.jump(1)
    expect(view.state.selection.from).toBe(second + 1)
    channel.jump(0)
    expect(view.state.selection.from).toBe(first + 1)
  })

  it('never reaches the save path: no markdownUpdated, markdown unchanged', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, view, channel } = await mountToc(DOC, { onMarkdownUpdated })
    const before = getMarkdownForSave(crepe)
    setHeadingFoldSet([scanHeadings(view.state.doc)[0].pos], true)(view.state, view.dispatch)
    channel.jump(2)
    channel.jump(0)
    // Crepe's listener debounces `markdownUpdated` by 200 ms.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  describe('what it unfolds eases in', () => {
    /** The eased blocks of a jump, in the order they were started: every `animate` call but the landing flash. */
    const eased = (animate: ReturnType<typeof stubLanding>['animate']) =>
      animate.mock.calls
        .map(([keyframes, options], i) => ({ keyframes, options: options as KeyframeAnimationOptions, element: animate.mock.contexts[i] as HTMLElement }))
        .filter(({ options }) => options.fill === 'backwards')
    const label = (element: HTMLElement): string => `${element.tagName} ${element.textContent?.trim()}`

    it('a section the jump opened: its blocks and no block outside it, each rising in 320 ms, 18 ms after the one above', async () => {
      const { view, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        setHeadingFoldSet([scanHeadings(view.state.doc)[1].pos], true)(view.state, view.dispatch)
        channel.jump(1)
        const blocks = eased(landing.animate)
        // Section A's own: "Section B" ends it, and Part 1's first paragraph was never hidden.
        expect(blocks.map(({ element }) => label(element))).toEqual(['P Alpha body.', 'H3 Deep dive', 'P Deep body.'])
        blocks.forEach(({ keyframes, options }, i) => {
          expect(keyframes).toEqual([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }])
          expect(options).toEqual({ duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', delay: i * 18, fill: 'backwards' })
        })
        // The flash is still one, on the heading itself.
        expect(landing.animate).toHaveBeenCalledTimes(4)
        expect(landing.animate).toHaveBeenCalledWith(...FLASH)
      } finally {
        landing.restore()
      }
    })

    it('a section inside a section, both opened: each block once, in document order', async () => {
      const { view, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        const [part1, sectionA] = scanHeadings(view.state.doc).map(({ pos }) => pos)
        setHeadingFoldSet([part1, sectionA], true)(view.state, view.dispatch)
        channel.jump(2)
        expect(eased(landing.animate).map(({ element }) => label(element))).toEqual([
          'P Intro paragraph.',
          'H2 Section A',
          'P Alpha body.',
          'H3 Deep dive',
          'P Deep body.',
          'H2 Section B',
          'P Beta body.',
        ])
      } finally {
        landing.restore()
      }
    })

    it('a long section: sixty blocks at most, and the stagger stops growing at the ninth', async () => {
      const paragraphs = Array.from({ length: 70 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
      const { view, channel } = await mountToc(`# Long\n\n${paragraphs}\n\n# After\n`)
      const landing = stubLanding()
      try {
        setHeadingFoldSet([0], true)(view.state, view.dispatch)
        channel.jump(0)
        const blocks = eased(landing.animate)
        expect(blocks).toHaveLength(60)
        expect(label(blocks[0].element)).toBe('P Paragraph 0.')
        expect(label(blocks[59].element)).toBe('P Paragraph 59.')
        expect(blocks.map(({ options }) => options.delay).slice(6, 11)).toEqual([108, 126, 144, 144, 144])
      } finally {
        landing.restore()
      }
    })

    it('a bullet the jump opened: the nested lists its fold and the folds above it were hiding, and no other', async () => {
      const { view, root, channel } = await mountToc(BULLETS)
      const landing = stubLanding()
      try {
        const [alpha, alphaOne, , , beta] = scanBullets(view.state.doc).map(({ pos }) => pos)
        setOutlineFoldSet([alpha, alphaOne, beta], true)(view.state, view.dispatch)
        channel.jump(1)
        const lists = eased(landing.animate).map(({ element }) => element)
        // Alpha's list of children, then Alpha one's inside it. Beta's stays folded and is not touched.
        expect(lists.map(({ tagName }) => tagName)).toEqual(['UL', 'UL'])
        expect(lists[0].parentElement?.closest('.milkdown-list-item-block')).toBe(view.nodeDOM(alpha))
        expect(lists[1].parentElement?.closest('.milkdown-list-item-block')).toBe(view.nodeDOM(alphaOne))
        expect(root.querySelectorAll('[data-outline-folded="true"]')).toHaveLength(1)
        expect(lists).not.toContain(root.querySelector('[data-outline-folded="true"]'))
      } finally {
        landing.restore()
      }
    })

    it('a jump that unfolds nothing animates the landing flash and nothing else', async () => {
      const { view, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        // A fold that hides something else is left alone, and its blocks with it.
        setHeadingFoldSet([scanHeadings(view.state.doc)[3].pos], true)(view.state, view.dispatch)
        channel.jump(1)
        expect(landing.animate).toHaveBeenCalledTimes(1)
        expect(landing.animate).toHaveBeenCalledWith(...FLASH)
      } finally {
        landing.restore()
      }
    })

    it('under prefers-reduced-motion nothing is animated: the unfold is instant, as it was', async () => {
      const { view, channel } = await mountToc(DOC)
      const landing = stubLanding()
      ;(window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({ matches: query.includes('prefers-reduced-motion') })
      try {
        const [part1, sectionA] = scanHeadings(view.state.doc).map(({ pos }) => pos)
        setHeadingFoldSet([part1, sectionA], true)(view.state, view.dispatch)
        channel.jump(1)
        expect(isHeadingCollapsed(view.state, part1)).toBe(false)
        expect(isHeadingCollapsed(view.state, sectionA)).toBe(false)
        expect(landing.animate).not.toHaveBeenCalled()
      } finally {
        delete (window as unknown as Record<string, unknown>).matchMedia
        landing.restore()
      }
    })
  })

  describe('the glide', () => {
    /**
     * The note's own scroller, 500px tall with its top edge at y=100, and the frames in the test's
     * hand. Each heading is given a place in the note (`tops`, px from the note's start), and its
     * box follows the scroller as a laid-out one does: the engine measures the row when the glide
     * starts and once more when it lands.
     */
    const glideHost = (view: EditorView, root: HTMLElement, tops: readonly number[], scrollHeight = 3000) => {
      root.classList.add('editor-host')
      root.getBoundingClientRect = () => new DOMRect(0, 100, 800, 500)
      Object.defineProperties(root, { scrollTop: { value: 0, writable: true }, clientHeight: { value: 500 }, scrollHeight: { value: scrollHeight } })
      scanHeadings(view.state.doc).forEach(({ pos }, i) => {
        ;(view.nodeDOM(pos) as HTMLElement).getBoundingClientRect = () => new DOMRect(0, 100 + tops[i] - root.scrollTop, 600, 30)
      })
      let clock = 1000
      const waiting = new Map<number, FrameRequestCallback>()
      let ids = 0
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        waiting.set(++ids, callback)
        return ids
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => waiting.delete(id))
      vi.spyOn(performance, 'now').mockImplementation(() => clock)
      return {
        /** Paint the frame that comes `ms` after the last one. */
        after: (ms: number): void => {
          clock += ms
          const frames = [...waiting.values()]
          waiting.clear()
          frames.forEach((frame) => frame(clock))
        },
      }
    }
    /** Part 1, Section A, Deep dive, Section B, Part 2: where each stands in the note. */
    const TOPS = [24, 224, 424, 624, 724]

    it('takes 420 ms for a row far off and for one close by, leaves and settles gently, and lands 24px under the edge with its one flash at the end', async () => {
      const { view, root, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        const frames = glideHost(view, root, TOPS)
        channel.jump(3)
        // Nothing has moved yet: the first frame is still to come.
        expect(root.scrollTop).toBe(0)
        // Section B, 600px down. A quarter of the time is a sixteenth of the way; the half is the half.
        frames.after(105)
        expect(root.scrollTop).toBe(37.5)
        frames.after(105)
        expect(root.scrollTop).toBe(300)
        frames.after(105)
        expect(root.scrollTop).toBe(562.5)
        expect(landing.animate).not.toHaveBeenCalled()
        frames.after(105)
        expect(root.scrollTop).toBe(600)
        expect(landing.animate).toHaveBeenCalledTimes(1)
        expect(landing.animate).toHaveBeenCalledWith(...FLASH)
        expect((landing.animate.mock.contexts[0] as HTMLElement).textContent).toContain('Section B')
        // The glide placed the row itself: no `scrollIntoView` beside it.
        expect(landing.scrollIntoView).not.toHaveBeenCalled()
        // Part 2, 100px further: the same 420 ms, not a sixth of it.
        channel.jump(4)
        frames.after(210)
        expect(root.scrollTop).toBe(650)
        expect(landing.animate).toHaveBeenCalledTimes(1)
        frames.after(210)
        expect(root.scrollTop).toBe(700)
        expect(landing.animate).toHaveBeenCalledTimes(2)
        // Over: a later frame moves nothing.
        frames.after(210)
        expect(root.scrollTop).toBe(700)
      } finally {
        vi.unstubAllGlobals()
        landing.restore()
      }
    })

    it('a row more than three windows away starts the glide three windows from it, down and up', async () => {
      const { view, root, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        const frames = glideHost(view, root, [24, 224, 424, 624, 2424], 5000)
        channel.jump(4)
        // 2400px to go and a window of 500: the note stands 1500px short of the row before a frame is painted.
        expect(root.scrollTop).toBe(900)
        frames.after(210)
        expect(root.scrollTop).toBe(1650)
        frames.after(210)
        expect(root.scrollTop).toBe(2400)
        channel.jump(0)
        expect(root.scrollTop).toBe(1500)
        frames.after(420)
        expect(root.scrollTop).toBe(0)
      } finally {
        vi.unstubAllGlobals()
        landing.restore()
      }
    })

    it.each(['wheel', 'pointerdown', 'keydown'])('the reader’s own %s in the note stops it where it is: no landing, no flash', async (type) => {
      const { view, root, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        const frames = glideHost(view, root, TOPS)
        channel.jump(3)
        frames.after(210)
        expect(root.scrollTop).toBe(300)
        root.dispatchEvent(new Event(type, { bubbles: true }))
        frames.after(210)
        frames.after(210)
        expect(root.scrollTop).toBe(300)
        expect(landing.animate).not.toHaveBeenCalled()
        // The caret went to the row when the jump was asked for; stopping the glide leaves it there.
        expect(view.state.selection.from).toBe(scanHeadings(view.state.doc)[3].pos + 1)
      } finally {
        vi.unstubAllGlobals()
        landing.restore()
      }
    })

    it('a second jump takes over from where the first one is, and a destroyed editor glides no more', async () => {
      const { crepe, view, root, channel } = await mountToc(DOC)
      const landing = stubLanding()
      try {
        const frames = glideHost(view, root, TOPS)
        channel.jump(3)
        frames.after(210)
        expect(root.scrollTop).toBe(300)
        // Part 2 from 300: half of the 400px left after half the time, and only its own flash.
        channel.jump(4)
        frames.after(210)
        expect(root.scrollTop).toBe(500)
        frames.after(210)
        expect(root.scrollTop).toBe(700)
        expect(landing.animate).toHaveBeenCalledTimes(1)
        expect((landing.animate.mock.contexts[0] as HTMLElement).textContent).toContain('Part 2')
        channel.jump(0)
        frames.after(210)
        expect(root.scrollTop).toBe(350)
        await crepe.destroy()
        mounted.pop()?.root.remove()
        frames.after(210)
        expect(root.scrollTop).toBe(350)
        expect(landing.animate).toHaveBeenCalledTimes(1)
      } finally {
        vi.unstubAllGlobals()
        landing.restore()
      }
    })
  })

  describe('in a bullet note', () => {
    it('puts the caret at the start of the bullet label, focuses the note, scrolls the list item to the top and flashes it once', async () => {
      const { view, channel } = await mountToc(BULLETS)
      const landing = stubLanding()
      try {
        channel.jump(5)
        const target = scanBullets(view.state.doc)[5]
        expect(target.text).toBe('Beta one')
        // Into the item, into its paragraph: the first place of the label.
        expect(view.state.selection.from).toBe(target.pos + 2)
        expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'Beta one'))
        expect(view.state.selection.empty).toBe(true)
        expect(view.hasFocus()).toBe(true)
        expect(landing.scrollIntoView).toHaveBeenCalledTimes(1)
        expect(landing.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
        expect(landing.scrollIntoView.mock.contexts[0]).toBe(view.nodeDOM(target.pos))
        expect(landing.animate).toHaveBeenCalledTimes(1)
        expect(landing.animate).toHaveBeenCalledWith(...FLASH)
        expect(landing.animate.mock.contexts[0]).toBe(view.nodeDOM(target.pos))
      } finally {
        landing.restore()
      }
    })

    it('a bullet whose first block is a heading takes the caret in that heading', async () => {
      const { view, channel } = await mountToc(`* Alpha\n* # Topic\n  * Under\n`)
      channel.jump(1)
      expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'Topic'))
      expect(view.state.selection.$from.parent.type.name).toBe('heading')
    })

    it('unfolds every collapsed bullet hiding the item and the item itself, and no other', async () => {
      const { view, channel } = await mountToc(BULLETS)
      const [alpha, alphaOne, alphaOneDeep, , beta] = scanBullets(view.state.doc).map(({ pos }) => pos)
      setOutlineFoldSet([alpha, alphaOne, alphaOneDeep, beta], true)(view.state, view.dispatch)
      for (const pos of [alpha, alphaOne, alphaOneDeep, beta]) expect(isOutlineItemCollapsed(view.state, pos)).toBe(true)
      channel.jump(2)
      // "Alpha one deep" sits inside Alpha one inside Alpha: both open, and so does its own fold over "Too deep". Beta hides something else.
      expect(isOutlineItemCollapsed(view.state, alpha)).toBe(false)
      expect(isOutlineItemCollapsed(view.state, alphaOne)).toBe(false)
      expect(isOutlineItemCollapsed(view.state, alphaOneDeep)).toBe(false)
      expect(isOutlineItemCollapsed(view.state, beta)).toBe(true)
      expect(view.state.selection.from).toBe(alphaOneDeep + 2)
    })

    it('opens the one heading folded over the list as well', async () => {
      const { view, channel } = await mountToc(`# Title\n\n* Alpha\n  * Child\n* Beta\n`)
      setHeadingFoldSet([0], true)(view.state, view.dispatch)
      expect(isHeadingCollapsed(view.state, 0)).toBe(true)
      channel.jump(2)
      expect(isHeadingCollapsed(view.state, 0)).toBe(false)
      expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'Beta'))
    })

    it('finds the bullet in the LIVE document: an edit above it, not yet scanned, does not send the jump astray', async () => {
      const { view, channel } = await mountToc(BULLETS)
      vi.useFakeTimers()
      view.dispatch(view.state.tr.insertText('A much longer first bullet. ', posOfText(view.state.doc, 'Alpha')))
      channel.jump(6)
      expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'Gamma'))
    })

    it('lands 24px below the edge of the note’s own scroller by its own arithmetic: no stylesheet margin covers a list item', async () => {
      const { view, root, channel } = await mountToc(BULLETS)
      const landing = stubLanding()
      // Reduced motion: the landing without the glide's frames.
      ;(window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({ matches: query.includes('prefers-reduced-motion') })
      try {
        root.classList.add('editor-host')
        root.getBoundingClientRect = () => new DOMRect(0, 100, 800, 500)
        Object.defineProperties(root, { scrollTop: { value: 200, writable: true }, clientHeight: { value: 500 }, scrollHeight: { value: 3000 } })
        const item = view.nodeDOM(scanBullets(view.state.doc)[4].pos) as HTMLElement
        item.getBoundingClientRect = () => new DOMRect(0, 700, 600, 30)
        channel.jump(4)
        // 600px below the scroller's top now; 24px below it after: 200 + 600 − 24.
        expect(root.scrollTop).toBe(776)
        expect(landing.scrollIntoView).not.toHaveBeenCalled()
      } finally {
        delete (window as unknown as Record<string, unknown>).matchMedia
        landing.restore()
      }
    })

    it('never reaches the save path: no markdownUpdated, markdown unchanged', async () => {
      const onMarkdownUpdated = vi.fn()
      const { crepe, view, channel } = await mountToc(BULLETS, { onMarkdownUpdated })
      const before = getMarkdownForSave(crepe)
      const [alpha, alphaOne] = scanBullets(view.state.doc).map(({ pos }) => pos)
      setOutlineFoldSet([alpha, alphaOne], true)(view.state, view.dispatch)
      channel.jump(2)
      channel.jump(0)
      // Crepe's listener debounces `markdownUpdated` by 200 ms.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(onMarkdownUpdated).not.toHaveBeenCalled()
      expect(getMarkdownForSave(crepe)).toBe(before)
    })
  })
})

describe('the scroll spy', () => {
  /** jsdom lays nothing out, so each row is given the box the test wants: its top, or null for one inside a fold. */
  const layOut = (view: EditorView, tops: readonly (number | null)[]) => {
    scanNote(view.state.doc).rows.forEach(({ pos }, i) => {
      const element = view.nodeDOM(pos) as HTMLElement
      const top = tops[i]
      Object.defineProperty(element, 'offsetParent', { configurable: true, get: () => (top === null ? null : document.body) })
      element.getBoundingClientRect = () => new DOMRect(0, top ?? 0, 600, 30)
    })
  }
  /** A scroller 500px tall whose box starts at y=100: the line a heading must reach is y=140. */
  const scrollerAt = (scrollTop: number, scrollHeight = 3000): HTMLElement => {
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => new DOMRect(0, 100, 800, 500)
    Object.defineProperties(scroller, {
      scrollTop: { value: scrollTop },
      clientHeight: { value: 500 },
      scrollHeight: { value: scrollHeight },
    })
    return scroller
  }
  const ALL = [0, 1, 2, 3, 4]

  it('the last heading at or above the scroller top + 40px is current', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [-400, -50, 140, 141, 900])
    expect(channel.current(ALL, scrollerAt(700))).toBe(2)
  })

  it('none above the line: the first', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [200, 300, 400, 500, 900])
    expect(channel.current(ALL, scrollerAt(0))).toBe(0)
  })

  it('a heading inside a folded section is skipped, above the line and as the first', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [-400, null, null, 141, 900])
    expect(channel.current(ALL, scrollerAt(700))).toBe(0)
    layOut(view, [null, 300, 400, 500, 900])
    expect(channel.current(ALL, scrollerAt(0))).toBe(1)
  })

  it('at the very bottom: the last heading in view, though it never reached the line', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [-2000, -900, 120, 300, 450])
    expect(channel.current(ALL, scrollerAt(2500))).toBe(4)
    // One pixel short of the bottom is still the bottom (a fractional scrollTop); further up it is not.
    expect(channel.current(ALL, scrollerAt(2499))).toBe(4)
    expect(channel.current(ALL, scrollerAt(2400))).toBe(2)
  })

  it('a note too short to scroll is at its top, not its bottom', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [120, 200, 280, 360, 440])
    expect(channel.current(ALL, scrollerAt(0, 500))).toBe(0)
  })

  it('answers in rows of the list it was asked about, not in headings of the note', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [-400, -50, 140, 141, 900])
    // H1 and H2 only: "Deep dive" (index 2) is not shown, so Section A (row 1) is the last above the line.
    expect(channel.current([0, 1, 3, 4], scrollerAt(700))).toBe(1)
  })

  it('no heading with a box at all: −1', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [null, null, null, null, null])
    expect(channel.current(ALL, scrollerAt(0))).toBe(-1)
  })

  it('trusts a remembered position only while its node is an h1-h3: a heading made an H4, not yet scanned, is no row', async () => {
    const { view, channel } = await mountToc(DOC)
    layOut(view, [-400, -50, 140, 141, 900])
    expect(channel.current(ALL, scrollerAt(700))).toBe(2)
    vi.useFakeTimers()
    // "Deep dive" becomes an H4 where it stands: its remembered position still starts a node, and
    // that node is given the very box the H3 had, so only the guard can refuse it.
    const deepDive = scanHeadings(view.state.doc)[2].pos
    view.dispatch(view.state.tr.setNodeMarkup(deepDive, undefined, { ...view.state.doc.nodeAt(deepDive)?.attrs, level: 4 }))
    const h4 = view.nodeDOM(deepDive) as HTMLElement
    expect(h4.tagName).toBe('H4')
    Object.defineProperty(h4, 'offsetParent', { configurable: true, get: () => document.body })
    h4.getBoundingClientRect = () => new DOMRect(0, 140, 600, 30)
    // Section A, the row above it, is the last one that is still a heading of the list.
    expect(channel.current(ALL, scrollerAt(700))).toBe(1)
    // The scan that follows the edit drops the row.
    vi.advanceTimersByTime(SCAN_DELAY_MS)
    expect(texts(channel.getState().headings)).toEqual(['1 Part 1', '2 Section A', '2 Section B', '1 Part 2'])
  })

  describe('in a bullet note', () => {
    const ROWS = [0, 1, 2, 3, 4, 5, 6]

    it('a list item’s node is the element Crepe’s node view made for it, the `<li>` its child', async () => {
      const { view } = await mountToc(BULLETS)
      for (const { pos } of scanBullets(view.state.doc)) {
        const element = view.nodeDOM(pos) as HTMLElement
        expect(element.tagName).toBe('DIV')
        expect(element.classList.contains('milkdown-list-item-block')).toBe(true)
        expect(element.firstElementChild?.matches('li.list-item')).toBe(true)
      }
    })

    it('the same rule over the list items: the last at or above the line, the first when none is, the last in view at the very bottom', async () => {
      const { view, channel } = await mountToc(BULLETS)
      layOut(view, [-400, -50, 140, 141, 300, 450, 900])
      expect(channel.current(ROWS, scrollerAt(700))).toBe(2)
      // Level 1 only: Alpha (row 0) is the last of those above the line.
      expect(channel.current([0, 4, 6], scrollerAt(700))).toBe(0)
      layOut(view, [200, 230, 260, 290, 320, 350, 380])
      expect(channel.current(ROWS, scrollerAt(0))).toBe(0)
      layOut(view, [-2000, -1900, -900, -500, 120, 300, 450])
      expect(channel.current(ROWS, scrollerAt(2500))).toBe(6)
    })

    it('a bullet inside a folded bullet is skipped, above the line and as the first', async () => {
      const { view, channel } = await mountToc(BULLETS)
      layOut(view, [-400, null, null, null, 141, 300, 900])
      expect(channel.current(ROWS, scrollerAt(700))).toBe(0)
      layOut(view, [null, null, null, null, 300, 400, 900])
      expect(channel.current(ROWS, scrollerAt(0))).toBe(4)
    })

    it('trusts a remembered position only while its node is a list item’s own element: after an edit above, not yet scanned, none is', async () => {
      const { view, root, channel } = await mountToc(`Intro.\n\n${BULLETS}`)
      layOut(view, [-400, -50, 140, 141, 300, 450, 900])
      expect(channel.current(ROWS, scrollerAt(700))).toBe(2)
      vi.useFakeTimers()
      // One letter above the list: every remembered position is now one short of its item, where a
      // list (`<ul>`) starts or nothing does. Each of those is given a box, so only the guard can refuse it.
      view.dispatch(view.state.tr.insertText('!', posOfText(view.state.doc, 'Intro.')))
      const stale = scanBullets(view.state.doc).map(({ pos }) => view.nodeDOM(pos - 1))
      expect(stale.some((node) => node instanceof HTMLElement && node.tagName === 'UL')).toBe(true)
      for (const element of root.querySelectorAll<HTMLElement>('ul, p')) {
        Object.defineProperty(element, 'offsetParent', { configurable: true, get: () => document.body })
        element.getBoundingClientRect = () => new DOMRect(0, 0, 600, 30)
      }
      expect(channel.current(ROWS, scrollerAt(700))).toBe(-1)
      // The scan that follows the edit has the positions right again.
      vi.advanceTimersByTime(SCAN_DELAY_MS)
      expect(channel.current(ROWS, scrollerAt(700))).toBe(2)
    })

    it('a heading’s element is not a bullet’s: a note that turned into headings stops trusting list items at once', async () => {
      const { view, channel } = await mountToc(`# Title\n\n* Alpha\n* Beta\n`)
      layOut(view, [-50, 300])
      expect(channel.current([0, 1], scrollerAt(700))).toBe(0)
      const { heading } = view.state.schema.nodes
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, heading.create({ level: 2 }, view.state.schema.text('Second'))))
      // A jump scans: the rows are the two headings now, and neither has been laid out.
      channel.jump(99)
      expect(channel.current([0, 1], scrollerAt(700))).toBe(-1)
      layOut(view, [-50, 300])
      expect(channel.current([0, 1], scrollerAt(700))).toBe(0)
    })
  })
})
