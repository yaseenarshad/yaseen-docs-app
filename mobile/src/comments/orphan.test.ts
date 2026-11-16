import { describe, expect, it } from 'vitest'
import { readComments } from '@shared/comments'
import { TASKS_PAGE } from '../dev/taskFixtures'
import { answersPart, syncDot } from '../status/dot'
import { WHY_NOT_SENT } from '../status/NotSent'
import { taskCore, tickOf } from './taskWrite'
import { commentsSetup } from './testing'

/**
 * YAZ-5517 (sweep 1, M1): a comment or a tick that waits offline while the Mac moves or deletes its page is NEVER lost
 * without a word. A move the phone can be sure of (the same file bytes at one new path, or the page's own `id` at one
 * new path) takes the write with it; anything else keeps it as "couldn't be sent", counted by the dot, with its words.
 */
const PAGE = 'home/Weekend jobs.md'
const MOVED = 'moved/Weekend jobs.md'
const WITH_ID = TASKS_PAGE.replace('title: Weekend jobs\n', 'id: YAZ-77\ntitle: Weekend jobs\n')
const tick = (content: string) => tickOf(content, taskCore('- [ ] Buy seeds')!, 0, true)
const dotOf = (t: Awaited<ReturnType<typeof commentsSetup>>) => syncDot({ sync: { status: 'synced', problem: null }, answers: answersPart(t.answers.state(), []), online: true, token: { kind: 'none' } })

async function offlineWrites(page: string) {
  const t = await commentsSetup({ [PAGE]: page })
  t.s.github.offline = true
  await t.port.add({ path: PAGE, body: 'Will be orphaned', by: 'yaseen' })
  await t.port.add({ path: PAGE, body: '', task: tick(page) })
  await t.settle()
  expect(t.port.waiting(PAGE)).toHaveLength(2)
  return t
}

async function backOnline(t: Awaited<ReturnType<typeof commentsSetup>>) {
  t.s.github.offline = false
  t.answers.online()
  await t.settle()
  await t.answers.sendNow()
  await t.settle()
}

