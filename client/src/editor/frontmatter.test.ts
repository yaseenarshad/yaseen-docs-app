import { describe, it, expect } from 'vitest'
import { parseFrontmatter, renameFrontmatterKey, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter, withCommentsHint } from '@shared/frontmatter'

describe('frontmatter split/join', () => {
  it('returns body unchanged when no frontmatter', () => {
    const md = '# Hi\n\n---\n\nnot frontmatter\n'
    const r = splitFrontmatter(md)
    expect(r.frontmatter).toBe('')
    expect(r.body).toBe(md)
  })

  it('splits a YAML block and re-joins byte-identically', () => {
    const fm = '---\ntitle: X\ntags: [a, b]\n---\n'
    const body = '# Hi\n\ntext\n'
    const r = splitFrontmatter(fm + body)
    expect(r.frontmatter).toBe(fm)
    expect(r.body).toBe(body)
    expect(r.frontmatter + r.body).toBe(fm + body)
  })

  it('handles CRLF and `...` terminator', () => {
    const fm = '---\r\na: 1\r\n...\r\n'
    const r = splitFrontmatter(fm + 'body')
    expect(r.frontmatter).toBe(fm)
    expect(r.body).toBe('body')
  })

  it('does not treat an unterminated block as frontmatter', () => {
    const md = '---\na: 1\nno end'
    expect(splitFrontmatter(md).frontmatter).toBe('')
  })

  it('recognises an empty block (GRO-2216)', () => {
    const r = splitFrontmatter('---\n---\nbody')
    expect(r.frontmatter).toBe('---\n---\n')
    expect(r.body).toBe('body')
  })

  it('recognises an empty CRLF block (GRO-2216)', () => {
    const r = splitFrontmatter('---\r\n---\r\nbody')
    expect(r.frontmatter).toBe('---\r\n---\r\n')
    expect(r.body).toBe('body')
  })

  it('recognises an empty block with no body (GRO-2216)', () => {
    const r = splitFrontmatter('---\n---\n')
    expect(r.frontmatter).toBe('---\n---\n')
    expect(r.body).toBe('')
  })

  // YAZ-5512 S1: the empty block was tried AFTER the lazy "some lines" form, so a later `---` line (a thematic break,
  // a card back) closed the block instead, and every card above that line vanished.
  it('an empty properties block ends at its own second fence (YAZ-5512 S1)', () => {
    for (const [md, block] of [
      ['---\n---\nBody\n\n---\n\nMore\n', '---\n---\n'],
      ['---\r\n---\r\n# A\r\n\r\n---\r\n', '---\r\n---\r\n'],
      ['---\n...\nBody\n---\n', '---\n...\n'],
      ['---\n--- \n```card\nQ\n---\nA\n```\n<!-- card: NC-1 -->\n', '---\n--- \n'],
    ]) {
      const r = splitFrontmatter(md)
      expect(r.frontmatter, JSON.stringify(md)).toBe(block)
      expect(r.frontmatter + r.body).toBe(md)
    }
    // A block with keys still ends at its FIRST closing fence.
    expect(splitFrontmatter('---\na: 1\n---\nBody\n---\n').frontmatter).toBe('---\na: 1\n---\n')
  })
})

describe('renameFrontmatterKey (YAZ-4551)', () => {
  const PAGE = '---\n# filed\nstatus: draft\n# the due day\ndue: 2026-12-01\ntags:\n  - a\nin:\n  f1:\n    Status: Ready\n---\nBody\n'

  it('renames ONE key in place: its value, its comment and its place stay, every other byte too', () => {
    expect(renameFrontmatterKey(PAGE, [], 'due', 'Due Date')).toBe(PAGE.replace('due: 2026-12-01', 'Due Date: 2026-12-01'))
    expect(renameFrontmatterKey(PAGE, [], 'tags', 'Tags')).toBe(PAGE.replace('tags:\n', 'Tags:\n'))
  })

  it('renames a key inside a map — a folder block of `in`', () => {
    expect(renameFrontmatterKey(PAGE, ['in', 'f1'], 'Status', 'Stage')).toBe(PAGE.replace('    Status: Ready', '    Stage: Ready'))
  })

  it('refuses a missing key and a name the map holds already', () => {
    expect(() => renameFrontmatterKey(PAGE, [], 'gone', 'x')).toThrow('"gone" is not a property')
    expect(() => renameFrontmatterKey(PAGE, [], 'due', 'status')).toThrow('"status" is already a property')
  })

  it('keeps the frame as a property write does (YAZ-4544, one helper): CRLF line ends, the `...` fence; bad YAML is refused', () => {
    const crlf = '---\r\nstatus: draft\r\ndue: 2026-12-01\r\n...\r\nBody\r\n'
    expect(renameFrontmatterKey(crlf, [], 'due', 'Due')).toBe(crlf.replace('due:', 'Due:'))
    expect(() => renameFrontmatterKey('---\na: [\n---\n', [], 'a', 'b')).toThrow('frontmatter is not valid YAML')
    expect(() => renameFrontmatterKey('no block\n', [], 'a', 'b')).toThrow('"a" is not a property')
  })
})

// YAZ-5512 C1: a page that starts with a byte order mark (a file saved by some Windows editors). Both the Mac and the
// phone keep the BOM in the text; the reader did not see the block behind it, so a comment made a SECOND block before
// the BOM and the page's own properties were read as body text.
describe('a page that starts with a BOM (YAZ-5512 C1)', () => {
  const BOM = '\uFEFF'
  const page = `${BOM}---\ntitle: Plan\n---\n# Plan\n`

  it('its block is read: the BOM rides on the block, the body is the same as without one', () => {
    const r = splitFrontmatter(page)
    expect(r.frontmatter).toBe(`${BOM}---\ntitle: Plan\n---\n`)
    expect(r.body).toBe('# Plan\n')
    expect(parseFrontmatter(r.frontmatter).properties).toEqual({ title: 'Plan' })
    // No block: the BOM stays in the body, as before.
    expect(splitFrontmatter(`${BOM}# Plan\n`)).toEqual({ frontmatter: '', body: `${BOM}# Plan\n` })
  })

  it('a property write goes into the one block, and the BOM stays first', () => {
    expect(setFrontmatterProperty(page, 'status', 'done')).toBe(`${BOM}---\ntitle: Plan\nstatus: done\n---\n# Plan\n`)
    expect(setFrontmatterProperty(page, 'title', undefined)).toBe(`${BOM}---\n---\n# Plan\n`)
    expect(renameFrontmatterKey(page, [], 'title', 'name')).toBe(`${BOM}---\nname: Plan\n---\n# Plan\n`)
    expect(replaceFrontmatter(page, 'a: 1')).toBe(`${BOM}---\na: 1\n---\n# Plan\n`)
    expect(replaceFrontmatter(page, '')).toBe(`${BOM}# Plan\n`)
    expect(withCommentsHint(page).startsWith(`${BOM}---\n# comments:`)).toBe(true)
  })

  it('a page with a BOM and no block grows its block AFTER the BOM', () => {
    expect(setFrontmatterProperty(`${BOM}# Plan\n`, 'status', 'done')).toBe(`${BOM}---\nstatus: done\n---\n# Plan\n`)
    expect(replaceFrontmatter(`${BOM}# Plan\n`, 'a: 1')).toBe(`${BOM}---\na: 1\n---\n# Plan\n`)
    expect(withCommentsHint(`${BOM}# Plan\n`).startsWith(`${BOM}---\n`)).toBe(true)
  })
})
