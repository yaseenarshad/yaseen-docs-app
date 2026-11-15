// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyTask, taskLines, tickOf } from '../comments/taskWrite'
import { pageTasks } from './pageMarked'
import { renderPage, splitBlocks, type PageLook } from './pageRender'

/**
 * YAZ-5547: a `- [ ]` line inside a `$$ … $$` math block stays math: no box, no task, and a tick of a task elsewhere
 * never writes inside the block. In each shape a block can open in: alone, under a paragraph, right under a list item
 * (no blank line), indented up to 3 spaces, in a quote, inside a list item, and in a long page drawn in pieces.
 * Made-up text.
 */
const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}

const SHAPES: Array<[string, string, number[]]> = [
  ['alone', '$$\n- [ ] Water the fern\n$$\n', []],
  ['under a paragraph', 'Sums\n$$\n- [ ] Water the fern\n$$\n- [ ] Water the fern\n', [4]],
  ['right under a list item', '- [ ] Buy pots\n$$\n- [ ] Water the fern\n$$\n', [0]],
  ['right under a nested list item', '- Garden\n  - [ ] Buy pots\n$$\n- [ ] Water the fern\n$$\n', [1]],
  ['indented 3 spaces', '   $$\n   - [ ] Water the fern\n   $$\n', []],
  ['with a blank line inside', '$$\nx = 1\n\n- [x] Water the fern\n\n$$\n', []],
  ['in a quote', '> $$\n> - [ ] Water the fern\n> $$\n', []],
  ['inside a list item', '- Garden\n  $$\n  - [ ] Water the fern\n  $$\n- [ ] Water the fern\n', [4]],
]

describe('a task line inside a math block stays math (YAZ-5547)', () => {
  it.each(SHAPES)('%s: only the tasks outside the block are tasks', (_, text, lines) => {
    expect(pageTasks(text).map((t) => t.line)).toEqual(lines)
  })

  it.each(SHAPES)('%s: the page draws no box inside the block; the block shows its source', async (_, text, lines) => {
    const el = document.createElement('div')
    await renderPage(text, look, el)
    expect([...el.querySelectorAll<HTMLElement>('.page-task[data-task-line]')].map((b) => Number(b.dataset.taskLine))).toEqual(lines)
    expect(el.querySelector('pre.page-math code')?.textContent).toContain('Water the fern')
  })

  it('a tick of the same task outside the block writes its own line, never the line inside the block', () => {
    const text = '# Plants\n\n$$\n- [ ] Water the fern\n$$\n\n- [ ] Water the fern\n'
    expect(taskLines(text)).toHaveLength(1)
    const tick = tickOf(text, '- [ ] Water the fern', 0, true)
    expect(tick.of).toBe(1)
    expect(applyTask(text, tick)).toEqual({ kind: 'ticked', content: '# Plants\n\n$$\n- [ ] Water the fern\n$$\n\n- [x] Water the fern\n' })
  })

  it('a long page drawn in pieces never starts a piece inside a math block', async () => {
    // The first piece is 1,500 characters: its first blank line past that is inside the math block.
    const sums = Array.from({ length: 120 }, (_, i) => `x_{${i}} = ${i} + y`).join('\n')
    const filler = Array.from({ length: 1_600 }, (_, i) => `Line ${i} of made-up notes about the garden.`).join('\n\n')
    const text = `$$\n${sums}\n\n- [ ] Water the fern\n\n$$\n\n${filler}\n\n- [ ] Buy pots\n`
    expect(splitBlocks(text, 1_500)[0]).toContain('- [ ] Water the fern\n\n$$')
    const el = document.createElement('div')
    await renderPage(text, look, el, async () => {})
    expect([...el.querySelectorAll('.page-task[data-task-line]')].map((b) => b.closest('li')?.textContent?.trim())).toEqual(['Buy pots'])
  })
})
