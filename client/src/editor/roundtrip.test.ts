/**
 * Crepe round-trip (GRO-1961): a synthetic fixture plus, when present on this
 * machine, a few real vault files (read-only) go through createCrepe() +
 * getMarkdownForSave(). Formatting normalisation is accepted (CONTRACTS.md
 * "Editor rules" 5); the assertions are on stable invariants: headings and words.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { splitFrontmatter } from '@shared/frontmatter'

const VAULT =
  '/Users/yasin/yaseen-os/yaseen-machine-content/Content Pillars/1. Agentic Agency'
const FILES = [
  `${VAULT}/How to Build Agents (for non-technical business owners)/Part 1/Storyboard-v1.md`,
  `${VAULT}/Services - Agentic Agency vs Traditional Agency.md`,
  `${VAULT}/How to Build Agents (for non-technical business owners)/Yaseen Dump.md`,
  `${VAULT}/How to Sell Agents (for non-technical business owners)/sources/Sequoia Article.md`,
]
const SYNTHETIC = `---
title: Synthetic fixture
tags: [a, b]
---

# Heading 1

Setext heading
==============

Some *emphasis*, __strong__, ==highlight==, \`code\`, a [link](https://x.y/z "t"), and a [[Wiki Link]] plus ![[embed.png]] and #tag.
A hard break follows (two spaces)  
next line. Backslash break\\
next line. Escapes: 1\\. not a list, \\_under\\_, \\[bracket\\], a_b_c, 2 * 3 * 4.

- dash item
- dash item two
    - nested four spaces
	- nested tab

* star item
+ plus item

1) paren ordered
2) paren ordered

1. dot ordered
1. dot ordered (all ones)

- [ ] todo
- [x] done

> quote line one
continued lazily

| Col A | Col B |
|-------|:-----:|
| 1     | 2     |

\`\`\`ts
const x = 1
\`\`\`

    indented code block

***

___

<div align="center">raw html</div>

Line with trailing spaces   
Final line without trailing newline`

async function roundTrip(markdown: string): Promise<string> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  const out = getMarkdownForSave(crepe)
  await crepe.destroy()
  root.remove()
  return out
}

async function documentJson(markdown: string): Promise<Record<string, unknown>> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  const json = crepe.editor.ctx.get(editorViewCtx).state.doc.toJSON() as Record<string, unknown>
  await crepe.destroy()
  root.remove()
  return json
}

/** The text of each code block on the page, and what a save writes. */
async function codeRoundTrip(markdown: string): Promise<{ code: string[]; saved: string }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  const code: string[] = []
  crepe.editor.ctx.get(editorViewCtx).state.doc.descendants((node) => {
    if (node.type.name === 'code_block') code.push(node.textContent)
  })
  const saved = getMarkdownForSave(crepe)
  await crepe.destroy()
  root.remove()
  return { code, saved }
}

function headings(md: string): string[] {
  const out: string[] = []
  const lines = md.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[\s>*+-]*(?:\d+[.)]\s+)?/, "")
    if (/^#{1,6}\s/.test(l)) {
      out.push(l.replace(/^#{1,6}\s+/, "").trim())
    } else if (l.trim() && i + 1 < lines.length && /^(=+|-+)\s*$/.test(lines[i + 1]) && !/^\s*[-*+]\s/.test(lines[i])) {
      // setext heading (Crepe re-serialises these as ATX)
      out.push(l.trim())
      i++
    }
  }
  return out
}

