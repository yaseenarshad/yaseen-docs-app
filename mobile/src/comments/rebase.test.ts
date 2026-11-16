import { describe, expect, it } from 'vitest'
import { cardRecords } from '@shared/cardLine'
import { applyOps } from '../answers/ops'
import { applyTask, taskCore, tickOf, type TaskTick } from './taskWrite'
import { applyComment } from './write'
import { commentsSetup, isPatch } from './testing'

/**
 * YAZ-5570: the phone's small writes (a tick, an answer on its card line, a comment) go again onto the Mac's newest
 * page by WHAT they meant: the same task (its text, the lines around it, its place), the card line by its ID, the
 * comment by its id. A Mac edit of another line never stops them; only the target line itself changed, gone, or two
 * lines that fit it the same do (the write stays on the phone, refused, never on another task). Made-up pages only.
 */
const tick = (content: string, line: string, checked: boolean, nth = 0): TaskTick => tickOf(content, taskCore(line)!, nth, checked)
const ticked = (content: string, t: TaskTick) => {
  const r = applyTask(content, t)
  if (r.kind !== 'ticked') throw new Error(`not ticked: ${JSON.stringify(r)}`)
  return r.content
}

describe('a tick goes again onto the Mac\'s newest page by its task', () => {
  it('M1: the Mac edited the NEXT line: the tick lands, the Mac\'s edit stays', () => {
    const base = '# List\n\n- [ ] One\n- [ ] Two\n'
    const mac = base.replace('- [ ] Two', '- [ ] Two edited')
    expect(ticked(mac, tick(base, '- [ ] One', true))).toBe('# List\n\n- [x] One\n- [ ] Two edited\n')
  })

  it('M7: the Mac ticked the task right below: both ticks', () => {
    const base = '- [ ] One\n- [ ] Two\n'
    const mac = base.replace('- [ ] Two', '- [x] Two')
    expect(ticked(mac, tick(base, '- [ ] One', true))).toBe('- [x] One\n- [x] Two\n')
  })

  it('the SAME line edited on the Mac: refused (the phone keeps the tick, nothing is written)', () => {
    const base = '- [ ] One\n- [ ] Two\n'
    const mac = base.replace('- [ ] One', '- [ ] One, later')
    expect(applyTask(mac, tick(base, '- [ ] One', true))).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('the Mac added a twin of the task in another section: the tapped task is ticked, not the twin', () => {
    const base = '# Home\n\n- [ ] Buy milk\n- [ ] Call mum\n\n# Shop\n\n- [ ] Bread\n'
    const mac = base.replace('- [ ] Bread\n', '- [ ] Bread\n- [ ] Buy milk\n')
    const out = ticked(mac, tick(base, '- [ ] Buy milk', true))
    expect(out).toBe('# Home\n\n- [x] Buy milk\n- [ ] Call mum\n\n# Shop\n\n- [ ] Bread\n- [ ] Buy milk\n')
  })

  it('the Mac added a twin ABOVE the tapped task: the tapped one (its neighbours, its place) is ticked', () => {
    const base = '# Week\n\n- [ ] Buy milk\n- [ ] Call mum\n'
    const mac = '# Plan\n\n- [ ] Buy milk\n\n# Week\n\n- [ ] Buy milk\n- [ ] Call mum\n'
    expect(ticked(mac, tick(base, '- [ ] Buy milk', true))).toBe('# Plan\n\n- [ ] Buy milk\n\n# Week\n\n- [x] Buy milk\n- [ ] Call mum\n')
  })

  it('the Mac took out the OTHER twin: the tapped one is ticked', () => {
    const base = '# A\n\n- [ ] Buy milk\n\n# B\n\n- [ ] Buy milk\n- [ ] Eggs\n'
    const mac = '# A\n\n# B\n\n- [ ] Buy milk\n- [ ] Eggs\n'
    expect(ticked(mac, tick(base, '- [ ] Buy milk', true, 1))).toBe('# A\n\n# B\n\n- [x] Buy milk\n- [ ] Eggs\n')
  })

  it('the Mac took out the TAPPED twin: refused, the other twin is never ticked', () => {
    const base = '# A\n\n- [ ] Buy milk\n\n# B\n\n- [ ] Buy milk\n- [ ] Eggs\n'
    const mac = '# A\n\n# B\n\n- [ ] Buy milk\n- [ ] Eggs\n'
    expect(applyTask(mac, tick(base, '- [ ] Buy milk', true, 0))).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('as many twins as before, but the Mac moved them: the tapped one by its neighbours, not the nth', () => {
    const base = '# A\n\n- [ ] Buy milk\n\n# B\n\n- [ ] Buy milk\n- [ ] Eggs\n'
    // The first twin (under A) is gone, and a new one is at the end: still two, and the 2nd is now the new one.
    const mac = '# A\n\n# B\n\n- [ ] Buy milk\n- [ ] Eggs\n\n# C\n\n- [ ] Buy milk\n'
    expect(ticked(mac, tick(base, '- [ ] Buy milk', true, 1))).toBe('# A\n\n# B\n\n- [x] Buy milk\n- [ ] Eggs\n\n# C\n\n- [ ] Buy milk\n')
  })

  it('the tapped line is gone and no twin has its neighbours: refused, never a guess', () => {
    const base = 'A\nB\n- [ ] T\nC\nD\n'
    const mac = '- [ ] T\nB\nX\nC\n- [ ] T\n'
    expect(applyTask(mac, tick(base, '- [ ] T', true))).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('identical twins in identical surroundings, one more added next to them: unclear which was tapped, refused', () => {
    const base = 'x\n\n- [ ] Same\n- [ ] Same\n\ny\n'
    const mac = 'x\n\n- [ ] Same\n- [ ] Same\n- [ ] Same\n\ny\n'
    expect(applyTask(mac, tick(base, '- [ ] Same', true, 1))).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('the Mac added a twin right next to the tapped task: the text cannot tell which is which, refused', () => {
    const base = '# Week\n\n- [ ] Buy milk\n- [ ] Eggs\n\n# Later\n\n- [ ] Buy milk\n'
    const mac = base.replace('- [ ] Buy milk\n- [ ] Eggs', '- [ ] Buy milk\n- [ ] Buy milk\n- [ ] Eggs')
    expect(applyTask(mac, tick(base, '- [ ] Buy milk', true, 0))).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('a tick stored before YAZ-5570 (no twins): the old rule, nth of the same count', () => {
    const base = '- [ ] A\n- [ ] A\n'
    const old: TaskTick = { core: '- [ ] A', nth: 1, of: 2, checked: true }
    expect(ticked(base, old)).toBe('- [ ] A\n- [x] A\n')
    expect(applyTask(base + '- [ ] A\n', old)).toEqual({ kind: 'refused', why: 'changed' })
  })

  it('the race on the fake GitHub: the Mac adds a twin just before the ref move; the phone ticks the tapped task on the fresh page', async () => {
    const PAGE = 'home/jobs.md'
    const base = '---\ntitle: Jobs\n---\n# Today\n\n- [ ] Water plants\n- [ ] Post letter\n'
    const mac = base.replace('# Today\n', '# Tomorrow\n\n- [ ] Water plants\n\n# Today\n')
    const t = await commentsSetup({ [PAGE]: base })
    let raced = false
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', task: tick(base, '- [ ] Water plants', true) })
    await t.settle()
    expect(await t.remote(PAGE)).toBe(mac.replace('# Today\n\n- [ ] Water plants', '# Today\n\n- [x] Water plants'))
    expect(t.port.waiting(PAGE)).toEqual([])
  })
})

describe('an answer and a comment go again onto the Mac\'s newest page', () => {
  it('M9: the Mac edited the line right BELOW the card line: the answer lands on the card line found by ID', () => {
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\nNext para\n'
    const mac = base.replace('Next para', 'Next para edited')
    const out = applyOps(mac, [{ kind: 'review', id: 'NC-1', review: { at: '2026-11-14T06:01:00.000Z', rating: 'good' } }]).content
    expect(out).toBe('```card\nQ\n```\n<!-- card: NC-1, 2026-11-14T06:01:00.000Z good -->\nNext para edited\n')
    expect(cardRecords(out)[0]!.reviews).toHaveLength(1)
  })

  it('a comment while the Mac edited the line next to the front matter: both kept', () => {
    const base = '---\ntitle: P\nstatus: draft\n---\nBody\n'
    const mac = base.replace('Body', 'Body edited')
    const r = applyComment(mac, { id: 'abcd0001', at: '2026-11-14T06:00:00Z', by: 'yaseen', body: 'from phone' })
    expect(r.kind).toBe('added')
    if (r.kind === 'added') expect(r.content).toContain('Body edited')
  })
})
