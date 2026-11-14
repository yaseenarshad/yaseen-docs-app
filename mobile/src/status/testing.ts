import type { AnswersEvent, AnswersState } from '../answers/answers'
import type { LostAnswer, WaitingAnswer } from '../answers/outbox'
import type { DotAnswers } from './useDotAnswers'

/** A fake of 3C's answer list, for the dot's screen tests and fixtures. It never touches the store or GitHub. */
export interface FakeAnswers extends DotAnswers {
  /** Changes the state (and the waiting list) and tells the listeners, as 3C's list does. */
  set(next: { waiting?: number; lost?: LostAnswer[]; sending?: boolean; problem?: AnswersState['problem']; retryAt?: number | null; lastSentAt?: number | null }): void
  discarded: number[]
  sendNowCalls: number
}

export const lostAnswer = (seq: number, title = 'Speed of light', rating: 'good' | 'again' = 'good', id = 'NC-17'): LostAnswer => ({
  seq,
  op: { kind: 'review', id, review: { at: '2026-11-13T11:01Z', rating } },
  path: 'cards/light.md',
  title,
  lostAt: 0,
})

/** `vault`: the open vault's id; the dot reads a list's state only when it is the open vault's (YAZ-5297). */
export function fakeAnswers(vault = 'yaseen/vault@main'): FakeAnswers {
  let state: AnswersState = { vault, waiting: 0, lost: [], sending: false, problem: null, retryAt: null, lastSentAt: null }
  let list: WaitingAnswer[] = []
  const listeners = new Set<(event: AnswersEvent) => void>()
  const emit = () => {
    for (const l of [...listeners]) l({ type: 'state', state: { ...state } })
  }
  const fake: FakeAnswers = {
    discarded: [],
    sendNowCalls: 0,
    async sendNow() {
      fake.sendNowCalls++
    },
    state: () => state,
    waiting: () => list,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async discard(seq) {
      fake.discarded.push(seq)
      const before = state.lost.length
      state = { ...state, lost: state.lost.filter((l) => l.seq !== seq) }
      emit()
      return state.lost.length < before
    },
    set(next) {
      if (next.waiting !== undefined)
        list = Array.from({ length: next.waiting }, (_, i) => ({ seq: i + 1, group: i + 1, op: { kind: 'review', id: `NC-${i + 1}`, review: { at: '2026-11-13T11:00Z', rating: 'good' } }, path: 'a.md', title: 'T', madeAt: 0 }))
      state = { ...state, ...next, waiting: list.length }
      emit()
    },
  }
  return fake
}
