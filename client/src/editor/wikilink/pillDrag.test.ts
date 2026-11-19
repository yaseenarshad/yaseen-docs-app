/**
 * A drag across a link pill lights it whole once the pointer passes its middle (YAZ-5960, `pillDrag.ts`,
 * `idLinkCaret.ts`): a real editor (`createCrepe`). jsdom draws nothing, so each shown piece gets a box by its text,
 * and the browser's selection during the drag is played by `select` (the head the browser picks: any letter).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import type { MarkdownLinkNav } from '../markdownLink'
import { linkResolver } from '../../links/folderLinks'
import { PILL_SELECTED_CLASS } from './pillSelection'
import { WIKILINK_CLASS, createWikilinkResolveSource, type WikilinkResolveSource } from './wikilinkPlugin'

const A = 'k3m9x2pq7abc'
const PATHS: Record<string, string> = { [A]: '/v/AR v2 plan.md', Named: '/v/Named.md' }

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mountWith(markdown: string, opts: { wikilinks?: WikilinkResolveSource; markdownLinkNav?: MarkdownLinkNav }) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { root, view }
}

function mount(markdown: string) {
  const source = createWikilinkResolveSource()
  source.update((target) => PATHS[target] ?? null)
  return mountWith(markdown, { wikilinks: source })
}

afterEach(async () => {
  vi.restoreAllMocks()
  document.dispatchEvent(new MouseEvent('mouseup'))
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

type Box = { left: number; right: number; top: number; bottom: number }
/** Gives each shown piece whose text is a key its boxes (two for a piece that wraps). */
function boxes(byText: Record<string, Box[]>) {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const list = this.classList.contains(WIKILINK_CLASS) ? (byText[this.textContent ?? ''] ?? []) : []
    return list.map((b) => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top })) as unknown as DOMRectList
  })
}

