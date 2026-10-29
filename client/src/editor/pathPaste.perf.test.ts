/** Paste a path, get a link (YAZ-3609) perf smoke: the `path → row` map at 20,000 rows. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { LinkCandidate } from '../links/completion'
import { timeMedian } from '../test-perf'
import { hrefTarget, linkFor } from './pathPaste'
import { createWikilinkCandidateSource } from './wikilink/wikilinkPicker'

const ROWS = 20_000

describe('pathPaste', () => {
  it('perf smoke: the first paste after an index change builds the map for 20,000 rows; a click after it is a lookup', () => {
    const rows: LinkCandidate[] = Array.from({ length: ROWS }, (_, i) => ({ name: `Note ${i}`, insert: `YAZ-${i}`, label: `Note ${i}`, path: `/vault/folder${i % 50}/note-${i}.md` }))
    const candidates = createWikilinkCandidateSource()
    const options = { root: '/vault', notePath: '/vault/folder0/note-0.md', candidates }
    // Each run is a new index snapshot: a fresh array, so the map is built again, as after a save.
    const firstPaste = () => {
      candidates.update([...rows])
      return linkFor(`/vault/folder${(ROWS - 1) % 50}/note-${ROWS - 1}.md`, options)
    }
    firstPaste() // warm-up (JIT)
    const { result: link, median: build } = timeMedian(5, firstPaste)
    const { result: target, median: click } = timeMedian(5, () => hrefTarget('../folder9/note-9.md', options))
    expect(link).toBe(`[[YAZ-${ROWS - 1}]]`)
    expect(target).toBe('/vault/folder9/note-9.md')
    console.log(`pathPaste perf: ${ROWS} rows, first paste median ${build.toFixed(1)} ms, click lookup median ${click.toFixed(3)} ms`)
    // Paste and click are no keystroke path; the budget keeps the map one pass over the rows.
    expect(build).toBeLessThan(50)
    expect(click).toBeLessThan(1)
  })
})
