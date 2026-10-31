/**
 * YAZ-3609 in a window with two vaults: a `[[link]]` is a pill with its file icon (D13), a Markdown link
 * into the other vault opens in a tab and Back returns (D14; the window's one Back list, YAZ-3647 D4), a pasted path of the other vault is a
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
/** A third vault the app knows (in the recents) that the window does not show (D21). */
const ARCHIVE = 'Archive'
const OLD_BODY = 'archive-old-body'

let userData: string
let vaultSrc: string
let vaultsDir: string
let work: string
let personal: string
let archive: string
let app: ElectronApplication
let win: Page

/** Both vaults in one window, on Work's Today note; the key and click changes (`hotkeys`, YAZ-3936) as the step needs them. */
function workspaceState(hotkeys: AppState['settings']['hotkeys'] = {}): AppState {
  const state = seededState(work, path.join(work, TODAY))
  state.windows[0]!.roots = [work, personal]
  state.recents = [...state.recents, { path: personal, lastOpened: Date.now() - 1 }, { path: archive, lastOpened: Date.now() - 2 }]
  state.folders = { ...state.folders, [personal]: { ...state.folders[work]!, lastFile: null } }
  state.settings = { ...state.settings, hotkeys }
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
  archive = path.join(vaultsDir, ARCHIVE)
  await Promise.all([cp(vaultSrc, work, { recursive: true }), mkdir(personal, { recursive: true }), mkdir(archive, { recursive: true })])
  for (const vault of [work, personal, archive]) {
    await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
    await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: false }))
  }
  await writeFile(path.join(personal, PLAN), `# Plan\n\n${PLAN_BODY}\n`)
  await writeFile(path.join(archive, 'Old.md'), `# Old\n\n${OLD_BODY}\n`)
  await writeFile(path.join(work, TODAY), `# Today\n\nSee [[Ideas]] here.\n\nThen [the gym plan](../${PERSONAL}/${PLAN}) after.\n\nEnds with [the plan](../${PERSONAL}/${PLAN})\n\nOld: [the old note](../${ARCHIVE}/Old.md)\n\nPaste:\n`)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vaultsDir].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a resolved [[link]] is a pill: its own text, with the file icon drawn in front (D13)', async () => {
  app = await launchApp({ userData, seedState: workspaceState() })
  win = await appWindow(app, 'w1')
  const pill = editorOf(win).locator('.wikilink.file-icon', { hasText: 'Ideas' })
  await expect(pill).toHaveCount(1) // icon and name in one span: one box
  await shoot(win, 'workspace-links-01-pill')
})

test('step 1b — a Markdown link into the other vault is the same pill, with no underline (D19); icons Off draw no box (YAZ-3648)', async () => {
  const pill = editorOf(win).locator('.link-pill--first', { hasText: 'the gym plan' })
  await expect(pill).toHaveCount(1)
  expect(await pill.evaluate((el) => getComputedStyle(el.closest('a')!).textDecorationLine)).toBe('none')
  const icon = () => editorOf(win).locator('.wikilink.file-icon', { hasText: 'Ideas' }).evaluate((el) => getComputedStyle(el, '::before').content)
  expect(await icon()).not.toBe('none')
  await win.evaluate(() => document.querySelector('.app')!.setAttribute('data-sidebar-file-icons', 'off'))
  expect(await icon()).toBe('none')
  await win.evaluate(() => document.querySelector('.app')!.removeAttribute('data-sidebar-file-icons'))
})

test('step 1c — words typed right after a pill stay and save (YAZ-3655)', async () => {
  await editorOf(win).getByText('Ends with').click()
  await win.keyboard.press('End')
  await win.keyboard.type(' and more', { delay: 15 })
  // The words stay and save. A link mark grows at its end as it always has (the commonmark link is inclusive),
  // so they join the link: what YAZ-3655 lost was the words themselves.
  await expect
    .poll(async () => (await readFile(path.join(work, TODAY), 'utf8')).includes(`Ends with [the plan and more](../${PERSONAL}/${PLAN})`), { timeout: 10_000 })
    .toBe(true)
  await expect(editorOf(win)).toContainText('the plan and more')
})

