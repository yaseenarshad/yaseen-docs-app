/**
 * "Connect your phone" (YAZ-5098), the Mac side: the code's text, its QR grid, and the repo it names. No real
 * keychain, git or GitHub: the secrets store is a fake, the repo facts are a fake. The QR encoder is the real `qr`
 * 0.7.2, and the reader is the phone's own (`qr/decode.js`, YAZ-5077), so the round trip is the real one.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeQR } from 'qr/decode.js'
import { parseScanCode } from '@shared/scanCode'
import { paintQr, QR_QUIET } from '@shared/qrPaint'
import type { PhoneCodeAnswer } from '@shared/types'
import { GITHUB_TOKEN_SECRET } from '@shared/types'
import type { Secrets } from './secrets'
import { buildPhoneCode, encodeQr, repoOfRemote, type PhoneCodeDeps, type RepoFactsForPhone } from './phoneCode'

const TOKEN = 'github_pat_EXAMPLE0' + 'x'.repeat(74)

/** The secrets store, in memory (no file, no Keychain). */
function fakeSecrets(values: Record<string, string> = {}): Secrets {
  const v = { ...values }
  return {
    set: async (name, value) => {
      if (value === null) delete v[name]
      else v[name] = value
    },
    has: async (name) => v[name] !== undefined,
    read: async (name) => v[name] ?? null,
  }
}

const GITHUB_VAULT: RepoFactsForPhone = { isRepo: true, remoteUrl: 'git@github.com:yaseen/vault.git', branch: 'main' }

function deps(secrets: Secrets, facts: RepoFactsForPhone | null = GITHUB_VAULT): PhoneCodeDeps {
  return { readToken: () => secrets.read(GITHUB_TOKEN_SECRET), repoFacts: async () => facts, encode: encodeQr }
}

/** What the renderer does with the grid (`paintQr` on its canvas), as RGBA pixels: a 2D context that records each square. */
function pixelsOf(grid: readonly (readonly boolean[])[], scale = 5) {
  const side = (grid.length + 2 * QR_QUIET) * scale
  const data = new Uint8ClampedArray(side * side * 4)
  const ctx = {
    fillStyle: '' as unknown,
    fillRect(x: number, y: number, w: number, h: number) {
      const v = this.fillStyle === '#000' ? 0 : 255
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const i = (yy * side + xx) * 4
          data[i] = data[i + 1] = data[i + 2] = v
          data[i + 3] = 255
        }
    },
  }
  expect(paintQr(ctx, grid, scale)).toBe(side)
  return { width: side, height: side, data }
}

const consoleCalls: unknown[][] = []
beforeEach(() => {
  consoleCalls.length = 0
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args) => void consoleCalls.push(args))
})
afterEach(() => {
  // The token is never in a log line, whatever the test did.
  expect(JSON.stringify(consoleCalls)).not.toContain('github_pat_')
  vi.restoreAllMocks()
})

describe("repoOfRemote: the vault's repo from its git remote `origin` (round 16: a vault is the whole repo)", () => {
  it.each([
    ['https://github.com/yaseen/vault', 'yaseen/vault'],
    ['https://github.com/yaseen/vault.git', 'yaseen/vault'],
    ['https://github.com/yaseen/vault/', 'yaseen/vault'],
    ['https://www.github.com/yaseen/vault.git', 'yaseen/vault'],
    ['https://x-access-token:secret@github.com/yaseen/vault.git', 'yaseen/vault'],
    ['git@github.com:yaseen/vault.git', 'yaseen/vault'],
    ['git@github.com:yaseen/vault', 'yaseen/vault'],
    ['ssh://git@github.com/yaseen/vault.git', 'yaseen/vault'],
    ['ssh://git@github.com:22/yaseen/vault.git', 'yaseen/vault'],
    ['  git@github.com:yaseen/vault.git\n', 'yaseen/vault'],
    // Dots and dashes in the names.
    ['git@github.com:my-org/my.vault-2.git', 'my-org/my.vault-2'],
    ['https://github.com/my-org/notes.v2.git', 'my-org/notes.v2'],
    ['https://github.com/a-b/x.git.git', 'a-b/x.git'],
  ])('%s → %s', (url, repo) => {
    expect(repoOfRemote(url)).toBe(repo)
  })

  it.each([
    'https://gitlab.com/yaseen/vault.git',
    'git@gitlab.com:yaseen/vault.git',
    'https://github.mycompany.com/yaseen/vault.git',
    'https://github.com.evil.example/yaseen/vault.git',
    'https://evil.example/github.com/yaseen/vault.git',
    'git@github-work:yaseen/vault.git',
    'https://github.com/yaseen',
    'https://github.com/yaseen/vault/tree/main',
    'https://github.com/yaseen/..',
    '/Users/yaseen/repos/vault.git',
    'file:///Users/yaseen/repos/vault.git',
    '',
  ])('%s is not a GitHub repo', (url) => {
    expect(repoOfRemote(url)).toBeNull()
  })
})

