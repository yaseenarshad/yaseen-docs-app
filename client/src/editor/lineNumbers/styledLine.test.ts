/**
 * Line numbers beside a styled line (YAZ-3204, S22; CONTRACTS rules 34 and 41): the line's comment is
 * a block of the FILE but not of the page, because `lineStyleRemark` joins it into the `hr`. The
 * checker's failing test, kept as written, and the cases of the fix.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { splitFrontmatter } from '@shared/frontmatter'
import { mount, unmountAll } from '../marks/markTestKit'
import { blockLines } from './blockLines'
import { fileLines } from './fileLines'
import { showLineNumbers } from './lineNumbers'

afterEach(unmountAll)

function show(crepe: Crepe, file: string): void {
  const { frontmatter, body } = splitFrontmatter(file)
  const { text, toFileLine } = fileLines(frontmatter, body)
  const { lines, ends, kinds } = blockLines(text)
  showLineNumbers(crepe, { lines: lines.map(toFileLine), ends: ends.map(toFileLine), kinds })
}
const words = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('[data-line]')].map((el) => `${el.dataset.line}:${el.className.includes('line-view') ? 'LINE' : (el.textContent?.trim().split(/\s+/)[0] ?? '')}`)

describe('line numbers with a styled line (S22)', () => {
  it('a styled line, as the app saves it: every block is numbered, on its own disk line', async () => {
    const file = 'First\n\n***\n\n<!-- line: darkness 50% -->\n\nSecond\n\nThird\n'
    const { crepe, root } = await mount(file)
    show(crepe, file)
    expect(words(root)).toEqual(['1:First', '3:LINE', '7:Second', '9:Third'])
  })
  it('a styled line in a bullet', async () => {
    const file = '- a\n- ***\n  <!-- line: thickness 6px -->\n- b\n\nAfter\n'
    const { crepe, root } = await mount(file)
    show(crepe, file)
    expect(words(root)).toEqual(['1:a', '2:LINE', '4:b', '6:After'])
  })

  it('the line’s number shows its range to the comment, as a block of two or more lines of the file does (D7)', async () => {
    const file = 'First\n\n***\n\n<!-- line: darkness 80%, thickness 12px, style dashed -->\n\nSecond\n'
    const { crepe, root } = await mount(file)
    show(crepe, file)
    const line = root.querySelector<HTMLElement>('.line-view')!
    expect([line.dataset.line, line.dataset.lineEnd]).toEqual(['3', '5'])
    const tight = '- ***\n  <!-- line: thickness 6px -->\n- b\n'
    const again = await mount(tight)
    show(again.crepe, tight)
    const inItem = again.root.querySelector<HTMLElement>('.line-view')!
    expect([inItem.dataset.line, inItem.dataset.lineEnd]).toEqual(['1', '2'])
  })

  it('two styled lines and a quote: every block keeps its own line', async () => {
    const file = '***\n<!-- line: darkness 80% -->\n\n***\n\n> ***\n> <!-- line: style dotted -->\n\nEnd\n'
    const { crepe, root } = await mount(file)
    show(crepe, file)
    expect(words(root)).toEqual(['1:LINE', '4:LINE', '6:LINE', '9:End'])
  })

  it('a comment on two lines in a quote: the editor joins it, so every block keeps its number', async () => {
    const file = '> q\n>\n> ***\n>\n> <!-- line: darkness 80%,\n> thickness 6px -->\n\nAfter\n'
    const { crepe, root } = await mount(file)
    show(crepe, file)
    expect(words(root)).toEqual(['1:q', '3:LINE', '8:After'])
  })
})

describe('line numbers with a table that has settings (YAZ-3758, rule 41a)', () => {
  it('the comment is part of the table: the table shows its range to the comment, and the next block keeps its own line', async () => {
    const file = 'First\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- table: stripes -->\n\nAfter\n'
    const { crepe, root } = await mount(file)
    show(crepe, file)
    const table = root.querySelector<HTMLElement>('.milkdown-table-block')!
    expect([table.dataset.line, table.dataset.lineEnd]).toEqual(['3', '7'])
    expect(words(root).at(-1)).toBe('9:After')
  })
})
