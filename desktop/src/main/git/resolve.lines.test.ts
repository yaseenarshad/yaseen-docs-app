/** YAZ-4701 (6B): sync merges a page's text line by line; D9 keeps both only for the SAME lines. Found by the checker (rounds 1 and 2). */
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { addComment, readComments } from '@shared/comments'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS } from './gitFixture'
import { syncPass } from './sync'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const BODY = 'Para one.\n\nPara two.\n\nPara three.\n\nPara four.\n\nPara five.\n'
const PAGE = (comments: string, body = BODY, title = 'Plan') => `---\ntitle: ${title}\n${comments === '' ? '' : `comments:\n${comments}`}---\n${body}`
const entry = (id: string, n: number, at: string, body: string, by: string) => `  - id: ${id}\n    n: ${n}\n    at: ${at}\n    by: ${by}\n    body: ${body}\n`
const temps = () => readdirSync(tmpdir()).filter((f) => f.startsWith('yaseendocs-merge-'))

async function pair(theirsBody: string, mineBody: string, theirsTitle = 'Plan') {
  const one = entry('aaaa0001', 1, '2026-11-01T10:00:00Z', 'First', 'sam')
  const p = await makeTwoMachines({ 'plan.md': PAGE(one) })
  cleanups.push(p.cleanup)
  await p.b.write('plan.md', PAGE(one + entry('bbbb0002', 2, '2026-11-02T10:00:00Z', 'From Sam', 'sam'), theirsBody, theirsTitle))
  await p.a.write('plan.md', PAGE(one + entry('cccc0003', 2, '2026-11-02T11:00:00Z', 'From me', 'yaseen'), mineBody))
  expect((await syncPass(p.b.root)).state).toBe('synced')
  const status = await syncPass(p.a.root)
  return { ...p, status }
}

describe('a page on real git: comments by id, text line by line (D4, D9)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('two people comment AND edit DIFFERENT paragraphs: one page with both edits and all comments, no conflicted copy', async () => {
    const one = entry('aaaa0001', 1, '2026-11-01T10:00:00Z', 'First', 'sam')
    const pair = await makeTwoMachines({ 'plan.md': PAGE(one) })
    cleanups.push(pair.cleanup)
    const { a, b } = pair
    await b.write('plan.md', PAGE(one + entry('bbbb0002', 2, '2026-11-02T10:00:00Z', 'From Sam', 'sam'), BODY.replace('Para one.', 'Para one, edited by Sam.')))
    await a.write('plan.md', PAGE(one + entry('cccc0003', 2, '2026-11-02T11:00:00Z', 'From me', 'yaseen'), BODY.replace('Para five.', 'Para five, edited by me.')))
    expect((await syncPass(b.root)).state).toBe('synced')
    const status = await syncPass(a.root)
    expect(status.state).toBe('synced')
    expect(readComments(a.read('plan.md')).map((c) => c.id)).toEqual(['aaaa0001', 'bbbb0002', 'cccc0003'])
    // Git merges edits on different lines (YAZ-4616 D9 correction). Both edits belong in the one page.
    expect(a.read('plan.md')).toContain('Para one, edited by Sam.')
    expect(a.read('plan.md')).toContain('Para five, edited by me.')
    expect(readdirSync(a.root).filter((f) => f.includes('(conflict,'))).toEqual([])
    // The notice names the page by its title (YAZ-4615 nit): one merge, no copy.
    expect(status.merged).toMatchObject([{ path: 'plan.md', kind: 'page', title: 'Plan' }])
    expect(status.merged?.[0]?.copy).toBeUndefined()
  })

  it('the SAME paragraph on both sides: a copy, no conflict marker in the page, and no temp folder left', async () => {
    const before = temps()
    const { a, status } = await pair(BODY.replace('Para three.', 'Para three, Sam.'), BODY.replace('Para three.', 'Para three, me.'))
    expect(status.state).toBe('synced')
    const page = a.read('plan.md')
    expect(page).not.toMatch(/^(<{7}|={7}|>{7})/m)
    expect(page).toContain('Para three, Sam.')
    expect(readComments(page).map((c) => c.id)).toEqual(['aaaa0001', 'bbbb0002', 'cccc0003'])
    const copy = status.merged?.[0]?.copy ?? ''
    expect(copy).toMatch(/\(conflict, /)
    expect(a.read(copy)).toContain('Para three, me.')
    expect(a.read(copy)).not.toMatch(/^(<{7}|={7}|>{7})/m)
    expect(temps().filter((t) => !before.includes(t))).toEqual([])
  })

  it('Sam edits the title, I edit paragraph five: one page with both', async () => {
    const { a, status } = await pair(BODY, BODY.replace('Para five.', 'Para five, me.'), 'Plan by Sam')
    expect(status.state).toBe('synced')
    expect(a.read('plan.md')).toContain('title: Plan by Sam')
    expect(a.read('plan.md')).toContain('Para five, me.')
    expect(status.merged?.[0]?.copy).toBeUndefined()
    expect(status.merged?.[0]?.title).toBe('Plan by Sam')
  })
})

