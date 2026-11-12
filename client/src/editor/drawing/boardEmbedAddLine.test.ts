/**
 * A line beside an embed (YAZ-4907: "how do you add a bullet under it?"): the one `addLineBesideCommand` of code
 * blocks and tables. The 6-dot menu on an embed's line gets "Add line above" / "Add line below"; with the embed
 * selected, Enter and ⌘↵ add the line below, ⌘⇧↵ above. On a bullet whose own line is the embed: a sibling bullet,
 * after its children. Else a plain paragraph. The caret goes into the new line; one ⌘Z removes it. A real editor
 * (`createCrepe`) with a FAKE window, as `boardEmbed.test.ts` has it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { BoardWindowHandle, BoardWindowHost } from '../embed/types'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { toggleOutlineFold } from '../outline/outlineFolding'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'

vi.mock('../embed/types', async (original) => ({
  ...(await original<typeof import('../embed/types')>()),
  loadBoardWindow: () =>
    Promise.resolve({
      mountBoardWindow: (_host: BoardWindowHost): BoardWindowHandle => ({
        dom: document.createElement('div'),
        update: () => {},
        setSelected: () => {},
        handleKey: () => false,
        setFolded: () => {},
        setFoldable: () => {},
        menuRows: () => [],
        flush: () => {},
        fit: () => {},
        showPage: () => {},
        destroy: () => {},
      }),
    }),
}))

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, extra: Partial<CreateCrepeOptions> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const wikilinks = createWikilinkResolveSource()
  wikilinks.update((t) => (t.endsWith('.md') || !t.includes('.') ? `/v/${t}.md` : null))
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks, boardEmbeds: { root: '/v' }, ...extra })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr)
  // The block handle's stand-in (`blockItemStrip.test.ts`): a right-click on it opens the 6-dot menu at `view.posAtCoords`.
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  return { crepe, root, view, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const md = (crepe: Crepe) => getMarkdownForSave(crepe)
/** The saved Markdown's lines, blank ones out: the list's blank lines between items are the serializer's, not the test's. */
const lines = (crepe: Crepe) => md(crepe).split('\n').filter((l) => l !== '')

