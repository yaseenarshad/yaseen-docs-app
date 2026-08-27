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
import { AllSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  // Crepe's trailing plugin appends an empty paragraph on the first doc change; get it out of the way.
  view.dispatch(view.state.tr)
  return { view }
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
  const text = view.someProp('clipboardTextSerializer', (f) => f(slice, view)) ?? ''
  const { dom } = view.serializeForClipboard(slice)
  return { text, html: dom.innerHTML }
}

function selectAll(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
}

describe('copy-out carries markdown text/plain AND rich text/html (YAZ-938)', () => {
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
