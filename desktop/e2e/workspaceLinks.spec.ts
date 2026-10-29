/**
 * YAZ-3609 in a window with two vaults: a `[[link]]` is a pill with its file icon (D13), a Markdown link
 * into the other vault opens in a tab and Back returns (D14, D10), a pasted path of the other vault is a
 * relative link (D15), and Settings › "Open a link in" › A new background tab keeps the note in front (D11).
 * The paste is a synthetic event, so the real clipboard stays the person's own. Serial: each step
 * continues the previous state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, buildFixtureVault, editorOf, launchApp, quitApp, seededState, shoot, tabsOf } from './helpers'
import type { AppState } from '../../shared/types'

test.describe.configure({ mode: 'serial' })

const WORK = 'Work'
const PERSONAL = 'Personal'
const TODAY = 'Today.md'
const PLAN = 'Plan.md'
const PLAN_BODY = 'personal-plan-body'

let userData: string
let vaultSrc: string
let vaultsDir: string
let work: string
let personal: string
let app: ElectronApplication
let win: Page

/** Both vaults in one window, on Work's Today note; `linkOpen` as the step needs it. */
function workspaceState(linkOpen: AppState['settings']['linkOpen'] = 'this-tab'): AppState {
  const state = seededState(work, path.join(work, TODAY))
  state.windows[0]!.roots = [work, personal]
  state.recents = [...state.recents, { path: personal, lastOpened: Date.now() - 1 }]
  state.folders = { ...state.folders, [personal]: { ...state.folders[work]!, lastFile: null } }
  state.settings = { ...state.settings, linkOpen }
  return state
}

/** A paste of `text` into the visible editor through a synthetic event. */
async function pasteText(w: Page, text: string): Promise<void> {
  await editorOf(w).first().evaluate((el, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'workspace-links-userdata-'))
  vaultSrc = await buildFixtureVault()
  vaultsDir = await mkdtemp(path.join(tmpdir(), 'workspace-links-vaults-'))
  work = path.join(vaultsDir, WORK)
  personal = path.join(vaultsDir, PERSONAL)
  await Promise.all([cp(vaultSrc, work, { recursive: true }), mkdir(personal, { recursive: true })])
  for (const vault of [work, personal]) {
    await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
    await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: false }))
  }
  await writeFile(path.join(personal, PLAN), `# Plan\n\n${PLAN_BODY}\n`)
  await writeFile(path.join(work, TODAY), `# Today\n\nSee [[Ideas]] here.\n\nThen [the gym plan](../${PERSONAL}/${PLAN}) after.\n\nPaste:\n`)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vaultsDir].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a resolved [[link]] is a pill that leads with its file icon (D13)', async () => {
  app = await launchApp({ userData, seedState: workspaceState() })
  win = await appWindow(app, 'w1')
  const pill = editorOf(win).locator('.wikilink', { hasText: 'Ideas' }).first()
  await expect(pill).toBeVisible()
  await expect(editorOf(win).locator('.wikilink__lead .file-icon')).toHaveCount(1)
  await shoot(win, 'workspace-links-01-pill')
})

test('step 2 — a Markdown link into the other vault opens in this tab, and Back returns (D14, D10)', async () => {
  await editorOf(win).locator('a', { hasText: 'the gym plan' }).click()
  await expect(activeTab(win)).toHaveText('Plan')
  await expect(editorOf(win)).toContainText(PLAN_BODY)
  await win.getByRole('button', { name: 'Back' }).click()
  await expect(activeTab(win)).toHaveText('Today')
  await shoot(win, 'workspace-links-02-back')
})

test('step 3 — a pasted path of the other vault is a relative link named after the note (D15)', async () => {
  await editorOf(win).getByText('Paste:').click()
  await win.keyboard.press('End')
  await pasteText(win, path.join(personal, PLAN))
  await expect
    .poll(async () => (await readFile(path.join(work, TODAY), 'utf8')).includes(`Paste:[Plan](../${PERSONAL}/${PLAN})`), { timeout: 10_000 })
    .toBe(true)
  await quitApp(app)
})

test('step 4 — "Open a link in: A new background tab": a click keeps this note in front (D11); Back in the new tab returns (YAZ-3644)', async () => {
  app = await launchApp({ userData, seedState: workspaceState('background-tab') })
  win = await appWindow(app, 'w1')
  await editorOf(win).locator('a', { hasText: 'the gym plan' }).click()
  await expect(tabsOf(win).filter({ hasText: 'Plan' })).toHaveCount(1)
  await expect(activeTab(win)).toHaveText('Today')
  await shoot(win, 'workspace-links-04-background')
  // YAZ-3644: the new tab remembers the note with the link, so Back there returns to it.
  await tabsOf(win).filter({ hasText: 'Plan' }).click()
  await win.getByRole('button', { name: 'Back' }).click()
  await expect(activeTab(win)).toHaveText('Today')
  await quitApp(app)
})
