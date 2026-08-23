/** The `[[` completion perf smoke (Links B, GRO-2191) — keeps the 1,000+ file acceptance honest. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { linkCandidates, matchLinkCandidates } from './completion'

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

describe('linkCandidates', () => {
  it('perf smoke: 5,000 records derive and match well under a keystroke budget', () => {
    const records = Array.from({ length: 5000 }, (_, i) => rec(`/vault/folder${i % 50}/Note ${i}.md`, [`N${i}`]))
    const start = performance.now()
    const candidates = linkCandidates(records)
    for (let i = 0; i < 10; i++) matchLinkCandidates(candidates, `Note 49`)
    const elapsed = performance.now() - start
    expect(candidates).toHaveLength(10000) // one name row + one alias row per record
    // Alone on an idle pool this is a real budget: ~27 ms measured, 100 ms allowed.
    expect(elapsed).toBeLessThan(100)
  })
})
