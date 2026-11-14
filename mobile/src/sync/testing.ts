import { githubClient } from '../github/client'
import { fakeGit, fakeGithub, type FakeGit, type FakeGithub } from '../github/testing'
import { memoryBackend, openVaultStore, tokenStoreOn, type TokenStore, type VaultStore } from '../store'
import type { Clock } from './engine'
import { githubRemote, type GithubRemote } from './githubRemote'

/**
 * Test help for 3B: a fake clock, and one scratch vault on the fake GitHub with a store and a token. No test calls the
 * real API. The fake answers as GitHub did in proof 1B (YAZ-5063).
 */
export const TOKEN = 'github_pat_11TESTTESTTEST_sync0000000000000000000000000000000000000000000000000000000000000'
export const REPO = 'yaseen/notes'
export const BRANCH = 'main'
export const VAULT = 'yaseen/notes@main'

export interface FakeClock extends Clock {
  /** Moves the time on and runs each timer that is due, in order. */
  advance(ms: number): void
  pending(): number
}

export function fakeClock(start = Date.UTC(2026, 10, 14, 6, 0, 0)): FakeClock {
  let time = start
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => time,
    setTimeout(fn, ms) {
      const id = next++
      timers.set(id, { at: time + Math.max(0, ms), fn })
      return id
    },
    clearTimeout(id) {
      timers.delete(id as number)
    },
    advance(ms) {
      const end = time + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        time = due[1].at
        due[1].fn()
      }
      time = end
    },
    pending: () => timers.size,
  }
}

export interface SyncSetup {
  github: FakeGithub
  git: FakeGit
  store: VaultStore
  tokens: TokenStore
  remote: GithubRemote
  /** Calls by kind, from the fake's log. */
  count(kind: 'ref' | 'tree' | 'blob' | 'write'): number
}

export async function syncSetup(files: Record<string, string | Uint8Array>, options: { access?: 'read' | 'write' } = {}): Promise<SyncSetup> {
  const git = await fakeGit(files, BRANCH)
  const github = fakeGithub({ tokens: { [TOKEN]: { login: 'yaseen', repos: { [REPO]: options.access ?? 'write' } } }, repos: [{ fullName: REPO, git }] })
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  await tokens.write(VAULT, TOKEN)
  const remote = githubRemote(githubClient(TOKEN, { fetch: github.fetch }), REPO, BRANCH)
  const count = (kind: 'ref' | 'tree' | 'blob' | 'write') =>
    github.calls.filter((c) =>
      kind === 'write' ? c.method !== 'GET' : c.method === 'GET' && c.url.includes(kind === 'ref' ? '/git/ref/' : kind === 'tree' ? '/git/trees/' : '/git/blobs/'),
    ).length
  return { github, git, store, tokens, remote, count }
}

/** A made-up card block: its fence, its text and its card line. */
export function card(id: string, text = `What is {{${id}}}?`): string {
  return `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${id} -->`
}

/** Made-up page text with cards, as the Mac writes it. */
export function pageText(title: string, id: string, cards: string[] = [], extra = ''): string {
  return `---\nid: ${id}\ntitle: ${title}\n---\n\n# ${title}\n\n${extra}${cards.map((c) => `${card(c)}\n\n`).join('')}`
}

/** A made-up card file (YAZ-5037): `kind: card`, its `title`, and one card. */
export function cardFileText(title: string, cardId: string): string {
  return `---\nkind: card\ntitle: ${title}\n---\n\n${card(cardId, `${title}\n---\nThe answer`)}\n`
}
