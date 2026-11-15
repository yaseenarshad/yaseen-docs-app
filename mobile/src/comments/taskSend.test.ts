import { describe, expect, it } from 'vitest'
import { TASKS_PAGE } from '../dev/taskFixtures'
import { answersPart, syncDot } from '../status/dot'
import { taskCore, tickOf, type TaskTick } from './taskWrite'
import { commentsSetup, isPatch } from './testing'

/**
 * YAZ-5494: a check box tick on the comments' safe path (YAZ-5461), on the fake GitHub with a made-up vault: the fresh
 * bytes, the same task found again, one commit with compare-and-swap (`PATCH force: false`), the race, no signal, a
 * lost answer, the dot.
 */
const PAGE = 'home/Weekend jobs.md'
const tickFor = (content: string, line: string, checked: boolean, nth = 0): TaskTick => tickOf(content, taskCore(line)!, nth, checked)
const diff = (a: string, b: string) => [...a].flatMap((c, i) => (c === b[i] ? [] : [[i, c, b[i]]]))

describe('a tick from the phone reaches the page', () => {
  it('one commit; one byte changed (the box); the front matter, spacing and the rest stay byte for byte', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '  - [ ] Sharpen the blade', true) })
    await t.settle()
    const page = (await t.remote(PAGE))!
    expect(diff(TASKS_PAGE, page)).toEqual([[TASKS_PAGE.indexOf('  - [ ] Sharpen') + 5, ' ', 'x']])
    expect(t.patches()).toBe(1)
    expect(t.s.github.calls.some((c) => c.method === 'PATCH' && c.url.includes('force=true'))).toBe(false)
    expect(t.port.waiting()).toEqual([])
    expect((await t.s.store.read('yaseen/vault@main', PAGE))?.content).toBe(page)
  })

  it('CRLF page: the tick changes the box only, the line ends stay', async () => {
    const crlf = TASKS_PAGE.replace(/\n/g, '\r\n')
    const t = await commentsSetup({ [PAGE]: crlf })
    await t.port.add({ path: PAGE, body: '', task: tickFor(crlf, '> - [x] Return the drill', false) })
    await t.settle()
    const page = (await t.remote(PAGE))!
    expect(diff(crlf, page)).toHaveLength(1)
    expect(page).toContain('> - [ ] Return the drill\r\n')
  })

  it('the race: the Mac edits elsewhere just before the ref move; the phone re-reads and ticks the same task on the fresh page', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    let raced = false
    const mac = TASKS_PAGE.replace('# Weekend jobs\n', '# Weekend jobs\n\nWritten on the Mac.\n- [ ] A new task\n')
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '1. [ ] Sweep the shed', true) })
    await t.settle()
    const page = (await t.remote(PAGE))!
    expect(diff(mac, page)).toHaveLength(1)
    expect(page).toContain('1. [x] Sweep the shed')
    expect(t.patches()).toBe(2)
  })

  it('the race where the Mac changed that task: refused, nothing written; the tick stays marked for the page to say so', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    const mac = TASKS_PAGE.replace('- [ ] Buy seeds', '- [ ] Buy seeds and bulbs')
    let raced = false
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '- [ ] Buy seeds', true) })
    await t.settle()
    expect(await t.remote(PAGE)).toBe(mac)
    // The first ref move was refused (the branch moved); the fresh page no longer has the task: no second commit.
    expect(t.patches()).toBe(1)
    expect(t.port.waiting(PAGE)).toMatchObject([{ refused: 'changed' }])
    expect(t.answers.state().comments).toBe(0)
  })

  it('no signal: the tick waits in IndexedDB, the dot says "1 check box waiting"; the signal back sends it once', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    t.s.github.offline = true
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '- [ ] Buy seeds', true) })
    await t.settle()
    expect(t.port.waiting(PAGE)).toHaveLength(1)
    expect(await t.s.store.getState('yaseen/vault@main', 'comments')).toMatchObject({ v: 1, waiting: [{ task: { core: '- [ ] Buy seeds', checked: true } }] })
    const state = t.answers.state()
    expect([state.comments, state.ticks]).toEqual([1, 1])
    const dot = syncDot({ sync: { status: 'synced', problem: null }, answers: answersPart(state, []), online: true, token: { kind: 'none' } as never })
    expect(dot.words).toBe('1 check box waiting')
    t.s.github.offline = false
    t.answers.online()
    await t.settle()
    expect(await t.remote(PAGE)).toContain('- [x] Buy seeds')
    expect(t.answers.state().comments).toBe(0)
  })

  it('the answer of the ref move is lost: the retry finds the box ticked and writes nothing again (no double toggle)', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    let lose = true
    t.setHook(async (_url, init, forward) => {
      const res = await forward()
      if (isPatch(init) && lose) {
        lose = false
        throw new TypeError('Load failed')
      }
      return res
    })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '- [ ] Buy seeds', true) })
    await t.settle()
    expect(t.port.waiting()).toHaveLength(1)
    t.answers.online()
    await t.settle()
    expect(await t.remote(PAGE)).toContain('- [x] Buy seeds')
    expect(t.patches()).toBe(1)
    expect(t.port.waiting()).toEqual([])
  })

  it('after a lost reply, a retry whose commit is already in the branch history writes nothing (YAZ-5513, W3)', async () => {
    // The tick reaches GitHub, its answer is lost; the Mac unticks it (a later change) before the retry.
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    let lose = true
    t.setHook(async (_url, init, forward) => {
      const res = await forward()
      if (isPatch(init) && lose) {
        lose = false
        await t.macPush({ [PAGE]: TASKS_PAGE })
        throw new TypeError('Load failed')
      }
      return res
    })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '- [ ] Buy seeds', true) })
    await t.settle()
    t.setHook(null)
    t.answers.online()
    await t.settle()
    // The retry finds its own commit under the Mac's: done by someone else after it, so it writes nothing.
    expect(await t.remote(PAGE)).toBe(TASKS_PAGE)
    expect(t.patches()).toBe(1)
    expect(t.port.waiting()).toEqual([])
  })

  it('a lost answer whose commit never reached the branch (GitHub refused the move): the retry still ticks', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    let lose = true
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && lose) {
        lose = false
        // The commit object was made; the move never reached GitHub.
        throw new TypeError('Load failed')
      }
      return forward()
    })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '- [ ] Buy seeds', true) })
    await t.settle()
    t.setHook(null)
    t.answers.online()
    await t.settle()
    expect(await t.remote(PAGE)).toContain('- [x] Buy seeds')
    expect(t.port.waiting()).toEqual([])
  })

  it('a tick then an untick before the send: the page ends as it began, and no commit is made', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    t.s.github.offline = true
    const on = tickFor(TASKS_PAGE, '+ [ ] Water the beans', true)
    await t.port.add({ path: PAGE, body: '', task: on })
    await t.port.add({ path: PAGE, body: '', task: { ...on, checked: false } })
    t.s.github.offline = false
    t.answers.online()
    await t.settle()
    expect(await t.remote(PAGE)).toBe(TASKS_PAGE)
    expect(t.patches()).toBe(0)
    expect(t.port.waiting()).toEqual([])
  })

  it('needs no account: a tick is signed by nothing, so it goes when the phone knows no GitHub login', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE }, { account: false })
    await t.port.add({ path: PAGE, body: '', task: tickFor(TASKS_PAGE, '- [ ] Buy seeds', true) })
    await t.settle()
    expect(await t.remote(PAGE)).toContain('- [x] Buy seeds')
  })
})