test('step 1d — find inside a pill shows the find colour, and a cut pill keeps one icon (YAZ-3657, YAZ-3663)', async () => {
  await win.keyboard.press('Meta+f')
  await win.locator('.find-bar__input').fill('gym')
  const active = editorOf(win).locator('.find-match--active')
  await expect(active).toHaveText('gym')
  expect(await active.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await win.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.background = 'var(--find-match-active-bg)'
    document.querySelector('.find-match--active')!.parentElement!.appendChild(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  }))
  // "the gym plan" is cut into three pieces by the match: one icon, on the first.
  const icons = await editorOf(win).locator('a', { hasText: 'the gym plan' }).locator('.link-pill').evaluateAll((pieces) => pieces.filter((el) => getComputedStyle(el, '::before').content !== 'none').length)
  expect(icons).toBe(1)
  await shoot(win, 'workspace-links-01d-find')
  await win.keyboard.press('Escape')
})

test('step 1e — a rest on a pill into the other vault previews its note, as a [[link]] does; no address bar (D20)', async () => {
  await editorOf(win).getByText('See').click() // the editor has focus: Crepe would show its address bar on a link
  await editorOf(win).locator('.link-pill--first', { hasText: 'the gym plan' }).hover()
  const preview = win.locator('.note-preview')
  await expect(preview.locator('.note-preview__body')).toContainText(PLAN_BODY)
  await expect(editorOf(win).locator('xpath=ancestor-or-self::*[contains(@class,"milkdown")][1]')).toHaveAttribute('data-pill-hover', '')
  // Crepe's address bar, in this editor, takes no room while the pointer is on the pill.
  expect(await win.locator('.milkdown[data-pill-hover] .milkdown-link-preview').evaluateAll((bars) => bars.every((bar) => getComputedStyle(bar).display === 'none'))).toBe(true)
  await shoot(win, 'workspace-links-01e-preview')
  await win.locator('.start__heading, .page-title').first().hover().catch(() => undefined)
  await win.mouse.move(5, 5)
  await expect(preview).toHaveCount(0)
})

