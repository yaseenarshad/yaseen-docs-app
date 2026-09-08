/**
 * Copy-out payload pins (YAZ-938). The app already writes BOTH clipboard formats on copy —
 * markdown to text/plain (clipboardTextSerializer) and rich HTML (ProseMirror clipboard
 * serialization). These tests pin the shapes YAZ-933 cares about (nested bullets, bold,
 * headings) so a Milkdown upgrade that degrades either format fails here instead of in a
 * user's paste into Linear/Claude/Docs. Sibling of clipboardOrderedList.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ view: EditorView; crepe: Crepe }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  // Crepe's trailing plugin appends an empty paragraph on the first doc change; get it out of the way.
  view.dispatch(view.state.tr)
  return { view, crepe }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** What the clipboard would carry for the current selection — same probe as clipboardOrderedList.test.ts. */
function payload(view: EditorView): { text: string; html: string } {
  const slice = view.state.selection.content()
  const { text, dom } = view.serializeForClipboard(slice)
  return { text, html: dom.innerHTML }
}

function selectAll(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
}

describe('copy-out carries markdown text/plain AND rich text/html (YAZ-938)', () => {
  it.each(['<br />', '<br/>', '<br>', '<br >'])('copies message spacing without %s while preserving the saved document (YAZ-1389)', async (spacer) => {
    const { view, crepe } = await mount(`Hi FIRST_NAME,\n\n${spacer}\n\nHello **friend**.\n`)
    selectAll(view)
    const doc = view.state.doc
    const selection = view.state.selection
    const saved = getMarkdownForSave(crepe)
    const { text, html } = payload(view)
    expect(text).toBe('Hi FIRST\\_NAME,\n\n\n\nHello **friend**.\n')
    const copied = document.createElement('div')
    copied.innerHTML = html
    const paragraphs = [...copied.querySelectorAll('p')]
    expect(paragraphs).toHaveLength(2)
    for (const paragraph of paragraphs) {
      expect(paragraph.style.marginTop).toBe('0px')
      expect(paragraph.style.marginBottom).toBe('0px')
    }
    expect(paragraphs[0].getAttribute('data-pm-slice')).toBe('0 0 []')
    expect([...copied.children].map(node => node.tagName)).toEqual(['P', 'BR', 'P'])
    expect(copied.children[1].getAttribute('data-mdapp-empty-paragraph')).toBe('true')
    expect(paragraphs[1].innerHTML).toBe('Hello <strong>friend</strong>.')
    expect(view.state.doc).toBe(doc)
    expect(view.state.selection).toBe(selection)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saved).toContain('<br />')
  })

  it('keeps each blank paragraph explicit without adding breaks to ordinary or inline-break paragraphs', async () => {
    const { view, crepe } = await mount('First.\n\n<br />\n\n<br />\n\nSecond.\\\nInline.\n')
    selectAll(view)
    const saved = getMarkdownForSave(crepe)
    const editorHtml = view.dom.innerHTML
    const copied = document.createElement('div')
    copied.innerHTML = payload(view).html
    const paragraphs = [...copied.querySelectorAll('p')]
    expect([...copied.children].map(node => node.tagName)).toEqual(['P', 'BR', 'BR', 'P'])
    expect(copied.querySelectorAll('br[data-mdapp-empty-paragraph]')).toHaveLength(2)
    expect(paragraphs.map(p => p.querySelectorAll('br').length)).toEqual([0, 1])
    expect(paragraphs[1].textContent).toBe('Second.Inline.')
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(view.dom.innerHTML).toBe(editorHtml)
  })

  it('retains links and code inside zero-margin clipboard paragraphs', async () => {
    const { view } = await mount('[Link](https://example.com) and `literal <br />`\n\n* **List item**\n')
    selectAll(view)
    const copied = document.createElement('div')
    copied.innerHTML = payload(view).html
    expect(copied.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(copied.querySelector('code')?.textContent).toBe('literal <br />')
    expect(copied.querySelector('li strong')?.textContent).toBe('List item')
    for (const paragraph of copied.querySelectorAll('p')) {
      if (paragraph.textContent) expect(paragraph.querySelector('br')).toBeNull()
      expect(paragraph.style.marginTop).toBe('0px')
      expect(paragraph.style.marginBottom).toBe('0px')
    }
  })

  it('removes repeated spacing tags without changing literal inline/fenced code or underline markup', async () => {
    const { view } = await mount('## Message\n\n<br />\n\n<br />\n\nUse `<br />` with <u>care</u>.\n\n```html\n<br />\n```\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toContain('## Message\n\n\n\n\n\nUse `<br />` with <u>care</u>.')
    expect(text).toContain('```html\n<br />\n```')
    expect(text.match(/<br \/>/g)).toHaveLength(2)
    expect(html).toContain('<u>care</u>')
    expect(html).toContain('&lt;br /&gt;')
  })

  it.each(['`<br />`\n', '```html\n<br />\n```\n'])('keeps a literal break tag selected inside code', async (markdown) => {
    const { view } = await mount(markdown)
    let from = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === '<br />') from = pos
    })
    expect(from).toBeGreaterThanOrEqual(0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 6)))
    expect(payload(view).text).toBe('<br />')
  })

  it('copies an empty paragraph as whitespace rather than falling back to the original spacer tag', async () => {
    const { view } = await mount('Before\n\n<br />\n\nAfter\n')
    let empty = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) empty = pos
    })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, empty)))
    const { text, html } = payload(view)
    expect(text).toMatch(/^\s+$/)
    expect(html).toContain('<br')
    expect(html).toContain('data-mdapp-empty-paragraph="true"')
  })

  it('keeps simultaneous editor instances independent', async () => {
    const [first, second] = await Promise.all([mount('First\n\n<br />\n\nEnd\n'), mount('Second\n\n<br />\n\nEnd\n')])
    selectAll(first.view)
    selectAll(second.view)
    expect(payload(first.view).text).toBe('First\n\n\n\nEnd\n')
    expect(payload(second.view).text).toBe('Second\n\n\n\nEnd\n')
  })

  it('nested bullets: markdown keeps the nesting, HTML has nested <ul>', async () => {
    const { view } = await mount('* parent\n  * child one\n  * child two\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toContain('* parent')
    expect(text).toContain('  * child one')
    expect(text).toContain('  * child two')
    expect(html.match(/<ul/g)!.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('<li')
  })

  it('bold and italic survive both formats', async () => {
    const { view } = await mount('some **bold** and *italic* words\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toContain('**bold**')
    expect(text).toContain('*italic*')
    expect(html).toContain('<strong')
    expect(html).toContain('<em')
  })

  it('headings survive both formats', async () => {
    const { view } = await mount('## Section title\n\nbody text\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toContain('## Section title')
    expect(html).toContain('<h2')
  })

  it('the Slack-shaped nested outline round-trips out as markdown with no literal • characters', async () => {
    const { view } = await mount('* top .\n  * middle .\n    * deep .\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).not.toContain('•')
    expect(text).toContain('    * deep .')
    // `data-label="•"` attributes are internal ProseMirror metadata; what matters is that the
    // VISIBLE content carries no literal bullets (the structure is real <ul> nesting).
    expect(html.replace(/<[^>]*>/g, '')).not.toContain('•')
  })
})
