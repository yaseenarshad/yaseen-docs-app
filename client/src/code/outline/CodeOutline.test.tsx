/**
 * The code Outline (YAZ-3486) as the reader sees it, against the fake Monaco editor
 * (`monacoTestKit.ts`) and a feed the test fills: the scenarios S1–S9 and S11–S12 in jsdom. The
 * rules themselves are pinned in `outlineModel.test.ts`; the real Monaco and the real Python helper
 * run in the hidden end-to-end step (`desktop/e2e/codeTab.spec.ts`).
 *
 * Mounted as `CodeEditor` mounts it: `section.editor` > `.code-editor` > Monaco's mount and the
 * Outline beside it. jsdom lays nothing out, so the section is given the width a test wants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TOC_DEFAULT_W, type CodeOutlineSort, type CodeSymbolKind, type TableOfContents as TableOfContentsMode } from '@shared/types'
import { FakeEditor, FakeModel } from '../monacoTestKit'
import { CodeOutline, ROW_H } from './CodeOutline'
import type { OutlineFeed, OutlineSnapshot } from './outlineFeed'
import { buildTree, type CodeSymbol, type MarkerLike } from './outlineModel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CLASS = 4
const METHOD = 5
const VARIABLE = 12

/** `long-class-for-folding.ts`: `export class Pipeline {` on line 1, then 40 methods of 10 lines, each with one variable. */
const LINES = ['export class Pipeline {', ...Array.from({ length: 40 }, (_, i) => [`  step${i + 1}() {`, `    const value${i + 1} = ${i}`, ...Array.from({ length: 7 }, () => '    work()'), '  }', '']).flat(), '}']
const TEXT = LINES.join('\n')
const line = (text: string): number => LINES.indexOf(text) + 1
const range = (from: number, to: number, column = 1, end = 200) => ({ startLineNumber: from, startColumn: column, endLineNumber: to, endColumn: end })
const SYMBOLS: CodeSymbol[] = [
  {
    name: 'Pipeline',
    kind: CLASS,
    range: range(1, LINES.length),
    selectionRange: range(1, 1, 14, 22),
    children: Array.from({ length: 40 }, (_, i) => {
      const at = line(`  step${i + 1}() {`)
      return { name: `step${i + 1}`, kind: METHOD, range: range(at, at + 9, 3), selectionRange: range(at, at, 3, 8), children: [{ name: `value${i + 1}`, kind: VARIABLE, range: range(at + 1, at + 1, 5), selectionRange: range(at + 1, at + 1, 11, 17) }] }
    }),
  },
]

/** A feed the test fills, as `outlineFeed.ts` would: `setLocals` builds the tree again, with or without the names inside functions. */
function testFeed(symbols: readonly CodeSymbol[] | null, markers: MarkerLike[] = []) {
  let snapshot: OutlineSnapshot = { tree: symbols === null ? null : buildTree(symbols, true), markers }
  const listeners = new Set<() => void>()
  const feed: OutlineFeed & { set(next: Partial<OutlineSnapshot>): void; locals: boolean[] } = {
    locals: [],
    setLocals(show) {
      feed.locals.push(show)
      snapshot = { ...snapshot, tree: symbols === null ? null : buildTree(symbols, show) }
      listeners.forEach((l) => l())
    },
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    dispose: () => undefined,
    setActive: () => undefined,
    set(next) {
      snapshot = { ...snapshot, ...next }
      act(() => listeners.forEach((l) => l()))
    },
  }
  return feed
}

interface Mounted {
  section: HTMLElement
  editor: FakeEditor
  feed: ReturnType<typeof testFeed>
  onChangeView: ReturnType<typeof vi.fn>
  onChangeMode: ReturnType<typeof vi.fn>
  onReturnFocus: ReturnType<typeof vi.fn>
  render(props?: Partial<{ mode: TableOfContentsMode; sort: CodeOutlineSort; hidden: CodeSymbolKind[]; locals: boolean }>): void
}

let root: Root | null = null
let host: HTMLElement | null = null
/** One entry per React commit of the Outline (a `Profiler` around it). */
const commits: number[] = []

