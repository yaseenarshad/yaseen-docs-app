import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CrepeFeature, type Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { ClipboardPasteRequest } from '@shared/types'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { isBulletsOnly, lockToBullets, outlineFeatures } from './outline/bulletsOnly'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
const listeners = new Set<(request: ClipboardPasteRequest) => boolean>()
let originalApi: typeof window.yaseenDocs
beforeEach(() => {
  originalApi = window.yaseenDocs
  window.yaseenDocs = { ...originalApi, menu: { ...originalApi?.menu, onPasteAs: (listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } } }
})
afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) { await crepe.destroy(); root.remove() }
  window.yaseenDocs = originalApi
  listeners.clear()
})
async function mount(markdown = '', outline = false, nativeCode = false) {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...(outline ? { features: outlineFeatures } : nativeCode ? { features: { [CrepeFeature.CodeMirror]: false } } : {}) })
  if (outline) lockToBullets(crepe)
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr)
  view.focus()
  return { crepe, view }
}
function pasteAs(mode: ClipboardPasteRequest['mode'], text: string) {
  return [...listeners].some(listener => listener({ mode, text }))
}
function pasteHtml(view: EditorView, html: string, text = 'First.\n\nSecond.') {
  return view.pasteHTML(html, { clipboardData: { getData: (t: string) => t === 'text/html' ? html : t === 'text/plain' ? text : '' }, preventDefault() {} } as unknown as ClipboardEvent)
}
const all = (view: EditorView) => view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
const textOf = (view: EditorView) => view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n')

describe('explicit paste modes through the native menu subscription', () => {
  it('inserts plain text literally, preserving spaces, CRLF and blank lines without Markdown interpretation', async () => {
    const { view } = await mount()
    const text = '# Heading\r\n\r\n**bold**  [link](https://example.com)\n- item\n'
    expect(pasteAs('plain', text)).toBe(true)
    expect(textOf(view)).toBe(text.replace(/\r\n/g, '\n'))
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    view.state.doc.descendants(node => { expect(node.marks).toEqual([]); expect(['paragraph', 'text', 'hardbreak']).toContain(node.type.name) })
  })
  it('parses explicit Markdown using existing schema including marks, links and lists', async () => {
    const { crepe, view } = await mount()
    expect(pasteAs('markdown', '# Heading\n\n**bold** [link](https://example.com)\n\n- first\n- second')).toBe(true)
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(getMarkdownForSave(crepe)).toContain('**bold**')
    expect(getMarkdownForSave(crepe)).toContain('[link](https://example.com)')
    expect(view.state.doc.content.toJSON().some((n: {type:string}) => n.type === 'bullet_list')).toBe(true)
  })
  it('replaces only the active selection and undoes the entire paste once', async () => {
    const { view } = await mount('Before middle after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 14)))
    const before = view.state.doc.toJSON()
    pasteAs('plain', 'new\ntext')
    expect(textOf(view)).toBe('Before new\ntext after')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.toJSON()).toEqual(before)
  })
  it('routes only to the focused editor and unsubscribes on destroy', async () => {
    const first = await mount('First')
    const second = await mount('Second')
    all(first.view); first.view.focus()
    pasteAs('plain', 'Replacement')
    expect(textOf(first.view)).toBe('Replacement')
    expect(textOf(second.view)).toBe('Second')
    const input = document.createElement('input'); document.body.append(input); input.focus()
    expect(pasteAs('markdown', '# Native input fallback')).toBe(false)
    input.remove()
    for (const { crepe, root } of mounted.splice(0)) { await crepe.destroy(); root.remove() }
    expect(listeners.size).toBe(0)
  })
  it('keeps Markdown pasted into a sentence inline and one undo step', async () => {
    const { view } = await mount('Before middle after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 14)))
    pasteAs('markdown', '**bold**')
    expect(view.state.doc.childCount).toBe(1)
    expect(textOf(view)).toBe('Before bold after')
    expect(view.state.doc.firstChild?.child(1).marks[0]?.type.name).toBe('strong')
    undo(view.state, view.dispatch)
    expect(textOf(view)).toBe('Before middle after')
  })
  it('keeps every mode literal inside code, including fake bullets on ordinary paste', async () => {
    const { view } = await mount('```text\nold\n```', false, true)
    for (const mode of ['plain', 'markdown'] as const) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + view.state.doc.firstChild!.content.size)))
      view.focus()
      expect(pasteAs(mode, '# heading\r\n**literal**')).toBe(true)
      expect(view.state.doc.firstChild?.type.name).toBe('code_block')
      expect(view.state.doc.firstChild?.textContent).toBe('# heading\n**literal**')
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + view.state.doc.firstChild!.content.size)))
    pasteHtml(view, '<ul><li>one</li><li>two</li></ul>', '• one\n• two')
    expect(view.state.doc.firstChild?.textContent).toBe('• one\n• two')
  })
  it('lets CodeMirror own native insertion at its internal caret', async () => {
    const { view } = await mount('```text\ncode\n```')
    const code = view.dom.querySelector<HTMLElement>('.cm-content')!
    expect(code).not.toBeNull()
    code.focus()
    expect(pasteAs('markdown', '# literal')).toBe(false)
    expect(view.state.doc.firstChild?.textContent).toBe('code')
  })
  it('does not change a read-only editor', async () => {
    const { view } = await mount('Read only')
    all(view)
    view.setProps({ editable: () => false })
    pasteAs('plain', 'replacement')
    pasteHtml(view, '<p>replacement</p>')
    expect(textOf(view)).toBe('Read only')
  })
  it('treats empty clipboard text as a no-op and never deletes the selection', async () => {
    const { view } = await mount('Keep this')
    all(view)
    pasteAs('plain', ''); pasteAs('markdown', '')
    expect(textOf(view)).toBe('Keep this')
  })
  it('runs existing outline paste constraints for explicit Markdown and literal plain text', async () => {
    const { view } = await mount('- existing', true)
    pasteAs('markdown', '# Heading\n\nParagraph')
    expect(isBulletsOnly(view.state.doc)).toBe(true)
    expect(textOf(view)).toContain('Heading')
    pasteAs('plain', '# literal\n\nnext')
    expect(isBulletsOnly(view.state.doc)).toBe(true)
    expect(textOf(view)).toContain('# literal\n\nnext')
  })
})