/** The embed's text `![[…]]` selected whole: the window selected (`boardEmbed.ts`). */
function selectEmbed(view: EditorView, target: string): void {
  const text = `![[${target}]]`
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text)
  })
  if (at < 0) throw new Error(`no ${text}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + text.length)))
}

function key(view: EditorView, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, ...init })
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
}

/** The caret's block: its text, and its list item's depth in lists (0 = no list). */
function caret(view: EditorView): { text: string; listDepth: number; itemIndex: number | null } {
  const { $from } = view.state.selection
  let listDepth = 0
  let itemIndex: number | null = null
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'list_item') continue
    listDepth++
    if (itemIndex === null) itemIndex = $from.index(d - 1)
  }
  return { text: $from.parent.textContent, listDepth, itemIndex }
}

/** Point the handle at the paragraph holding `text` (or, `item`, at its list item). */
function aimAt(view: EditorView, text: string, item = false): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isTextblock && node.textContent.includes(text)) found = pos
    return found === -1
  })
  if (found === -1) throw new Error(`no block with ${text}`)
  const inside = item ? view.state.doc.resolve(found).before() : found
  view.posAtCoords = () => ({ pos: inside + 1, inside })
}

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rightClick = (item: HTMLElement) => item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
const rowLabels = (view: EditorView) =>
  [...popupOf(view)!.querySelectorAll<HTMLElement>('.ctx-menu__item')].map((b) => `${b.textContent ?? ''}${b.dataset.hint === undefined ? '' : ` ${b.dataset.hint}`}`)
const row = (view: EditorView, label: string): HTMLButtonElement => {
  const found = [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent?.startsWith(label))
  if (found === undefined) throw new Error(`no row ${label}: ${rowLabels(view).join(' | ')}`)
  return found
}

const BOARD = 'Slides.excalidraw'
/** His picture: a sub-bullet whose own line is the embed, with a child under it. */
const SUB_BULLET = `* test\n\n  * ![[${BOARD}]]\n\n    * child\n\n* after\n`

describe('YAZ-4907: the 6-dot menu on an embed`s line', () => {
  it('on a bullet whose line is the embed: Add line above (⌘⇧↵) and Add line below (⌘↵), from the handle on the line and on its dot', async () => {
    const { view, item } = await mount(SUB_BULLET)
    aimAt(view, `![[${BOARD}]]`)
    rightClick(item)
    const labels = rowLabels(view)
    expect(labels.some((l) => l.startsWith('Add line above') && l.includes('⌘⇧↵'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Add line below') && l.includes('⌘↵'))).toBe(true)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    aimAt(view, `![[${BOARD}]]`, true)
    rightClick(item)
    expect(rowLabels(view).filter((l) => l.startsWith('Add line'))).toHaveLength(2)
  })

  it('"Add line below" on the sub-bullet: a sibling sub-bullet after its child, the caret in it', async () => {
    const { crepe, view, item } = await mount(SUB_BULLET)
    aimAt(view, `![[${BOARD}]]`)
    rightClick(item)
    row(view, 'Add line below').click()
    expect(caret(view)).toEqual({ text: '', listDepth: 2, itemIndex: 1 })
    view.dispatch(view.state.tr.insertText('new'))
    expect(lines(crepe)).toEqual(['* test', `  * ![[${BOARD}]]`, '    * child', '  * new', '* after'])
  })

  it('the folded embed line keeps the two rows', async () => {
    const { view, item } = await mount(SUB_BULLET)
    const itemPos = view.state.doc.resolve(view.state.doc.textContent.indexOf('![[') + 2).before()
    toggleOutlineFold(itemPos)(view.state, view.dispatch)
    aimAt(view, `![[${BOARD}]]`, true)
    rightClick(item)
    expect(rowLabels(view).filter((l) => l.startsWith('Add line'))).toHaveLength(2)
  })

  it('a plain text line has no Add line rows', async () => {
    const { view, item } = await mount(SUB_BULLET)
    aimAt(view, 'after')
    rightClick(item)
    expect(rowLabels(view).filter((l) => l.startsWith('Add line'))).toHaveLength(0)
  })
})

describe('YAZ-4907: the keys on a selected embed', () => {
  it('Enter adds a sibling sub-bullet below, after the child; the embed stays', async () => {
    const { crepe, view } = await mount(SUB_BULLET)
    selectEmbed(view, BOARD)
    expect(key(view, {})).toBe(true)
    expect(caret(view)).toEqual({ text: '', listDepth: 2, itemIndex: 1 })
    expect(md(crepe)).toContain(`![[${BOARD}]]`)
    view.dispatch(view.state.tr.insertText('new'))
    expect(lines(crepe)).toEqual(['* test', `  * ![[${BOARD}]]`, '    * child', '  * new', '* after'])
  })

  it('⌘↵ adds the line below, and ⌘⇧↵ above', async () => {
    const { crepe, view } = await mount(SUB_BULLET)
    selectEmbed(view, BOARD)
    expect(key(view, { metaKey: true })).toBe(true)
    expect(caret(view)).toEqual({ text: '', listDepth: 2, itemIndex: 1 })
    selectEmbed(view, BOARD)
    expect(key(view, { metaKey: true, shiftKey: true })).toBe(true)
    expect(caret(view)).toEqual({ text: '', listDepth: 2, itemIndex: 0 })
    view.dispatch(view.state.tr.insertText('above'))
    expect(lines(crepe)).toEqual(['* test', '  * above', `  * ![[${BOARD}]]`, '    * child', '  *', '* after'])
  })

  it('with no bullet: a plain line below, the caret in it', async () => {
    const { crepe, view } = await mount(`![[${BOARD}]]\n\nafter\n`)
    selectEmbed(view, BOARD)
    expect(key(view, {})).toBe(true)
    expect(caret(view)).toEqual({ text: '', listDepth: 0, itemIndex: null })
    view.dispatch(view.state.tr.insertText('new'))
    expect(md(crepe)).toBe(`![[${BOARD}]]\n\nnew\n\nafter\n`)
  })

  it('one ⌘Z removes the new line, and the embed is as it was', async () => {
    const { crepe, view } = await mount(SUB_BULLET)
    selectEmbed(view, BOARD)
    key(view, {})
    expect(md(crepe)).not.toBe(SUB_BULLET)
    undo(view.state, view.dispatch)
    expect(md(crepe)).toBe(SUB_BULLET)
  })

  it('a caret in text keeps its own Enter: a split, no embed line', async () => {
    const { crepe, view } = await mount(SUB_BULLET)
    const at = view.state.doc.textContent.indexOf('after')
    let pos = -1
    view.state.doc.descendants((node, p) => {
      if (pos === -1 && node.isText && node.text!.includes('after')) pos = p + node.text!.indexOf('after') + 2
    })
    void at
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    key(view, {})
    expect(md(crepe)).toContain('* af\n\n* ter')
  })

  it('a board of another vault (an image node, selected) takes the same keys', async () => {
    const boards = { place: (src: string) => (src.startsWith('../w/') ? { root: '/w', path: `/w/${src.slice(5)}`, vault: 'Work' } : null), open: vi.fn(), linkMenu: (path: string) => ({ labels: [], open: () => void path }) }
    const { crepe, view } = await mount('* ![Plan](../w/Plan.drawio)\n\n* after\n', { image: { root: '/v', notePath: '/v/n.md', boards } })
    let imagePos = -1
    view.state.doc.descendants((node, pos) => {
      if (imagePos === -1 && node.type.name === 'image') imagePos = pos
    })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imagePos)))
    expect(key(view, { metaKey: true })).toBe(true)
    expect(caret(view)).toEqual({ text: '', listDepth: 1, itemIndex: 1 })
    view.dispatch(view.state.tr.insertText('new'))
    expect(md(crepe)).toBe('* ![Plan](../w/Plan.drawio)\n\n* new\n\n* after\n')
  })
})
