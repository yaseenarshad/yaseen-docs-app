import { describe, expect, it } from 'vitest'
import { createAnswers } from '../answers/answers'
import { lazySync } from '../app/lazySync'
import { createSyncEngine } from '../sync/engine'
import { BRANCH, REPO, pageText, syncSetup } from '../sync/testing'
import { followAnswers } from './followAnswers'

/**
 * YAZ-5078: the app shell makes ONE answer list with the engine and wires it to the page (3C's result comment: the
 * app must call the list's own `setVisible` and `online`, or the background send does not run). The real lazy sync,
 * the real engine and list on the fake GitHub, and a fake page.
 */
function fakePage() {
  const listeners = new Map<string, Set<() => void>>()
  const on = (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn)
  const off = (type: string, fn: () => void) => void listeners.get(type)?.delete(fn)
  const page = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: on, removeEventListener: off }
  const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn())
  return { page: page as unknown as Document & Window, fire, count: (type: string) => listeners.get(type)?.size ?? 0 }
}

describe('the shell wires the answer list (decision 4)', () => {
  it('review() gives the engine and ONE list; hidden sends at once; `online` sends at once; after "Sign in again" too', async () => {
    const s = await syncSetup({ '.yaseendocs/review.json': '{}', 'a.md': pageText('A', 'P-1', ['NC-2', 'NC-3']) })
    const doc = fakePage()
    const setHidden = (hidden: boolean) => void ((doc.page as { visibilityState: DocumentVisibilityState }).visibilityState = hidden ? 'hidden' : 'visible')
    const win = fakePage()
    const sync = lazySync(s.store, s.tokens, async () => ({
      createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => s.remote, lock: (_n, fn) => fn(), yieldToUi: async () => {} }),
      followPage: () => () => undefined,
      createAnswers: (o) => createAnswers({ ...o, yieldToUi: async () => {} }),
      followAnswers: (answers) => followAnswers(answers, doc.page, win.page),
    }))
    expect(await sync.review!()).toBeNull() // no vault open yet
    await sync.open({ repo: REPO, branch: BRANCH, addedAt: 0 })
    const link = (await sync.review!())!
    expect(link).not.toBeNull()
    expect(await sync.review!()).toEqual(link) // the same list each time
    await link.answers.idle()
    expect(doc.count('visibilitychange')).toBe(1)
    expect(win.count('online')).toBe(1)

    const writes = () => s.github.calls.filter((c) => c.method === 'PATCH').length
    const add = (minute: number) => link.answers.add([{ op: { kind: 'review', id: 'NC-2', review: { at: `2026-11-14T06:0${minute}Z`, rating: 'good' } }, path: 'a.md', title: 'NC-2' }])

    // Hidden: at once, not 5 s later.
    await add(1)
    setHidden(true)
    doc.fire('visibilitychange')
    await link.answers.idle()
    expect(writes()).toBe(1)

    // No signal, then the `online` event: at once.
    s.github.offline = true
    await add(2)
    setHidden(false)
    doc.fire('visibilitychange')
    await link.answers.idle()
    expect(writes()).toBe(1)
    s.github.offline = false
    win.fire('online')
    await link.answers.idle()
    expect(writes()).toBe(2)

    // A refused token (401) keeps the answer, and no poll sends it again; after "Sign in again" the shell's `syncNow`
    // sends it (3C: "engine.syncNow(), then answers.sendNow()").
    s.github.interrupt = () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    await add(3)
    setHidden(true)
    doc.fire('visibilitychange')
    await link.answers.idle()
    expect(link.answers.state().problem).toBe('UNAUTHORIZED')
    expect(link.answers.waiting()).toHaveLength(1)
    s.github.interrupt = null
    await sync.syncNow()
    await link.answers.idle()
    expect(link.answers.waiting()).toHaveLength(0)
    expect(writes()).toBe(3)
    await sync.open(null)
  })
})
