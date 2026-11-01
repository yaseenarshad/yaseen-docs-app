/**
 * Mixed-marker siblings (GRO-2112): `-`, `*` and `+` are the same bullet. `unifySiblingMarkers`
 * runs on load (inside `normalizeEmptyItems`) so CommonMark's "marker change = new list" never
 * splits an indent level into sibling lists. Pure-function tests; the editor-level proof lives
 * in guideLines.test.ts ('mixed markers').
 */
import { describe, expect, it } from 'vitest'
import { postProcessMarkdown } from './createCrepe'
import {
  alignNestedIndent,
  escapeSameLineOrderedMarkers,
  mapOutsideFences,
  normalizeEmptyItems,
  restoreItemLine,
  separateEmptyNestedItems,
  unifySiblingMarkers,
} from './listItemRoundTrip'

describe('same-line numeric bullet text (YAZ-1329)', () => {
  it('armors immediate `6)` / `6.` text after a bullet marker, at every indent', () => {
    expect(escapeSameLineOrderedMarkers('- 6) Paid\n  * 7. Lead\n\t+ 8) Deep\n')).toBe(
      '- 6\\) Paid\n  * 7\\. Lead\n\t+ 8\\) Deep\n',
    )
  })

  it('restores the source spelling on save and is idempotent in both directions', () => {
    const source = '* 1) one\n* 2. two\n'
    const armored = '* 1\\) one\n* 2\\. two\n'
    expect(escapeSameLineOrderedMarkers(source)).toBe(armored)
    expect(escapeSameLineOrderedMarkers(armored)).toBe(armored)
    expect(postProcessMarkdown(armored)).toBe(source)
    expect(postProcessMarkdown(source)).toBe(source)
    expect(armored.split('\n').map(restoreItemLine).join('\n')).toBe(source)
  })

  it('handles a delimiter-only item and preserves CRLF line endings', () => {
    expect(escapeSameLineOrderedMarkers('- 1)\r\n* 2.\r\n')).toBe('- 1\\)\r\n* 2\\.\r\n')
  })

  it('does not reinterpret real ordered lists, decimals, prose, or fenced examples', () => {
    const markdown = [
      '1. real ordered item',
      '- 6.5 hours',
      'Paragraph 7) stays prose',
      '```md',
      '- 8) example in a fence',
      '```',
      '',
    ].join('\n')
    expect(escapeSameLineOrderedMarkers(markdown)).toBe(markdown)
  })

  it('keeps nested, tilde, and longer fenced examples byte-identical', () => {
    const markdown = '* Parent\n  ~~~~md\n  - 8) tilde example\n  ~~~~\n    `````\n    * 9. deep example\n    `````\n'
    expect(escapeSameLineOrderedMarkers(markdown)).toBe(markdown)
    expect(postProcessMarkdown(markdown)).toBe(markdown)
  })
})