/**
 * `locals` is "…" › Show › "Variables inside functions" (YAZ-3507). The scenarios of YAZ-3486 ran with every
 * symbol a row, so they keep it on; the YAZ-3507 suite mounts with it off, the app's default.
 */
function mount(opts: { width?: number; mode?: TableOfContentsMode; symbols?: readonly CodeSymbol[] | null; markers?: MarkerLike[]; text?: string; locals?: boolean } = {}): Mounted {
  host = document.createElement('div')
  document.body.appendChild(host)
  const section = document.createElement('section')
  section.className = 'editor editor--code'
  Object.defineProperty(section, 'clientWidth', { configurable: true, value: opts.width ?? 1400 })
  host.appendChild(section)
  // Monaco's own element: in the section, so its focus is this tab's (⌘J's claim rule).
  const editorMount = document.createElement('div')
  section.appendChild(editorMount)
  const reactRoot = document.createElement('div')
  section.appendChild(reactRoot)
  const model = new FakeModel(opts.text ?? TEXT, { scheme: 'code-tab', authority: 't1', path: '/vault/long-class-for-folding.ts', fsPath: '/vault/long-class-for-folding.ts', toString: () => 'code-tab://t1/vault/long-class-for-folding.ts' })
  const editor = new FakeEditor(editorMount, { model })
  const feed = testFeed(opts.symbols === undefined ? SYMBOLS : opts.symbols, opts.markers)
  commits.length = 0
  const onChangeView = vi.fn()
  const onChangeMode = vi.fn()
  const onReturnFocus = vi.fn(() => editor.focus())
  let props = { mode: opts.mode ?? ('auto' as TableOfContentsMode), sort: 'position' as CodeOutlineSort, hidden: [] as CodeSymbolKind[], locals: opts.locals ?? true }
  function Host() {
    const hostRef = useRef<HTMLDivElement>(null)
    return (
      <div className="code-editor">
        <div className="code-editor__monaco" ref={hostRef} />
        <Profiler id="outline" onRender={() => void commits.push(1)}>
        <CodeOutline feed={feed} editor={editor} lineHeight={() => 19} mode={props.mode} onChangeMode={onChangeMode} width={TOC_DEFAULT_W} onChangeWidth={() => undefined} sort={props.sort} hidden={props.hidden} locals={props.locals} onChangeView={onChangeView} hostRef={hostRef} onReturnFocus={onReturnFocus} />
        </Profiler>
      </div>
    )
  }
  root = createRoot(reactRoot)
  const render = (next: Partial<typeof props> = {}): void => {
    props = { ...props, ...next }
    act(() => root!.render(<Host />))
  }
  render()
  return { section, editor, feed, onChangeView, onChangeMode, onReturnFocus, render }
}

const nav = (): HTMLElement | null => document.querySelector('nav.outline')
const rowEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.outline__row')]
const rowNames = (): string[] => rowEls().map((r) => r.querySelector('.outline__name')!.textContent!)
const row = (name: string): HTMLElement => {
  const found = rowEls().find((r) => r.querySelector('.outline__name')!.textContent === name)
  if (found === undefined) throw new Error(`no row ${name}: ${rowNames().join(', ')}`)
  return found
}
const current = (): string | null => document.querySelector('.outline__row[aria-current="true"] .outline__name')?.textContent ?? null
const filterBox = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.outline__filter')!
const click = (el: Element): void => act(() => void (el as HTMLElement).click())
const key = (target: Element, k: string, init: KeyboardEventInit = {}): void => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const type = (value: string): void => {
  const input = filterBox()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const menuItem = (label: string): HTMLButtonElement => {
  const item = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === label)
  if (item === undefined) throw new Error(`no menu item ${label}`)
  return item
}
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

let reduce = true
beforeEach(() => {
  reduce = true
  // jsdom lays nothing out: the list is 480 px tall, so it draws 20 rows and keeps the current one in view.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('outline__list') ? 480 : 0
    },
  })
  // "Reduce Motion" on by default: a jump lands at once, so a test reads where it landed.
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  // Back to jsdom's own (on `Element.prototype`).
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

