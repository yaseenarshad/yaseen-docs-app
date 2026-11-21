import { readComments } from '@shared/comments'
import { cardRecords } from '@shared/cardLine'
import { addComment } from '@shared/comments'
import { describe, expect, it } from 'vitest'
import { applyOps } from '../../answers/ops'
import { applyComment } from '../../comments/write'
import { applyTask, tickOf } from '../../comments/taskWrite'
import { macMerge } from './macMerge.testing'

const C = (body: string) => ({ id: 'pho00001', at: '2026-11-14T06:00:00Z', by: 'yaseen', body })
const added = (t: string, body: string) => {
  const r = applyComment(t, C(body))
  if (r.kind !== 'added') throw new Error(r.kind)
  return r.content
}
const ticked = (t: string, core: string, nth = 0) => {
  const r = applyTask(t, tickOf(t, core, nth, true))
  if (r.kind !== 'ticked') throw new Error(r.kind)
  return r.content
}

describe('check-writes: the Mac merges a phone write with its own local edit', () => {
  it('M1 phone ticks a task while the Mac edits the NEXT line (adds a task below): no conflict copy', () => {
    const base = '# List\n\n- [ ] One\n- [ ] Two\n'
    const phone = ticked(base, '- [ ] One')
    const mac = base.replace('- [ ] Two', '- [ ] Two edited')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy, `how=${out.how}`).toBeUndefined()
    expect.soft(out.text).toBe('# List\n\n- [x] One\n- [ ] Two edited\n')
  })
  it('M2 phone comments on a page with NO front matter while the Mac edits its first line: no copy, both kept', () => {
    const base = '# Title\n\nBody\n'
    const phone = added(base, 'from phone')
    const mac = base.replace('# Title', '# Title edited')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy, `how=${out.how}`).toBeUndefined()
    expect.soft(out.text).toContain('# Title edited')
    expect.soft(readComments(out.text).map((c) => c.body)).toEqual(['from phone'])
  })
  it('M3 phone answers NC-1 while the Mac answers NC-1 too: both reviews, no copy', () => {
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\n'
    const phone = applyOps(base, [{ kind: 'review', id: 'NC-1', review: { at: '2026-11-14T06:01:00.000Z', rating: 'good' } }]).content
    const mac = base.replace('NC-1 -->', 'NC-1, 2026-11-14T06:02:00.000Z hard -->')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy).toBeUndefined()
    expect.soft(cardRecords(out.text)[0].reviews.map((r) => r.at)).toEqual(['2026-11-14T06:01:00.000Z', '2026-11-14T06:02:00.000Z'])
  })
  it('M4 phone answers the same card twice in one second (YAZ-5642: two times) while the Mac changes that line: two reviews stay', () => {
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\n'
    const r = { at: '2026-11-14T06:01:12.345Z', rating: 'again' as const }
    const phone = applyOps(base, [{ kind: 'review', id: 'NC-1', review: r }, { kind: 'review', id: 'NC-1', review: { ...r, at: '2026-11-14T06:01:12.802Z' } }]).content
    expect(cardRecords(phone)[0].reviews).toHaveLength(2)
    const mac = base.replace('NC-1 -->', 'NC-1, fix -->')
    const out = macMerge(base, phone, mac)
    expect.soft(cardRecords(out.text)[0].reviews, out.text).toHaveLength(2)
  })
  it('M5 a hand-written comment (no id); phone and Mac each add one: the hand-written one shows ONE time', () => {
    const base = '---\ntitle: P\ncomments:\n  - by: agent\n    body: hand-written\n---\nBody\n'
    const phone = added(base, 'from phone')
    const mac = addComment(base, 'from mac', { id: 'mac00001', at: '2026-11-14T06:00:00Z', by: 'mac' })
    const out = macMerge(base, phone, mac)
    const bodies = readComments(out.text).map((c) => c.body)
    expect.soft(bodies.filter((b) => b === 'hand-written'), JSON.stringify(bodies)).toHaveLength(1)
    expect.soft(bodies.sort()).toEqual(['from mac', 'from phone', 'hand-written'])
  })
  it('M6 phone comment while the Mac edits the property just above the closing fence: no copy', () => {
    const base = '---\ntitle: P\nstatus: draft\n---\nBody\n'
    const phone = added(base, 'from phone')
    const mac = base.replace('status: draft', 'status: done')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy, out.how).toBeUndefined()
    expect.soft(out.text).toContain('status: done')
    expect.soft(readComments(out.text).map((c) => c.body)).toEqual(['from phone'])
  })
  it('M7 phone ticks a task while the Mac ticks the task right below it: both ticks, no copy', () => {
    const base = '- [ ] One\n- [ ] Two\n'
    const phone = ticked(base, '- [ ] One')
    const mac = base.replace('- [ ] Two', '- [x] Two')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy, out.how).toBeUndefined()
    expect.soft(out.text).toBe('- [x] One\n- [x] Two\n')
  })
  it('M8 phone answers card NC-1 while the Mac edits the card TEXT right above its line: no copy', () => {
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\n'
    const phone = applyOps(base, [{ kind: 'review', id: 'NC-1', review: { at: '2026-11-14T06:01:00.000Z', rating: 'good' } }]).content
    const mac = base.replace('Q\n', 'Q edited\n')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy, out.how).toBeUndefined()
  })
  it('M9 phone answers NC-1 while the Mac edits the line right BELOW the card line: no copy', () => {
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\nNext para\n'
    const phone = applyOps(base, [{ kind: 'review', id: 'NC-1', review: { at: '2026-11-14T06:01:00.000Z', rating: 'good' } }]).content
    const mac = base.replace('Next para', 'Next para edited')
    const out = macMerge(base, phone, mac)
    expect.soft(out.copy, out.how).toBeUndefined()
  })
  it('M10 phone comments on a page with NO front matter that has a "---" line (a card back), the Mac edits the first line: the Mac merge does not throw', () => {
    const base = '# Words\n\n```card\nHola\n---\nHello\n```\n<!-- card: NC-1 -->\n'
    const phone = added(base, 'from phone')
    const mac = base.replace('# Words', '# Words edited')
    let out: ReturnType<typeof macMerge> | null = null
    expect.soft(() => (out = macMerge(base, phone, mac)), 'resolve.ts settle -> mergePageComments').not.toThrow()
    if (out !== null) expect.soft(readComments((out as { text: string }).text).map((c) => c.body)).toEqual(['from phone'])
  })
})