describe('unifySiblingMarkers (GRO-2112)', () => {
  it('gives a sibling the marker of the previous bullet at its indent', () => {
    expect(unifySiblingMarkers('* a\n- b\n+ c\n')).toBe('* a\n* b\n* c\n')
    expect(unifySiblingMarkers('- a\n* b\n')).toBe('- a\n- b\n')
  })

  it('works per indent level, tabs counting as 4 spaces', () => {
    expect(unifySiblingMarkers('* p\n\t- c1\n\t* c2\n\t\t* g1\n\t\t- g2\n')).toBe('* p\n\t- c1\n\t- c2\n\t\t* g1\n\t\t* g2\n')
    expect(unifySiblingMarkers('* p\n    - c1\n\t* c2\n')).toBe('* p\n    - c1\n\t- c2\n')
  })

  it('forgets deeper indents after a shallower bullet and resets on a blank line', () => {
    // `- y` is the first bullet of q's NEW nested list: it keeps its own marker.
    expect(unifySiblingMarkers('* p\n  * x\n* q\n  - y\n')).toBe('* p\n  * x\n* q\n  - y\n')
    expect(unifySiblingMarkers('* a\n\n- b\n')).toBe('* a\n\n- b\n')
    // Lazy continuation: no blank line → `lazy` belongs to `a`, so `b` is still a's sibling.
    expect(unifySiblingMarkers('* a\nlazy text\n- b\n')).toBe('* a\nlazy text\n* b\n')
  })

  it('treats bare empty markers as bullets and never touches thematic breaks', () => {
    expect(unifySiblingMarkers('*\n- b\n')).toBe('*\n* b\n')
    expect(unifySiblingMarkers('- <br />\n* b\n')).toBe('- <br />\n- b\n')
    expect(unifySiblingMarkers('* a\n- - -\n* b\n')).toBe('* a\n- - -\n* b\n')
    expect(unifySiblingMarkers('* a\n  - - -\n  * b\n')).toBe('* a\n  - - -\n  * b\n')
    // The break itself is untouched; `b` inheriting `*` is harmless — remark ends the list at `***` anyway.
    expect(unifySiblingMarkers('* a\n***\n- b\n')).toBe('* a\n***\n* b\n')
  })

  it('leaves ordered lists, fenced code and non-list text alone', () => {
    // Ordered lines are not bullets: they neither take nor give a marker; `- y` / `- b` still
    // follow the bullets at their indent (CommonMark splits the lists around `1.` regardless).
    expect(unifySiblingMarkers('* a\n  1. x\n  - y\n- b\n')).toBe('* a\n  1. x\n  - y\n* b\n')
    const fenced = '* a\n```md\n- not a bullet\n* nor this\n```\n- b\n'
    expect(unifySiblingMarkers(fenced)).toBe('* a\n```md\n- not a bullet\n* nor this\n```\n* b\n')
    expect(unifySiblingMarkers('*emphasis* not a bullet\n-- dashes\n')).toBe('*emphasis* not a bullet\n-- dashes\n')
  })

  it('is idempotent and composed into normalizeEmptyItems', () => {
    const once = unifySiblingMarkers('* a\n- b\n')
    expect(unifySiblingMarkers(once)).toBe(once)
    expect(normalizeEmptyItems('* a\n- b\n- [ ]\n')).toBe('* a\n* b\n* [ ] <br />\n')
  })
})

/**
 * Rule 8 (YAZ-3727 D1): the list depth comes from the indentation. The editor-level proof (what a
 * save writes) lives in roundtrip.test.ts ('list depth from indentation').
 */