describe('S1 and S11: what shows', () => {
  it('S1: Pipeline and its methods, nested, each with a type icon and a ⌄ where it has children', () => {
    mount()
    expect(nav()).not.toBeNull()
    // The runner is as tall as every row; only the rows on screen and a margin are drawn.
    expect(document.querySelector<HTMLElement>('.outline__runner')!.style.height).toBe(`${81 * ROW_H}px`)
    expect(rowNames().slice(0, 4)).toEqual(['Pipeline', 'step1', 'value1', 'step2'])
    expect(rowEls().length).toBeLessThan(81)
    expect(row('Pipeline').querySelector('.outline__icon')!.getAttribute('data-family')).toBe('class')
    expect(row('step1').querySelector('.outline__icon')!.getAttribute('data-family')).toBe('method')
    expect(row('value1').querySelector('.outline__icon')!.getAttribute('data-family')).toBe('variable')
    expect(row('Pipeline').getAttribute('aria-expanded')).toBe('true')
    expect(row('value1').hasAttribute('aria-expanded')).toBe(false)
    expect(row('step1').getAttribute('aria-level')).toBe('2')
    expect(row('Pipeline').title).toBe('Class Pipeline')
  })

  it('S11: a file with no symbol source shows no Outline; the setting Off shows none either', () => {
    mount({ symbols: null })
    expect(nav()).toBeNull()
    act(() => root?.unmount())
    mount({ mode: 'off' })
    expect(nav()).toBeNull()
  })

  it('names beside the code when there is room for 800 px of code; else the rail and its card; Always down to 700 px', () => {
    mount({ width: 1000 })
    expect(nav()!.hasAttribute('data-names')).toBe(true)
    act(() => root?.unmount())
    mount({ width: 999 })
    expect(nav()!.hasAttribute('data-names')).toBe(false)
    expect(document.querySelector('.toc__rail')).not.toBeNull()
    // The rail draws one line per row it has room for, and the current one in the accent.
    expect(document.querySelectorAll('.toc__line').length).toBeGreaterThan(0)
    act(() => root?.unmount())
    mount({ width: 760, mode: 'pinned' })
    expect(nav()!.hasAttribute('data-names')).toBe(true)
  })
})

describe('S2: collapse', () => {
  it('the ⌄ of Pipeline hides its methods and shows them again; Collapse all collapses every parent', () => {
    mount()
    click(row('Pipeline').querySelector('.outline__twisty')!)
    expect(rowNames()).toEqual(['Pipeline'])
    expect(row('Pipeline').getAttribute('aria-expanded')).toBe('false')
    click(row('Pipeline').querySelector('.outline__twisty')!)
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'value1'])
    click(document.querySelector('button[aria-label="Collapse all"]')!)
    expect(rowNames()).toEqual(['Pipeline'])
    // Open Pipeline again: its methods show, each still collapsed.
    click(row('Pipeline').querySelector('.outline__twisty')!)
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'step2'])
  })
})

describe('S3: the filter', () => {
  it('keeps step3 and its parent Pipeline (and step30–39, which hold the text), with the match in bold', () => {
    mount()
    type('step3')
    expect(rowNames()).toEqual(['Pipeline', 'step3', ...Array.from({ length: 10 }, (_, i) => `step${30 + i}`)])
    expect(row('step3').querySelector('.outline__hit')!.textContent).toBe('step3')
    // The first match is picked, as VS Code's filter does.
    expect(row('step3').hasAttribute('data-picked')).toBe(true)
    type('')
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'value1'])
  })
})

