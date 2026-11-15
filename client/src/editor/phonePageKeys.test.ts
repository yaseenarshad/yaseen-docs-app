/**
 * YAZ-5591: the phone keeps a key of its own in a page's frontmatter, `sticky-headings: true | false` ("Sticky headings
 * on this page"), which the Mac does not know. The Mac must keep it when it writes the page's frontmatter: its page cog's
 * switches (`writePageSwitch`), a property (`setFrontmatterProperty`), a rename of another key. The line as the phone
 * writes it (`sticky-headings: false`, the Mac's own writer's layout) stays BYTE FOR BYTE. A line laid out by hand keeps
 * its key, its value and its comment; the Mac's writer evens its spaces, as it does for every key of the block. (The
 * Mac's editor's save puts the whole block back as it was read: `useAutosave.test.tsx`.) Made-up pages only.
 */
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, renameFrontmatterKey, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { writePageSwitch } from '@shared/pageSwitches'

const LINE = 'sticky-headings: false'
const page = (eol: string) => ['---', 'title: Garden plan', LINE, 'tags: [garden, spring]', 'folding: true', '---', '', '# Garden plan', '', 'Beds.', ''].join(eol)

describe("the Mac keeps the phone's `sticky-headings` key byte for byte (YAZ-5591)", () => {
  for (const eol of ['\n', '\r\n']) {
    const name = eol === '\n' ? 'LF' : 'CRLF'
    it(`through the page cog, a property, a rename and a delete of other keys (${name})`, () => {
      const writes = [
        writePageSwitch(page(eol), 'folding', false),
        writePageSwitch(page(eol), 'toc', true),
        setFrontmatterProperty(page(eol), 'status', 'done'),
        setFrontmatterProperty(page(eol), 'tags', ['garden']),
        setFrontmatterProperty(page(eol), 'title', undefined),
        renameFrontmatterKey(page(eol), [], 'tags', 'labels'),
      ]
      for (const out of writes) {
        expect(out).not.toBe(page(eol))
        expect(splitFrontmatter(out).frontmatter.split(eol)).toContain(LINE)
        expect(parseFrontmatter(splitFrontmatter(out).frontmatter).properties['sticky-headings']).toBe(false)
        expect(splitFrontmatter(out).body).toBe(splitFrontmatter(page(eol)).body)
      }
    })
  }

  it('a line laid out by hand keeps its key, value and comment (its spaces evened, as every key of the block)', () => {
    const hand = '---\ntitle: Notes\nsticky-headings:   true   # the phone\n---\nText.\n'
    const out = writePageSwitch(hand, 'folding', false)
    expect(out).toBe('---\ntitle: Notes\nsticky-headings: true # the phone\nfolding: false\n---\nText.\n')
  })

  it('the phone writes it with the Mac\'s writer; the Mac\'s next write of another key keeps that line as it is', () => {
    const plain = '---\ntitle: Notes\n---\nText.\n'
    const phone = setFrontmatterProperty(plain, 'sticky-headings', false)
    expect(phone).toBe('---\ntitle: Notes\nsticky-headings: false\n---\nText.\n')
    expect(writePageSwitch(phone, 'folding', false)).toBe('---\ntitle: Notes\nsticky-headings: false\nfolding: false\n---\nText.\n')
  })
})
