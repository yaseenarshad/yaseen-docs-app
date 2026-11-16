// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { GITHUB_CHOOSE_REPOS } from '../auth/githubAppConfig'
import { fakeOauth, type FakeOauth } from '../auth/githubApp.testing'
import type { FetchLike } from '../github/client'
import { loadVaultList } from '../store'
import { GH_ACCESS, GH_NONE, GH_OTHER, GOOD, mount, newPhone, signInWithForm, type Harness } from './testing'

/**
 * YAZ-5645 slice 1, the whole round trip on the real app: the new sign-in screen → GitHub (the address the app goes to)
 * → back at /auth/callback → the REAL Worker swaps the code (a fake GitHub behind it) → the repos chosen for the app →
 * a tap adds the vault on the GitHub sign-in. No test calls the real GitHub.
 */

/** The dev server's address, one of the app's two callbacks (decision D8); the Worker refuses any other. */
const SITE = 'http://localhost:5173'
let h: Harness | undefined
afterEach(() => {
  h?.unmount()
  h = undefined
  history.replaceState(null, '', '/')
})

async function phoneWithGithub(phone?: Awaited<ReturnType<typeof newPhone>>) {
  const went: string[] = []
  let oauth!: FakeOauth
  // Each start has its own fake GitHub (`h.github`); the one Worker and its sign-in fake stay, in front of the latest.
  let api!: FetchLike
  const p = phone ?? (await newPhone())
  const open = () =>
    mount({
      phone: p,
      services: { goToGithub: (url) => void went.push(url), origin: SITE },
      wrapFetch: (fetch) => ((api = fetch), (oauth ??= fakeOauth(SITE, (url, init) => api(url, init))).fetch),
    })
  return { went, phone: p, open, oauth: () => oauth }
}

/** Taps "Sign in with GitHub" and waits until the app went to GitHub (its chunk loads first). */
async function tapGithub(t: Awaited<ReturnType<typeof phoneWithGithub>>): Promise<string> {
  const before = t.went.length
  await h!.click('Sign in with GitHub')
  for (let i = 0; i < 200 && t.went.length === before; i++) await h!.settle()
  expect(t.went.length).toBe(before + 1)
  return t.went.at(-1)!
}

/** GitHub sends the person back: the app starts again at the callback address (the same storage). */
async function comeBack(t: Awaited<ReturnType<typeof phoneWithGithub>>, query: Record<string, string>) {
  h!.unmount()
  history.replaceState(null, '', `/auth/callback?${new URLSearchParams(query)}`)
  h = await t.open()
  await h.settle()
}
const stateOf = (url: string) => new URL(url).searchParams.get('state')!

