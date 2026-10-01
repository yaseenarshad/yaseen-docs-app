import { afterEach, describe, expect, it } from 'vitest'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import appCss from '../app.css?inline'
import codeThemeSource from './codeTheme.ts?raw'
import { createCrepe } from './createCrepe'

const LONG = 'The limiting step sets the shape of the whole flow, so you plan backward from delivery. '.repeat(6).trim()

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const current = mounted.pop()!
    await current.crepe.destroy()
    current.root.remove()
  }
})

async function mountCode(markdown: string): Promise<{ crepe: Crepe; code: CodeMirrorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.focus() // a code block mounts its CodeMirror editor lazily
  return { crepe, code: CodeMirrorView.findFromDOM(view.dom.querySelector<HTMLElement>('.cm-content')!)! }
}

/** The `--code-*` names a CSS block declares. */
const declared = (block: string): string[] => [...block.matchAll(/(--code-[a-z-]+):/g)].map((m) => m[1]).sort()

describe('code blocks (YAZ-2270)', () => {
  it('wrap long lines instead of scrolling sideways, without touching the markdown', async () => {
    const markdown = `\`\`\`markdown\n${LONG}\n\`\`\`\n`
    const { crepe, code } = await mountCode(markdown)
    expect(code.contentDOM.classList).toContain('cm-lineWrapping')
    expect(crepe.getMarkdown()).toBe(markdown)
  })

  it('take their colours from the app, not from One Dark', async () => {
    const { code } = await mountCode('```ts\nconst a = 1\n```\n')
    expect(code.state.facet(CodeMirrorView.darkTheme)).toBe(false)
  })

  it('every code colour is defined for light and for dark, and none is left unused', () => {
    const used = [...new Set([...codeThemeSource.matchAll(/var\((--code-[a-z-]+)\)/g)].map((m) => m[1]))].sort()
    const light = appCss.match(/:root\s*\{([^}]*)\}/s)![1]
    const dark = appCss.match(/\[data-theme='dark'\]\s*\{([^}]*)\}/s)![1]
    expect(used.length).toBeGreaterThan(0)
    expect(declared(light)).toEqual(used)
    expect(declared(dark)).toEqual(used)
  })
})