/** Words after stripping markdown punctuation, html tags and escapes — content invariant. */
function words(md: string): string[] {
  return md
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, " ") // list markers
    .replace(/<(?![a-z]+:\/\/)(?![^>\s]*@)[^>\n]+>/g, " ") // html tags, keep autolinks
    .replace(/\\/g, "")
    .replace(/[#*_`|\[\]()!+\-~=&<>.,:;"]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

describe('Crepe markdown round-trip', () => {
  const cases: Array<[string, string]> = [['synthetic.md', SYNTHETIC]]
  for (const f of FILES) {
    if (existsSync(f)) cases.push([basename(f), readFileSync(f, 'utf8')])
  }

  it.each(cases)('%s: headings + words preserved', async (_name, original) => {
    const { body } = splitFrontmatter(original)
    const out = await roundTrip(body)
    expect(headings(out)).toEqual(headings(body))
    expect(words(out).join(' ')).toEqual(words(body).join(' '))
  })

  it('synthetic: frontmatter-stripped body round-trips without the --- fence mangling', async () => {
    const { frontmatter, body } = splitFrontmatter(SYNTHETIC)
    expect(frontmatter.startsWith('---\n')).toBe(true)
    expect((await roundTrip(body)).startsWith('---')).toBe(false)
    // Fed WITH frontmatter, Crepe turns the YAML block into a thematic break + paragraph.
    expect((await roundTrip(SYNTHETIC)).startsWith('---\ntitle:')).toBe(false)
  })

  it('round-trip is idempotent (second pass === first pass)', async () => {
    const { body } = splitFrontmatter(SYNTHETIC)
    const once = await roundTrip(body)
    const twice = await roundTrip(once)
    expect(twice).toBe(once)
  })
})

describe('locked editor rules (createCrepe)', () => {
  it('keeps image alt text (ImageBlock feature off)', async () => {
    expect(await roundTrip('![alt text](https://x/y.png "t")\n')).toBe('![alt text](https://x/y.png "t")\n')
  })
  it('keeps task list checkboxes', async () => {
    expect(await roundTrip('- [ ] todo\n- [x] done\n')).toBe('* [ ] todo\n* [x] done\n')
  })
  it('does not inject <br /> before headings / nested lists inside list items', async () => {
    const out = await roundTrip('* # Part 1\n\t- **Idea:** foo\n\t* ### S1\n\t\t- bar\n')
    expect(out).not.toContain('<br />')
    expect(out).toContain('* # Part 1')
  })
  it('writes empty bullets as bare markers and keeps their children (GRO-2012)', async () => {
    expect(await roundTrip('* a\n* \n* b\n')).toBe('* a\n*\n* b\n')
    expect(await roundTrip('* a\n* \n  * c\n* b\n')).toBe('* a\n*\n  * c\n* b\n')
    expect(await roundTrip('1. a\n2. \n   1. c\n')).toBe('1. a\n2.\n   1. c\n')
    // legacy encoding from earlier builds: `<br />` must not swallow the children as an HTML block
    expect(await roundTrip('* a\n* <br />\n  * c\n* b\n')).toBe('* a\n*\n  * c\n* b\n')
    // empty task items: `<br />` (Milkdown's encoding, also what earlier builds wrote) never reaches
    // the disk, and Obsidian's bare `* [ ] ` / `* [ ]` stays a task instead of becoming text `\[ ]`
    expect(await roundTrip('* [ ] a\n* [x] <br />\n  * c\n')).toBe('* [ ] a\n* [x]\n  * c\n')
    expect(await roundTrip('* [ ] \n')).toBe('* [ ]\n')
    expect(await roundTrip('- [x]\n  - child\n- [ ] a\n')).toBe('* [x]\n  * child\n* [ ] a\n')
    expect(await roundTrip('1. [ ]\n2. [ ] b\n')).toBe('1. [ ]\n2. [ ] b\n')
    // a task whose text happens to start with a bracket is not an empty task
    expect(await roundTrip('* [ ] [x] literal\n')).toBe('* [ ] \\[x] literal\n')
    // A number immediately after a bullet is literal text, never a nested ordered list.
    expect(await roundTrip('* 1) one\n* 2. two\n')).toBe('* 1) one\n* 2. two\n')
    expect(await roundTrip('- 6. Paid\n- 7. Lead\n')).toBe('* 6. Paid\n* 7. Lead\n')
    // Real ordered Markdown remains supported: it is also what Number children writes.
    expect(await roundTrip('1. one\n2. two\n')).toBe('1. one\n2. two\n')
    // empty paragraphs outside list items are unchanged
    expect(await roundTrip('x\n\n<br />\n\ny\n')).toBe('x\n\n<br />\n\ny\n')
  })
  it('an empty bullet nested DIRECTLY under text loads as a nested item, spelled with a blank line (YAZ-1357)', async () => {
    // CommonMark: an empty list item cannot interrupt a paragraph, so `* a` + `  *` used to read as
    // the text `a *` (and the `-` spelling as a setext heading). The blank line is the one spelling
    // every parser reads as a nested empty item, and the one Milkdown writes back — so it is stable.
    expect(await roundTrip('* a\n  *\n')).toBe('* a\n\n  *\n')
    expect(await roundTrip('- a\n    -\n')).toBe('* a\n\n  *\n')
    expect(await roundTrip('* [[Alex Hormozi]]\n  *\n')).toBe('* [[Alex Hormozi]]\n\n  *\n')
    expect(await roundTrip('* a\n  *\n  * d\n')).toBe('* a\n\n  *\n  * d\n')
    expect(await roundTrip('* a\n  *\n    * e\n* f\n')).toBe('* a\n\n  *\n    * e\n* f\n')
    expect(await roundTrip('1. a\n   1.\n')).toBe('1. a\n\n   1.\n')
    expect(await roundTrip('* a\n\t*\n')).toBe('* a\n\n  *\n')
    // already spelled with the blank line: byte-stable
    expect(await roundTrip('* a\n\n  *\n')).toBe('* a\n\n  *\n')
    // a SIBLING empty bullet is not nested and keeps GRO-2012's bare-marker spelling
    expect(await roundTrip('* a\n*\n* b\n')).toBe('* a\n*\n* b\n')
  })
  it('parses a reported same-line number as the parent bullet text, with one direct child list', async () => {
    const json = await documentJson('* 5) Competitor Ad Intelligence Engine\n  * Automation Tools\n')
    expect(json).toMatchObject({
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '5) Competitor Ad Intelligence Engine' }] },
                { type: 'bullet_list' },
              ],
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(json)).not.toContain('ordered_list')
  })
  it('ends with exactly one newline even when the trailing plugin appends an empty paragraph', async () => {
    expect(await roundTrip('# H\n\n* a\n')).toBe('# H\n\n* a\n')
    expect(await roundTrip('# H\n\n* a\n\n\n')).toBe('# H\n\n* a\n')
  })
  it('un-escapes wikilinks and embeds on save', async () => {
    const out = await roundTrip('See [[Wiki Link]] and ![[embed.png]].\n')
    expect(out).toBe('See [[Wiki Link]] and ![[embed.png]].\n')
  })
  it('wikilink variants round-trip byte-identically (decoration-only rendering, GRO-2190)', async () => {
    const cases = [
      'See [[a|b]] with an alias.\n',
      'See [[a#h]] with a heading.\n',
      'See [[a#^block]] with a block ref.\n',
      'Adjacent [[a]][[b]] links.\n',
      '**see [[a]]**\n',
      'Unicode [[Café Notes/Über plan]] with spaces.\n',
      'An unclosed [[ stays literal.\n',
    ]
    for (const md of cases) expect(await roundTrip(md)).toBe(md)
  })
})