describe('Sign in with GitHub (YAZ-5645 slice 1)', () => {
  it('the first sign-in: one button, GitHub, back, the chosen repos, a tap: the vault opens on the GitHub sign-in', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    expect(h.text()).toContain('Your vault is a repo on GitHub. Sign in, then choose it.')
    expect(h.button('Use a token instead')).not.toBeNull()
    expect(h.host.querySelector('input[name="token"]')).toBeNull()
    const to = new URL(await tapGithub(t))
    expect(to.origin).toBe('https://github.com')
    expect(to.searchParams.get('redirect_uri')).toBe(`${SITE}/auth/callback`)

    t.oauth().codes.set('code-1', { access: GH_ACCESS, refresh: 'ghr_1' })
    await comeBack(t, { code: 'code-1', state: stateOf(t.went[0]) })
    // The code leaves the address bar at once.
    expect(location.pathname + location.search).toBe('/')
    await h.waitText('Signed in as @yaseen. Choose the repo of your vault.')
    expect(h.button(/^yaseen\/second/)).not.toBeNull()
    expect(h.button(/^yaseen\/code/)).toBeNull()
    await h.click(/^yaseen\/vault/)
    await h.waitText('vault')
    expect((await loadVaultList(h.store)).vaults.map((v) => v.repo)).toEqual(['yaseen/vault'])
    expect(await h.tokens.githubOf('yaseen/vault@main')).toBe('yaseen')
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GH_ACCESS)
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('vault')
    expect(t.oauth().workerCalls).toEqual(['/api/github/token'])
  })

  it('no repo chosen for the app yet: "Choose repos on GitHub", never an empty list (edge case 4)', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await tapGithub(t)
    t.oauth().codes.set('code-2', { access: GH_NONE, refresh: 'ghr_2' })
    await comeBack(t, { code: 'code-2', state: stateOf(t.went[0]) })
    await h.waitText("Yaseen Docs can't see any repo yet. On GitHub, choose the repo of your vault.")
    await h.click('Choose repos on GitHub')
    expect(t.went.at(-1)).toBe(GITHUB_CHOOSE_REPOS)
  })

  it('back from "choose repos" (/auth/installed): the account signed in last lists its repos again', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await tapGithub(t)
    t.oauth().codes.set('code-3', { access: GH_ACCESS, refresh: 'ghr_3' })
    await comeBack(t, { code: 'code-3', state: stateOf(t.went[0]) })
    await h.waitText('Signed in as @yaseen.')
    h.unmount()
    history.replaceState(null, '', '/auth/installed?installation_id=1&setup_action=update')
    h = await t.open()
    await h.waitText('Signed in as @yaseen. Choose the repo of your vault.')
  })

  it('"no" on GitHub, or a link this phone did not start: plain words and "Sign in with GitHub"; nothing stored', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await tapGithub(t)
    await comeBack(t, { error: 'access_denied', state: stateOf(t.went[0]) })
    await h.waitText('You did not allow Yaseen Docs on GitHub. Nothing changed.')
    expect(h.button('Sign in with GitHub')).not.toBeNull()
    await comeBack(t, { code: 'stolen', state: 'forged' })
    await h.waitText('This sign-in did not start here.')
    expect(await h.tokens.githubAccounts()).toEqual([])
    expect(t.oauth().workerCalls).toEqual([])
  })

  it('"Use a token instead" keeps the pasted-token sign-in working (decision D4)', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    expect(await h.tokens.read('yaseen/vault@main')).toBe(GOOD)
    expect(await h.tokens.githubOf('yaseen/vault@main')).toBeNull()
  })

  it('Sign in again offers GitHub first: a pasted-token vault moves to the GitHub sign-in; its files stay', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.unmount()
    await t.phone.tokens.clear('yaseen/vault@main')
    h = await t.open()
    expect(h.text()).toContain('GitHub needs you to sign in again for yaseen/vault.')
    await tapGithub(t)
    t.oauth().codes.set('code-4', { access: GH_ACCESS, refresh: 'ghr_4' })
    await comeBack(t, { code: 'code-4', state: stateOf(t.went.at(-1)!) })
    await h.waitText('vault')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('vault')
    expect(await h.tokens.githubOf('yaseen/vault@main')).toBe('yaseen')
  })

  it('Sign in again as another GitHub account: refused, nothing changes (YAZ-5092 D5)', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    h.unmount()
    await t.phone.tokens.clear('yaseen/vault@main')
    h = await t.open()
    await tapGithub(t)
    t.oauth().codes.set('code-5', { access: GH_OTHER, refresh: 'ghr_5' })
    await comeBack(t, { code: 'code-5', state: stateOf(t.went.at(-1)!) })
    await h.waitText('You signed in to GitHub as @someone. This vault uses @yaseen. Sign in as @yaseen.')
    expect(await h.tokens.githubOf('yaseen/vault@main')).toBeNull()
    expect(await h.tokens.has('yaseen/vault@main')).toBe(false)
  })

  it('"Sign out and erase this phone" ends each GitHub sign-in on GitHub too (decision D7)', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await tapGithub(t)
    t.oauth().codes.set('code-6', { access: GH_ACCESS, refresh: 'ghr_6' })
    await comeBack(t, { code: 'code-6', state: stateOf(t.went[0]) })
    await h.waitText('Signed in as @yaseen.')
    await h.click(/^yaseen\/vault/)
    await h.waitText('vault')
    await h.click('Settings')
    await h.click('Sign out and erase this phone')
    await h.click('Erase this phone')
    expect(t.oauth().revoked).toEqual([GH_ACCESS])
    expect(await h.tokens.githubAccounts()).toEqual([])
  })
})

/** Signs in with GitHub and adds yaseen/vault, as a person does; the app is open on the vault. */
async function vaultOnGithub(t: Awaited<ReturnType<typeof phoneWithGithub>>, code: string) {
  h = await t.open()
  await tapGithub(t)
  t.oauth().codes.set(code, { access: GH_ACCESS, refresh: `ghr_${code}` })
  await comeBack(t, { code, state: stateOf(t.went.at(-1)!) })
  await h.waitText('Signed in as @yaseen.')
  await h.click(/^yaseen\/vault/)
  await h.waitText('vault')
}

/** GitHub's Setup URL sends the person back after "Manage repos": the app starts again at /auth/installed. */
async function backFromRepoPage(t: Awaited<ReturnType<typeof phoneWithGithub>>) {
  h!.unmount()
  history.replaceState(null, '', '/auth/installed?installation_id=1&setup_action=update')
  h = await t.open()
  await h.settle()
}

