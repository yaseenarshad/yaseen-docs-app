/** YAZ-4701 (6B): sync merges a note's text line by line; D9 keeps both only for the SAME lines. Found by the checker (rounds 1 and 2). */
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readComments } from '@shared/comments'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS } from './gitFixture'
import { syncPass } from './sync'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const BODY = 'Para one.\n\nPara two.\n\nPara three.\n\nPara four.\n\nPara five.\n'
const NOTE = (comments: string, body = BODY, title = 'Plan') => `---\ntitle: ${title}\n${comments === '' ? '' : `comments:\n${comments}`}---\n${body}`
const entry = (id: string, n: number, at: string, body: string, by: string) => `  - id: ${id}\n    n: ${n}\n    at: ${at}\n    by: ${by}\n    body: ${body}\n`
const temps = () => readdirSync(tmpdir()).filter((f) => f.startsWith('yaseendocs-merge-'))

async function pair(theirsBody: string, mineBody: string, theirsTitle = 'Plan') {
  const one = entry('aaaa0001', 1, '2026-11-01T10:00:00Z', 'First', 'sam')
  const p = await makeTwoMachines({ 'plan.md': NOTE(one) })
  cleanups.push(p.cleanup)
  await p.b.write('plan.md', NOTE(one + entry('bbbb0002', 2, '2026-11-02T10:00:00Z', 'From Sam', 'sam'), theirsBody, theirsTitle))
  await p.a.write('plan.md', NOTE(one + entry('cccc0003', 2, '2026-11-02T11:00:00Z', 'From me', 'yaseen'), mineBody))
  expect((await syncPass(p.b.root)).state).toBe('synced')
  const status = await syncPass(p.a.root)
  return { ...p, status }
}

describe('a note on real git: comments by id, text line by line (D4, D9)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
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

  it('the SAME paragraph on both sides: a copy, no conflict marker in the note, and no temp folder left', async () => {
    const before = temps()
    const { a, status } = await pair(BODY.replace('Para three.', 'Para three, Sam.'), BODY.replace('Para three.', 'Para three, me.'))
    expect(status.state).toBe('synced')
    const note = a.read('plan.md')
    expect(note).not.toMatch(/^(<{7}|={7}|>{7})/m)
    expect(note).toContain('Para three, Sam.')
    expect(readComments(note).map((c) => c.id)).toEqual(['aaaa0001', 'bbbb0002', 'cccc0003'])
    const copy = status.merged?.[0]?.copy ?? ''
    expect(copy).toMatch(/\(conflict, /)
    expect(a.read(copy)).toContain('Para three, me.')
    expect(a.read(copy)).not.toMatch(/^(<{7}|={7}|>{7})/m)
    expect(temps().filter((t) => !before.includes(t))).toEqual([])
  })

  it('Sam edits the title, I edit paragraph five: one note with both', async () => {
    const { a, status } = await pair(BODY, BODY.replace('Para five.', 'Para five, me.'), 'Plan by Sam')
    expect(status.state).toBe('synced')
    expect(a.read('plan.md')).toContain('title: Plan by Sam')
    expect(a.read('plan.md')).toContain('Para five, me.')
    expect(status.merged?.[0]?.copy).toBeUndefined()
    expect(status.merged?.[0]?.title).toBe('Plan by Sam')
  })
})
