/** YAZ-4701 (6B): sync merges a note's text line by line; D9 keeps both only for the SAME lines. Found by the checker. */
import { readdirSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readComments } from '@shared/comments'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS } from './gitFixture'
import { syncPass } from './sync'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const BODY = 'Para one.\n\nPara two.\n\nPara three.\n\nPara four.\n\nPara five.\n'
const NOTE = (comments: string, body = BODY) => `---\ntitle: Plan\n${comments === '' ? '' : `comments:\n${comments}`}---\n${body}`
const entry = (id: string, n: number, at: string, body: string, by: string) => `  - id: ${id}\n    n: ${n}\n    at: ${at}\n    by: ${by}\n    body: ${body}\n`

describe('checker: D9 on real git', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('two people comment AND edit DIFFERENT paragraphs: one note with both edits and all comments, no conflicted copy', async () => {
    const one = entry('aaaa0001', 1, '2026-11-01T10:00:00Z', 'First', 'sam')
    const pair = await makeTwoMachines({ 'plan.md': NOTE(one) })
    cleanups.push(pair.cleanup)
    const { a, b } = pair
    await b.write('plan.md', NOTE(one + entry('bbbb0002', 2, '2026-11-02T10:00:00Z', 'From Sam', 'sam'), BODY.replace('Para one.', 'Para one, edited by Sam.')))
    await a.write('plan.md', NOTE(one + entry('cccc0003', 2, '2026-11-02T11:00:00Z', 'From me', 'yaseen'), BODY.replace('Para five.', 'Para five, edited by me.')))
    expect((await syncPass(b.root)).state).toBe('synced')
    const status = await syncPass(a.root)
    expect(status.state).toBe('synced')
    expect(readComments(a.read('plan.md')).map((c) => c.id)).toEqual(['aaaa0001', 'bbbb0002', 'cccc0003'])
    // Git merges edits on different lines (YAZ-4616 D9 correction). Both edits belong in the one note.
    expect(a.read('plan.md')).toContain('Para one, edited by Sam.')
    expect(a.read('plan.md')).toContain('Para five, edited by me.')
    expect(readdirSync(a.root).filter((f) => f.includes('(conflict,'))).toEqual([])
    // The notice names the note by its title (YAZ-4615 nit): one merge, no copy.
    expect(status.merged).toMatchObject([{ path: 'plan.md', kind: 'note', title: 'Plan' }])
    expect(status.merged?.[0]?.copy).toBeUndefined()
  })
})