describe('alignNestedIndent (YAZ-3727 D1)', () => {
  it('moves the children of 10 and up to the text column of their parent', () => {
    // An AI indents every child by 3 spaces: right under `9. `, one short under `10. ` (4 wide).
    expect(alignNestedIndent('9. nine\n   * a\n10. ten\n   * b\n   * c\n11. eleven\n   * d\n')).toBe(
      '9. nine\n   * a\n10. ten\n    * b\n    * c\n11. eleven\n    * d\n',
    )
  })

  it('nests a numbered child that starts at 8 under a bullet, with a blank line before it', () => {
    expect(alignNestedIndent('* Keys\n  8. eight\n     * a\n  9. nine\n  10. ten\n     * b\n')).toBe(
      '* Keys\n\n  8. eight\n     * a\n  9. nine\n  10. ten\n      * b\n',
    )
    // Only a number other than 1 needs it: `1.` may interrupt a paragraph, and a bullet may too.
    expect(alignNestedIndent('* Keys\n  1. one\n  * b\n')).toBe('* Keys\n  1. one\n  * b\n')
  })

  it('reads Obsidian tabs and a too-deep indent as one level', () => {
    expect(alignNestedIndent('- a\n\t1. one\n\t\t- deep\n\t2. two\n- b\n')).toBe('- a\n  1. one\n     - deep\n  2. two\n- b\n')
    expect(alignNestedIndent('* a\n      * b\n      * c\n* d\n')).toBe('* a\n  * b\n  * c\n* d\n')
  })

  it('moves text with the item whose text column it reaches; a lazy line stays as written', () => {
    expect(alignNestedIndent('10. ten\n   lazy text\n   * kid\n     kid text\n\n     kid para\n11. eleven\n')).toBe(
      '10. ten\n   lazy text\n    * kid\n      kid text\n\n      kid para\n11. eleven\n',
    )
  })

  it('after a blank line, text indented past an item\'s marker belongs to that item (a loose list)', () => {
    expect(alignNestedIndent('10. ten\n\n   Para\n   * child\n')).toBe('10. ten\n\n    Para\n    * child\n')
    expect(alignNestedIndent('9. nine\n\n   Para of nine\n\n10. ten\n\n   Para of ten\n')).toBe('9. nine\n\n   Para of nine\n\n10. ten\n\n    Para of ten\n')
    // A heading and a quote take the same rule; past the text column a line keeps its distance from it.
    expect(alignNestedIndent('10. a\n\n   # H\n\n   > q\n')).toBe('10. a\n\n    # H\n\n    > q\n')
    expect(alignNestedIndent('10. a\n   * kid\n\n       two past\n')).toBe('10. a\n    * kid\n\n        two past\n')
    // The next lines of a text line let in at 3 spaces go with it: a table's rows, a paragraph's lines. A line further left stays.
    expect(alignNestedIndent('10. x\n\n   | a |\n   | - |\n   | 1 |\n')).toBe('10. x\n\n    | a |\n    | - |\n    | 1 |\n')
    expect(alignNestedIndent('10. x\n\n   one\n   two\nlazy\n   * kid\n')).toBe('10. x\n\n    one\n    two\nlazy\n    * kid\n')
  })

  it('after a blank line, a line 4 or more columns past its item\'s text column is indented code: it opens no level', () => {
    expect(alignNestedIndent('1. one\n\n       - code line\n')).toBe('1. one\n\n       - code line\n')
    // The code goes on while the indent holds; it moves with its item, so it stays code.
    expect(alignNestedIndent('10. ten\n   1. one\n\n          - code\n          - more\n   2. two\n')).toBe(
      '10. ten\n    1. one\n\n           - code\n           - more\n    2. two\n',
    )
    expect(alignNestedIndent('para\n\n    - top code\n')).toBe('para\n\n    - top code\n')
    // No blank line: not code, a too-deep line nests.
    expect(alignNestedIndent('1. one\n       - deep\n')).toBe('1. one\n   - deep\n')
  })

  it('a blank line and a paragraph end the list; a fence inside an item keeps its bytes', () => {
    expect(alignNestedIndent('1. one\n   * kid\n\nPlain paragraph\n')).toBe('1. one\n   * kid\n\nPlain paragraph\n')
    expect(alignNestedIndent('* a\n  ```\n  * code\n  ```\n* b\n')).toBe('* a\n  ```\n  * code\n  ```\n* b\n')
  })

  it('an empty parent gets no blank line before its numbered child: a blank line would end it', () => {
    expect(alignNestedIndent('*\n  8. x\n  9. y\n')).toBe('*\n  8. x\n  9. y\n')
    expect(alignNestedIndent('10.\n   8. x\n')).toBe('10.\n    8. x\n')
  })

  it('a heading, a quote, a thematic break or a fence closes the items right of it', () => {
    // Without the close, `  * x` would move under `10.` (4 spaces), which after the closed list is code.
    for (const closer of ['# H', '> quote', '---', '***']) {
      expect(alignNestedIndent(`10. a\n${closer}\n  * x\n`), closer).toBe(`10. a\n${closer}\n  * x\n`)
    }
    expect(alignNestedIndent('10. a\n```\ncode\n```\n  * x\n')).toBe('10. a\n```\ncode\n```\n  * x\n')
    // Inside the item (at its text column) a fence or a heading closes nothing.
    expect(alignNestedIndent('10. a\n    ```\n    code\n    ```\n   * x\n')).toBe('10. a\n    ```\n    code\n    ```\n    * x\n')
    expect(alignNestedIndent('10. a\n    # H\n   * x\n')).toBe('10. a\n    # H\n    * x\n')
  })

  it('keeps Markdown the app writes byte-identical, and is idempotent', () => {
    const app = '* Keys\n  1. k1\n     * child1\n  10. k10\n      * child10\n  * bullet\n    text line\n\n    second para\n- [ ] task\n  * sub\n*\n  8. x\n\n1. a\n2.\n   1. c\n'
    expect(alignNestedIndent(app)).toBe(app)
    for (const md of ['9. a\n   * k\n10. b\n   * k\n', '* Keys\n  8. a\n', '- a\n\t\t- b\n', '10. a\n   text\n   * kid\n']) {
      const once = alignNestedIndent(md)
      expect(alignNestedIndent(once), md).toBe(once)
    }
  })

  it('keeps CRLF line endings', () => {
    expect(alignNestedIndent('9. a\r\n   * k\r\n10. b\r\n   * k2\r\n')).toBe('9. a\r\n   * k\r\n10. b\r\n    * k2\r\n')
    expect(alignNestedIndent('* Keys\r\n  8. a\r\n  9. b\r\n')).toBe('* Keys\r\n\n  8. a\r\n  9. b\r\n')
    expect(alignNestedIndent('*\r\n  8. a\r\n')).toBe('*\r\n  8. a\r\n')
  })

  it('runs inside normalizeEmptyItems before the marker rule, which reads the aligned indent', () => {
    // c1 (3 spaces) and c2 (2 spaces) are both children of p: aligned first, they share one marker.
    expect(normalizeEmptyItems('* p\n   - c1\n  * c2\n')).toBe('* p\n  - c1\n  - c2\n')
  })
})

