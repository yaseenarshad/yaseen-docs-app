/** `repoOfRemote` (moved from `main/phoneCode.ts`, YAZ-5650): the remotes that name a github.com repo, and the ones that do not. */
import { describe, expect, it } from 'vitest'
import { repoOfRemote } from './repoOfRemote'

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
