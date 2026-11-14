/**
 * YAZ-4103 3F: copy and paste keep the letter styles between a page and a drawing's text box, checked against a real
 * page: the page's copy HTML read by the engine's paste (`parseStyledHtml`), and the engine's copy HTML (`getStyledHtml`)
 * pasted into a page and saved. The text editor's own paste and copy events are the engine's
 * `wysiwyg/textWysiwyg.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { AllSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../editor/createCrepe'

const engine = () => import('@excalidraw/excalidraw')

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) {
    await crepe.destroy()
    root.remove()
  }
})

async function page(markdown: string): Promise<{ view: EditorView; crepe: Crepe }> {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr)
  return { view, crepe }
}

const STYLED = '**b** *i* <u>u</u> ~~s~~ ==h== <mark class="highlight-green">g</mark> [[YAS-1]]'

describe('YAZ-4103 3F: styles between a page and a drawing', () => {
  it('page → drawing: each style of a page copy becomes a run, and the [[link]] stays as written', async () => {
    const { view } = await page(STYLED)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    const html = view.serializeForClipboard(view.state.selection.content()).dom.innerHTML
    const { parseStyledHtml } = await engine()
    expect(parseStyledHtml(html)).toEqual({
      text: 'b i u s h g [[YAS-1]]',
      textRuns: [
        { start: 0, end: 1, bold: true },
        { start: 2, end: 3, italic: true },
        { start: 4, end: 5, underline: true },
        { start: 6, end: 7, strikethrough: true },
        { start: 8, end: 9, highlight: 'yellow' },
        { start: 10, end: 11, highlight: 'green' },
      ],
    })
  })

  it('drawing → page: the page saves the Markdown marks; the text color has no mark and is dropped', async () => {
    const { getStyledHtml } = await engine()
    const html = getStyledHtml(
      'b i u s h g c [[YAS-1]]',
      [
        { start: 0, end: 1, bold: true },
        { start: 2, end: 3, italic: true },
        { start: 4, end: 5, underline: true },
        { start: 6, end: 7, strikethrough: true },
        { start: 8, end: 9, highlight: 'yellow' },
        { start: 10, end: 11, highlight: 'green' },
        { start: 12, end: 13, color: '#e03131' },
      ],
      0,
      23,
    )!
    const { view, crepe } = await page('')
    view.pasteHTML(html, { clipboardData: { getData: (type: string) => (type === 'text/html' ? html : '') }, preventDefault() {} } as unknown as ClipboardEvent)
    expect(getMarkdownForSave(crepe).trim()).toBe('**b** *i* <u>u</u> ~~s~~ ==h== <mark class="highlight-green">g</mark> c [[YAS-1]]')
  })
})
