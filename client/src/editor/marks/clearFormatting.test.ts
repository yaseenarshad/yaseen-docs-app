/**
 * ⌘\ "Clear formatting" in a note (YAZ-4420, D28): real editors (`createCrepe`), the key through ProseMirror's own
 * `handleKeyDown` chain, and the bytes the note would save. The letter styles go (bold, italic, underline, strike,
 * inline code, highlight; a text box's color), a heading becomes a paragraph (one in a bullet stays in its bullet),
 * and the structure stays: bullets, numbered lists, check items, quotes, links and `[[` pills. One undo step; Read
 * only blocks it; the key is the row `note.clearFormatting`, so Settings › Hotkeys can move it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import { NOTE_KEYS } from '@shared/keys/note'
import { ALL_KEYS } from '@shared/keys'
import { sameKey } from '@shared/hotkeyBindings'
import { caretIn, marksOn, md, mount, pressKey, selectAcross, unmountAll } from './markTestKit'
import type { Crepe } from '@milkdown/crepe'

afterEach(unmountAll)

/** ⌘\ as the keyboard sends it. */
const clear = (crepe: Crepe) => pressKey(crepe, '\\', { mod: true })

/** One key press through ProseMirror's `handleKeyDown`, for a chord `pressKey` cannot spell (⌥). */
const press = (crepe: Crepe, event: KeyboardEvent): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })

/** Select the whole document's text: from the first letter to the last, whatever block they are in. */
function selectAll(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { doc } = view.state
    view.dispatch(view.state.tr.setSelection(TextSelection.between(Selection.atStart(doc).$from, Selection.atEnd(doc).$to)))
  })
}

/** Types letters as the keyboard leaves them: at the selection, with the stored marks (ProseMirror's own insertText). */
const typeLetters = (crepe: Crepe, text: string): void =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(text))
  })

const blocks = (crepe: Crepe): string[] =>
  crepe.editor.action((ctx) => {
    const names: string[] = []
    ctx.get(editorViewCtx).state.doc.descendants((node) => void names.push(node.type.name))
    return names.filter((name) => name !== 'text')
  })

describe('⌘\\ clears the letter styles (YAZ-4420)', () => {
  it('bold, italic, underline, strike, inline code and highlight go; the words stay', async () => {
    const { crepe } = await mount('**bold** *italic* <u>under</u> ~~strike~~ `code` ==high== plain\n')
    selectAll(crepe)
    expect(clear(crepe)).toBe(true)
    expect(md(crepe)).toBe('bold italic under strike code high plain\n')
  })

  it('only the selected letters lose their styles', async () => {
    const { crepe } = await mount('**one two three**\n')
    selectAcross(crepe, 'two', 'two')
    clear(crepe)
    expect(md(crepe)).toBe('**one** two **three**\n')
  })

  it('a link and a [[ pill stay (they are content); the bold on the link text goes', async () => {
    const { crepe } = await mount('see [**the site**](https://example.com) and [[Some Page]] **now**\n')
    selectAll(crepe)
    clear(crepe)
    expect(md(crepe)).toBe('see [the site](https://example.com) and [[Some Page]] now\n')
  })
})

describe('⌘\\ and the blocks (YAZ-4420, D28)', () => {
  it('a heading in the selection becomes a plain paragraph, its words and their place kept', async () => {
    const { crepe } = await mount('# **Title**\n\n## Second\n\nbody\n')
    selectAll(crepe)
    clear(crepe)
    expect(md(crepe)).toBe('Title\n\nSecond\n\nbody\n')
    expect(blocks(crepe)).toEqual(['paragraph', 'paragraph', 'paragraph'])
  })

  it("with only a caret, the caret's heading becomes a paragraph and no other heading changes", async () => {
    const { crepe } = await mount('# One\n\n# Two\n')
    caretIn(crepe, 'Two')
    clear(crepe)
    expect(md(crepe)).toBe('# One\n\nTwo\n')
  })

  it('a heading inside a bullet becomes a paragraph and stays in its bullet', async () => {
    const { crepe } = await mount('* # **Head** in a bullet\n* next\n')
    expect(blocks(crepe)).toContain('heading')
    selectAll(crepe)
    clear(crepe)
    expect(blocks(crepe)).not.toContain('heading')
    expect(md(crepe)).toBe('* Head in a bullet\n* next\n')
  })

  it('bullets, numbered items, unticked check items and quotes stay, with their indent', async () => {
    const { crepe } = await mount('* **a**\n  * *nested*\n\n1. ~~b~~\n2. `c`\n\n* [ ] ==d==\n\n> **quoted**\n\nend\n')
    const before = blocks(crepe)
    selectAll(crepe)
    clear(crepe)
    expect(blocks(crepe)).toEqual(before)
    expect(md(crepe)).toBe('* a\n  * nested\n\n1. b\n2. c\n\n* [ ] d\n\n> quoted\n\nend\n')
  })

  // The closeout brief named a bug: "a ticked check item loses its checkbox". It does not happen at the base commit
  // (378722225): the doc keeps `checked`, the bytes keep `[x]`, the DOM keeps the checked label. This pins it.
  it('a ticked check item keeps its tick and its checkbox, alone or among other items, with a word or a caret', async () => {
    for (const [start, select, after] of [
      ['* [x] **done**\n', selectAll, '* [x] done\n'],
      ['* [x] **done**\n', (c: Crepe) => selectAcross(c, 'done', 'done'), '* [x] done\n'],
      ['* [x] done\n', (c: Crepe) => caretIn(c, 'done'), '* [x] done\n'],
      ['* [ ] **a**\n* [x] *b*\n\ntext\n', selectAll, '* [ ] a\n* [x] b\n\ntext\n'],
      ['* a\n  * [x] **nested done**\n', selectAll, '* a\n  * [x] nested done\n'],
    ] as const) {
      const { crepe, root } = await mount(start)
      select(crepe)
      clear(crepe)
      expect(md(crepe), start).toBe(after)
      expect(root.querySelectorAll('.milkdown-icon.label.checked'), start).toHaveLength(1)
    }
  })
})