describe('automatic rich paste spacing', () => {
  it('represents a standalone paragraph separator as one empty paragraph, preserving rich marks', async () => {
    const { view, crepe } = await mount()
    pasteHtml(view, '<b id="docs-internal-guid-test" style="font-weight:normal"><p><strong>First.</strong></p><br><p>Second.</p></b>')
    expect(view.state.doc.childCount).toBe(3)
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).childCount).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe('**First.**\n\n<br />\n\nSecond.\n')
  })
  it('preserves multiple intentional standalone separators', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p>First.</p>\n<br>\n<br>\n<p>Second.</p>')
    expect(view.state.doc.childCount).toBe(4)
    expect(view.state.doc.child(1).content.size).toBe(0)
    expect(view.state.doc.child(2).content.size).toBe(0)
  })
  it('keeps ordinary paragraphs, inline breaks and explicit empty paragraphs', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p>First.<br>inline</p><p></p><p>Second.</p>')
    expect(view.state.doc.child(0).child(1).type.name).toBe('hardbreak')
    expect(view.state.doc.child(1).content.size).toBe(0)
  })
  it('does not change internal clipboard structure, nested lists or code', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p data-pm-slice="0 0 []">First.</p><br><p>Second.</p>')
    expect(view.state.doc.child(1).firstChild?.type.name).toBe('hardbreak')
    all(view)
    pasteHtml(view, '<ul><li><p>Item<br>continuation</p></li></ul><pre><code>one\n\ntwo</code></pre>')
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(textOf(view)).toContain('Item\ncontinuation')
    expect(textOf(view)).toContain('one\n\ntwo')
  })
  it('does not multiply blank paragraphs across repeated rich copy/paste round trips', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p>First.</p><br><p>Second.</p>')
    const expected = view.state.doc.toJSON()
    for (let i = 0; i < 3; i++) {
      all(view)
      const { dom, text } = view.serializeForClipboard(view.state.selection.content())
      pasteHtml(view, dom.innerHTML, text)
      expect(view.state.doc.toJSON()).toEqual(expected)
    }
  })
})
