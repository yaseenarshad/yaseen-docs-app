import { readComments } from '@shared/comments'
import { createAnswers } from '../answers/answers'
import { saveAccount } from '../auth/account'
import { githubClient, type FetchLike } from '../github/client'
import { vaultId, type PhoneVault } from '../store'
import { createSyncEngine } from '../sync/engine'
import { githubRemote } from '../sync/githubRemote'
import { BRANCH, REPO, fakeClock, syncSetup } from '../sync/testing'
import type { CommentsPort } from './bridge'

/**
 * Test help for YAZ-5461: one made-up vault on the fake GitHub (3B's `syncSetup`), the engine on a fake clock, the ONE
 * answer list with its comment list (`createAnswers` → `withComments`), and a `fetch` that a test can wrap (`hook`):
 * the "Mac" writes before the phone's ref move, an answer is lost, the signal goes. No test calls the real API.
 */
export const VAULT_ROW: PhoneVault = { repo: REPO, branch: BRANCH, addedAt: 0 }
export const VAULT = vaultId(VAULT_ROW)
export const PAGE = 'notes/plan.md'
export const PLAN = '---\ntitle:   Plan\ntags: [a,b]\n---\n# Plan\n\nThe body.\n'

export type Hook = (url: string, init: RequestInit, forward: () => Promise<Response>) => Promise<Response>

export async function commentsSetup(files: Record<string, string> = { [PAGE]: PLAN }, options: { account?: boolean } = {}) {
  const s = await syncSetup(files)
  const clock = fakeClock()
  let hook: Hook | null = null
  const fetch: FetchLike = (url, init) => (hook === null ? s.github.fetch(url, init) : hook(url, init, () => s.github.fetch(url, init)))
  if (options.account !== false) await saveAccount(s.store, VAULT, { login: 'Yaseen', name: 'Yaseen A', avatarUrl: '', gists: 'no', expiresAt: null, checkedAt: 0 })
  const engine = createSyncEngine({ store: s.store, tokens: s.tokens, clock, yieldToUi: async () => {}, makeRemote: (v, token) => githubRemote(githubClient(token, { fetch, now: clock.now }), v.repo, v.branch) })
  const answers = createAnswers({ store: s.store, engine, clock, yieldToUi: async () => {} })
  await engine.open(VAULT_ROW)
  await engine.idle()
  await answers.idle()
  const port = answers.comments as CommentsPort
  const head = () => s.git.branches.get(BRANCH)!
  const remote = async (path = PAGE) => (await s.git.filesAt(head()))[path]
  const patches = () => s.github.calls.filter((c) => c.method === 'PATCH').length
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await engine.idle()
      await answers.idle()
    }
  }
  /** Moves the fake clock and waits for what its timers started. */
  const tick = async (ms: number) => {
    clock.advance(ms)
    await settle()
  }
  return {
    s,
    clock,
    engine,
    answers,
    port,
    head,
    remote,
    patches,
    settle,
    tick,
    /** The remote page's comments as the Mac reads them. */
    remoteComments: async (path = PAGE) => readComments((await remote(path)) ?? ''),
    setHook: (next: Hook | null) => void (hook = next),
    /** The "Mac" pushes a commit (a body edit, a comment of its own). */
    macPush: (files: Record<string, string | null>) => s.git.push(files),
  }
}

export const isPatch = (init: RequestInit) => (init.method ?? 'GET') === 'PATCH'
