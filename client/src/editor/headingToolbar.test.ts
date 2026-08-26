/**
 * The selection toolbar's Heading group (YAZ-923, `createCrepe.ts` `buildHeadingToolbar`).
 *
 * Tested through a REAL Crepe (the `wikilinkPicker.test.ts` mount idiom), not a stub builder:
 * the group is wired via `featureConfigs[CrepeFeature.Toolbar].buildToolbar`, so mounting is the
 * only thing that proves the wiring, the group is APPENDED (stock Bold/Italic/… survive), and
 * `active`/`onRun` run against a real `Ctx` — real selection, real commands, real markdown out.
 *
 * NB: Crepe's toolbar items fire on POINTERDOWN, not click (a click never reaches them because
 * the button must act before the editor's selection is torn down) — hence `press()` below.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** The Heading group's items, in the order `buildHeadingToolbar` adds them. */
const HEADING_ITEMS = ['h1', 'h2', 'h3', 'text'] as const
type HeadingItem = (typeof HEADING_ITEMS)[number]

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.milkdown-toolbar').forEach((el) => el.remove())
})

/** Let the toolbar's own update tick land (it renders off the view update, not synchronously). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

/** Select a run of text by its content — the toolbar only shows for a non-empty selection. */
async function select(view: EditorView, text: string): Promise<void> {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (from >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (index >= 0) from = pos + index
    return from < 0
  })
  if (from < 0) throw new Error(`text not found: ${text}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)))
  await settle()
}

function item(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.milkdown-toolbar [data-toolbar-item="${key}"]`)
}

function must(key: string): HTMLElement {
  const el = item(key)
  if (el === null) throw new Error(`no toolbar item: ${key}`)
  return el
}

/** Which of H1/H2/H3/T the toolbar is lighting up right now. */
function actives(): HeadingItem[] {
  return HEADING_ITEMS.filter((key) => must(key).classList.contains('active'))
}

/** Crepe's toolbar buttons act on pointerdown — a plain `.click()` is a no-op here. */
async function press(key: HeadingItem): Promise<void> {
  must(key).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  await settle()
}

describe('Heading toolbar group (YAZ-923)', () => {
  it('appends H1/H2/H3/T to the selection toolbar — labelled, glyph-iconed, stock items untouched', async () => {
    const { view } = await mount('# One\n\nplain\n')
    await select(view, 'plain')

    const buttons = HEADING_ITEMS.map(must)
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Text'])
    expect(buttons.map((b) => b.title)).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Text'])
    // The label IS the icon: an `Hn` / `T` glyph drawn as SVG text.
    expect(buttons.map((b) => b.querySelector('svg text')?.textContent)).toEqual(['H1', 'H2', 'H3', 'T'])

    // A GROUP was added, not a replacement toolbar: Crepe's own marks still lead the strip.
    expect(item('bold')).not.toBeNull()
    expect(item('italic')).not.toBeNull()
    const order = [...document.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')].map(
      (b) => b.dataset.toolbarItem,
    )
    expect(order.slice(-4)).toEqual(['h1', 'h2', 'h3', 'text'])
    expect(order.indexOf('bold')).toBeLessThan(order.indexOf('h1'))
  })

  it('lights exactly the block\'s own level — the invisible ## made visible', async () => {
    const { view } = await mount('# One\n\n## Two\n\n### Three\n\nplain\n')

    await select(view, 'One')
    expect(actives()).toEqual(['h1'])
    await select(view, 'Two')
    expect(actives()).toEqual(['h2'])
    await select(view, 'Three')
    expect(actives()).toEqual(['h3'])
  })

  it('lights T — and no heading — inside a plain paragraph', async () => {
    const { view } = await mount('## Two\n\nplain\n')
    await select(view, 'plain')
    expect(actives()).toEqual(['text'])
  })

  it('lights nothing for a block that is neither: a level past the group (h4) reads as no answer', async () => {
    const { view } = await mount('#### Four\n')
    await select(view, 'Four')
    expect(actives()).toEqual([])
  })

  it('pressing a level writes the markdown that typing its hashes would', async () => {
    const { crepe, view } = await mount('plain\n')

    await select(view, 'plain')
    await press('h1')
    expect(getMarkdownForSave(crepe)).toBe('# plain\n')

    await select(view, 'plain')
    await press('h3')
    expect(getMarkdownForSave(crepe)).toBe('### plain\n')
  })

  it('T is the way back: a heading turns into a plain paragraph without backspacing hashes', async () => {
    const { crepe, view } = await mount('## Two\n\ntail\n')
    await select(view, 'Two')
    await press('text')
    expect(getMarkdownForSave(crepe)).toBe('Two\n\ntail\n')
  })

  it('only the selected block changes; the rest of the document is left alone', async () => {
    const { crepe, view } = await mount('# One\n\n## Two\n\nplain\n')
    await select(view, 'plain')
    await press('h2')
    expect(getMarkdownForSave(crepe)).toBe('# One\n\n## Two\n\n## plain\n')
  })

  it('the lit button follows the press: switching level re-lights, T un-lights every heading', async () => {
    const { view } = await mount('plain\n')

    await select(view, 'plain')
    expect(actives()).toEqual(['text'])

    await press('h2')
    await select(view, 'plain')
    expect(actives()).toEqual(['h2'])

    await press('text')
    await select(view, 'plain')
    expect(actives()).toEqual(['text'])
  })

  it('pressing the level a block already is leaves it exactly as it was', async () => {
    const { crepe, view } = await mount('## Two\n')
    await select(view, 'Two')
    await press('h2')
    expect(getMarkdownForSave(crepe)).toBe('## Two\n')
    await select(view, 'Two')
    expect(actives()).toEqual(['h2'])
  })
})
