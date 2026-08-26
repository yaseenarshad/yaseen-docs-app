/** The title-search perf smoke (YAZ-802) — keeps the 1,000+ file acceptance honest. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { searchCandidates, searchTitles } from './searchCandidates'

const rec = (path: string, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+$/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: path.indexOf('/', '/vault/'.length) === -1 ? '' : folder,
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases,
    tags: [],
    links: [],
    embeds: [],
  }
}

describe('searchCandidates', () => {
  it('perf smoke: 2,000 records derive and match well under a keystroke budget', () => {
    const records = Array.from({ length: 2000 }, (_, i) => rec(`/vault/folder${i % 50}/Note ${i}.md`, [`N${i}`]))
    const start = performance.now()
    const candidates = searchCandidates(records)
    for (let i = 0; i < 10; i++) searchTitles(candidates, `Note 49`)
    const elapsed = performance.now() - start
    expect(candidates).toHaveLength(4000) // one basename row + one alias row per record
    // The measured ms in the run's output, like every other perf smoke (YAZ-861): a budget that
    // only ever prints on failure hides the drift that walks up to it.
    console.log(`search perf: 2000 records in ${elapsed.toFixed(1)} ms (${candidates.length} candidates)`)
    // Alone on an idle pool this is a real budget: ~4 ms measured, 50 ms allowed.
    expect(elapsed).toBeLessThan(50)
  })
})
