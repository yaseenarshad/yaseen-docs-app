/**
 * Numbers take the bullets' marker colour (YAZ-3727 D7): the rule in `bullets.css` paints `.label.ordered` with
 * `--list-marker-color`. CSS is not computed here (vitest ignores stylesheets), so the proof is the rule itself, read from
 * the stylesheet, with its selector matched against the live DOM of a numbered list. Threading sets the same variable on
 * the label wrapper (`bulletThreading.css`), the number's parent, so its accent reaches numbers through inheritance.
 * The variable is a share of `currentColor`, read where it is used: for a number that is its wrapper's colour, which
 * Crepe paints grey, so a second rule gives that wrapper the text colour (the demo found the numbers still grey).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe } from '../createCrepe'

const css = readFileSync(resolve(__dirname, 'bullets.css'), 'utf8')
const rule = css.match(/^(\.editor-instance[^{]*\.label-wrapper > \.label\.ordered)\s*\{([^}]*)\}/m)
if (!rule) throw new Error('bullets.css has no ordered-label rule')
const [, NUMBER_SELECTOR] = rule
const base = css.match(/^(\.editor-instance[^{]*\.label-wrapper:has\(> \.label\.ordered\))\s*\{([^}]*)\}/m)
if (!base) throw new Error('bullets.css has no rule for the wrapper that holds a number')
const [, WRAPPER_SELECTOR, WRAPPER_BODY] = base

const threading = readFileSync(resolve(__dirname, 'bulletThreading.css'), 'utf8')
const accent = threading.match(/^([^{}]*> \.label-wrapper)\s*\{([^}]*--list-marker-color[^}]*)\}/m)
if (!accent) throw new Error('bulletThreading.css has no label-wrapper accent rule')
const [, ACCENT_SELECTOR] = accent

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, host: HTMLElement = document.body): Promise<Crepe> {
  const root = document.createElement('div')
  root.className = 'editor-instance'
  host.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  // The list node views render their labels on Vue's next tick.
  await new Promise(requestAnimationFrame)
  mounted.push({ crepe, root })
  return crepe
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('numbers take the bullets\' marker colour (YAZ-3727 D7)', () => {
  it('its selector matches every number, nested ones too, and no bullet', async () => {
    await mount('1. Plan\n2. Build\n   * child\n     1. deep\n')
    const numbers = [...document.querySelectorAll(NUMBER_SELECTOR)].map((el) => el.textContent?.trim())
    expect(numbers).toEqual(['1.', '2.', '1.'])
  })

  it('the wrapper of each number takes the text colour, so the share of currentColor is not a share of grey', async () => {
    await mount('1. Plan\n2. Build\n   * child\n     1. deep\n\n* bullet\n')
    expect(WRAPPER_BODY).toMatch(/color:\s*var\(--crepe-color-on-background\)/)
    const numbers = [...document.querySelectorAll(NUMBER_SELECTOR)]
    expect(numbers.length).toBe(3)
    expect(numbers.every((label) => label.parentElement?.matches(WRAPPER_SELECTOR))).toBe(true)
    expect(document.querySelectorAll(WRAPPER_SELECTOR)).toHaveLength(3)
  })

  it('threading sets the variable on the label wrapper that holds the number', async () => {
    const app = document.createElement('div')
    app.className = 'app'
    app.dataset.threading = 'on'
    document.body.appendChild(app)
    const crepe = await mount('1. Plan\n   1. deep\n', app)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let at = -1
      view.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'deep') at = pos + 2 })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    })
    const lit = [...document.querySelectorAll(NUMBER_SELECTOR)].filter((label) => label.parentElement?.matches(ACCENT_SELECTOR))
    expect(lit.length).toBeGreaterThan(0)
    app.remove()
  })
})
