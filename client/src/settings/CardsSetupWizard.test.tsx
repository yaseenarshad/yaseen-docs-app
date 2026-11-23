// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type GithubAuthStatus, type GithubInstalledRepo } from '@shared/types'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { CardsSetupWizard } from './CardsSetupWizard'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  container.remove()
  delete (window as unknown as { yaseenDocs?: unknown }).yaseenDocs
})

function stubGithub(overrides: Partial<{
  authStatus: () => Promise<GithubAuthStatus>
  signIn: () => Promise<GithubAuthStatus>
  listRepos: () => Promise<GithubInstalledRepo[]>
  connectRepo: (root: string, fullName: string) => Promise<{ ok: boolean; error?: string }>
  manageRepos: () => Promise<void>
  autoSyncStatus: (root: string) => Promise<{ installed: boolean; vaultSynced: boolean; supportsDeepLink: boolean }>
}> = {}) {
  const listeners = new Set<(s: GithubAuthStatus) => void>()
  const gh = {
    authStatus: vi.fn(overrides.authStatus ?? (async () => ({ signedIn: false, hasManualToken: false }))),
    signIn: vi.fn(overrides.signIn ?? (async () => ({ signedIn: false, hasManualToken: false, pending: true }))),
    listRepos: vi.fn(overrides.listRepos ?? (async () => [])),
    connectRepo: vi.fn(overrides.connectRepo ?? (async () => ({ ok: true }))),
    manageRepos: vi.fn(overrides.manageRepos ?? (async () => undefined)),
    autoSyncStatus: vi.fn(overrides.autoSyncStatus ?? (async () => ({ installed: false, vaultSynced: false, supportsDeepLink: false }))),
    onAuthChanged: vi.fn((cb: (s: GithubAuthStatus) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
  }
  ;(window as unknown as { yaseenDocs?: unknown }).yaseenDocs = { github: gh }
  return { gh, emitAuth: (s: GithubAuthStatus) => listeners.forEach((cb) => cb(s)) }
}

const findBtn = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)

describe('CardsSetupWizard (YAZ-6225)', () => {
  it('tells non-repo vaults they cannot sync yet, hides enable buttons, and guides creating or connecting a repo (YAZ-6250)', async () => {
    const { gh, emitAuth } = stubGithub({
      listRepos: async () => [{ fullName: 'yaseenarshad/study-cards', private: true, defaultBranch: 'main' }],
    })
    const setEnabled = vi.fn()
    const onClose = vi.fn()

    await act(async () =>
      root!.render(
        <CardsSetupWizard
          autoSync={{ installed: true, vaultSynced: false, supportsDeepLink: true }}
          alreadySynced={false}
          root="/vault/study-cards"
          sync={{ status: { root: '/vault/study-cards', state: 'off', enabled: false }, setEnabled }}
          settings={DEFAULT_SETTINGS}
          onChange={vi.fn()}
          onClose={onClose}
        />,
      ),
    )

    // Non-repo vault must NOT show Use Docs App Sync or Add to GitHub AutoSync.
    expect(container.textContent).toContain('This vault is not a GitHub repo yet')
    expect(findBtn('Use Docs App Sync')).toBeUndefined()
    expect(findBtn('Add to GitHub AutoSync')).toBeUndefined()
    const createLink = container.querySelector<HTMLAnchorElement>('.cards-wizard__actions a')!
    expect(createLink.textContent?.trim()).toBe('Create a private repo on GitHub ↗')
    expect(createLink.href).toContain('https://github.com/new?name=study-cards&visibility=private')
    expect(createLink.classList.contains('cards-wizard__btn--primary')).toBe(true)

    // Clicking Create shifts primary highlight to Connect and shows waiting-on-you copy.
    await act(async () => {
      createLink.addEventListener('click', (e) => e.preventDefault(), { once: true })
      createLink.click()
    })
    expect(container.textContent).toContain('Finish creating your repo, then connect it here')
    expect(createLink.classList.contains('cards-wizard__btn--primary')).toBe(false)
    expect(findBtn('Connect to a GitHub repo')!.classList.contains('cards-wizard__btn--primary')).toBe(true)

    // Clicking Connect to a GitHub repo while signed out launches sign-in and waits for auth callback.
    await act(async () => findBtn('Connect to a GitHub repo')!.click())
    expect(gh.signIn).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Finish signing in with GitHub')

    // When browser sign-in finishes, non-git vault shows the inline repo picker.
    await act(async () => emitAuth({ signedIn: true, login: 'yaseenarshad', hasManualToken: false }))
    expect(gh.listRepos).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="wizard-repo-picker"]')).not.toBeNull()

    // Picking a repo connects it and advances straight to Step 3: Read Only.
    await act(async () => findBtn('yaseenarshad/study-cards')!.click())
    expect(gh.connectRepo).toHaveBeenCalledWith('/vault/study-cards', 'yaseenarshad/study-cards')
    expect(container.querySelector('[data-testid="cards-wizard-step-readonly"]')).not.toBeNull()
  })

  it('places Use Docs App Sync as #1 primary and Add to GitHub AutoSync as #2 when vault is already a GitHub repo', async () => {
    stubGithub({ authStatus: async () => ({ signedIn: true, login: 'yaseenarshad', hasManualToken: false }) })
    const setEnabled = vi.fn()

    await act(async () =>
      root!.render(
        <CardsSetupWizard
          autoSync={{ installed: true, vaultSynced: false, supportsDeepLink: true }}
          alreadySynced={false}
          root="/vault"
          sync={{
            status: { root: '/vault', state: 'off', enabled: false, repo: { remoteUrl: 'https://github.com/a/b.git', branch: 'main' } },
            setEnabled,
          }}
          settings={DEFAULT_SETTINGS}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    )

    const actionBtns = [...container.querySelectorAll<HTMLButtonElement>('.cards-wizard__actions button')]
    expect(actionBtns.map((b) => b.textContent?.trim())).toEqual([
      'Use Docs App Sync',
      'Add to GitHub AutoSync',
      'Not now',
    ])
    expect(actionBtns[0].classList.contains('cards-wizard__btn--primary')).toBe(true)
    expect(actionBtns[1].classList.contains('cards-wizard__btn--primary')).toBe(false)

    await act(async () => actionBtns[0].click())
    expect(setEnabled).toHaveBeenCalledWith(true)
    expect(container.querySelector('[data-testid="cards-wizard-step-readonly"]')).not.toBeNull()
  })

  it('walks through Step 3 (Read Only live toggle), Step 4 (Friends education-only), and Step 5 (Card Skill + Cards Course)', async () => {
    stubGithub()
    const saveReadOnly = vi.fn()
    const onChange = vi.fn()
    const openCourse = vi.fn()
    const onClose = vi.fn()

    await act(async () =>
      root!.render(
        <CardsSetupWizard
          autoSync={{ installed: false, vaultSynced: false, supportsDeepLink: false }}
          alreadySynced={false}
          readOnlyVault={{ settings: { on: false }, save: saveReadOnly }}
          settings={{ ...DEFAULT_SETTINGS, cardSkillInSidebar: true }}
          onChange={onChange}
          openCourse={openCourse}
          onClose={onClose}
        />,
      ),
    )

    // Skip Cloud Sync -> Step 3: Read Only
    await act(async () => findBtn('Not now')!.click())
    expect(container.querySelector('[data-testid="cards-wizard-step-readonly"]')).not.toBeNull()
    await act(async () => findBtn('On')!.click())
    expect(saveReadOnly).toHaveBeenCalledWith({ on: true })

    // Next -> Step 4: Friends (education-only, no On/Off toggle)
    await act(async () => findBtn('Next: Friends →')!.click())
    const friendsStep = container.querySelector('[data-testid="cards-wizard-step-friends"]')!
    expect(friendsStep).not.toBeNull()
    expect(friendsStep.textContent).toContain('Inbox')
    expect(friendsStep.textContent).toContain('Friends icon')
    expect(friendsStep.textContent).toContain('docs.yaseenarshad.com')
    expect(friendsStep.textContent).toContain('Settings › Cards › Friends')
    expect(friendsStep.querySelector('[role="group"]')).toBeNull()

    // Next -> Step 5: Learn & Skills (live Card Skill toggle + Start Cards Course)
    await act(async () => findBtn('Next: Learn & Skills →')!.click())
    expect(container.querySelector('[data-testid="cards-wizard-step-learn"]')).not.toBeNull()
    await act(async () => findBtn('Hide')!.click())
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cardSkillInSidebar: false }))

    // Start Cards Course closes wizard and launches course
    await act(async () => findBtn('Start Cards Course')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(openCourse).toHaveBeenCalledTimes(1)
  })

  it('opens after Page IDs confirm in SettingsDialog when IDs start off', async () => {
    stubGithub()
    const setIds = vi.fn(async () => true)
    const saveReview = vi.fn()

    await act(async () =>
      root!.render(
        <SettingsDialog
          initialPage="cards"
          onClose={vi.fn()}
          ctx={{
            settings: DEFAULT_SETTINGS,
            onChange: vi.fn(),
            review: { settings: { ...DEFAULT_REVIEW_SETTINGS, enabled: false }, save: saveReview },
            ids: {
              enabled: false,
              held: false,
              ask: { pages: 2, folders: 0, foreign: 0 },
              set: setIds,
              check: vi.fn(async () => ''),
              old: 0,
              unfinished: false,
              state: vi.fn(async () => ({ letters: 'AB', pages: 0, folders: 0, old: 0, stale: 0, unfinished: false })),
              reletter: vi.fn(async () => null),
              backfill: vi.fn(async () => null),
            },
            sync: { status: { root: '/vault', state: 'off', enabled: false }, setEnabled: vi.fn() },
          }}
        />,
      ),
    )

    // Turn Cards on -> opens Step 1 (IdsOnSheet)
    const onBtn = container.querySelector('[data-setting="enabled"] button') as HTMLButtonElement
    await act(async () => onBtn.click())
    const input = container.querySelector('.confirm__input') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, 'AB')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => findBtn('Turn on both')!.click())

    expect(setIds).toHaveBeenCalledWith(true, 'AB')
    expect(saveReview).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(container.querySelector('[data-testid="cards-setup-wizard"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cards-wizard-step-sync"]')).not.toBeNull()
  })

  it('prevents double-syncing on Step 2 when already synced by AutoSync and user clicks Back (YAZ-6232)', async () => {
    stubGithub()
    const setEnabled = vi.fn()

    await act(async () =>
      root!.render(
        <CardsSetupWizard
          autoSync={{ installed: true, vaultSynced: true, supportsDeepLink: true }}
          alreadySynced={true}
          sync={{ status: { root: '/vault', state: 'off', enabled: false }, setEnabled }}
          settings={DEFAULT_SETTINGS}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    )

    // Starts on Step 3 (Read Only) when already synced.
    expect(container.querySelector('[data-testid="cards-wizard-step-readonly"]')).not.toBeNull()

    // Click Back to Step 2: Use Docs App Sync and Add to GitHub AutoSync must be hidden.
    await act(async () => findBtn('← Back')!.click())
    expect(container.querySelector('[data-testid="cards-wizard-step-sync"]')).not.toBeNull()
    expect(findBtn('Use Docs App Sync')).toBeUndefined()
    expect(findBtn('Add to GitHub AutoSync')).toBeUndefined()
    expect(container.textContent).toContain('Synced by GitHub AutoSync')
    expect(findBtn('Next: Read Only →')).toBeTruthy()
  })

  it('shows sign-in error and keeps buttons unlocked when api.github.signIn fails or rejects (YAZ-6233)', async () => {
    stubGithub({
      signIn: async () => ({ signedIn: false, hasManualToken: false, error: 'GitHub sign-in is unavailable.' }),
    })

    await act(async () =>
      root!.render(
        <CardsSetupWizard
          autoSync={{ installed: false, vaultSynced: false, supportsDeepLink: false }}
          alreadySynced={false}
          root="/vault"
          sync={{ status: { root: '/vault', state: 'off', enabled: false, repo: { remoteUrl: 'https://github.com/a/b.git', branch: 'main' } }, setEnabled: vi.fn() }}
          settings={DEFAULT_SETTINGS}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    )

    await act(async () => findBtn('Use Docs App Sync')!.click())
    expect(container.textContent).toContain('GitHub sign-in is unavailable.')
    const btn = findBtn('Use Docs App Sync')!
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)
  })

  it('supports Add to GitHub AutoSync secondary button and Step 5 Done button', async () => {
    stubGithub()
    const addToAutoSync = vi.fn(async () => ({ ok: true, method: 'deep-link' as const }))
    const openCourse = vi.fn()
    const onClose = vi.fn()

    await act(async () =>
      root!.render(
        <CardsSetupWizard
          autoSync={{ installed: true, vaultSynced: false, supportsDeepLink: true }}
          alreadySynced={false}
          sync={{ status: { root: '/vault', state: 'off', enabled: false, repo: { remoteUrl: 'https://github.com/a/b.git', branch: 'main' } }, setEnabled: vi.fn(), addToAutoSync }}
          settings={DEFAULT_SETTINGS}
          onChange={vi.fn()}
          openCourse={openCourse}
          onClose={onClose}
        />,
      ),
    )

    await act(async () => findBtn('Add to GitHub AutoSync')!.click())
    expect(addToAutoSync).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="cards-wizard-step-readonly"]')).not.toBeNull()

    // Jump to Step 5 and click Done (closes without opening course).
    await act(async () => findBtn('5. Learn & Skills')!.click())
    expect(container.querySelector('[data-testid="cards-wizard-step-learn"]')).not.toBeNull()
    await act(async () => findBtn('Done')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(openCourse).not.toHaveBeenCalled()
  })
})
