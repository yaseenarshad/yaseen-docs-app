/**
 * The card skill as the app's own vault (YAZ-5108): the switch `cardSkillInSidebar` (default Show, kept, junk falls
 * back) and the guards that keep the copy out of every list the person keeps — Recent vaults, the ⌘O list, a window's
 * "used" vault. Made-up paths only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cardSkillVault, inAppVault, isAppVault, setCardSkillVault } from '@shared/appVaults'
import { DEFAULT_SETTINGS, addRecentRoot, defaultAppState, defaultFolderState, defaultRightPanelIdentity, listVaults, type AppState } from '@shared/types'
import { createStore, isSettings, sanitizeSettings } from './store'

const SKILL = '/Users/demo/Library/Application Support/Yaseen Docs/card-skill'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-card-skill-vault-'))
  file = path.join(dir, 'yaseendocs.json')
  setCardSkillVault(SKILL)
})
afterEach(async () => {
  setCardSkillVault(null)
  await rm(dir, { recursive: true, force: true })
})

describe('the switch "Card skill in the sidebar" (YAZ-5108)', () => {
  it('starts on Show: the default, and a file from before it', async () => {
    expect(DEFAULT_SETTINGS.cardSkillInSidebar).toBe(true)
    const { cardSkillInSidebar: _gone, ...legacy } = DEFAULT_SETTINGS
    await writeFile(file, JSON.stringify({ ...defaultAppState(), settings: legacy }))
    expect(createStore(file).get().settings.cardSkillInSidebar).toBe(true)
  })

  it('keeps Hide across a restart; junk falls back to Show and the IPC boundary refuses it', async () => {
    const store = createStore(file)
    store.setSettings({ ...store.get().settings, cardSkillInSidebar: false })
    await store.flush()
    expect((JSON.parse(await readFile(file, 'utf8')) as AppState).settings.cardSkillInSidebar).toBe(false)
    expect(createStore(file).get().settings.cardSkillInSidebar).toBe(false)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, cardSkillInSidebar: 'hide' })).toMatchObject({ cardSkillInSidebar: true })
    expect(isSettings({ ...DEFAULT_SETTINGS, cardSkillInSidebar: 'hide' })).toBe(false)
    expect(isSettings({ ...DEFAULT_SETTINGS, cardSkillInSidebar: false })).toBe(true)
  })
})

describe('the copy is never a vault of the person (YAZ-5108)', () => {
  it('knows the copy and the paths inside it, with or without a trailing slash', () => {
    expect(cardSkillVault()).toBe(SKILL)
    expect(isAppVault(`${SKILL}/`)).toBe(true)
    expect(inAppVault(`${SKILL}/Start here.md`)).toBe(true)
    expect(inAppVault(`${SKILL}-old/Start here.md`)).toBe(false)
    expect(isAppVault('/Users/demo/Vault')).toBe(false)
    setCardSkillVault(null)
    expect(isAppVault(SKILL)).toBe(false)
  })

  it('never joins Recent vaults: not by addRecentRoot, not by the store, not by the window that shows it', async () => {
    const list = [{ path: '/Users/demo/Vault', lastOpened: 1 }]
    expect(addRecentRoot(list, SKILL, 2)).toBe(list)
    expect(addRecentRoot(list, `${SKILL}/`, 2)).toBe(list)
    const store = createStore(file)
    store.pushRecent('/Users/demo/Vault', 1)
    store.pushRecent(SKILL, 2)
    expect(store.get().recents.map((r) => r.path)).toEqual(['/Users/demo/Vault'])
  })

  it('is never a row of the ⌘O list, whatever an old state holds', () => {
    const state = {
      recents: [{ path: SKILL, lastOpened: 3 }, { path: '/Users/demo/Vault', lastOpened: 2 }],
      windows: [{ roots: ['/Users/demo/Vault', SKILL] }],
      folders: { [SKILL]: { ...defaultFolderState(), key: 3 } },
    }
    expect(listVaults(state).map((v) => v.path)).toEqual(['/Users/demo/Vault'])
  })

  it('leaves the person\'s own window roots as they are stored', async () => {
    const store = createStore(file)
    const roots = ['/Users/demo/Vault', '/Users/demo/Work']
    store.upsertWindow({ id: 'w1', root: roots[0], roots, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
    expect(store.get().windows[0].roots).toEqual(roots)
  })
})
