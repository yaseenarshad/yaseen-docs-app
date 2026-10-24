/**
 * Formatting acts on the lines you see (YAZ-3209): the REAL built app, the user flow from the
 * issue. Fold two parents → select both with the keyboard → press Bold on the selection toolbar →
 * the file on disk bolds the parents only → unfold, and the kids are still plain. The toolbar is
 * pressed here and not in the unit suite: under jsdom a pointerdown on the strip collapses the
 * selection first. Screenshots are the evidence (and the release notes' pictures).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'FormatFold.md'
const BODY = `# Plan

* Alpha parent
  * alpha-kid-e2e
* Beta parent
  * beta-kid-e2e
`
const BOLDED = `# Plan

* **Alpha parent**
  * alpha-kid-e2e
* **Beta parent**
  * beta-kid-e2e
`

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const editor = () => win.locator('.ProseMirror')

async function fold(label: string): Promise<void> {
  await editor().getByText(label, { exact: true }).hover()
  await win.locator(`.outline-toggle[aria-label="Collapse ${label}"]`).click()
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'ff-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'ff-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — fold both parents and select them with the keyboard', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(editor()).toContainText('alpha-kid-e2e')

  await fold('Alpha parent')
  await fold('Beta parent')
  await expect(editor().getByText('alpha-kid-e2e')).toBeHidden()
  await expect(editor().getByText('beta-kid-e2e')).toBeHidden()

  // Start of Alpha, ⇧↓ to the start of Beta (the hidden kids are skipped), ⇧⌘→ to Beta's end.
  await editor().getByText('Alpha parent', { exact: true }).click()
  await win.keyboard.press('Meta+ArrowLeft')
  await win.keyboard.press('Shift+ArrowDown')
  await win.keyboard.press('Shift+Meta+ArrowRight')
  await expect(win.locator('.milkdown-toolbar[data-show="true"]')).toBeVisible()
  await shoot(win, 'ff-01-folded-parents-selected')
})

test('step 2 — Bold on the toolbar bolds the parents only, on disk too', async () => {
  const bold = win.locator('.milkdown-toolbar [data-toolbar-item="bold"]')
  await expect(bold).not.toHaveClass(/active/)
  await bold.click()
  await expect(bold).toHaveClass(/active/)
  await expect.poll(() => readFile(notePath, 'utf8'), { timeout: 10_000 }).toBe(BOLDED)
  await shoot(win, 'ff-02-parents-bold')
})

test('step 3 — unfold: the kids are still plain', async () => {
  for (const label of ['Alpha parent', 'Beta parent']) {
    await editor().getByText(label, { exact: true }).hover()
    await win.locator(`.outline-toggle[aria-label="Expand ${label}"]`).click()
  }
  await expect(editor().getByText('alpha-kid-e2e')).toBeVisible()
  await expect(editor().locator('strong', { hasText: 'alpha-kid-e2e' })).toHaveCount(0)
  await expect(editor().locator('strong', { hasText: 'beta-kid-e2e' })).toHaveCount(0)
  await expect(editor().locator('strong', { hasText: 'Alpha parent' })).toHaveCount(1)
  await shoot(win, 'ff-03-unfolded-kids-plain')
})
