/**
 * The shared harness for the inline-mark tests (`highlight.test.ts`, `underline.test.ts`).
 *
 * Both files drive a REAL editor (`createCrepe`) rather than a bare ProseMirror state, so both
 * need the same five things: a mount that registers itself for teardown, a way to find text by
 * its characters, a way to select or put a caret in it, the marks sitting on it, and one key
 * press through ProseMirror's own `handleKeyDown` chain. They used to carry a private copy of
 * each; this is the single one.
 *
 * Teardown is deliberately NOT an `afterEach` here — a module-level hook would register once per
 * importing file anyway, but leaving it explicit keeps the ownership obvious: every file that
 * calls `mount` calls `unmountAll()` in its own `afterEach`.
 *
 * Mark-specific probes (colours, literal insertion, `<mark>` element lists, …) stay in the test
 * file that cares about them.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** A real Crepe on a real detached root, pushed onto the teardown list. */
export async function mount(markdown: string): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

/** Destroy every editor mounted since the last call — each test file's `afterEach` runs this. */
export async function unmountAll(): Promise<void> {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
}

/** `test-setup.ts` pins `navigator.platform` to MacIntel, so `Mod-` resolves to ⌘ here. */
export const IS_MAC = /Mac/.test(navigator.platform)

/**
 * One key press through ProseMirror's `handleKeyDown` — the same path a real keyboard takes, so
 * keymap priority and `Mod-` resolution are both under test. `Mod` = ⌘ on mac, Ctrl elsewhere.
 * `mod` defaults to true (every mark hotkey is a ⌘ chord); `{ mod: false }` presses a bare key
 * such as `ArrowDown` or `Backspace` (YAZ-1734's line selection).
 */
export function pressKey(crepe: Crepe, key: string, opts: { shift?: boolean; mod?: boolean } = {}): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const mod = opts.mod ?? true
    const event = new KeyboardEvent('keydown', {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      shiftKey: opts.shift ?? false,
      ...(mod ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}),
      bubbles: true,
      cancelable: true,
    })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

/** Document position of the first occurrence of `text` inside a single text node. */
export function posOf(crepe: Crepe, text: string): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

/** Select from the start of `start` to the end of `end` — a range that can span text nodes. */
export function selectAcross(crepe: Crepe, start: string, end: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const from = posOf(crepe, start)
    const to = posOf(crepe, end) + end.length
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  })
}

/** Select exactly `text`. */
export const selectText = (crepe: Crepe, text: string): void => selectAcross(crepe, text, text)

/** Put the caret (empty selection) just inside the text node containing `text`. */
export function caretIn(crepe: Crepe, text: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const at = posOf(crepe, text) + 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
  })
}

/** Mark names on the text node containing `text`. */
export function marksOn(crepe: Crepe, text: string): string[] {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    const $pos = doc.resolve(posOf(crepe, text) + 1)
    return $pos.marks().map((m) => m.type.name).sort()
  })
}

/** The bytes this editor would write to the vault. */
export const md = (crepe: Crepe): string => getMarkdownForSave(crepe)