describe('S4 and S5: the "…" menu, remembered app-wide', () => {
  it('S4: Sort by Name and Type write the setting; the rows follow it; Position puts them back', () => {
    const m = mount()
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Sort by'))
    // Position is checked; the others are not.
    expect(menuItem('Position').querySelector('path')).not.toBeNull()
    expect(menuItem('Name').querySelector('path')).toBeNull()
    click(menuItem('Name'))
    expect(m.onChangeView).toHaveBeenLastCalledWith({ codeOutlineSort: 'name' })
    expect(document.querySelector('.ctx-menu')).toBeNull()
    m.render({ sort: 'name' })
    // step1, step2, …, step10 by number, not step1, step10, step11.
    expect(rowNames().slice(0, 5)).toEqual(['Pipeline', 'step1', 'value1', 'step2', 'value2'])
    m.render({ sort: 'type', hidden: ['variable'] })
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'step2'])
    m.render({ sort: 'position', hidden: [] })
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'value1'])
  })

  it('S5: Show › Variables turns them off through the setting; the rows go; Show › Variables brings them back', () => {
    const m = mount()
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Show'))
    // Only the kinds this file has: a class, methods, variables; then the names inside functions (on here).
    expect([...document.querySelectorAll('.ctx-menu__sub .ctx-menu__item')].map((b) => b.textContent)).toEqual(['Classes', 'Methods', 'Variables', 'Variables inside functions'])
    click(menuItem('Variables'))
    expect(m.onChangeView).toHaveBeenLastCalledWith({ codeOutlineHidden: ['variable'] })
    m.render({ hidden: ['variable'] })
    expect(rowNames().some((n) => n.startsWith('value'))).toBe(false)
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Show'))
    expect(menuItem('Variables').querySelector('path')).toBeNull()
    click(menuItem('Variables'))
    expect(m.onChangeView).toHaveBeenLastCalledWith({ codeOutlineHidden: [] })
  })

  it('Expand all and Collapse all are in the menu too', () => {
    mount()
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Collapse all'))
    expect(rowNames()).toEqual(['Pipeline'])
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Expand all'))
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'value1'])
  })
})

describe('YAZ-3507: names inside functions', () => {
  it('are not rows by default; "…" › Show › "Variables inside functions" writes the setting, and the rows come back', () => {
    const m = mount({ locals: false })
    expect(m.feed.locals).toEqual([false])
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'step2'])
    expect(rowNames().some((n) => n.startsWith('value'))).toBe(false)
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Show'))
    // No Variables kind is left in the tree: only the class, the methods, and the row that brings the names back.
    expect([...document.querySelectorAll('.ctx-menu__sub .ctx-menu__item')].map((b) => b.textContent)).toEqual(['Classes', 'Methods', 'Variables inside functions'])
    expect(menuItem('Variables inside functions').querySelector('path')).toBeNull()
    click(menuItem('Variables inside functions'))
    expect(m.onChangeView).toHaveBeenLastCalledWith({ codeOutlineLocals: true })
    m.render({ locals: true })
    expect(m.feed.locals).toEqual([false, true])
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'value1'])
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Show'))
    expect(menuItem('Variables inside functions').querySelector('path')).not.toBeNull()
    click(menuItem('Variables inside functions'))
    expect(m.onChangeView).toHaveBeenLastCalledWith({ codeOutlineLocals: false })
  })

  it('a file with no name inside a function does not offer the row', () => {
    mount({ locals: false, symbols: [{ name: 'make', kind: 11, range: range(1, 3), selectionRange: range(1, 1, 17, 21) }, { name: 'LIMIT', kind: VARIABLE, range: range(4, 4), selectionRange: range(4, 4, 14, 19) }] })
    click(document.querySelector('button[aria-label="More actions"]')!)
    click(menuItem('Show'))
    expect([...document.querySelectorAll('.ctx-menu__sub .ctx-menu__item')].map((b) => b.textContent)).toEqual(['Functions', 'Variables'])
  })
})

describe('S6: error marks', () => {
  it('the row that holds an error has a red mark, a warning a yellow one; a collapsed parent shows the worst it hides', () => {
    const m = mount()
    expect(document.querySelectorAll('.outline__mark').length).toBe(0)
    m.feed.set({ markers: [{ severity: 8, startLineNumber: line('    const value2 = 1') + 2, startColumn: 5 }, { severity: 4, startLineNumber: line('  step1() {') + 3, startColumn: 5 }] })
    expect(row('step2').querySelector('.outline__mark')!.getAttribute('data-mark')).toBe('error')
    expect(row('step1').querySelector('.outline__mark')!.getAttribute('data-mark')).toBe('warning')
    expect(row('Pipeline').querySelector('.outline__mark')).toBeNull()
    expect(row('step2').title).toBe('Method step2 — has an error')
    click(row('Pipeline').querySelector('.outline__twisty')!)
    expect(row('Pipeline').querySelector('.outline__mark')!.getAttribute('data-mark')).toBe('error')
  })
})

