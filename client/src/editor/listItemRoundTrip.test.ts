/**
 * Mixed-marker siblings (GRO-2112): `-`, `*` and `+` are the same bullet. `unifySiblingMarkers`
 * runs on load (inside `normalizeEmptyItems`) so CommonMark's "marker change = new list" never
 * splits an indent level into sibling lists. Pure-function tests; the editor-level proof lives
 * in guideLines.test.ts ('mixed markers').
 */
import { describe, expect, it } from 'vitest'
import { postProcessMarkdown } from './createCrepe'
import {
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