describe('outbox_commentOnDeletedOrMovedPage_staysCountedAndShowsItsWords', () => {
  it('the page is moved as it is (a git rename): the comment and the tick follow it to the new path', async () => {
    const t = await offlineWrites(TASKS_PAGE)
    await t.macPush({ [PAGE]: null, [MOVED]: TASKS_PAGE })
    await backOnline(t)
    const page = (await t.remote(MOVED))!
    expect(readComments(page).map((c) => c.body)).toEqual(['Will be orphaned'])
    expect(page).toContain('- [x] Buy seeds')
    expect(t.port.waiting()).toEqual([])
    expect(dotOf(t).words).toBe('Synced')
  })

  it('the page is moved AND edited on the Mac: its `id` finds it; the comment and the tick follow', async () => {
    const t = await offlineWrites(WITH_ID)
    await t.macPush({ [PAGE]: null, [MOVED]: WITH_ID.replace('# Weekend jobs\n', '# Weekend jobs\n\nEdited on the Mac.\n') })
    await backOnline(t)
    const page = (await t.remote(MOVED))!
    expect(readComments(page).map((c) => c.body)).toEqual(['Will be orphaned'])
    expect(page).toContain('- [x] Buy seeds')
    expect(page).toContain('Edited on the Mac.')
    expect(t.port.waiting()).toEqual([])
  })

  it('the page is deleted: both stay, "couldn\'t be sent", the dot is amber with the reason, the words are kept; Discard takes them', async () => {
    const t = await offlineWrites(TASKS_PAGE)
    const before = t.head()
    await t.macPush({ [PAGE]: null })
    await backOnline(t)
    expect(t.patches()).toBe(0)
    expect(t.head()).not.toBe(before)
    const kept = t.port.waiting()
    expect(kept.map((c) => [c.body, c.refused])).toEqual([
      ['Will be orphaned', 'gone'],
      ['', 'gone'],
    ])
    const dot = dotOf(t)
    expect(dot.state).toBe('pending')
    expect(dot.words).toBe("2 changes couldn't be sent: their page is gone")
    expect(dot.short).toBe('2 not sent')
    for (const c of kept) expect(await t.port.discard(c.id)).toBe(true)
    expect(dotOf(t).words).toBe('Synced')
  })

  it('notSent_pageCopiedTwiceWithSameId_saysCopy: a page copied to two places with its id is not "gone": "Its page has a copy with the same ID", kept with Copy and Discard (sweep2 nit 2)', async () => {
    const t = await offlineWrites(WITH_ID)
    await t.macPush({ [PAGE]: null, 'a/Weekend jobs.md': WITH_ID.replace('# Weekend jobs\n', '# Weekend jobs\n\nA.\n'), 'b/Weekend jobs.md': WITH_ID.replace('# Weekend jobs\n', '# Weekend jobs\n\nB.\n') })
    await backOnline(t)
    expect(readComments((await t.remote('a/Weekend jobs.md'))!)).toEqual([])
    expect(readComments((await t.remote('b/Weekend jobs.md'))!)).toEqual([])
    expect(t.port.waiting().map((c) => c.refused)).toEqual(['copies', 'copies'])
    expect(WHY_NOT_SENT.copies).toBe('Its page has a copy with the same ID.')
    const dot = dotOf(t)
    expect(dot.state).toBe('pending')
    expect(dot.words).toBe("2 changes couldn't be sent")
  })

  it('moved with no id AND edited: not certain, so not followed: kept as "couldn\'t be sent"', async () => {
    const t = await offlineWrites(TASKS_PAGE)
    await t.macPush({ [PAGE]: null, [MOVED]: TASKS_PAGE.replace('# Weekend jobs\n', '# Weekend jobs\n\nEdited.\n') })
    await backOnline(t)
    expect(readComments((await t.remote(MOVED))!)).toEqual([])
    expect(t.port.waiting().map((c) => c.refused)).toEqual(['gone', 'gone'])
    expect(dotOf(t).state).toBe('pending')
  })

  it('one comment on a deleted page: "1 comment couldn\'t be sent: its page is gone", and after a restart it is still counted', async () => {
    const t = await commentsSetup({ [PAGE]: TASKS_PAGE })
    t.s.github.offline = true
    await t.port.add({ path: PAGE, body: 'Kept words', by: 'yaseen' })
    await t.settle()
    await t.macPush({ [PAGE]: null })
    await backOnline(t)
    expect(dotOf(t).words).toBe("1 comment couldn't be sent: its page is gone")
    t.answers.stop()
    t.engine.stop()
    const { createSyncEngine } = await import('../sync/engine')
    const { createAnswers } = await import('../answers/answers')
    const { githubRemote } = await import('../sync/githubRemote')
    const { githubClient } = await import('../github/client')
    const engine = createSyncEngine({ store: t.s.store, tokens: t.s.tokens, clock: t.clock, yieldToUi: async () => {}, makeRemote: (v, token) => githubRemote(githubClient(token, { fetch: t.s.github.fetch }), v.repo, v.branch) })
    const answers = createAnswers({ store: t.s.store, engine, clock: t.clock })
    await engine.open({ repo: 'yaseen/vault', branch: 'main', addedAt: 0 })
    for (let i = 0; i < 4; i++) {
      await engine.idle()
      await answers.idle()
      await new Promise((r) => setTimeout(r, 0))
    }
    const dot = syncDot({ sync: { status: 'synced', problem: null }, answers: answersPart(answers.state(), []), online: true, token: { kind: 'none' } })
    expect(dot.words).toBe("1 comment couldn't be sent: its page is gone")
    expect(answers.comments!.waiting().map((c) => c.body)).toEqual(['Kept words'])
  })
})
