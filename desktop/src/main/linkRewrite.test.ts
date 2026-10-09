// The ONE rewrite of an ID to a new ID in a file's text (YAZ-2677 D5, D6, D7): a clash fix, a change
// of the vault's letters and the backfill of old IDs all go through `rewriteIds`.
import { describe, expect, it } from 'vitest'
import { rewriteIds } from '@shared/linkRewrite'

const ONE = new Map([['YAZ-1', 'YAZ-9']])

describe('rewriteIds: an ID becomes its new ID wherever a file names it', () => {
  it('a link, a link with a label, a link to a heading, both, and an embed', () => {
    const before = 'a [[YAZ-1]] b [[YAZ-1|the plan]] c [[YAZ-1#Goals]] d [[YAZ-1#Goals|the goals]] e ![[YAZ-1]]\n'
    expect(rewriteIds(before, ONE)).toEqual({
      content: 'a [[YAZ-9]] b [[YAZ-9|the plan]] c [[YAZ-9#Goals]] d [[YAZ-9#Goals|the goals]] e ![[YAZ-9]]\n',
      changed: 5,
    })
  })

  it('an ID is matched whole: `YAZ-1` is not in `YAZ-12`, `YAZ-10` or `XYAZ-1`, and never in plain text', () => {
    const before = '[[YAZ-12]] [[YAZ-10]] [[XYAZ-1]] [[YAZ-1 plan]] YAZ-1 and yaz-1 as text\n'
    expect(rewriteIds(before, ONE)).toEqual({ content: before, changed: 0 })
  })

  it('an ID is read in any case and written as the app writes it (R2)', () => {
    expect(rewriteIds('[[yaz-1]] and [[Yaz-1|x]] and [[ YAZ-1 ]]\n', ONE).content).toBe('[[YAZ-9]] and [[YAZ-9|x]] and [[YAZ-9]]\n')
  })

  it('a code block and a code span are left as they are', () => {
    const before = 'see `[[YAZ-1]]`\n\n```\n[[YAZ-1]]\n```\n\n~~~md\n[[YAZ-1]]\n~~~\n\n[[YAZ-1]]\n'
    expect(rewriteIds(before, ONE)).toEqual({ content: before.replace(/\[\[YAZ-1\]\]\n$/, '[[YAZ-9]]\n'), changed: 1 })
  })

  it('a link in a property, in a list of a property, and in a folder’s values', () => {
    const before = '---\nparent: "[[YAZ-1]]"\nrelated:\n  - "[[YAZ-1|Plan]]"\n  - "[[YAZ-2]]"\nin:\n  YAZ-5:\n    Owner: "[[yaz-1]]"\n---\nbody\n'
    const { content, changed } = rewriteIds(before, ONE)
    expect(content).toBe('---\nparent: "[[YAZ-9]]"\nrelated:\n  - "[[YAZ-9|Plan]]"\n  - "[[YAZ-2]]"\nin:\n  YAZ-5:\n    Owner: "[[YAZ-9]]"\n---\nbody\n')
    expect(changed).toBe(3)
  })

  it('an `also_in` entry, in a list and alone, in any case', () => {
    expect(rewriteIds('---\nalso_in:\n  - YAZ-1\n  - YAZ-12\n  - yaz-1\n---\n', ONE)).toEqual({ content: '---\nalso_in:\n  - YAZ-9\n  - YAZ-12\n  - YAZ-9\n---\n', changed: 2 })
    expect(rewriteIds('---\nalso_in: YAZ-1\n---\n', ONE)).toEqual({ content: '---\nalso_in: YAZ-9\n---\n', changed: 1 })
    expect(rewriteIds('---\nalso_in: YAZ-12\n---\n', ONE).changed).toBe(0)
  })

  it('a folder-value key: the block of the folder moves to the new ID, and its values stay', () => {
    const before = '---\ntitle: T\nin:\n  YAZ-1:\n    Status: open\n  YAZ-12:\n    Status: done\n---\nbody\n'
    const { content, changed } = rewriteIds(before, ONE)
    expect(content).toBe('---\ntitle: T\nin:\n  YAZ-9:\n    Status: open\n  YAZ-12:\n    Status: done\n---\nbody\n')
    expect(changed).toBe(1)
  })

  it('a folder-value key is not moved over a block that the new ID already has', () => {
    const before = '---\nin:\n  YAZ-1:\n    Status: open\n  YAZ-9:\n    Status: done\n---\n'
    expect(rewriteIds(before, ONE)).toEqual({ content: before, changed: 0 })
  })

  it('the link places of a folder’s settings: a view’s order, an outline line, a column’s target', () => {
    const before =
      '---\nid: YAZ-4\nfolder_settings:\n  columns:\n    Parent:\n      type: text\n      target: "[[YAZ-1]]"\n  views:\n    - type: table\n      name: All\n      order:\n        - "[[YAZ-1]]"\n        - "[[YAZ-2]]"\n    - type: outline\n      name: Map\n      outline: |-\n        - [[YAZ-1]]\n            - see [[YAZ-1]] in prose\n---\n'
    const { content, changed } = rewriteIds(before, ONE)
    expect(content).toContain('target: "[[YAZ-9]]"')
    expect(content).toContain('- "[[YAZ-9]]"\n        - "[[YAZ-2]]"')
    expect(content).toContain('- [[YAZ-9]]\n            - see [[YAZ-1]] in prose')
    expect(changed).toBe(3)
  })

  it('the file’s own `id:` line only when the caller asks (`own`)', () => {
    const before = '---\nid: YAZ-1\ntitle: T\n---\n[[YAZ-1]]\n'
    expect(rewriteIds(before, ONE).content).toBe('---\nid: YAZ-1\ntitle: T\n---\n[[YAZ-9]]\n')
    expect(rewriteIds(before, ONE, { own: true })).toEqual({ content: '---\nid: YAZ-9\ntitle: T\n---\n[[YAZ-9]]\n', changed: 2 })
    expect(rewriteIds('---\nid: yaz-1\n---\n', ONE, { own: true }).content).toBe('---\nid: YAZ-9\n---\n')
  })

  it('a function from an ID to its new ID: every ID of the vault from old letters to new letters (D5)', () => {
    const letters = (id: string): string | undefined => (id.startsWith('YAZ-') ? `DOC-${id.slice(4)}` : undefined)
    const before = '---\nid: YAZ-3\nalso_in:\n  - YAZ-7\nin:\n  YAZ-7:\n    Status: open\n---\n[[YAZ-1]] [[yaz-12|x]] [[BUS-4]] [[6cbnmcq5n2sj]] [[Some note]]\n'
    expect(rewriteIds(before, letters, { own: true })).toEqual({
      content: '---\nid: DOC-3\nalso_in:\n  - DOC-7\nin:\n  DOC-7:\n    Status: open\n---\n[[DOC-1]] [[DOC-12|x]] [[BUS-4]] [[6cbnmcq5n2sj]] [[Some note]]\n',
      changed: 5,
    })
  })

  it('an old ID to its number ID (D6)', () => {
    const backfill = new Map([['6cbnmcq5n2sj', 'YAZ-3']])
    expect(rewriteIds('---\nid: 6cbnmcq5n2sj\nalso_in: 6cbnmcq5n2sj\n---\n[[6cbnmcq5n2sj|Home]] [[6cbnmcq5n2sk]]\n', backfill, { own: true }).content).toBe(
      '---\nid: YAZ-3\nalso_in: YAZ-3\n---\n[[YAZ-3|Home]] [[6cbnmcq5n2sk]]\n',
    )
  })

  it('a file that names no changed ID keeps each byte, and a second run changes nothing', () => {
    const before = '---\r\ntitle:   "T"   # kept\r\n---\r\n[[YAZ-2]] [[Other]]\r\n'
    expect(rewriteIds(before, ONE)).toEqual({ content: before, changed: 0 })
    const once = rewriteIds('---\nalso_in: [YAZ-1]\n---\n[[YAZ-1]]\n', ONE).content
    expect(rewriteIds(once, ONE)).toEqual({ content: once, changed: 0 })
  })

  it('properties that do not parse: the links of the body still change, and the properties keep each byte', () => {
    expect(rewriteIds('---\nid: [YAZ-1\n---\n[[YAZ-1]]\n', ONE, { own: true })).toEqual({ content: '---\nid: [YAZ-1\n---\n[[YAZ-9]]\n', changed: 1 })
  })

  it('an ID that maps to itself is no change', () => {
    expect(rewriteIds('[[YAZ-1]]\n', new Map([['YAZ-1', 'YAZ-1']]))).toEqual({ content: '[[YAZ-1]]\n', changed: 0 })
  })
})