describe('separateEmptyNestedItems (YAZ-1357)', () => {
  it('is idempotent and leaves fenced code alone', () => {
    const once = separateEmptyNestedItems('* a\n  *\n  * d\n')
    expect(once).toBe('* a\n\n  *\n  * d\n')
    expect(separateEmptyNestedItems(once)).toBe(once)
    const fenced = '```\n* a\n  *\n```\n* b\n  *\n'
    expect(separateEmptyNestedItems(fenced)).toBe('```\n* a\n  *\n```\n* b\n\n  *\n')
  })
  it('only fires for a DEEPER bare marker on the very next line', () => {
    expect(separateEmptyNestedItems('* a\n*\n')).toBe('* a\n*\n')
    expect(separateEmptyNestedItems('  * a\n*\n')).toBe('  * a\n*\n')
    expect(separateEmptyNestedItems('* a\n  * b\n')).toBe('* a\n  * b\n')
    expect(separateEmptyNestedItems('*\n  *\n')).toBe('*\n  *\n')
  })
})

describe('normalizeEmptyItems runs the blank-line pass LAST (YAZ-1357)', () => {
  it('mixed markers are unified before the blank line resets their memory', () => {
    expect(normalizeEmptyItems('- a\n  *\n* b\n')).toBe('- a\n\n  *\n- b\n')
  })
})

/**
 * 🔒 Every text rule, on load (`normalizeEmptyItems`) and on save (`postProcessMarkdown`), goes
 * through `mapOutsideFences`, so no rule reads code as Markdown. The editor-level proof lives in
 * roundtrip.test.ts ('the text rules never change code').
 */
