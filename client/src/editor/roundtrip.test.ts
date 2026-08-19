/**
 * Crepe round-trip (GRO-1961): a synthetic fixture plus, when present on this
 * machine, a few real vault files (read-only) go through createCrepe() +
 * getMarkdownForSave(). Formatting normalisation is accepted (CONTRACTS.md
 * "Editor rules" 5); the assertions are on stable invariants: headings and words.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { splitFrontmatter } from './frontmatter'

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

Some *emphasis*, __strong__, \`code\`, a [link](https://x.y/z "t"), and a [[Wiki Link]] plus ![[embed.png]] and #tag.
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
  it('ends with exactly one newline even when the trailing plugin appends an empty paragraph', async () => {
    expect(await roundTrip('# H\n\n* a\n')).toBe('# H\n\n* a\n')
    expect(await roundTrip('# H\n\n* a\n\n\n')).toBe('# H\n\n* a\n')
  })
  it('un-escapes wikilinks and embeds on save', async () => {
    const out = await roundTrip('See [[Wiki Link]] and ![[embed.png]].\n')
    expect(out).toBe('See [[Wiki Link]] and ![[embed.png]].\n')
  })
})