describe('YAZ-5512 X1: a phone comment never stops the Mac sync', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  // The page has no properties and a card with a back (`---`). The phone's comment makes its first block; the Mac
  // edits the first line before it syncs. Git stops on the page; the old settle threw on every pass from then on, so
  // a vault in this state never pushed again. This IS that stuck state: the next pass must land it.
  const CARDS = '# Words\n\n```card\nHola\n---\nHello\n```\n<!-- card: NC-1 -->\n\nThe end.\n'
  it('a vault stuck on such a page syncs on its next pass: both edits, the comment, no copy', async () => {
    const p = await makeTwoMachines({ 'words.md': CARDS })
    cleanups.push(p.cleanup)
    const { a, b } = p
    await b.write('words.md', addComment(CARDS, 'from phone', { id: 'pho00001', at: '2026-11-14T06:00:00Z', by: 'yaseen' }))
    expect((await syncPass(b.root)).state).toBe('synced')
    await a.write('words.md', CARDS.replace('# Words', '# Words edited'))
    const status = await syncPass(a.root)
    expect(status.state).toBe('synced')
    const page = a.read('words.md')
    expect(page).toContain('# Words edited')
    expect(page).toContain('```card\nHola\n---\nHello\n```\n<!-- card: NC-1 -->')
    expect(readComments(page).map((c) => c.body)).toEqual(['from phone'])
    expect(readdirSync(a.root).filter((f) => f.includes('(conflict,'))).toEqual([])
    // It reached GitHub: the other machine gets the Mac's edit.
    expect((await syncPass(b.root)).state).toBe('synced')
    expect(b.read('words.md')).toBe(page)
  })
})

describe('YAZ-5515 X2: a phone write next to a Mac edit makes no conflict copy', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** GitHub gets `phone` (the phone's write, here pushed by machine B); the Mac (A) made `mac` before it synced. */
  async function merge(base: string, phone: string, mac: string) {
    const p = await makeTwoMachines({ 'list.md': base })
    cleanups.push(p.cleanup)
    await p.b.write('list.md', phone)
    expect((await syncPass(p.b.root)).state).toBe('synced')
    await p.a.write('list.md', mac)
    const status = await syncPass(p.a.root)
    expect(status.state).toBe('synced')
    expect(readdirSync(p.a.root).filter((f) => f.includes('(conflict,'))).toEqual([])
    expect(status.merged?.[0]?.copy).toBeUndefined()
    return p.a.read('list.md')
  }

  it('a phone tick or card line write merges with a Mac edit of the adjacent line without a conflict copy', async () => {
    // M1: the phone ticks One; the Mac edits Two, the next line.
    expect(await merge('# List\n\n- [ ] One\n- [ ] Two\n', '# List\n\n- [x] One\n- [ ] Two\n', '# List\n\n- [ ] One\n- [ ] Two edited\n')).toBe('# List\n\n- [x] One\n- [ ] Two edited\n')
    // M9: the phone answers the card; the Mac edits the line right below its card line.
    const card = '# Words\n\n```card\nQ\n```\n<!-- card: NC-1 -->\nNext para\n'
    expect(await merge(card, card.replace('NC-1 -->', 'NC-1, 2026-11-14T06:01:00.000Z good -->'), card.replace('Next para', 'Next para edited'))).toBe(
      '# Words\n\n```card\nQ\n```\n<!-- card: NC-1, 2026-11-14T06:01:00.000Z good -->\nNext para edited\n',
    )
  })

  it('M7: the phone ticks a task while the Mac ticks the task right below it: both ticks', async () => {
    expect(await merge('- [ ] One\n- [ ] Two\n', '- [x] One\n- [ ] Two\n', '- [ ] One\n- [x] Two\n')).toBe('- [x] One\n- [x] Two\n')
  })

  it('the SAME line on both sides still keeps both (a copy)', async () => {
    const p = await makeTwoMachines({ 'list.md': '- [ ] One\n- [ ] Two\n' })
    cleanups.push(p.cleanup)
    await p.b.write('list.md', '- [x] One\n- [ ] Two\n')
    expect((await syncPass(p.b.root)).state).toBe('synced')
    await p.a.write('list.md', '- [ ] One, edited\n- [ ] Two\n')
    const status = await syncPass(p.a.root)
    expect(status.state).toBe('synced')
    expect(p.a.read('list.md')).toBe('- [x] One\n- [ ] Two\n')
    expect(p.a.read(status.merged?.[0]?.copy ?? '')).toBe('- [ ] One, edited\n- [ ] Two\n')
  })
})
