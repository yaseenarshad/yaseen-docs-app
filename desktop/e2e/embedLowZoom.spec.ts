/**
 * Drawing embeds below 10% zoom (YAZ-5988), end-to-end against the real app (headless-safe:
 * `launchApp` runs hidden with `YASEEN_DOCS_E2E_HIDDEN=1`, isolated temp profile and vault).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, editorOf, launchApp, quitApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

const rect = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  type: 'rectangle',
  x,
  y,
  width,
  height,
  angle: 0,
  strokeColor: '#1e293b',
  backgroundColor: '#dbeafe',
  fillStyle: 'solid',
  strokeWidth: 40,
  strokeStyle: 'solid',
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
})

const scene = (width: number, height: number) =>
  JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'yaseen-docs',
    elements: [rect('outer', 0, 0, width, height)],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  })

let vault: string
let userData: string
let app: ElectronApplication | null = null
let win: Page

test.beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'yaz-5988-vault-'))
  userData = await mkdtemp(path.join(tmpdir(), 'yaz-5988-profile-'))
  await writeFile(path.join(vault, 'Wide.excalidraw'), scene(28_000, 12_000))
  await writeFile(path.join(vault, 'Mega.excalidraw'), scene(100_000, 45_000))
  const note = path.join(vault, 'Embeds.md')
  await writeFile(
    note,
    [
      '# Embeds',
      '',
      '![[Wide.excalidraw|640x320 view=10500,4500,0.1]]',
      '',
      '![[Mega.excalidraw|640x320 locked]]',
      '',
    ].join('\n'),
  )
  app = await launchApp({ userData, seedState: seededState(vault, note) })
  win = await appWindow(app, 'w1')
})

test.afterAll(async () => {
  if (app !== null) await quitApp(app)
  await rm(vault, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('Fit whole drawing zooms below 10% and formats sub-1% zoom cleanly', async () => {
  const embeds = editorOf(win).locator('.board-window--ready')
  await expect(embeds).toHaveCount(2, { timeout: 20_000 })

  const wide = embeds.nth(0)
  await expect(wide.locator('.board-window__zoom')).toHaveText('10%')

  // Right-click -> Fit whole drawing must drop below 10% (around 2%).
  await wide.click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Fit whole drawing' }).click()
  await expect(wide.locator('.board-window__zoom')).toHaveText('2%')

  // Huge 100,000 px board fits below 1% and displays one decimal (never "0%" or "10%").
  const mega = embeds.nth(1)
  await expect(mega.locator('.board-window__zoom')).toHaveText('0.6%')
})