describe('buildPhoneCode (YAZ-5098)', () => {
  it('round trip: the code → the QR grid → painted → read by the phone\'s reader → the phone\'s parser → the same repo, branch and token', async () => {
    const answer = await buildPhoneCode(deps(fakeSecrets({ [GITHUB_TOKEN_SECRET]: TOKEN })), '/v')
    if (!answer.ok) throw new Error(answer.problem)
    expect(answer.repo).toBe('yaseen/vault')
    expect(answer.branch).toBe('main')
    const text = decodeQR(pixelsOf(answer.grid), { format: 'RGBA' })
    expect(parseScanCode(text)).toEqual({ ok: true, code: { repo: 'yaseen/vault', branch: 'main', token: TOKEN, expiresAt: null } })
  })

  it('a repo name with dots and dashes and a branch with a slash make the trip too', async () => {
    const facts = { isRepo: true, remoteUrl: 'https://github.com/my-org/my.vault-2.git', branch: 'notes/main-2' }
    const answer = await buildPhoneCode(deps(fakeSecrets({ [GITHUB_TOKEN_SECRET]: TOKEN }), facts), '/v')
    if (!answer.ok) throw new Error(answer.problem)
    expect(parseScanCode(decodeQR(pixelsOf(answer.grid, 3), { format: 'RGBA' }))).toEqual({ ok: true, code: { repo: 'my-org/my.vault-2', branch: 'notes/main-2', token: TOKEN, expiresAt: null } })
  })

  it('the answer holds the grid, never the token as text', async () => {
    const answer = await buildPhoneCode(deps(fakeSecrets({ [GITHUB_TOKEN_SECRET]: TOKEN })), '/v')
    expect(answer.ok).toBe(true)
    expect(JSON.stringify(answer)).not.toContain('github_pat_')
    expect(Object.keys(answer).sort()).toEqual(['branch', 'grid', 'ok', 'repo'])
  })

  it('no token saved, a token removed, or a stored value that is not a token: no code', async () => {
    const secrets = fakeSecrets()
    const encode = vi.fn(encodeQr)
    expect(await buildPhoneCode({ ...deps(secrets), encode }, '/v')).toEqual({ ok: false, problem: 'no-token' })
    await secrets.set(GITHUB_TOKEN_SECRET, TOKEN)
    expect((await buildPhoneCode({ ...deps(secrets), encode }, '/v')).ok).toBe(true)
    await secrets.set(GITHUB_TOKEN_SECRET, null)
    expect(await buildPhoneCode({ ...deps(secrets), encode }, '/v')).toEqual({ ok: false, problem: 'no-token' })
    await secrets.set(GITHUB_TOKEN_SECRET, 'not a token')
    expect(await buildPhoneCode({ ...deps(secrets), encode }, '/v')).toEqual({ ok: false, problem: 'no-token' })
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it.each<[string, RepoFactsForPhone | null, PhoneCodeAnswer]>([
    ['no git on this Mac', null, { ok: false, problem: 'no-git' }],
    ['a vault that is not a repo (or a folder inside one)', { isRepo: false, remoteUrl: null, branch: null }, { ok: false, problem: 'not-a-repo' }],
    ['a repo with no remote origin', { isRepo: true, remoteUrl: null, branch: 'main' }, { ok: false, problem: 'no-remote' }],
    ['a remote that is not GitHub', { isRepo: true, remoteUrl: 'git@gitlab.com:yaseen/vault.git', branch: 'main' }, { ok: false, problem: 'not-github' }],
    ['a detached HEAD', { isRepo: true, remoteUrl: 'git@github.com:yaseen/vault.git', branch: null }, { ok: false, problem: 'no-branch' }],
  ])('%s: plain words, no code', async (_name, facts, expected) => {
    const encode = vi.fn(encodeQr)
    expect(await buildPhoneCode({ ...deps(fakeSecrets({ [GITHUB_TOKEN_SECRET]: TOKEN }), facts), encode }, '/v')).toEqual(expected)
    expect(encode).not.toHaveBeenCalled()
  })

  it('a remote with a password in it: the answer names the repo only, never the address', async () => {
    const facts = { isRepo: true, remoteUrl: 'https://me:hunter2@github.com/yaseen/vault.git', branch: 'main' }
    const answer = await buildPhoneCode(deps(fakeSecrets({ [GITHUB_TOKEN_SECRET]: TOKEN }), facts), '/v')
    expect(JSON.stringify(answer)).not.toContain('hunter2')
  })

  it('the QR library loads with import() when a code is asked for, never at start (main and renderer)', () => {
    const source = readFileSync(new URL('./phoneCode.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/import\('qr'\)/)
    expect(source).not.toMatch(/^import .* from 'qr/m)
  })
})
