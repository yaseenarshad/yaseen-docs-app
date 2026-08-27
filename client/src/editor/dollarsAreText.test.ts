/**
 * DOLLARS ARE TEXT (YAZ-977, pinned by YAZ-978): a business wiki writes `$500K–$1M/yr`, and the
 * editor must render it as written. With Crepe's Latex feature enabled, `$…$` is inline MATH —
 * the real Project-Brief.md line below renders as the formula `500K−`, dollars gone.
 *
 * Two pins, different lifetimes:
 *  - the RENDER pin is `it.fails` while the Latex feature stands — YAZ-979 (the feature moves to
 *    `DISABLED_FEATURES`) must flip it to `it` in the same diff;
 *  - the ROUND-TRIP pin passes TODAY and forever: the misrender was display-only — the math node
 *    serialises back to the very bytes it swallowed, so no file was ever rewritten (the YAZ-964
 *    contrast, proven rather than assumed).
 *
 * Real Crepe in jsdom, the note editor's own feature map — the harness idiom of
 * `outline/bulletsOnly.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { features } from './featureConfig'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, features })
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

/** Every node and mark name in the document — the math feature would contribute `math_inline`. */
const nodeNames = (crepe: Crepe): string[] =>
  crepe.editor.action((ctx) => {
    const names = new Set<string>()
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      names.add(node.type.name)
      for (const mark of node.marks) names.add(mark.type.name)
      return true
    })
    return [...names]
  })

const textOf = (crepe: Crepe): string =>
  crepe.editor.action((ctx) => {
    const { doc } = ctx.get(editorViewCtx).state
    return doc.textBetween(0, doc.content.size, '\n')
  })

/** Project-Brief.md line 16, verbatim — the line in the YAZ-977 screenshot. */
const FLOOR_LINE = 'Floor: owners doing at least $500K–$1M/yr. Ideal: $2M–$10M+/yr, and even beyond.'

describe('dollars are text (YAZ-977)', () => {
  it('renders the real Project-Brief line as written — no math node, dollars intact', async () => {
    const crepe = await mount(FLOOR_LINE)
    expect(nodeNames(crepe).filter((name) => name.includes('math'))).toEqual([])
    expect(textOf(crepe)).toBe(FLOOR_LINE)
  })

  it('round-trips the line byte-for-byte — the misrender never rewrote a file', async () => {
    const crepe = await mount(FLOOR_LINE)
    expect(getMarkdownForSave(crepe)).toBe(`${FLOOR_LINE}\n`)
  })
})