describe('the text rules never read code (YAZ-2660)', () => {
  const FENCE = '```'
  /** A text bullet, a deeper bare marker (rule 7 would add a blank line) and a `-` sibling (the marker rule would make it `*`). */
  const LIST = ['* a', '  *', '- b']

  it('the walk knows the fence character, its length, and that a closing fence has no text after it', () => {
    const seen = (markdown: string): string[] => {
      const lines: string[] = []
      mapOutsideFences(markdown, (line) => {
        lines.push(line)
        return line
      })
      return lines
    }
    expect(seen(`before\n${FENCE}\ncode\n${FENCE}\nafter`)).toEqual(['before', 'after'])
    // A shorter fence, the other character, and a fence with text after it do not close the block.
    expect(seen(`\`\`\`\`\n${FENCE}\ncode\n${FENCE}\n\`\`\`\`\nafter`)).toEqual(['after'])
    expect(seen(`~~~\n${FENCE}\ncode\n${FENCE}\n~~~\nafter`)).toEqual(['after'])
    expect(seen(`${FENCE}\n${FENCE}js\ncode\n${FENCE}\nafter`)).toEqual(['after'])
    // A fence in a bullet is indented; a fence that never closes runs to the end.
    expect(seen(`* item\n  ${FENCE}\n  code\n  ${FENCE}\n* next`)).toEqual(['* item', '* next'])
    expect(seen(`before\n${FENCE}\ncode\nmore`)).toEqual(['before'])
  })

  it('the walk gives a rule the line below, and writes back what the rule returns', () => {
    const below: Array<string | undefined> = []
    const out = mapOutsideFences('a\nb\n', (line, next) => {
      below.push(next)
      return line.toUpperCase()
    })
    expect(out).toBe('A\nB\n')
    expect(below).toEqual(['b', '', undefined])
  })

  it('load: an empty item and an empty task inside a fence keep their bytes (C1, C2, C11)', () => {
    const fenced = `${FENCE}\n* <br />\n* [ ]\n- [x] \n${FENCE}\n`
    expect(normalizeEmptyItems(fenced)).toBe(fenced)
    const inBullet = `* item\n\n  ${FENCE}\n  * [ ]\n  * <br />\n  ${FENCE}\n`
    expect(normalizeEmptyItems(inBullet)).toBe(inBullet)
  })

  it.each([
    { id: 'C4', shape: 'a fence of 4 backticks that holds a line of 3', open: '````', inner: FENCE, close: '````' },
    { id: 'C5', shape: 'a `~~~` fence that holds a line of 3 backticks', open: '~~~', inner: FENCE, close: '~~~' },
    { id: 'C6', shape: 'a fence that holds a line such as ```js', open: FENCE, inner: `${FENCE}js`, close: FENCE },
  ])('load: $id, $shape: no blank line is added and both markers stay (C7)', ({ open, inner, close }) => {
    const fenced = [open, inner, ...LIST, close, ''].join('\n')
    expect(separateEmptyNestedItems(fenced)).toBe(fenced)
    expect(unifySiblingMarkers(fenced)).toBe(fenced)
    expect(normalizeEmptyItems(fenced)).toBe(fenced)
  })

  it('load: the rules work again under the closing fence (C12)', () => {
    const fenced = ['````', FENCE, ...LIST, '````', ...LIST, '* <br />', '* [ ]', '* 6) text', ''].join('\n')
    expect(normalizeEmptyItems(fenced)).toBe(['````', FENCE, ...LIST, '````', '* a', '', '  *', '* b', '*', '* [ ] <br />', '* 6\\) text', ''].join('\n'))
  })

  it('save: an empty task, an armored delimiter and a wikilink escape inside a fence keep their bytes (C3, C8, C9, C11)', () => {
    const fenced = `${FENCE}\n* [ ] <br />\n* 6\\) text\n\\[\\[page]]\n!\\[\\[embed.png]]\n[[a \\= b]]\n${FENCE}\n`
    expect(postProcessMarkdown(fenced)).toBe(fenced)
    const inBullet = `* item\n\n  ${FENCE}\n  * [ ] <br />\n  \\[\\[page]]\n  ${FENCE}\n`
    expect(postProcessMarkdown(inBullet)).toBe(inBullet)
  })

  it('save: the rules work again under the closing fence (C12)', () => {
    const out = postProcessMarkdown(`~~~\n${FENCE}\n\\[\\[page]]\n~~~\n* [ ] <br />\n* 6\\) text\n\\[\\[page]] !\\[\\[embed.png]] [[A \\=\\= B]]\n`)
    expect(out).toBe(`~~~\n${FENCE}\n\\[\\[page]]\n~~~\n* [ ]\n* 6) text\n[[page]] ![[embed.png]] [[A == B]]\n`)
  })

  it('save: a code span on the line keeps its bytes, and a wikilink beside it is restored (C10, C13)', () => {
    expect(postProcessMarkdown('`\\[\\[page]]`\n')).toBe('`\\[\\[page]]`\n')
    expect(postProcessMarkdown('`[[a \\= b]]`\n')).toBe('`[[a \\= b]]`\n')
    expect(postProcessMarkdown('[[A \\=\\= B]] and `\\[\\[x]]`\n')).toBe('[[A == B]] and `\\[\\[x]]`\n')
    expect(postProcessMarkdown('`\\[\\[x]]` and \\[\\[page]] and ``a ` \\[\\[y]]`` and !\\[\\[e.png]]\n')).toBe('`\\[\\[x]]` and [[page]] and ``a ` \\[\\[y]]`` and ![[e.png]]\n')
    // A lone backtick opens no span: the rule works on the rest of the line.
    expect(postProcessMarkdown('a ` b \\[\\[page]]\n')).toBe('a ` b [[page]]\n')
  })

  it('load: a CRLF file keeps the two empty-item rules, and each line keeps its ending', () => {
    expect(normalizeEmptyItems('* a\r\n* [ ]\r\n* b\r\n')).toBe('* a\r\n* [ ] <br />\r\n* b\r\n')
    expect(normalizeEmptyItems('* a\r\n* <br />\r\n  * c\r\n')).toBe('* a\r\n*\r\n  * c\r\n')
  })

  it('save: a typed backtick is not a code span (remark writes it escaped), so a wikilink between two of them is restored', () => {
    expect(postProcessMarkdown('a \\` b \\[\\[x]] \\` c\n')).toBe('a \\` b [[x]] \\` c\n')
    // An escaped BACKSLASH before a real span does not escape the span's backtick.
    expect(postProcessMarkdown('a \\\\`\\[\\[x]]` c\n')).toBe('a \\\\`\\[\\[x]]` c\n')
  })
})
