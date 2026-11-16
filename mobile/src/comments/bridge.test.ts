import { describe, expect, it } from 'vitest'
import { answersPart, syncDot } from '../status/dot'
import { memoryBackend, openVaultStore } from '../store'
import { withComments } from './bridge'
import { COMMENTS_STATE, type CommentBook } from './outbox'
import type { Answers, AnswersState } from '../answers/answers'

/** YAZ-5461: the comment list rides on the ONE answer list: the dot counts it; its writer loads only when used. */
const VAULT = 'yaseen/vault@main'
const IDLE_ANSWERS: AnswersState = { vault: VAULT, waiting: 0, lost: [], sending: false, problem: null, retryAt: null, lastSentAt: null }

function fakes() {
  const engineListeners = new Set<(e: { type: 'state'; state: { vault: string | null; status: string } }) => void>()
  const engine = {
    state: () => ({ vault: VAULT, status: 'synced' }),
    subscribe: (l: (e: never) => void) => (engineListeners.add(l as never), () => engineListeners.delete(l as never)),
    lane: async () => null,
  }
  const answers = {
    state: () => IDLE_ANSWERS,
    subscribe: () => () => {},
    sendNow: async () => {},
    setVisible: () => {},
    online: () => {},
    idle: async () => {},
    stop: () => {},
  } as unknown as Answers
  return { engine, answers }
}

describe('the bridge', () => {
  it('no comment waits: the writer chunk is not loaded at the start', async () => {
    const store = await openVaultStore(memoryBackend())
    const { engine, answers } = fakes()
    let loads = 0
    withComments(answers, { store, engine: engine as never }, async () => (loads++, import('./sender')))
    await new Promise((r) => setTimeout(r, 10))
    expect(loads).toBe(0)
  })

  it('a comment waits in the stored list: the writer loads at the start, and the dot counts it as waiting', async () => {
    const store = await openVaultStore(memoryBackend())
    const book: CommentBook = { v: 1, waiting: [{ id: 'a1b2c3d4', path: 'p.md', body: 'Approved', at: '2026-11-14T06:00:00Z', by: 'yaseen', madeAt: 0, notBefore: 0 }] }
    await store.setState(VAULT, COMMENTS_STATE, book)
    const { engine, answers } = fakes()
    let loads = 0
    const both = withComments(answers, { store, engine: engine as never }, async () => (loads++, import('./sender')))
    // The first import of the writer's chunk takes a moment in Vitest: wait for the state, not for a fixed time.
    for (let i = 0; i < 200 && both.state().comments !== 1; i++) await new Promise((r) => setTimeout(r, 10))
    expect(loads).toBe(1)
    expect(both.state().comments).toBe(1)
    const dot = syncDot({ sync: { status: 'synced', problem: null }, answers: answersPart(both.state(), []), online: true, token: { kind: 'none' } as never })
    expect(dot).toMatchObject({ state: 'pending', words: '1 comment waiting', reason: 'waiting' })
    const offline = syncDot({ sync: { status: 'synced', problem: null }, answers: answersPart(both.state(), []), online: false, token: { kind: 'none' } as never })
    expect(offline.words).toBe('1 comment waiting · no signal')
  })

  it('the dot words: answers alone keep their words; answers and comments say how many wait', () => {
    const waiting = [{ seq: 1, group: 1, op: { kind: 'review', id: 'NC-1', review: { at: 'x', rating: 'good' } }, path: 'a.md', title: 'A', madeAt: 0 }] as never
    const dot = (comments: number) => syncDot({ sync: { status: 'synced', problem: null }, answers: answersPart({ ...IDLE_ANSWERS, comments }, waiting), online: true, token: { kind: 'none' } as never }).words
    expect(dot(0)).toBe('1 answer waiting')
    expect(dot(2)).toBe('3 waiting')
  })
})