describe('S7: follow the cursor', () => {
  it('the current row is the symbol at the cursor; while the code scrolls with the cursor off screen, the one at the top', async () => {
    const m = mount()
    act(() => m.editor.setPosition({ lineNumber: line('  step3() {') + 4, column: 5 }))
    expect(current()).toBe('step3')
    act(() => m.editor.setPosition({ lineNumber: line('    const value3 = 2'), column: 12 }))
    expect(current()).toBe('value3')
    // Scroll: the cursor (line 25) is still on screen, so it stays the current one.
    act(() => m.editor.scrollToLine(10))
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(current()).toBe('value3')
    // Scroll on: the cursor is off screen, the top of the view decides.
    act(() => m.editor.scrollToLine(line('  step7() {') + 3))
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(current()).toBe('step7')
    // The accent marker rides the hairline to it.
    const marker = document.querySelector<HTMLElement>('.toc__marker')!
    expect(marker.style.transform).toBe(`translateY(${rowNames().indexOf('step7') * ROW_H}px)`)
  })

  it('a key typed inside one symbol (the column moves) renders nothing; a move into another symbol renders once', () => {
    const m = mount()
    const at = line('    const value3 = 2')
    act(() => m.editor.setPosition({ lineNumber: at, column: 5 }))
    expect(current()).toBe('value3')
    const before = commits.length
    for (let column = 6; column < 16; column++) act(() => m.editor.setPosition({ lineNumber: at, column }))
    expect(commits.length).toBe(before)
    act(() => m.editor.setPosition({ lineNumber: line('    const value4 = 3'), column: 5 }))
    expect(current()).toBe('value4')
    expect(commits.length).toBe(before + 1)
  })

  it('a current row inside a collapsed parent: the parent is current', () => {
    const m = mount()
    act(() => m.editor.setPosition({ lineNumber: line('  step3() {') + 4, column: 5 }))
    click(row('Pipeline').querySelector('.outline__twisty')!)
    expect(current()).toBe('Pipeline')
  })
})

describe('S8: a click jumps', () => {
  it('opens the folds in the way, puts the cursor on the name, focuses the code, and lands near the top', async () => {
    const m = mount()
    const step3 = line('  step3() {')
    // The class is folded, and step3 with it.
    m.editor.folded.add(1)
    m.editor.folded.add(step3)
    click(row('step3'))
    await settle()
    expect(m.editor.folded.has(1)).toBe(false)
    expect(m.editor.folded.has(step3)).toBe(false)
    expect(m.editor.selections.at(-1)).toEqual({ startLineNumber: step3, startColumn: 3, endLineNumber: step3, endColumn: 3 })
    expect(document.activeElement).toBe(m.editor.input)
    // 24 px below the top, under one sticky line (its class): (line − 1) × 19 − 24 − 19.
    expect(m.editor.getScrollTop()).toBe((step3 - 1) * 19 - 24 - 19)
    expect(current()).toBe('step3')
  })

  it('without Reduce Motion it glides, then flashes the line once', async () => {
    reduce = false
    const m = mount()
    const step30 = line('  step30() {')
    click(row('Pipeline').querySelector('.outline__twisty')!)
    click(row('Pipeline').querySelector('.outline__twisty')!)
    act(() => m.editor.scrollToLine(1))
    type('step30')
    click(row('step30'))
    await settle()
    expect(m.editor.getScrollTop()).toBeLessThan((step30 - 1) * 19 - 43)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 600)))
    expect(m.editor.getScrollTop()).toBe((step30 - 1) * 19 - 43)
    expect(m.editor.decorations.at(-1)).toEqual([{ range: { startLineNumber: step30, startColumn: 1, endLineNumber: step30, endColumn: 1 }, options: { isWholeLine: true, className: 'code-outline-flash' } }])
  })
})

