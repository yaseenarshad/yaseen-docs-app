import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoSyncStatus, GithubAuthStatus } from '@shared/types'
import { SyncIndicator } from '../editor/SyncIndicator'
import { DEFAULT_REVIEW_SETTINGS, DEFAULT_SETTINGS } from '@shared/types'
import { CloudSyncSheet } from './CloudSyncSheet'
import { GithubAccountControl } from './GithubAccountControl'
import { SettingsDialog } from './SettingsDialog'
import { SyncVaultControl } from './SyncVaultControl'

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
})

function stubGithub(overrides: Record<string, unknown> = {}) {
  const prev = (window as unknown as { yaseenDocs?: Record<string, unknown> }).yaseenDocs
  ;(window as unknown as { yaseenDocs: Record<string, unknown> }).yaseenDocs = {
    ...(prev ?? {}),
    github: {
      authStatus: vi.fn(async (): Promise<GithubAuthStatus> => ({ signedIn: false, hasManualToken: false })),
      signIn: vi.fn(async (): Promise<GithubAuthStatus> => ({ signedIn: false, hasManualToken: false, pending: true })),
      signOut: vi.fn(async (): Promise<GithubAuthStatus> => ({ signedIn: false, hasManualToken: false })),
      manageRepos: vi.fn(async () => undefined),
      listRepos: vi.fn(async () => [{ fullName: 'yaseenarshad/my-vault', private: true, defaultBranch: 'main' }]),
      connectRepo: vi.fn(async () => ({ ok: true })),
      autoSyncStatus: vi.fn(async (): Promise<AutoSyncStatus> => ({ installed: false, vaultSynced: false, supportsDeepLink: false })),
      addToAutoSync: vi.fn(async () => ({ ok: true, method: 'deep-link' as const })),
      openAutoSync: vi.fn(async () => true),
      onAuthChanged: vi.fn(() => () => undefined),
      ...overrides,
    },
    secrets: {
      has: vi.fn(async () => false),
      set: vi.fn(async () => undefined),
    },
  }
  return (window as unknown as { yaseenDocs: { github: Record<string, ReturnType<typeof vi.fn>> } }).yaseenDocs.github
}

