// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadVaultList } from '../store'
import { GOOD, MANY, mount, NO_CONTENTS, NO_REPOS, signInWithForm, WRONG, type Harness } from './testing'

/**
 * YAZ-5408: paste the token, then pick the repo from the token's list. The pick runs the existing check (3E) unchanged.
 * "Type the repo name" stays as a small fallback.
 */
let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  vi.restoreAllMocks()
})

const rows = (x: Harness) => [...x.host.querySelectorAll('.repo-row')].map((r) => r.getAttribute('aria-label'))
const tabs = (x: Harness) => [...x.host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
const paths = (x: Harness) => x.github.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)

async function showRepos(x: Harness, token: string) {
  await x.type('Token', token)
  await x.click('Show my repos')
}

describe('the token comes first (YAZ-5408)', () => {
  it('the first screen has ONE field, the token; the typed repo is collapsed; no call to GitHub', async () => {
    h = await mount()
    expect(h.host.querySelectorAll('form input')).toHaveLength(1)
    expect(h.host.querySelector('input[name="token"]')?.getAttribute('type')).toBe('password')
    expect(h.host.querySelector('input[name="repo"]')).toBeNull()
    expect(h.button('Show my repos')).not.toBeNull()
    expect(h.button('Type the repo name')).not.toBeNull()
    expect(h.github.calls).toEqual([])
  })

  it('the example text of the typed field is never sent as a value (the "owner/wiki" block)', async () => {
    h = await mount()
    await h.click('Type the repo name')
    const field = h.host.querySelector<HTMLInputElement>('input[name="repo"]')!
    expect(field.value).toBe('')
    await h.type('Token', GOOD)
    await h.click('Connect vault')
    // An empty repo field asks for the repo; no call to GitHub with a made-up name.
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('Type the repo as owner/name')
    expect(h.github.calls).toEqual([])
  })

  it('lists the repos the token reaches: owner/name, private, the likely vaults first; then a tap signs in through the existing check', async () => {
    h = await mount()
    await showRepos(h, GOOD)
    await h.waitText('Choose the repo of your vault')
    // yaseen/code is pushed last but has no vault: the two vaults come first.
    expect(rows(h)).toEqual(['yaseen/vault, private, a vault', 'yaseen/second, private, a vault', 'yaseen/code, private'])
    // The list: one call for the list, then one look for each repo on screen.
    expect(paths(h).filter((p) => p === 'GET /user/repos')).toHaveLength(1)
    expect(paths(h).filter((p) => p.endsWith('/contents/.yaseendocs'))).toHaveLength(3)
    const before = h.github.calls.length
    await h.click('yaseen/vault, private, a vault')
    await h.settle()
    // The existing check of 3E, in its order: the user, the repo, the branch, the vault, the write probe, Gists.
    expect(paths(h).slice(before)).toEqual(['GET /user', 'GET /repos/yaseen/vault', 'GET /repos/yaseen/vault/branches/main', 'GET /repos/yaseen/vault/contents/.yaseendocs', 'POST /repos/yaseen/vault/git/blobs', 'POST /gists'])
    expect(tabs(h)).toEqual(['Friends', 'Review', 'Search'])
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
    expect(h.host.innerHTML).not.toContain(GOOD)
  })

  it("a pick that fails the check gives the check's own words: no vault at the top; Contents not readable", async () => {
    h = await mount()
    await showRepos(h, GOOD)
    await h.waitText('Choose the repo of your vault')
    await h.click('yaseen/code, private')
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('yaseen/code has no Yaseen Docs vault at its top')
    expect((await loadVaultList(h.store)).vaults).toEqual([])
    h.unmount()

    h = await mount()
    await showRepos(h, NO_CONTENTS)
    await h.waitText('Choose the repo of your vault')
    await h.click('yaseen/vault, private')
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain('set Contents to "Read and write"')
  })

  it('a token that reaches no repo: the plain words, and the way to fix the token', async () => {
    h = await mount()
    await showRepos(h, NO_REPOS)
    await h.waitText("This token can't see any repository.")
    const alert = h.host.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('On GitHub, edit the token and choose the repository of your vault.')
    expect(alert.querySelector('button')?.textContent).toBe('How to make a token')
    expect(h.button('Use another token')).not.toBeNull()
  })

  it('a wrong token, the rate limit, no signal: words and a way forward; "Try again" lists again', async () => {
    h = await mount()
    await showRepos(h, WRONG)
    await h.waitText('GitHub does not accept this token.')
    expect(h.host.querySelector('[role="alert"] button')?.textContent).toBe('How to make a token')
    await h.click('Use another token')
    expect(h.host.querySelector<HTMLInputElement>('input[name="token"]')).not.toBeNull()

    h.github.rateLimitedUntil = Date.UTC(2026, 10, 13, 13) / 1000
    await showRepos(h, GOOD)
    await h.waitText('GitHub asks us to slow down. Try again after')
    h.github.rateLimitedUntil = null
    h.github.offline = true
    await h.click('Try again')
    await h.waitText('No internet connection.')
    h.github.offline = false
    await h.click('Try again')
    await h.waitText('Choose the repo of your vault')
    expect(h.text()).not.toMatch(/\b(401|403|404|503)\b/)
  })

  it('more than 8 repos: a search box narrows the list', async () => {
    h = await mount()
    await showRepos(h, MANY)
    await h.waitText('Choose the repo of your vault')
    expect(rows(h)).toHaveLength(12)
    const search = h.host.querySelector<HTMLInputElement>('input[type="search"]')!
    expect(search).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'project-1')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows(h)).toEqual(['yaseen/project-10, private', 'yaseen/project-1, private'])
  })

  it('fewer than 9 repos: no search box', async () => {
    h = await mount()
    await showRepos(h, GOOD)
    await h.waitText('Choose the repo of your vault')
    expect(h.host.querySelector('input[type="search"]')).toBeNull()
  })

  it('Settings › Add vault: the same list; a vault on the phone says "Added" and cannot be added again', async () => {
    h = await mount()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.click('Add vault')
    await showRepos(h, GOOD)
    await h.waitText('Choose the repo of your vault')
    const added = [...h.host.querySelectorAll<HTMLButtonElement>('.repo-row')].find((b) => b.getAttribute('aria-label')!.startsWith('yaseen/vault'))!
    expect(added.getAttribute('aria-label')).toBe('yaseen/vault, private, a vault, added')
    expect(added.disabled).toBe(true)
    expect(added.textContent).toContain('Added')
    const before = h.github.calls.length
    await act(async () => added.click())
    expect(h.github.calls.length).toBe(before)
    await h.click('yaseen/second, private, a vault')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('second')
  })

  it('privacy: the repo names are not stored, not logged, and go nowhere but api.github.com', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    localStorage.clear()
    h = await mount()
    await showRepos(h, GOOD)
    await h.waitText('Choose the repo of your vault')
    await h.click('Use another token')
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/yaseen\/(vault|second|code)/)
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/yaseen\//)
    expect((await loadVaultList(h.store)).vaults).toEqual([])
    expect(h.github.calls.every((c) => c.url.startsWith('https://api.github.com/'))).toBe(true)
  })
})