/**
 * 🔒 The editor never changes the text of code. Every text rule, on load and on save, goes through
 * the one walk `mapOutsideFences` (listItemRoundTrip.ts), and the wikilink save rule also skips a
 * code span on its line. The page is checked beside the saved text: a load rule that the save
 * rule undoes leaves the file right and the code block on the page wrong.
 */
describe('the text rules never change code (YAZ-2660)', () => {
  const FENCE = '```'
  /** A text bullet and a deeper bare marker: rule 7 puts a blank line between them outside code. */
  const NESTED = ['* a', '  *']

  it.each([
    { id: 'C1', shape: 'a legacy empty item', code: ['* <br />'] },
    { id: 'C2', shape: 'an empty task', code: ['* [ ]'] },
    { id: 'C3', shape: 'an empty task as Milkdown spells it', code: ['* [ ] <br />'] },
    { id: 'C7', shape: 'mixed markers', code: ['* a', '- b'] },
    { id: 'C8', shape: 'an escaped wikilink', code: ['\\[\\[page]]'] },
    { id: 'C9', shape: 'an escaped `=` in a wikilink', code: ['[[a \\= b]]'] },
  ])('$id, $shape inside a fence: the code block on the page shows it, and the saved text is the same', async ({ code }) => {
    const file = [FENCE, ...code, FENCE, ''].join('\n')
    expect(await codeRoundTrip(file)).toEqual({ code: [code.join('\n')], saved: file })
  })

  it('C4, a fence of 4 backticks that holds a line of 3: no blank line is added, the saved text is the same', async () => {
    const code = [FENCE, ...NESTED, FENCE]
    const file = ['````', ...code, '````', ''].join('\n')
    expect(await codeRoundTrip(file)).toEqual({ code: [code.join('\n')], saved: file })
  })

  // remark writes a `~~~` fence, and a fence whose code holds a line of 3 backticks, as a fence of
  // 4 backticks. That is the serializer's spelling of the FENCE, not a text rule: the code lines are the proof.
  it('C5, a `~~~` fence that holds a line of 3 backticks: no blank line is added inside the code', async () => {
    const code = [FENCE, ...NESTED, FENCE]
    const out = await codeRoundTrip(['~~~', ...code, '~~~', ''].join('\n'))
    expect(out).toEqual({ code: [code.join('\n')], saved: ['````', ...code, '````', ''].join('\n') })
  })

  it('C6, a fence that holds a line such as ```js: no blank line is added inside the code', async () => {
    const code = [`${FENCE}js`, ...NESTED]
    const out = await codeRoundTrip([FENCE, ...code, FENCE, ''].join('\n'))
    expect(out).toEqual({ code: [code.join('\n')], saved: ['````', ...code, '````', ''].join('\n') })
  })

  it('C10, an escaped wikilink in inline code: the saved text is the same', async () => {
    for (const md of ['Text `\\[\\[page]]` here.\n', 'Text `[[a \\= b]]` and ``a ` \\[\\[b]]`` here.\n']) expect(await roundTrip(md), md).toBe(md)
  })

  it('C11, a fence inside a bullet that holds an empty task: the saved text is the same', async () => {
    const file = ['* item', '', `  ${FENCE}`, '  * [ ]', '  * <br />', `  ${FENCE}`, ''].join('\n')
    expect(await codeRoundTrip(file)).toEqual({ code: ['* [ ]\n* <br />'], saved: file })
  })

  it('C12, outside code each rule still works, above and below a code block', async () => {
    const block = [FENCE, '* <br />', FENCE]
    const file = ['* a', '* <br />', '  * c', '- [ ]', '- 6) text', '', ...block, '', '+ d', '  +', '- e', '', 'See [[A == B]] and ![[e.png]].', ''].join('\n')
    expect(await roundTrip(file)).toBe(['* a', '*', '  * c', '* [ ]', '* 6) text', '', ...block, '', '* d', '', '  *', '* e', '', 'See [[A == B]] and ![[e.png]].', ''].join('\n'))
  })

  it('C12, a file with CRLF line endings: an empty task stays a checkbox and a legacy empty item keeps its child', async () => {
    expect(await roundTrip('* a\r\n* [ ]\r\n* b\r\n')).toBe('* a\n* [ ]\n* b\n')
    expect(await roundTrip('* a\r\n* <br />\r\n  * c\r\n* b\r\n')).toBe('* a\n*\n  * c\n* b\n')
  })

  it('C13, a typed backtick is text, not a code span: a wikilink between two of them is restored', async () => {
    const md = 'a \\` b [[x]] \\` c\n'
    expect(await roundTrip(md)).toBe(md)
  })

  it('C13, a wikilink beside a code span on one line: the link is restored, the code span is the same', async () => {
    for (const md of ['See [[A == B]] and `\\[\\[x]]` here.\n', 'Code `\\[\\[x]]` then [[A == B]] and ![[e.png]].\n']) expect(await roundTrip(md), md).toBe(md)
  })

  /** Every load and save trigger; the last line is the armored delimiter of `* 6) text`. */
  const TRIGGERS = ['* <br />', '* [ ]', '* [ ] <br />', '* a', '- b', ...NESTED, '\\[\\[page]]', '!\\[\\[embed.png]]', '[[a \\= b]]', '* 6\\) text']
  const CODE = {
    plain: TRIGGERS, // C1, C2, C3, C7, C8, C9
    inner: [FENCE, ...TRIGGERS, FENCE, ...TRIGGERS], // C4, C5: a line of 3 backticks closes neither fence
    info: [`${FENCE}js`, ...TRIGGERS], // C6: a fence with text after it closes nothing
    inBullet: TRIGGERS, // C11
  }
  const fenced = (fence: string, code: string[], indent = ''): string[] => [fence, ...code, fence].map((line) => indent + line)
  /** The note, with the fence of the C5 block and of the C6 block as given. */
  const note = (c5: string, c6: string): string =>
    [
      'Intro.',
      '',
      ...fenced(FENCE, CODE.plain),
      '',
      ...fenced('````', CODE.inner),
      '',
      ...fenced(c5, CODE.inner),
      '',
      ...fenced(c6, CODE.info),
      '',
      '* item',
      '',
      ...fenced(FENCE, CODE.inBullet, '  '),
      '',
      // C10: the same triggers in inline code.
      'Inline `\\[\\[page]]`, `[[a \\= b]]` and `* [ ] <br />`.',
      '',
    ].join('\n')

  it('one note with every trigger inside code: each code line is the same on the page and in the saved file', async () => {
    const first = await codeRoundTrip(note('~~~', FENCE))
    expect(first.code).toEqual([CODE.plain, CODE.inner, CODE.inner, CODE.info, CODE.inBullet].map((code) => code.join('\n')))
    // Byte for byte the file, but for the fences of the C5 and C6 blocks, which remark spells with 4 backticks.
    expect(first.saved).toBe(note('````', '````'))
    expect(await codeRoundTrip(first.saved)).toEqual(first)
  })
})