describe('GithubAccountControl (YAZ-6190 D4)', () => {
  it('shows Sign in with GitHub when signed out and triggers signIn on click', async () => {
    const gh = stubGithub()
    await act(async () => root!.render(<GithubAccountControl />))
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Sign in with GitHub'))!
    expect(btn).toBeTruthy()
    await act(async () => btn.click())
    expect(gh.signIn).toHaveBeenCalledTimes(1)
  })

  it('shows @login, Manage repos, and Sign out confirm when signed in', async () => {
    const gh = stubGithub({
      authStatus: vi.fn(async () => ({ signedIn: true, login: 'yaseenarshad', hasManualToken: false })),
    })
    await act(async () => root!.render(<GithubAccountControl />))
    expect(container.querySelector('[data-testid="github-account-status"]')?.textContent).toContain('@yaseenarshad')

    const manage = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Manage repos'))!
    await act(async () => manage.click())
    expect(gh.manageRepos).toHaveBeenCalledTimes(1)

    const signOutBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!
    await act(async () => signOutBtn.click())
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button, .confirm button')].filter((b) => b.textContent === 'Sign out').at(-1) as HTMLButtonElement
    await act(async () => confirm.click())
    expect(gh.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('SyncVaultControl (YAZ-6190 D3, Extras #1, #2, #4)', () => {
  it('disables Docs App Sync switch when GitHub AutoSync already syncs the vault (Extra #2) and shows phone link (Extra #4)', async () => {
    stubGithub()
    const setEnabled = vi.fn()
    const openAutoSync = vi.fn()
    await act(async () =>
      root!.render(
        <SyncVaultControl
          root="/vault"
          sync={{
            status: { root: '/vault', state: 'off', enabled: false },
            autoSync: { installed: true, vaultSynced: true, supportsDeepLink: true },
            setEnabled,
            openAutoSync,
          }}
        />,
      ),
    )
    expect(container.querySelector('[data-testid="autosync-active-note"]')?.textContent).toContain('Synced by GitHub AutoSync')
    expect(container.querySelector('[data-testid="phone-sync-note"]')?.textContent).toContain('docs.yaseenarshad.com')
    const onBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'On') as HTMLButtonElement
    expect(onBtn.disabled).toBe(true)
  })

  it('offers Connect to a GitHub repo when signed in and folder has no remote (Extra #1)', async () => {
    const gh = stubGithub({
      authStatus: vi.fn(async () => ({ signedIn: true, login: 'yaseenarshad', hasManualToken: false })),
    })
    await act(async () =>
      root!.render(
        <SyncVaultControl
          root="/vault"
          sync={{
            status: { root: '/vault', state: 'off', enabled: false },
            autoSync: { installed: false, vaultSynced: false, supportsDeepLink: false },
            setEnabled: vi.fn(),
          }}
        />,
      ),
    )
    const connectBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Connect to a GitHub repo')!
    await act(async () => connectBtn.click())
    expect(gh.listRepos).toHaveBeenCalledTimes(1)
    const repoBtn = [...container.querySelectorAll('[data-testid="connect-repo-picker"] button')].find((b) => b.textContent === 'yaseenarshad/my-vault') as HTMLButtonElement
    await act(async () => repoBtn.click())
    expect(gh.connectRepo).toHaveBeenCalledWith('/vault', 'yaseenarshad/my-vault')
  })
})

describe('CloudSyncSheet (YAZ-6190 D5)', () => {
  it('shows Add to GitHub AutoSync when installed and hides it when not installed', async () => {
    stubGithub()
    const onClose = vi.fn()
    const addToAutoSync = vi.fn(async () => ({ ok: true, method: 'deep-link' as const }))
    await act(async () =>
      root!.render(
        <CloudSyncSheet
          autoSync={{ installed: true, vaultSynced: false, supportsDeepLink: true }}
          sync={{ status: null, setEnabled: vi.fn(), addToAutoSync }}
          onClose={onClose}
        />,
      ),
    )
    const autoBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add to GitHub AutoSync')!
    expect(autoBtn).toBeTruthy()
    await act(async () => autoBtn.click())
    expect(addToAutoSync).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () =>
      root!.render(
        <CloudSyncSheet
          autoSync={{ installed: false, vaultSynced: false, supportsDeepLink: false }}
          sync={{ status: null, setEnabled: vi.fn() }}
          onClose={onClose}
        />,
      ),
    )
    expect([...container.querySelectorAll('button')].find((b) => b.textContent === 'Add to GitHub AutoSync')).toBeUndefined()
  })
})

describe('SyncIndicator AutoSync state (YAZ-6190 Extra #3)', () => {
  it('renders AutoSync label and opens GitHub AutoSync on click when built-in sync is off', async () => {
    const onSyncNow = vi.fn()
    const onOpenAutoSync = vi.fn()
    await act(async () =>
      root!.render(
        <SyncIndicator
          status={{ root: '/vault', state: 'off', enabled: false }}
          autoSync={{ installed: true, vaultSynced: true, supportsDeepLink: true }}
          onSyncNow={onSyncNow}
          onOpenAutoSync={onOpenAutoSync}
        />,
      ),
    )
    const chip = container.querySelector<HTMLButtonElement>('.sync-indicator')!
    expect(chip.textContent).toBe('AutoSync')
    expect(chip.classList.contains('sync-indicator--synced')).toBe(true)
    await act(async () => chip.click())
    expect(onOpenAutoSync).toHaveBeenCalledTimes(1)
    expect(onSyncNow).not.toHaveBeenCalled()
  })
})

describe('Cards enable 3rd check in SettingsDialog (YAZ-6190 D5)', () => {
  it('opens CloudSyncSheet when turning Cards on with neither sync active, and stays silent when AutoSync is active', async () => {
    stubGithub()
    const saveReview = vi.fn()
    const renderCards = (vaultSynced: boolean) =>
      act(async () =>
        root!.render(
          <SettingsDialog
            initialPage="cards"
            onClose={vi.fn()}
            ctx={{
              settings: DEFAULT_SETTINGS,
              onChange: vi.fn(),
              review: { settings: { ...DEFAULT_REVIEW_SETTINGS, enabled: false }, save: saveReview },
              ids: { enabled: true, held: false, ask: undefined, set: vi.fn(), check: vi.fn(async () => ''), old: 0, unfinished: false, state: vi.fn(async () => ({ enabled: true, letters: 'AB', pages: 0, folders: 0, old: 0, unfinished: false })), reletter: vi.fn(async () => null), backfill: vi.fn(async () => null) },
              sync: {
                status: { root: '/vault', state: 'off', enabled: false },
                autoSync: { installed: true, vaultSynced, supportsDeepLink: true },
                setEnabled: vi.fn(),
              },
            }}
          />,
        ),
      )

    await renderCards(false)
    const onBtn = container.querySelector('[data-setting="enabled"] button') as HTMLButtonElement
    await act(async () => onBtn.click())
    expect(saveReview).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(container.querySelector('[data-testid="cloud-sync-sheet"]')).not.toBeNull()

    // Dismiss with Escape
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="cloud-sync-sheet"]')).toBeNull()

    // When AutoSync already syncs the vault, turning Cards on stays silent.
    await renderCards(true)
    const onBtn2 = container.querySelector('[data-setting="enabled"] button') as HTMLButtonElement
    await act(async () => onBtn2.click())
    expect(container.querySelector('[data-testid="cloud-sync-sheet"]')).toBeNull()
  })
})