describe('S9: ⌘J, type, ⏎', () => {
  it('⌘J puts the focus in the filter; typing filters; ↓ picks; ⏎ goes; Esc clears and returns to the code', async () => {
    const m = mount()
    act(() => m.editor.focus())
    key(m.editor.input, 'j', { metaKey: true })
    expect(document.activeElement).toBe(filterBox())
    type('step1')
    // step1 and step10–19.
    expect(rowNames()).toEqual(['Pipeline', 'step1', ...Array.from({ length: 10 }, (_, i) => `step${10 + i}`)])
    key(filterBox(), 'ArrowDown')
    expect(row('step10').hasAttribute('data-picked')).toBe(true)
    key(filterBox(), 'Enter')
    await settle()
    expect(m.editor.selections.at(-1)!.startLineNumber).toBe(line('  step10() {'))
    expect(document.activeElement).toBe(m.editor.input)
    // ⌘J again, Esc: the filter clears, the code has the focus.
    key(m.editor.input, 'j', { metaKey: true })
    key(filterBox(), 'Escape')
    expect(m.onReturnFocus).toHaveBeenCalled()
    expect(filterBox().value).toBe('')
    expect(document.activeElement).toBe(m.editor.input)
  })

  it('in the lines look, ⌘J opens the card with the focus in the filter', () => {
    const m = mount({ width: 900 })
    expect(document.querySelector('.toc__card')).toBeNull()
    act(() => m.editor.focus())
    key(m.editor.input, 'j', { metaKey: true })
    expect(document.querySelector('.toc__card')).not.toBeNull()
    expect(document.activeElement).toBe(filterBox())
  })

  it('← collapses the picked row and → opens it while the filter is empty; a letter on a button goes to the filter', () => {
    mount()
    // The cursor is on line 1: Pipeline is current, and ↓ walks from it.
    key(filterBox(), 'ArrowDown')
    expect(row('step1').hasAttribute('data-picked')).toBe(true)
    key(filterBox(), 'ArrowLeft')
    expect(rowNames().slice(0, 3)).toEqual(['Pipeline', 'step1', 'step2'])
    // ← on a collapsed row picks its parent; ← again collapses it.
    key(filterBox(), 'ArrowLeft')
    expect(row('Pipeline').hasAttribute('data-picked')).toBe(true)
    key(filterBox(), 'ArrowLeft')
    expect(rowNames()).toEqual(['Pipeline'])
    key(filterBox(), 'ArrowRight')
    expect(rowNames().length).toBeGreaterThan(1)
    const collapse = document.querySelector<HTMLButtonElement>('button[aria-label="Collapse all"]')!
    act(() => collapse.focus())
    key(collapse, 's')
    expect(document.activeElement).toBe(filterBox())
  })
})

describe('S12: a big file', () => {
  it('260 000 symbols: the list draws only the rows on screen, and a cursor move renders in time', () => {
    const big: CodeSymbol[] = Array.from({ length: 52_000 }, (_, i) => ({
      name: `value${i}`,
      kind: 13,
      range: range(i + 2, i + 2),
      selectionRange: range(i + 2, i + 2, 14, 20),
      children: ['id', 'name', 'tags', 'active'].map((n, k) => ({ name: n, kind: 6, range: range(i + 2, i + 2, 24 + k * 15, 36 + k * 15), selectionRange: range(i + 2, i + 2, 24 + k * 15, 26 + k * 15) })),
    }))
    const t0 = performance.now()
    const m = mount({ symbols: big, text: Array.from({ length: 52_002 }, (_, i) => `export const value${i} = { id: ${i} }`).join('\n') })
    const mountMs = performance.now() - t0
    expect(document.querySelector<HTMLElement>('.outline__runner')!.style.height).toBe(`${260_000 * ROW_H}px`)
    expect(rowEls().length).toBeLessThan(80)
    const t1 = performance.now()
    act(() => m.editor.setPosition({ lineNumber: 40_000, column: 40 }))
    const moveMs = performance.now() - t1
    expect(current()).toBe('name')
    console.log(`[YAZ-3486 S12] Outline of 260k symbols: first render ${mountMs.toFixed(0)} ms (tree built before it), cursor move ${moveMs.toFixed(1)} ms, ${rowEls().length} rows drawn`)
    // jsdom under a full parallel run is slow: about 12 ms alone; the ceiling only catches a walk over every row.
    expect(moveMs).toBeLessThan(500)
  })
})
