import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GIT_CANDIDATES, GIT_TIMEOUT_CODE, git, resolveGit } from './exec'
import { requireGit } from './gitFixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

/** A temp dir that is NOT a repo — `os.tmpdir()` is never inside one, so git calls in it fail predictably. */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mdapp-exec-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('resolveGit', () => {
  it('returns null when no candidate exists', async () => {
    expect(await resolveGit(['/nope/bin/git', '/also/nope/git'])).toBeNull()
  })

  it('ignores a candidate that is a directory rather than a binary', async () => {
    expect(await resolveGit([await tempDir()])).toBeNull()
  })

  it('finds this machine’s git among the defaults', async () => {
    const bin = await resolveGit()
    expect(GIT_CANDIDATES).toContain(bin)
  })
})

describe('git', () => {
  it('resolves a non-zero exit with stderr instead of rejecting', async () => {
    const res = await git(await requireGit(), await tempDir(), ['rev-parse', '--is-inside-work-tree'])
    expect(res.code).toBeGreaterThan(0)
    expect(res.stderr).toMatch(/not a git repository/i)
    expect(res.stdout).toBe('')
  })

  it('resolves code 0 with stdout for a successful run', async () => {
    const res = await git(await requireGit(), await tempDir(), ['--version'])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/^git version /)
  })

  it('rejects with ENOENT for a bogus binary path — a spawn failure is not a git exit code', async () => {
    await expect(git('/definitely/not/a/git', await tempDir(), ['--version'])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kills a hung child on timeout and resolves -1', async () => {
    // `hash-object --stdin` blocks reading stdin, which execFile opens as a pipe and never closes:
    // a reliably hanging git that needs no repo, no network and no credentials.
    const t0 = Date.now()
    const res = await git(await requireGit(), await tempDir(), ['hash-object', '--stdin'], { timeoutMs: 100 })
    expect(res.code).toBe(GIT_TIMEOUT_CODE)
    expect(res.stderr).toMatch(/timed out/)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