const lit = (root: HTMLElement) => Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}.${PILL_SELECTED_CLASS}`)).map((el) => el.textContent ?? '')
const select = (view: EditorView, anchor: number, head = anchor) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
const press = (view: EditorView, x: number, y = 10, detail = 1) => view.dom.dispatchEvent(new MouseEvent('mousedown', { button: 0, detail, clientX: x, clientY: y, bubbles: true }))
const move = (x: number, y = 10) => document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: x, clientY: y, bubbles: true }))
const release = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
/** The pointer moves to `x`, `y`, and the browser puts the head at `head`. */
const drag = (view: EditorView, anchor: number, head: number, x: number, y = 10) => {
  move(x, y)
  select(view, anchor, head)
  return view.state.selection.head
}

// 'pad [[k3m9x2pq7abc]] tail': the link spans 5..21; its title's box runs 40..140 on the line 0..20, its middle 90.
const FROM = 5
const TO = 21
const TITLE = { 'AR v2 plan': [{ left: 40, right: 140, top: 0, bottom: 20 }] }

describe('a drag lights a pill whole as the pointer passes its middle (YAZ-5960)', () => {
  it('left to right: before the middle the pill is out, past it the whole pill lights, whatever letter the browser picks', async () => {
    const { root, view } = await mount(`pad [[${A}]] tail\n`)
    boxes(TITLE)
    press(view, 10)
    expect(drag(view, 1, 8, 60)).toBe(FROM)
    expect(lit(root)).toEqual([])
    // The same letter, the pointer past the middle: the pill is in.
    expect(drag(view, 1, 8, 100)).toBe(TO)
    expect(lit(root)).toEqual(['AR v2 plan'])
    expect(drag(view, 1, 19, 130)).toBe(TO)
    expect(drag(view, 1, 23, 160)).toBe(23)
    expect(lit(root)).toEqual(['AR v2 plan'])
    // Back before the middle: out again, though the browser left the head on the link's end.
    expect(drag(view, 1, TO, 70)).toBe(FROM)
    expect(lit(root)).toEqual([])
  })

  it('right to left: the pill lights once the pointer passes its middle going left', async () => {
    const { root, view } = await mount(`pad [[${A}]] tail\n`)
    boxes(TITLE)
    press(view, 200)
    expect(drag(view, 25, 12, 120)).toBe(TO)
    expect(lit(root)).toEqual([])
    expect(drag(view, 25, 12, 80)).toBe(FROM)
    expect(lit(root)).toEqual(['AR v2 plan'])
    expect(drag(view, 25, FROM, 120)).toBe(TO) // back past the middle, the browser on the link's start
    expect(lit(root)).toEqual([])
  })

  it('no flip while the pointer stays in one half, wherever the browser puts the head', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    boxes(TITLE)
    press(view, 10)
    for (const [head, x] of [[18, 45], [6, 60], [20, 75], [7, 89]] as const) expect(drag(view, 1, head, x)).toBe(FROM)
    for (const [head, x] of [[6, 90], [20, 110], [7, 139], [TO, 125]] as const) expect(drag(view, 1, head, x)).toBe(TO)
  })

  it('across lines: a pointer on a line below the pill is past it, on a line above before it', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    boxes(TITLE)
    press(view, 10)
    expect(drag(view, 1, 12, 0, 40)).toBe(TO)
    press(view, 200, 40)
    expect(drag(view, 25, 12, 500, -10)).toBe(FROM)
  })

  it('a pill that wraps counts its two lines one after the other', async () => {
    // 'pad [[Named]] tail': the link spans 5..14; "Named" runs 300..400 on the first line, 0..100 on the second.
    const { view } = await mount('pad [[Named]] tail\n')
    boxes({ Named: [{ left: 300, right: 400, top: 0, bottom: 20 }, { left: 0, right: 100, top: 20, bottom: 40 }] })
    press(view, 10)
    expect(drag(view, 1, 10, 350, 10)).toBe(5) // half of the first line: a quarter of the pill
    expect(drag(view, 1, 10, 20, 30)).toBe(14) // on the second line: past the middle
    expect(drag(view, 1, 10, 390, 10)).toBe(5)
  })

  it('at a line\'s end the browser\'s nudge back into the hidden `]]` keeps the link selected', async () => {
    const { view } = await mount('pad [[Named]]\n')
    boxes({ Named: [{ left: 40, right: 100, top: 0, bottom: 20 }] })
    press(view, 10)
    expect(drag(view, 1, 14, 300)).toBe(14)
    expect(drag(view, 1, 12, 300)).toBe(14) // the nudge, the pointer past the line's end
    expect([view.state.selection.from, view.state.selection.to]).toEqual([1, 14])
  })

  it('a card pill lights by its pieces\' boxes', async () => {
    const records = [{ path: '/v/verbs.md', name: 'verbs.md', basename: 'verbs', title: 'verbs', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], id: 'YAS-1', cards: [{ id: 'YAS-126', off: false, next: false, reviews: [], title: 'Ser' }] }]
    const source = createWikilinkResolveSource()
    source.update(linkResolver(records, '/v', [], [], ['YAS']), records, [], true, ['YAS'])
    source.setLook({ format: '{icon}{name} ({number})' }, 'Mine')
    const { root, view } = await mountWith('pad [[YAS-126]] tail\n', { wikilinks: source })
    // 'pad [[YAS-126]] …': the link spans 5..16; "Ser" 40..70 and " (126)" 70..100: the middle 70.
    boxes({ Ser: [{ left: 40, right: 70, top: 0, bottom: 20 }], ' (126)': [{ left: 70, right: 100, top: 0, bottom: 20 }] })
    press(view, 10)
    expect(drag(view, 1, 10, 65)).toBe(5)
    expect(lit(root)).toEqual([])
    expect(drag(view, 1, 10, 75)).toBe(16)
    expect(lit(root)).toEqual(['Ser', ' (126)'])
  })

  it('a Markdown link pill lights by its pieces\' boxes', async () => {
    const vaultPath = (href: string) => (href.startsWith('../') ? `/v/${href.slice(3)}` : null)
    const markdownLinkNav = { open: vi.fn(), copy: vi.fn(), onNotice: vi.fn(), vaultPath, vaultTag: () => 'Other Vault', icon: () => ({ class: 'probe-icon' }) } as unknown as MarkdownLinkNav
    const { root, view } = await mountWith('pad [Plan end](../plan.md) tail\n', { markdownLinkNav })
    // The link's text spans 5..13; "Plan end" runs 40..120 and its vault's name, a widget at its end, 120..200: the middle 120.
    boxes({ 'Plan end': [{ left: 40, right: 120, top: 0, bottom: 20 }], ' (Other Vault)': [{ left: 120, right: 200, top: 0, bottom: 20 }] })
    press(view, 10)
    expect(drag(view, 1, 9, 110)).toBe(5)
    expect(lit(root)).toEqual([])
    expect(drag(view, 1, 9, 130)).toBe(13)
    expect(lit(root)).toEqual(['Plan end', ' (Other Vault)'])
  })
})

describe('the rest is as before (YAZ-5960)', () => {
  it('a click (no move, or under 4px) and a double-click keep the nearer edge by the letter', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    boxes(TITLE)
    press(view, 130)
    move(132)
    select(view, 8) // the browser's caret near the link's start; the pointer on its second half
    expect(view.state.selection.head).toBe(FROM)
    release()
    press(view, 130, 10, 2)
    move(200)
    select(view, 1)
    select(view, TO - 2)
    expect(view.state.selection.head).toBe(TO)
  })

  it('after the button is up, Shift+arrow steps over the link from edge to edge', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    boxes(TITLE)
    press(view, 10)
    expect(drag(view, 1, 8, 60)).toBe(FROM)
    release()
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    select(view, 1, FROM + 1)
    expect(view.state.selection.head).toBe(TO)
  })
})
