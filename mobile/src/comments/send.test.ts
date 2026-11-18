import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { addComment } from '@shared/comments'
import { PAGE, PLAN, commentsSetup, isPatch } from './testing'

/** YAZ-5461: the comment send on the answer list's safe path: fresh bytes, compare-and-swap, a queue that loses nothing. */
describe('a comment from the phone reaches the page (fake GitHub, made-up vault)', () => {
  it('a typed comment: one commit; only the comments entry changed; signed with the login; the local copy has it', async () => {
    const t = await commentsSetup()
    const made = await t.port.add({ path: PAGE, body: 'Looks good', by: 'yaseen' })
    await t.settle()
    const page = await t.remote()
    // The id is random hex (`newCommentId`); one like `38110107` reads as a NUMBER in YAML, so the writer quotes it
    // (as in cardFile.test.ts, YAZ-5516). The test expects the same, so it passes for every id (YAZ-5784).
    const idText = typeof parse(`id: ${made.id}`).id === 'string' ? made.id : `"${made.id}"`
    expect(page).toBe(`---\ntitle:   Plan\ntags: [a,b]\ncomments:\n  - id: ${idText}\n    n: 1\n    at: 2026-11-14T06:00:00Z\n    by: yaseen\n    body: Looks good\n---\n# Plan\n\nThe body.\n`)
    expect(t.patches()).toBe(1)
    expect(t.port.waiting()).toEqual([])
    // The pass after the commit: the stored copy (what the page view reads) holds it at once.
    expect((await t.s.store.read('yaseen/vault@main', PAGE))?.content).toBe(page)
    expect(t.answers.state().comments).toBe(0)
  })

  it('the race: the Mac adds a comment and edits the body just before the phone moves the ref; the phone re-reads and re-applies; #2 is taken on the fresh page', async () => {
    const t = await commentsSetup()
    let raced = false
    t.setHook(async (url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        const mac = addComment(PLAN.replace('The body.', 'The body, edited on the Mac.'), 'From the Mac', { id: 'mac00001', at: '2026-11-14T05:59:00Z', by: 'yaseen-arshad' })
        await t.macPush({ [PAGE]: mac })
      }
      return forward()
    })
    const made = await t.port.add({ path: PAGE, body: 'From the phone', by: 'yaseen' })
    await t.settle()
    const comments = await t.remoteComments()
    expect(comments.map((c) => [c.id, c.n, c.body])).toEqual([
      ['mac00001', 1, 'From the Mac'],
      [made.id, 2, 'From the phone'],
    ])
    expect(await t.remote()).toContain('The body, edited on the Mac.')
    // Two ref moves were tried: the refused one (422 not a fast forward) and the one on the fresh page. No force push.
    expect(t.patches()).toBe(2)
    expect(t.s.github.calls.some((c) => c.method === 'PATCH' && c.url.includes('force=true'))).toBe(false)
  })

  it('offline: the comment waits (kept in IndexedDB), the dot counts it; the signal back sends it once', async () => {
    const t = await commentsSetup()
    t.s.github.offline = true
    await t.port.add({ path: PAGE, body: 'Approved', by: 'yaseen' })
    await t.settle()
    expect(t.port.waiting(PAGE)).toHaveLength(1)
    expect(t.answers.state().comments).toBe(1)
    expect(await t.s.store.getState('yaseen/vault@main', 'comments')).toMatchObject({ v: 1, waiting: [{ body: 'Approved' }] })
    t.s.github.offline = false
    t.answers.online()
    await t.settle()
    expect((await t.remoteComments()).map((c) => c.body)).toEqual(['Approved'])
    expect(t.answers.state().comments).toBe(0)
  })

  it('the answer of the ref move is lost: the retry finds the comment on the page and posts nothing twice', async () => {
    const t = await commentsSetup()
    let lose = true
    t.setHook(async (_url, init, forward) => {
      const res = await forward()
      if (isPatch(init) && lose) {
        lose = false
        throw new TypeError('Load failed')
      }
      return res
    })
    const made = await t.port.add({ path: PAGE, body: 'Once', by: 'yaseen' })
    await t.settle()
    expect(t.port.waiting()).toHaveLength(1) // the phone does not know GitHub has it
    t.answers.online()
    await t.settle()
    expect((await t.remoteComments()).map((c) => c.id)).toEqual([made.id])
    expect(t.patches()).toBe(1)
    expect(t.port.waiting()).toEqual([])
  })

  it('a closed app: the stored comment goes at the next start, with no tap (the sender loads because the list is not empty)', async () => {
    const t = await commentsSetup()
    t.s.github.offline = true
    await t.port.add({ path: PAGE, body: 'Kept', by: 'yaseen' })
    await t.settle()
    t.answers.stop()
    t.engine.stop()
    t.s.github.offline = false
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
    expect((await t.remoteComments()).map((c) => c.body)).toEqual(['Kept'])
  })

  it('a page whose comments is not a comment list: refused, nothing written, the words kept with the reason', async () => {
    const t = await commentsSetup({ [PAGE]: '---\ncomments: see the doc\n---\nBody\n' })
    const before = t.head()
    await t.port.add({ path: PAGE, body: 'Hello', by: 'yaseen' })
    await t.settle()
    expect(t.head()).toBe(before)
    expect(t.port.waiting(PAGE)).toMatchObject([{ body: 'Hello', refused: 'foreign' }])
    expect(t.answers.state().comments).toBe(0)
    expect(await t.port.discard(t.port.waiting(PAGE)[0].id)).toBe(true)
  })

  it('"Approved" in one tap waits out its Undo: Undo inside 4 s posts nothing; left alone it posts after 4 s', async () => {
    const t = await commentsSetup()
    const undone = await t.port.add({ path: PAGE, body: 'Approved', by: 'yaseen', holdMs: 4000 })
    await t.tick(2000)
    expect(t.patches()).toBe(0)
    expect(await t.port.undo(undone.id)).toBe(true)
    await t.tick(5000)
    expect(t.patches()).toBe(0)
    await t.port.add({ path: PAGE, body: 'Approved', by: 'yaseen', holdMs: 4000 })
    await t.tick(3999)
    expect(t.patches()).toBe(0)
    await t.tick(1)
    expect((await t.remoteComments()).map((c) => c.body)).toEqual(['Approved'])
  })

  it('no account kept on the phone: the comment waits unsigned (NO_LOGIN) and is never posted without its `by`', async () => {
    const t = await commentsSetup(undefined, { account: false })
    await t.port.add({ path: PAGE, body: 'Who am I', holdMs: 0 })
    await t.settle()
    expect(t.patches()).toBe(0)
    expect(t.port.waiting(PAGE)).toHaveLength(1)
    const { saveAccount } = await import('../auth/account')
    await saveAccount(t.s.store, 'yaseen/vault@main', { login: 'Yaseen', name: null, avatarUrl: '', gists: 'no', expiresAt: null, checkedAt: 0 })
    await t.answers.sendNow()
    await t.settle()
    expect((await t.remoteComments()).map((c) => c.by)).toEqual(['yaseen'])
  })
})