test('step 1f — a pill into the other vault names it (D22); a pill and a [[link]] give the same right-click menu (D23)', async () => {
  // The vault's name is a piece of the pill (YAZ-3738 D4): the `link-pill__vault` widget inside the link, not a `::after`.
  const vault = editorOf(win).locator('a', { hasText: 'the gym plan' }).locator('.link-pill__vault')
  await expect(vault).toHaveCount(1)
  expect(await vault.textContent()).toBe(` (${PERSONAL})`)
  expect(await editorOf(win).locator('.wikilink', { hasText: 'Ideas' }).evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none')
  const rows = () => win.locator('.ctx-menu--editor .ctx-menu__item').allTextContents()
  // The one link menu of a page that is there (YAZ-3740): no "Copy link"; "Open in" is the parent of its flyout.
  const LINK_ROWS = ['Open', 'Open in new tab', 'Show in sidebar', 'Copy name', 'Copy path', 'Add to favorites', 'Add to focus', 'Open in', 'Edit link', 'Remove link']
  await editorOf(win).locator('.link-pill--first', { hasText: 'the gym plan' }).click({ button: 'right' })
  await expect.poll(rows).toEqual([`Plan (${PERSONAL})`, ...LINK_ROWS])
  await shoot(win, 'workspace-links-01f-menu')
  await win.keyboard.press('Escape')
  await editorOf(win).locator('.wikilink', { hasText: 'Ideas' }).click({ button: 'right' })
  await expect.poll(rows).toEqual(['Ideas', ...LINK_ROWS])
  await win.keyboard.press('Escape')
  await expect(win.locator('.ctx-menu--editor')).toHaveCount(0)
  // D17: words selected in the note, right-click › Add link… (the note menu, YAZ-3653) opens the link box on them.
  await editorOf(win).getByText('Paste:').click()
  const box = await win.evaluate(() => {
    const line = Array.from(document.querySelectorAll('.ProseMirror p')).find((p) => p.textContent === 'Paste:')!
    const range = document.createRange()
    range.selectNodeContents(line)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    const r = range.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await win.mouse.click(box.x, box.y, { button: 'right' })
  await win.locator('.ctx-overlay [role="menuitem"]', { hasText: 'Add link…' }).click()
  await expect(win.locator('.milkdown-link-edit input')).toBeVisible()
  await shoot(win, 'workspace-links-01f-add-link')
  // The box stands by the words it links (Crepe puts it just above or below them), never at the top of the note.
  const edit = (await win.locator('.milkdown-link-edit').boundingBox())!
  expect(Math.abs(edit.y - box.y)).toBeLessThan(80)
  await win.keyboard.press('Escape')
})

test('step 2 — a Markdown link into the other vault opens in this tab on ⌘-click, and Back returns (D14; YAZ-3647 D4; YAZ-3936)', async () => {
  await editorOf(win).locator('a', { hasText: 'the gym plan' }).click({ modifiers: ['Meta'] })
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

test('step 5 — Links › "Open in a new tab" on ⌥-click (Settings › Hotkeys, YAZ-3936): it opens a new tab in front, and Back returns (YAZ-3651)', async () => {
  app = await launchApp({ userData, seedState: workspaceState({ 'links.newTab': 'Alt+Click' }) })
  win = await appWindow(app, 'w1')
  await editorOf(win).locator('a', { hasText: 'the gym plan' }).click({ modifiers: ['Alt'] })
  await expect(activeTab(win)).toHaveText('Plan')
  await expect(tabsOf(win)).toHaveCount(2) // Today stays in its own tab
  // The new tab in front is a step of the window's one list (YAZ-3647 D4): Back goes to Today's tab, and no tab closes.
  await win.getByRole('button', { name: 'Back' }).click()
  await expect(activeTab(win)).toHaveText('Today')
  await expect(tabsOf(win)).toHaveCount(2)
  await quitApp(app)
})

test('step 4 — Links › "Open in a background tab" (⌘⇧-click by default, YAZ-3936) keeps this note in front; Back in the new tab returns (YAZ-3647 D4)', async () => {
  app = await launchApp({ userData, seedState: workspaceState() })
  win = await appWindow(app, 'w1')
  await editorOf(win).locator('a', { hasText: 'the gym plan' }).click({ modifiers: ['Meta', 'Shift'] })
  await expect(tabsOf(win).filter({ hasText: 'Plan' })).toHaveCount(1)
  await expect(activeTab(win)).toHaveText('Today')
  await shoot(win, 'workspace-links-04-background')
  // A tab behind adds no step (YAZ-3647 D4): Today is still the only step, so Back is grey.
  await expect(win.locator('.tabbar-nav [aria-label="Back"]')).toBeDisabled()
  // The tab click brings Plan to the front, and that is the step: Back returns to Today, in its own tab.
  await tabsOf(win).filter({ hasText: 'Plan' }).click()
  await win.getByRole('button', { name: 'Back' }).click()
  await expect(activeTab(win)).toHaveText('Today')
  await expect(tabsOf(win)).toHaveCount(2)
  await quitApp(app)
})

test('step 6 — a link into a vault the app knows but this window does not show asks to add it; Add opens the page in a tab (D21)', async () => {
  app = await launchApp({ userData, seedState: workspaceState() })
  win = await appWindow(app, 'w1')
  const sheet = win.locator('.confirm[role="dialog"]')
  const link = editorOf(win).locator('a', { hasText: 'the old note' })
  // V3: Cancel changes nothing.
  await link.click({ modifiers: ['Meta'] })
  await expect(sheet).toContainText(`This file (Old) is not in this vault. It is in another vault (${ARCHIVE}), which is not open in this window.`)
  await shoot(win, 'workspace-links-06-ask')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(activeTab(win)).toHaveText('Today')
  // V1: Add — the vault joins the window, the page opens in a tab, and Back returns.
  await link.click({ modifiers: ['Meta'] })
  await sheet.getByRole('button', { name: 'Add vault to this window' }).click()
  await expect(activeTab(win)).toHaveText('Old')
  await expect(editorOf(win)).toContainText(OLD_BODY)
  await expect(win.locator('.tree__row', { hasText: ARCHIVE }).first()).toBeVisible()
  await win.getByRole('button', { name: 'Back' }).click()
  await expect(activeTab(win)).toHaveText('Today')
  // YAZ-3664: the link into the vault that just joined the window is a pill now, with no edit.
  await expect(editorOf(win).locator('.link-pill--first', { hasText: 'the old note' })).toHaveCount(1)
  await quitApp(app)
})

test('step 7 — a link into a vault that joins the window turns into a pill at once, in the note that stays open (YAZ-3664)', async () => {
  app = await launchApp({ userData, seedState: workspaceState() })
  win = await appWindow(app, 'w1')
  const link = editorOf(win).locator('a', { hasText: 'the old note' })
  await expect(link.locator('.link-pill')).toHaveCount(0) // Archive is not in the window: a plain link
  await link.click({ modifiers: ['Meta', 'Shift'] }) // a background tab: Today stays on screen, as Yaseen's note did
  await win.locator('.confirm[role="dialog"]').getByRole('button', { name: 'Add vault to this window' }).click()
  await expect(tabsOf(win).filter({ hasText: 'Old' })).toHaveCount(1)
  await expect(activeTab(win)).toHaveText('Today')
  await expect(editorOf(win).locator('.link-pill--first', { hasText: 'the old note' })).toHaveCount(1)
  await quitApp(app)
})