describe('Settings › GitHub (YAZ-5645 slice 2)', () => {
  it('shows the account (YAZ-5659: not its vaults, the Vaults section lists them); "Manage repos on GitHub" goes to GitHub\'s repo page and comes back to Settings', async () => {
    const t = await phoneWithGithub()
    await vaultOnGithub(t, 'code-s1')
    await h!.click('Settings')
    await h!.waitText('@yaseen')
    expect(h!.text()).toContain('Signed in with GitHub. Access renews by itself.')
    expect(h!.host.querySelector('.github-account')!.textContent).not.toContain('Vaults:')
    // YAZ-5659: GitHub is the last section before "This phone" (the erase, apart); Vaults is the first.
    const heads = [...h!.host.querySelectorAll('.screen h2.section')].map((e) => e.textContent)
    expect(heads[0]).toBe('Vaults')
    expect(heads.slice(-3)).toEqual(['About Yaseen Docs', 'GitHub', 'This phone'])
    await h!.click('Manage repos on GitHub')
    expect(t.went.at(-1)).toBe(GITHUB_CHOOSE_REPOS)
    await backFromRepoPage(t)
    await h!.waitText('Manage repos on GitHub')
    expect(h!.host.querySelector('.topbar__title')?.textContent).toBe('Settings')
    // The way back was used once: the next start is an ordinary one.
    expect(await h!.tokens.takeManaging()).toBeNull()
  })

  it('a phone with pasted tokens only shows no GitHub part', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.waitText('Vaults')
    expect(h.button('Manage repos on GitHub')).toBeNull()
  })

  it('"Sign out of this account" asks first, ends the sign-in on GitHub, and the vault stays and asks to sign in again', async () => {
    const t = await phoneWithGithub()
    await vaultOnGithub(t, 'code-s2')
    await h!.click('Settings')
    await h!.waitText('@yaseen')
    await h!.click('Sign out of @yaseen')
    expect(h!.text()).toContain('Sign out of @yaseen on this phone? yaseen/vault stops syncing until you sign in again.')
    expect(t.oauth().revoked).toEqual([])
    await h!.click('Sign out')
    await h!.waitText('GitHub needs you to sign in again for yaseen/vault.')
    expect(t.oauth().revoked).toEqual([GH_ACCESS])
    expect(await h!.tokens.githubAccounts()).toEqual([])
    expect((await loadVaultList(h!.store)).vaults.map((v) => v.repo)).toEqual(['yaseen/vault'])
  })

  it('"Add another GitHub account" opens GitHub\'s account picker', async () => {
    const t = await phoneWithGithub()
    await vaultOnGithub(t, 'code-s3')
    await h!.click('Settings')
    await h!.waitText('@yaseen')
    const before = t.went.length
    await h!.click('Add another GitHub account')
    for (let i = 0; i < 200 && t.went.length === before; i++) await h!.settle()
    expect(new URL(t.went.at(-1)!).searchParams.get('prompt')).toBe('select_account')
  })
})

describe('a repo taken off the app\'s list on GitHub (YAZ-5645 slice 2, edge case 5)', () => {
  const lost = { status: 'attention' as const, vault: 'yaseen/vault@main', problem: 'NOT_FOUND', ready: true }

  it('names the repo, and "Add it again on GitHub" goes to the repo page and back to the vault', async () => {
    const t = await phoneWithGithub()
    await vaultOnGithub(t, 'code-r1')
    h!.github.takeOff(GH_ACCESS, 'yaseen/vault')
    await h!.syncSet(lost)
    await h!.waitText('Yaseen Docs can no longer see yaseen/vault. It was taken off the list on GitHub. The pages on this phone stay readable.')
    expect(h!.text()).not.toContain('token')
    await h!.click('Add it again on GitHub')
    expect(t.went.at(-1)).toBe(GITHUB_CHOOSE_REPOS)
    await backFromRepoPage(t)
    await h!.waitText('vault')
    expect(h!.host.querySelector('.topbar__title')?.textContent).toBe('vault')
  })

  it('still on the list (renamed or deleted): row R12\'s words stay', async () => {
    const t = await phoneWithGithub()
    await vaultOnGithub(t, 'code-r2')
    await h!.syncSet(lost)
    await h!.waitText("Can't find yaseen/vault (branch main) on GitHub.")
    expect(h!.github.calls.some((c) => c.url.includes('/user/installations'))).toBe(true)
    expect(h!.text()).not.toContain('taken off the list')
  })

  it('a pasted-token vault: row R12\'s words, and no installation call', async () => {
    const t = await phoneWithGithub()
    h = await t.open()
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.syncSet(lost)
    await h.waitText("Can't find yaseen/vault (branch main) on GitHub.")
    await h.settle()
    expect(h.github.calls.some((c) => c.url.includes('/user/installations'))).toBe(false)
  })
})
