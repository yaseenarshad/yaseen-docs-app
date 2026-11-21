import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitAuthEnv } from './askpass'
import { detectRepo } from './detect'
import { git, resolveGit } from './exec'
import { connectVaultToRepo, syncPass } from './sync'

const temps: string[] = []

afterEach(async () => {
  while (temps.length > 0) {
    await rm(temps.pop()!, { recursive: true, force: true })
  }
})

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

describe('gitAuthEnv (YAZ-6190 D2)', () => {
  it('creates an executable GIT_ASKPASS helper script and places token only in env', async () => {
    const env = await gitAuthEnv('ghu_secret_token')
    expect(env.GIT_ASKPASS).toBeTruthy()
    expect(env.YASEEN_DOCS_GIT_TOKEN).toBe('ghu_secret_token')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })
})

describe('connectVaultToRepo (YAZ-6190 Extra #1)', () => {
  it('initializes git and sets origin HTTPS URL on a plain folder without touching existing files', async () => {
    const bin = await resolveGit()
    if (bin === null) return
    const dir = await makeTemp('connect-repo-')
    await writeFile(path.join(dir, 'Note.md'), '# Hello\n')

    const res = await connectVaultToRepo(dir, 'yaseenarshad/my-vault')
    expect(res).toEqual({ ok: true })

    const facts = await detectRepo(bin, dir)
    expect(facts.isRepo).toBe(true)
    expect(facts.remoteUrl).toBe('https://github.com/yaseenarshad/my-vault.git')
  })

  it('rejects malformed repo names', async () => {
    const dir = await makeTemp('connect-bad-')
    const res = await connectVaultToRepo(dir, 'not a repo!!')
    expect(res.ok).toBe(false)
  })
})

describe('syncPass with GitHub App auth (YAZ-6190 D2 + Extra #5)', () => {
  it('uses GitHub profile fallback for git commit identity when global/local identity is missing', async () => {
    const bin = await resolveGit()
    if (bin === null) return
    const bare = await makeTemp('bare-')
    const work = await makeTemp('work-')
    await git(bin, bare, ['init', '--bare', '-b', 'main'])
    await git(bin, work, ['init', '-b', 'main'])
    await git(bin, work, ['remote', 'add', 'origin', bare])
    // Force empty local identity so git commit fails without fallback
    await git(bin, work, ['config', 'user.name', ''])
    await git(bin, work, ['config', 'user.email', ''])
    await writeFile(path.join(work, 'Page.md'), 'hello\n')

    // Isolated HOME so global ~/.gitconfig does not supply an identity
    const fakeHome = await makeTemp('home-')
    const prevHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      const status = await syncPass(work, {
        auth: {
          getValidAuth: async () => ({
            token: 'ghu_test',
            login: 'yaseenarshad',
            email: '43793164+yaseenarshad@users.noreply.github.com',
          }),
        },
      })
      expect(status.state).toBe('synced')
      const author = await git(bin, work, ['log', '-1', '--format=%an <%ae>'])
      expect(author.stdout.trim()).toBe('yaseenarshad <43793164+yaseenarshad@users.noreply.github.com>')
    } finally {
      process.env.HOME = prevHome
    }
  })

  it('rebases cleanly when behind remote with no local git identity (YAZ-6205)', async () => {
    const bin = await resolveGit()
    if (bin === null) return
    const bare = await makeTemp('bare-rebase-')
    const cloneA = await makeTemp('clone-a-')
    const cloneB = await makeTemp('clone-b-')
    await git(bin, bare, ['init', '--bare', '-b', 'main'])
    await git(bin, cloneA, ['init', '-b', 'main'])
    await git(bin, cloneA, ['remote', 'add', 'origin', bare])
    await writeFile(path.join(cloneA, 'First.md'), 'one\n')
    await git(bin, cloneA, ['add', '-A'])
    await git(bin, cloneA, ['-c', 'user.name=A', '-c', 'user.email=a@example.com', 'commit', '-m', 'init'])
    await git(bin, cloneA, ['push', '-u', 'origin', 'main'])

    await git(bin, cloneB, ['clone', bare, '.'])
    // Remote moves ahead via cloneA
    await writeFile(path.join(cloneA, 'Remote.md'), 'from remote\n')
    await git(bin, cloneA, ['add', '-A'])
    await git(bin, cloneA, ['-c', 'user.name=A', '-c', 'user.email=a@example.com', 'commit', '-m', 'remote change'])
    await git(bin, cloneA, ['push'])

    // cloneB has no local identity and has its own local edit
    await git(bin, cloneB, ['config', 'user.name', ''])
    await git(bin, cloneB, ['config', 'user.email', ''])
    await writeFile(path.join(cloneB, 'Local.md'), 'from local\n')

    const fakeHome = await makeTemp('home-rebase-')
    const prevHome = process.env.HOME
    process.env.HOME = fakeHome
    try {
      const status = await syncPass(cloneB, {
        auth: {
          getValidAuth: async () => ({
            token: 'ghu_test',
            login: 'yaseenarshad',
            email: '43793164+yaseenarshad@users.noreply.github.com',
          }),
        },
      })
      expect(status.state).toBe('synced')
    } finally {
      process.env.HOME = prevHome
    }
  })

  it('passes -c credential.helper= and classifies repo-not-allowed on 404 when signed in (YAZ-6204, Extra #5)', async () => {
    const dir = await makeTemp('fake-git-')
    await mkdir(path.join(dir, '.git', 'info'), { recursive: true })
    const logFile = path.join(dir, 'args.log')
    const fakeGit = path.join(dir, 'git')
    // Fake git binary: answers detectRepo + ensureBoardMergeRule queries cleanly, logs fetch args, and simulates GitHub 404.
    const script = `#!/bin/sh
echo "$@" >> "${logFile}"
case "$*" in
  *"rev-parse --is-inside-work-tree"*) echo "true"; exit 0 ;;
  *"rev-parse --git-path info/attributes"*) echo ".git/info/attributes"; exit 0 ;;
  *"remote get-url origin"*) echo "https://github.com/yaseenarshad/blocked-repo.git"; exit 0 ;;
  *"rev-parse --abbrev-ref HEAD"*) echo "main"; exit 0 ;;
  *"status --porcelain"*) exit 0 ;;
  *"fetch origin"*) echo "remote: Repository not found." >&2; exit 128 ;;
  *) exit 0 ;;
esac
`
    await writeFile(fakeGit, script, { mode: 0o700 })
    await chmod(fakeGit, 0o700)

    const status = await syncPass(dir, {
      candidates: [fakeGit],
      auth: {
        getValidAuth: async () => ({
          token: 'ghu_test',
          login: 'yaseenarshad',
          email: '43793164+yaseenarshad@users.noreply.github.com',
        }),
        isRepoAllowed: async (slug) => (slug === 'yaseenarshad/blocked-repo' ? 'not-allowed' : 'allowed'),
      },
    })
    expect(status.state).toBe('attention')
    expect(status.attention).toBe('repo-not-allowed')
    const logged = await readFile(logFile, 'utf8')
    expect(logged).toContain('-c credential.helper= fetch origin')
  })
})
