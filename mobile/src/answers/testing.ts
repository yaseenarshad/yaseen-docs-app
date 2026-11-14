import { cardRecords } from '@shared/cardLine'
import { githubClient, type FetchLike } from '../github/client'
import type { PhoneVault } from '../store'
import { createSyncEngine } from '../sync/engine'
import { githubRemote } from '../sync/githubRemote'
import { BRANCH, REPO, cardFileText, fakeClock, pageText, syncSetup } from '../sync/testing'
import { createAnswers, type AnswersEvent } from './answers'
import type { CardOp } from './ops'

/**
 * Test help for 3C: one scratch vault on the fake GitHub (3B's `syncSetup`), its engine on a fake clock, synced once,
 * and the answer list on top. No test calls the real API.
 */
export const VAULT_ROW: PhoneVault = { repo: REPO, branch: BRANCH, addedAt: 0 }
export const at = (minute: number) => `2026-11-14T06:${String(minute).padStart(2, '0')}Z`
export const answer = (id: string, minute: number): CardOp => ({ kind: 'review', id, review: { at: at(minute), rating: 'good' } })
export const FILES = { 'a.md': pageText('A', 'NC-1', ['NC-2', 'NC-3']), 'cards/light-nc-17.md': cardFileText('Speed of light', 'NC-17') }

export async function answersSetup(options: { files?: Record<string, string>; fetch?: (s: Awaited<ReturnType<typeof syncSetup>>) => FetchLike } = {}) {
  const s = await syncSetup(options.files ?? FILES)
  const store = s.store
  const clock = fakeClock()
  const fetch = options.fetch?.(s) ?? s.github.fetch
  const engine = createSyncEngine({ store, tokens: s.tokens, clock, yieldToUi: async () => {}, makeRemote: (v, token) => githubRemote(githubClient(token, { fetch, now: clock.now }), v.repo, v.branch) })
  const answers = createAnswers({ store, engine, clock, yieldToUi: async () => {} })
  const events: AnswersEvent[] = []
  answers.subscribe((e) => events.push(e))
  await engine.open(VAULT_ROW)
  await engine.idle()
  await answers.idle()
  const head = () => s.git.branches.get(BRANCH)!
  const commits = () => s.github.calls.filter((c) => c.method === 'PATCH').length
  const remoteReviews = async (path = 'a.md', id = 'NC-2') => cardRecords((await s.git.filesAt(head()))[path]).find((c) => c.id === id)!.reviews.map((r) => r.at)
  const add = (...ops: CardOp[]) => answers.add(ops.map((op) => ({ op, path: 'a.md', title: `Title ${op.id}` })))
  /** Moves the fake clock and waits for what its timers started. */
  const tick = async (ms: number) => {
    clock.advance(ms)
    await engine.idle()
    await answers.idle()
  }
  return { s, store, clock, engine, answers, events, head, commits, remoteReviews, add, tick }
}

