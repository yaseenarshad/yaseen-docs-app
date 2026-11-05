/**
 * The selection toolbar's test harness, shared by `headingToolbar.test.ts` and `highlightPanel.test.ts`: a real Crepe
 * (the `wikilinkPicker.test.ts` mount idiom), a selection by its text, and a press on a strip button. Each file that
 * mounts calls `unmountAll()` in its own `afterEach`.
 *
 * NB: Crepe's toolbar items fire on POINTERDOWN, not click (a click never reaches them because the button must act
 * before the editor's selection is torn down), hence `press()`.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DEFAULT_TOOLBAR } from '@shared/types'
import { createCrepe } from './createCrepe'
import { toolbarPrefs } from './toolbarPrefs'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

export async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, view }
}

/** Every editor mounted, gone; the toolbars and the toolbar setting back to their start. */
export async function unmountAll(): Promise<void> {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.milkdown-toolbar').forEach((el) => el.remove())
  toolbarPrefs.value = DEFAULT_TOOLBAR
}

/** Let the toolbar's own update tick land (it renders off the view update, not synchronously). */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

/** Start of `text` inside a single text node. */
export function find(view: EditorView, text: string): number {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (from >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (index >= 0) from = pos + index
    return from < 0
  })
  if (from < 0) throw new Error(`text not found: ${text}`)
  return from
}

/** Select from the start of `start` to the end of `end` — the toolbar only shows for a non-empty selection. */
export async function selectSpan(view: EditorView, start: string, end: string): Promise<void> {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, find(view, start), find(view, end) + end.length)))
  await settle()
}

export const select = (view: EditorView, text: string) => selectSpan(view, text, text)

export function item(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.milkdown-toolbar [data-toolbar-item="${key}"]`)
}

export function must(key: string): HTMLElement {
  const el = item(key)
  if (el === null) throw new Error(`no toolbar item: ${key}`)
  return el
}

/** The highlight swatches, in the order `buildToolbar` adds them (YAZ-4348 demo round 2: pink went into the ▾ panel). */
export const SWATCHES = ['highlight', 'highlight-green', 'highlight-blue'] as const

/** Crepe's toolbar buttons act on pointerdown — a plain `.click()` is a no-op here. */
export async function press(key: string): Promise<void> {
  must(key).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  await settle()
}

/** Every item key in the strip, left to right. */
export function order(): Array<string | undefined> {
  return [...document.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')].map((b) => b.dataset.toolbarItem)
}

/** Which swatches the toolbar is lighting up right now. */
export const litDots = (): Array<(typeof SWATCHES)[number]> => SWATCHES.filter((key) => must(key).classList.contains('active'))
