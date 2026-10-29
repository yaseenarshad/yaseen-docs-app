/**
 * The note keys (YAZ-3564 K1, K4, K12): the drift test and one test per way a changed key reaches a note.
 *
 * The drift test builds a REAL note editor (`createCrepe`, with the find bar, the table of contents and the read-only
 * keys a tab has) and reads every key from Milkdown's own keymap manager (`keymapCtx.build()`): every `$useKeymap`
 * (commonmark, gfm, history, the app's highlight), every app `$shortcut` and ProseMirror's base keymap. A key with no
 * row in the list fails. (A `$useKeymap`'s own `.keymap` is no help: it is undefined until an editor runs it.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, keymapCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { sameKey, toAccelerator, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { APP_KEYS } from '@shared/keys/app'
import { NOTE_KEYS } from '@shared/keys/note'
import { storage } from '../lib/storage'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { createFindChannel } from './find/findChannel'
import { FindBar } from './find/FindBar'
import { createTocChannel } from './toc/tocChannel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
const roots: Root[] = []

async function mount(markdown: string, hotkeys?: HotkeyOverrides) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, hotkeys, find: createFindChannel(), toc: createTocChannel(), readOnlyKeys: true })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, root, view }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const r of roots.splice(0)) act(() => r.unmount())
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.milkdown-toolbar').forEach((el) => el.remove())
})

/** A ProseMirror key name as an accelerator ('Mod-Shift-x' → 'CmdOrCtrl+Shift+X'), the drift test's one translation. */
function accelerator(name: string): string {
  const parts = name.split(/-(?!$)/)
  const key = parts.pop() ?? ''
  const has = (...names: string[]) => parts.some((p) => names.includes(p))
  const named: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' }
  return toAccelerator({ cmd: has('Mod', 'Meta', 'Cmd'), ctrl: has('Ctrl', 'Control'), alt: has('Alt'), shift: has('Shift'), key: named[key] ?? (key.length === 1 ? key.toUpperCase() : key) })
}

/** One key press through ProseMirror's `handleKeyDown`, as a Mac sends it (`test-setup.ts` pins the platform). */
function press(view: EditorView, key: string, mods: { meta?: boolean; alt?: boolean; shift?: boolean } = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, metaKey: mods.meta ?? false, altKey: mods.alt ?? false, shiftKey: mods.shift ?? false, bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

function selectText(view: EditorView, text: string): void {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (from < 0 && at >= 0) from = pos + at
    return from < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)))
}

describe('the note keys in the list (K1)', () => {
  it('every key the note editor binds has a row: a note row or an App row', async () => {
    const { crepe } = await mount('# A note\n\n* a bullet\n')
    const bound = Object.keys(crepe.editor.action((ctx) => ctx.get(keymapCtx).build()))
    // The editor really is the whole note editor: its own keys, Milkdown's and ProseMirror's base keymap.
    expect(bound).toEqual(expect.arrayContaining(['Mod-b', 'Mod-u', 'Mod-Shift-h', 'Mod-.', 'Ctrl-a', 'Shift-ArrowDown']))
    const rows = [...NOTE_KEYS, ...APP_KEYS]
    const missing = bound.filter((name) => !rows.some((row) => row.keys.some((key) => sameKey(key, accelerator(name)))))
    expect(missing).toEqual([])
  })
})

describe('a changed note key works in the next note (K4)', () => {
  it("Milkdown's keymaps: the slice takes the new key, the old one does nothing, and the toolbar shows it (K12)", async () => {
    const { crepe, view } = await mount('hello world\n', { 'note.bold': 'CmdOrCtrl+Alt+B' })
    selectText(view, 'world')
    expect(press(view, 'b', { meta: true })).toBe(false)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(press(view, 'b', { meta: true, alt: true })).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello **world**\n')
    // Crepe's toolbar labels Bold from the same slice.
    selectText(view, 'hello')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(document.querySelector<HTMLElement>('.milkdown-toolbar [data-toolbar-item="bold"]')?.title).toBe('Bold (⌥⌘B)')
  })

  it('Quote has no key by default (D10): ⌘⇧B is Toggle sidebar, and the note binds nothing on it', async () => {
    const { crepe } = await mount('hello\n')
    expect(Object.keys(crepe.editor.action((ctx) => ctx.get(keymapCtx).build()))).not.toContain('Mod-Shift-b')
    const { view } = await mount('hello\n', { 'note.quote': 'CmdOrCtrl+Alt+Q' })
    expect(press(view, 'q', { meta: true, alt: true })).toBe(true)
    expect(view.state.doc.firstChild?.type.name).toBe('blockquote')
  })

  it("the app's own keymaps: a row's new key, and none with No key", async () => {
    const moved = await mount('hello world\n', { 'note.underline': 'CmdOrCtrl+Alt+U' })
    selectText(moved.view, 'world')
    expect(press(moved.view, 'u', { meta: true })).toBe(false)
    expect(press(moved.view, 'u', { meta: true, alt: true })).toBe(true)
    expect(getMarkdownForSave(moved.crepe)).toBe('hello <u>world</u>\n')

    const none = await mount('hello world\n', { 'note.underline': null })
    selectText(none.view, 'world')
    expect(press(none.view, 'u', { meta: true })).toBe(false)
    expect(getMarkdownForSave(none.crepe)).toBe('hello world\n')
  })

  it('the window listeners read the setting at each keydown: Find opens on its new key only', async () => {
    const { root, view } = await mount('apple\n')
    const channel = createFindChannel()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const bar = createRoot(el)
    roots.push(bar)
    act(() => bar.render(<FindBar channel={channel} scope="note" hostRef={{ current: root }} />))
    const settings = vi.spyOn(storage, 'getSettings').mockReturnValue({ ...storage.getSettings(), hotkeys: { 'note.find': 'CmdOrCtrl+Alt+F' } })
    const keydown = (alt: boolean) => act(() => void view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, altKey: alt, bubbles: true, cancelable: true })))
    keydown(false)
    expect(channel.getState().open).toBe(false)
    keydown(true)
    expect(channel.getState().open).toBe(true)
    // Read at the keydown, not when the bar mounted.
    act(() => channel.close())
    settings.mockReturnValue({ ...storage.getSettings(), hotkeys: {} })
    keydown(false)
    expect(channel.getState().open).toBe(true)
    el.remove()
  })
})