describe('⌘\\ with only a caret (YAZ-4420)', () => {
  it('the next typed letters are plain; the styled letters around the caret keep their styles', async () => {
    const { crepe } = await mount('**bold**\n')
    caretIn(crepe, 'bold')
    clear(crepe)
    typeLetters(crepe, 'X')
    expect(marksOn(crepe, 'X')).toEqual([])
    expect(md(crepe)).toMatch(/\*\*b\*\*X\*\*old\*\*|\*\*bX?old\*\*/)
    expect(marksOn(crepe, 'old')).toEqual(['strong'])
  })

  it('a style turned on at the caret (⌘B) is cleared before a letter is typed', async () => {
    const { crepe } = await mount('plain\n')
    caretIn(crepe, 'plain')
    pressKey(crepe, 'b', { mod: true })
    clear(crepe)
    typeLetters(crepe, 'Y')
    expect(marksOn(crepe, 'Y')).toEqual([])
  })
})

describe('⌘\\ is one undo step (YAZ-4420)', () => {
  it('one ⌘Z gives back the styles and the heading together', async () => {
    const start = '# **Title**\n\n* *item* ==hi==\n'
    const { crepe } = await mount(start)
    selectAll(crepe)
    clear(crepe)
    expect(md(crepe)).toBe('Title\n\n* item hi\n')
    pressKey(crepe, 'z', { mod: true })
    expect(md(crepe)).toBe(start)
  })
})

describe('⌘\\ in a Read only note (YAZ-4420)', () => {
  it('changes nothing: the same press that clears an editable note does nothing once the note is read only', async () => {
    const start = '# **Title**\n'
    const editable = await mount(start, { readOnlyKeys: true })
    selectAll(editable.crepe)
    clear(editable.crepe)
    expect(md(editable.crepe)).toBe('Title\n')

    const locked = await mount(start, { readOnlyKeys: true })
    selectAll(locked.crepe)
    locked.crepe.setReadonly(true)
    // ProseMirror runs no keymap in a view that is not editable; the read-only keys answer view actions only.
    const press = new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(press)
    locked.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', metaKey: true, bubbles: true, cancelable: true }))
    expect(md(locked.crepe)).toBe(start)
  })
})

describe('the key row note.clearFormatting (YAZ-4420)', () => {
  it('is ⌘\\ by default, changeable, and the note scope binds ⌘\\ to nothing else', () => {
    const row = NOTE_KEYS.find((r) => r.id === 'note.clearFormatting')!
    expect(row).toMatchObject({ label: 'Clear formatting', keys: ['CmdOrCtrl+\\'] })
    expect(row.changeable).toBe(true)
    const others = NOTE_KEYS.filter((r) => r.id !== row.id && r.keys.some((k) => sameKey(k, 'CmdOrCtrl+\\')))
    expect(others).toEqual([])
    // the drawing's own ⌘\ (reset to the default style) is another scope's row: a text box keeps it (the engine
    // takes it in the capture phase during an edit, `hostTextWysiwyg.ts`); draw.io's is the diagram's
    expect(ALL_KEYS.filter((r) => r.keys.some((k) => sameKey(k, 'CmdOrCtrl+\\'))).map((r) => [r.id, r.scope]).sort()).toEqual([['diagram.removeFormat', 'diagram'], ['drawing.clearTextFormatting', 'drawing'], ['note.clearFormatting', 'note']])
  })

  it('a new key in Settings › Hotkeys clears; ⌘\\ then does nothing; No key binds nothing', async () => {
    const moved = await mount('**x**\n', { hotkeys: { 'note.clearFormatting': 'CmdOrCtrl+Alt+K' } })
    selectAll(moved.crepe)
    expect(clear(moved.crepe)).toBe(false)
    expect(md(moved.crepe)).toBe('**x**\n')
    expect(press(moved.crepe, new KeyboardEvent('keydown', { key: 'k', metaKey: true, altKey: true, bubbles: true, cancelable: true }))).toBe(true)
    expect(md(moved.crepe)).toBe('x\n')

    const none = await mount('**x**\n', { hotkeys: { 'note.clearFormatting': null } })
    selectAll(none.crepe)
    expect(clear(none.crepe)).toBe(false)
    expect(md(none.crepe)).toBe('**x**\n')
  })
})
