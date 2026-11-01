/**
 * A single line break inside a paragraph shows as a line break (YAZ-3727 6C), as Obsidian shows it. Milkdown keeps it
 * as a `hardbreak` with `isInline: true`, drawn as `<span data-type="hardbreak" data-is-inline="true"> </span>`: a
 * space on screen, `\n` on disk. `softBreaks.css` draws that span as a new line; the file is untouched. CSS is not
 * computed here (vitest ignores stylesheets), so the proof is the rule, read from the stylesheet, with its selector
 * matched against the live DOM; the layout itself was measured in Chromium (two lines, the second at the left edge).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from './createCrepe'

const css = readFileSync(resolve(__dirname, 'softBreaks.css'), 'utf8')
const span = css.match(/^(\.editor-instance [^{,]*\[data-is-inline='true'\])\s*\{([^}]*)\}/m)
const after = css.match(/^(\.editor-instance [^{,]*\[data-is-inline='true'\]::after)\s*\{([^}]*)\}/m)

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
async function mount(markdown: string): Promise<Crepe> {
  // As in the app (`Editor.tsx`): Crepe's root, which it marks `.milkdown`, sits inside `.editor-instance`.
  const root = document.createElement('div')
  root.className = 'editor-instance'
  document.body.appendChild(root)
  const host = document.createElement('div')
  root.appendChild(host)
  const crepe = createCrepe({ root: host, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return crepe
}
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('a single line break shows as a line break (YAZ-3727 6C)', () => {
  it('the stylesheet hides the space and puts a new line after it', () => {
    expect(span?.[2]).toMatch(/font-size:\s*0/)
    expect(after?.[2]).toMatch(/content:\s*'\\A'/)
    expect(after?.[2]).toMatch(/white-space:\s*pre/)
  })

  it('the rule matches the soft break only, not a hard break, and the file keeps its bytes', async () => {
    const crepe = await mount('3- how are you?\n4- im good\n\nhard\\\nbreak\n')
    const dom = crepe.editor.ctx.get(editorViewCtx).dom
    // From the document: jsdom's element-scoped query ignores the ancestors the selector names.
    const soft = [...document.querySelectorAll(span![1])]
    expect(soft).toHaveLength(1)
    expect(dom.contains(soft[0]!)).toBe(true)
    expect(soft[0]!.textContent).toBe(' ')
    expect(dom.querySelector('br[data-type="hardbreak"]')!.matches(span![1])).toBe(false)
    expect(getMarkdownForSave(crepe)).toBe('3- how are you?\n4- im good\n\nhard\\\nbreak\n')
  })

  it('both editors load the stylesheet: the note editor and the folder outline', () => {
    for (const file of ['Editor.tsx', '../views/view/OutlineEditor.tsx']) {
      expect(readFileSync(resolve(__dirname, file), 'utf8')).toMatch(/import '[./]*(editor\/)?softBreaks\.css'/)
    }
  })
})
