/**
 * The settings DIALOG itself (YAZ-1679, spec'd in YAZ-1689): the three ways in (cog, ⌘, via the
 * app menu, and the menu with the sidebar collapsed — when there is no cog to click), the nav's
 * order and its divider, one section to a page (YAZ-2709) with a nav click swapping it, search
 * narrowing the pane to hits under breadcrumbs, the two-stage Escape, the three ways out, and a
 * change surviving close → reopen.
 * theme.spec.ts / contentWidth.spec.ts each prove ONE setting's effect on the app;
 * this spec proves the frame those rows sit in. Same harness as smoke.spec.ts: temp
 * `--user-data-dir`, a COPY of a generated fixture vault, `settings-` step screenshots. Serial:
 * one launch, each step continuing the last one's state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, launchApp, quitApp, readState, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The nav as the registry orders it (registry.tsx): the settings pages (General first, YAZ-3276 D7), a divider, the reference pages. */
const NAV_ORDER = ['General', 'Appearance', 'Notifications', 'Editor', 'Excalidraw canvas', 'Images', 'Files & Links', 'Review', 'Sync', '—', 'Storage', 'Sharing', 'Hotkeys'] as const

// ---------- the dialog's parts, by role and stable class only (never position) ----------

const cog = (w: Page) => w.getByRole('button', { name: 'Settings', exact: true })
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
const search = (w: Page) => dialog(w).getByRole('textbox', { name: 'Search settings', exact: true })
const closeButton = (w: Page) => dialog(w).getByRole('button', { name: 'Close settings', exact: true })
/** A nav button by its exact title (`hasText` alone is a substring match; `&` is not special in a regex). */
const navItem = (w: Page, title: string) => dialog(w).locator('.settings-nav__item', { hasText: new RegExp(`^${title}$`) })
const headings = (w: Page) => dialog(w).locator('.settings-section__title')
const rows = (w: Page) => dialog(w).locator('[data-setting]')
const row = (w: Page, id: string) => dialog(w).locator(`[data-setting="${id}"]`)

/**
 * The nav's children in DOM order, section buttons by their text and the divider as `—` — the
 * one fact the "divider before Hotkeys" requirement is about, so it is read as a sequence rather
 * than through a sibling selector.
 */
const navSequence = (w: Page): Promise<string[]> =>
  dialog(w)
    .locator('.settings-nav')
    .evaluate((nav) =>
      Array.from(nav.children)
        .filter((el) => el.classList.contains('settings-nav__item') || el.classList.contains('settings-nav__divider'))
        .map((el) => (el.classList.contains('settings-nav__divider') ? '—' : (el.textContent ?? ''))),
    )

const paneScrollTop = (w: Page): Promise<number> => dialog(w).locator('.settings-pane').evaluate((pane) => pane.scrollTop)

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'settings-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the sidebar cog opens the dialog on the General page: nav in registry order, divider before Hotkeys, General current', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toBeVisible() // the seeded note is open; the app is up

  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await expect(search(win)).toBeFocused() // focus lands in the search box on open

  // The nav lists exactly the registry's sections, in its order, with the reference page walled
  // off under the divider — Sync is there because App always hands the engine over.
  await expect.poll(() => navSequence(win)).toEqual([...NAV_ORDER])

  // Opening always starts at the first page, at its top: General is the one current nav item,
  // and it is a `page` — the section the pane shows — like every item of the nav.
  expect(await paneScrollTop(win)).toBe(0)
  await expect(navItem(win, 'General')).toHaveAttribute('aria-current', 'page')
  await expect(dialog(win).locator('.settings-nav__item[aria-current]')).toHaveCount(1)
  // ONE section to a page: the only heading is General — its two rows, the settings folder (YAZ-3276 D7) and
  // Reopen — and a row of a later section (Appearance's, Sync's) is not in the DOM.
  await expect(headings(win)).toHaveText(['General'])
  await expect(row(win, 'settingsFolder')).toBeVisible()
  await expect(row(win, 'settingsFolder').getByTestId('settings-folder-path')).toHaveText('On this Mac only (default)')
  await expect(row(win, 'startupWindows')).toBeVisible()
  await expect(row(win, 'theme')).toHaveCount(0)
  await expect(row(win, 'githubSync')).toHaveCount(0)
  await shoot(win, 'settings-01-open-from-cog')

  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
})

test('step 2 — Settings… in the app menu (⌘,) opens the same dialog, with or without a sidebar to click', async () => {
  // The REAL menu path: the item by its stable id, focused on w1 so main's focused-window send lands here.
  await clickMenuItem(app, 'menu.app.settings', 'w1')
  await expect(dialog(win)).toBeVisible()
  await expect(navItem(win, 'General')).toHaveAttribute('aria-current', 'page')
  await shoot(win, 'settings-02-open-from-menu')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  // With the sidebar collapsed the cog does not exist (App unmounts the sidebar) — the menu is
  // then the ONLY pointer-free way in besides the accelerator it carries, and it still works.
  await clickMenuItem(app, 'menu.view.toggle-sidebar', 'w1')
  await expect(cog(win)).toHaveCount(0)
  await clickMenuItem(app, 'menu.app.settings', 'w1')
  await expect(dialog(win)).toBeVisible()
  await shoot(win, 'settings-03-open-from-menu-sidebar-collapsed')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  // Leave the sidebar as the next steps need it: with a cog.
  await clickMenuItem(app, 'menu.view.toggle-sidebar', 'w1')
  await expect(cog(win)).toBeVisible()
})

test('step 3 — search narrows the page to hits under breadcrumbs, and a hit still works', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()

  // "dark" is a Theme keyword and the draw.io diagrams' "In dark mode" row (YAZ-3028 D10): two rows,
  // both on the Appearance page, Theme first under the untitled group's breadcrumb (just the section).
  await search(win).fill('dark')
  await expect(rows(win)).toHaveCount(2)
  await expect(row(win, 'theme')).toBeVisible()
  await expect(row(win, 'diagramDarkColors')).toBeVisible()
  await expect(headings(win).first()).toHaveText('Appearance')
  await shoot(win, 'settings-04-search-dark')

  // A hit is the live row, not a copy: clicking Dark in it changes the real setting.
  await row(win, 'theme').getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(row(win, 'theme').getByRole('button', { name: 'Dark', exact: true })).toHaveClass(/settings__option--active/)
  await expect.poll(async () => (await readState(userData)).settings.theme).toBe('dark')

  // "threading" matches on the GROUP title: its three rows, under "section › group". It matches
  // the next group's hint too, which names Bullet threading (YAZ-2709): that group's two rows
  // follow under their own breadcrumb. The sidebar's line style row names it too (YAZ-3309 D7).
  await search(win).fill('threading')
  await expect(headings(win)).toHaveText(['Appearance › Sidebar level lines', 'Editor › Bullet threading', 'Editor › Section indent'])
  await expect(rows(win)).toHaveCount(6)
  await expect(row(win, 'sidebarLineStyle')).toBeVisible()
  await expect(row(win, 'bulletThreading')).toBeVisible()
  await expect(row(win, 'threadWidth')).toBeVisible()
  await expect(row(win, 'threadColor')).toBeVisible()
  await expect(row(win, 'sectionStep')).toBeVisible()
  await expect(row(win, 'sectionLines')).toBeVisible()
  await shoot(win, 'settings-05-search-threading')

  // Nothing matches: the empty state, no rows, no headings.
  await search(win).fill('zzz')
  await expect(dialog(win).locator('.settings-empty')).toHaveText('No settings match “zzz”.')
  await expect(rows(win)).toHaveCount(0)
  await expect(headings(win)).toHaveCount(0)
  await shoot(win, 'settings-06-search-empty')
})

test('step 4 — Escape is two-stage (clear the search, then close); the × and the overlay close too', async () => {
  // Continuing step 3: the dialog is open with "zzz" in the search box.
  await expect(dialog(win)).toBeVisible()
  await expect(search(win)).toHaveValue('zzz')

  // First Escape: the query goes, the dialog stays, the page that was showing is back.
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toBeVisible()
  await expect(search(win)).toHaveValue('')
  await expect(headings(win)).toHaveText(['General'])
  await expect(row(win, 'settingsFolder')).toBeVisible()
  await shoot(win, 'settings-07-escape-cleared-search')

  // Second Escape, nothing to clear: the dialog closes.
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  // The × button.
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await closeButton(win).click()
  await expect(dialog(win)).toHaveCount(0)

  // The overlay: a mousedown outside the sheet. The sheet is centred and at most 920×680 in an
  // 1100×750 window, so the overlay's top-left corner is never under it.
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await win.locator('.settings-overlay').click({ position: { x: 8, y: 8 } })
  await expect(dialog(win)).toHaveCount(0)
  await shoot(win, 'settings-08-closed-by-overlay')
})

test('step 5 — a nav click swaps the page: Sync, then Hotkeys under the divider, then Appearance again', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()

  // A later settings page: its one heading and its row, nothing of Appearance, from the top.
  await navItem(win, 'Sync').click()
  await expect(navItem(win, 'Sync')).toHaveAttribute('aria-current', 'page')
  await expect(dialog(win).locator('.settings-nav__item[aria-current]')).toHaveCount(1)
  await expect(headings(win)).toHaveText(['Sync'])
  await expect(row(win, 'githubSync')).toBeVisible()
  await expect(row(win, 'theme')).toHaveCount(0)
  expect(await paneScrollTop(win)).toBe(0)

  await navItem(win, 'Hotkeys').click()
  await expect(navItem(win, 'Hotkeys')).toHaveAttribute('aria-current', 'page') // a page like the others
  await expect(dialog(win).locator('.settings-nav__item[aria-current]')).toHaveCount(1)
  // A page swap, not a scroll: the one heading is Hotkeys and the settings rows are gone from the DOM.
  await expect(headings(win)).toHaveText(['Hotkeys'])
  await expect(row(win, 'theme')).toHaveCount(0)
  await expect(row(win, 'githubSync')).toHaveCount(0)
  await expect(row(win, 'hotkey-search')).toBeVisible()
  await expect(dialog(win).locator('.hotkeys__row').first()).toBeVisible()
  await shoot(win, 'settings-09-hotkeys-page')
  // The page's own search bar (YAZ-3397 D5): words, with a slip forgiven, find New Files window first.
  const hotkeySearch = dialog(win).getByRole('textbox', { name: 'Search hotkeys', exact: true })
  await hotkeySearch.fill('file winodw')
  await expect(dialog(win).locator('.setting').first()).toHaveAttribute('data-setting', 'hotkey-newFilesWindow')
  await expect(row(win, 'theme')).toHaveCount(0)
  await shoot(win, 'settings-09b-hotkeys-search')
  await hotkeySearch.fill('')
  await expect(row(win, 'hotkey-search')).toBeVisible()
  // A change is a pop-up with the key now → the key it will have (YAZ-3397 D6); Cancel writes nothing.
  await row(win, 'hotkey-search').locator('.hotkeys__key').click()
  await win.keyboard.press('Meta+Shift+K')
  const popup = win.locator('.confirm')
  await expect(popup.locator('.confirm__text')).toHaveText('Change the key for Search the vault?')
  await expect(popup.locator('.hotkeys__cap')).toHaveText(['⌘K', '⌘⇧K'])
  await shoot(win, 'settings-09c-hotkeys-change-popup')
  await popup.getByRole('button', { name: 'Cancel' }).click()
  await expect(popup).toHaveCount(0)
  await expect(row(win, 'hotkey-search').locator('.hotkeys__key')).toHaveText('⌘K')
  // A built-in key is refused in RED (D6, S9): its line's colour is not the colour of the hint line under it.
  await row(win, 'hotkey-search').locator('.hotkeys__key').click()
  await win.keyboard.press('Meta+J')
  const refused = row(win, 'hotkey-search').locator('.hotkeys__line--refused')
  await expect(refused).toHaveText('⌘J is built in: Table of contents. Pick a different key.')
  const colour = (line: typeof refused) => line.evaluate((p) => getComputedStyle(p).color)
  const hint = row(win, 'hotkey-search').locator('.hotkeys__line:not(.hotkeys__line--refused)')
  expect(await colour(refused)).not.toBe(await colour(hint))
  await shoot(win, 'settings-09d-hotkeys-refused')
  await win.keyboard.press('Escape')
  await expect(refused).toHaveCount(0)
  await expect(row(win, 'hotkey-search').locator('.hotkeys__key')).toHaveText('⌘K')

  await navItem(win, 'Appearance').click()
  await expect(navItem(win, 'Appearance')).toHaveAttribute('aria-current', 'page')
  await expect(headings(win)).toHaveText(['Appearance'])
  await expect(row(win, 'theme')).toBeVisible()
  await expect(row(win, 'hotkey-search')).toHaveCount(0)
  await shoot(win, 'settings-10-back-to-settings-page')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
})

test('step 6 — Appearance › "Sidebar level lines" (YAZ-3309 D3, D6–D10): each choice reaches the state file and `.app`; the grey line below the open folder follows the mouse and the keyboard (S2, S3), and the thread the resting mouse', async () => {
  // Projects/ open in Files: its nested level is the one that draws a line, below the folder's chevron.
  const folder = win.locator('li[role="treeitem"]:has(> .tree__row--dir[data-path$="/Projects"])')
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.locator('> .tree__row--dir').click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  const line = () => folder.locator('> ul.tree[role="group"]').evaluate((ul) => {
    const before = getComputedStyle(ul, '::before')
    return { opacity: before.opacity, left: before.left, width: before.width, pointerEvents: before.pointerEvents }
  })
  // Roadmap.md inside Projects/: with the thread, its li draws the piece from the folder's line down to its row.
  const roadmap = folder.locator('> ul.tree[role="group"] > li').filter({ has: win.locator('.tree__row--file[data-path$="/Roadmap.md"]') })
  const thread = () => roadmap.evaluate((li) => {
    const before = getComputedStyle(li, '::before')
    return { content: before.content, opacity: before.opacity, zIndex: before.zIndex, pointerEvents: before.pointerEvents, radius: before.borderBottomLeftRadius }
  })
  const mouseOnNote = () => win.locator('.ProseMirror').filter({ visible: true }).first().hover()
  const mouseOnTree = () => win.locator('.sidebar__body').hover()
  const choose = async (id: 'sidebarLines' | 'sidebarLineStyle', label: string, value: string) => {
    await cog(win).click()
    await expect(dialog(win)).toBeVisible()
    await navItem(win, 'Appearance').click()
    await row(win, id).getByRole('button', { name: label, exact: true }).click()
    await expect(row(win, id).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await readState(userData)).settings[id]).toBe(value)
    await expect(win.locator('.app')).toHaveAttribute(id === 'sidebarLines' ? 'data-sidebar-lines' : 'data-sidebar-line-style', value)
    await win.keyboard.press('Escape')
    await expect(dialog(win)).toHaveCount(0)
  }

  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await navItem(win, 'Appearance').click()
  // Its own group on Appearance (D6); its rows and their defaults are SettingsDialog.test's.
  await expect(row(win, 'sidebarLines').locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " settings-group ")][1]').locator('.settings-group__title')).toHaveText('Sidebar level lines')
  await shoot(win, 'settings-11-sidebar-level-lines-group')
  await win.keyboard.press('Escape')
  await expect(win.locator('.app')).toHaveAttribute('data-sidebar-lines', 'hover')
  await expect(win.locator('.app')).toHaveAttribute('data-sidebar-line-style', 'plain')

  // "On hover": the line shows while the mouse is over the list, and goes when it leaves. 1px at depth 1 * 14 + 1, no target.
  await mouseOnTree()
  await expect.poll(line).toEqual({ opacity: '1', left: '15px', width: '1px', pointerEvents: 'none' })
  await mouseOnNote()
  await expect.poll(async () => (await line()).opacity).toBe('0')
  await shoot(win, 'settings-12-sidebar-lines-hover-out')
  // S2: the keyboard in the tree, the mouse on the note: an arrow key moves the focus to a row, and the lines show.
  const projects = folder.locator('> .tree__row--dir')
  await projects.focus()
  await win.keyboard.press('ArrowDown')
  await expect(win.locator('.sidebar__body')).toHaveAttribute('data-key-focus', '')
  await expect.poll(async () => (await line()).opacity).toBe('1')
  // S3: a mouse click on a row is no keyboard focus: the mouse leaves, and the lines go.
  await roadmap.locator('> .tree__row--file').click()
  await mouseOnNote()
  await expect(win.locator('.sidebar__body')).not.toHaveAttribute('data-key-focus', '')
  await expect(win.locator('.sidebar__body')).not.toHaveAttribute('data-mouse-in', '')
  await expect.poll(async () => (await line()).opacity).toBe('0')
  // "Always show": with the mouse on the note.
  await choose('sidebarLines', 'Always show', 'always')
  await mouseOnNote()
  await expect.poll(async () => (await line()).opacity).toBe('1')
  await shoot(win, 'settings-13-sidebar-lines-always')

  // "Thread to the row" (D7): the mouse rests on Roadmap, and the thread fades in over the grey line; off the row, it fades out.
  await choose('sidebarLineStyle', 'Thread to the row', 'thread')
  await roadmap.locator('> .tree__row--file').hover()
  await expect.poll(thread).toEqual({ content: '""', opacity: '1', zIndex: '2', pointerEvents: 'none', radius: '6px' })
  await shoot(win, 'settings-14-sidebar-thread')
  await mouseOnNote()
  await expect.poll(async () => (await thread()).opacity).toBe('0')
  // "Never": no line and no thread, not even with the mouse on the row.
  await choose('sidebarLines', 'Never', 'off')
  await roadmap.locator('> .tree__row--file').hover()
  await expect.poll(async () => (await line()).opacity).toBe('0')
  // With "Never" the li draws no piece at all: its `::before` has no content.
  await expect.poll(async () => (await thread()).content).toMatch(/^(none|normal)$/)
  // Back to the defaults for the steps after this one.
  await choose('sidebarLineStyle', 'Plain lines', 'plain')
  await choose('sidebarLines', 'On hover', 'hover')
})

test('step 7 — a change survives close and reopen, and reached the state file', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await navItem(win, 'Appearance').click()
  const width = row(win, 'contentWidth')
  await expect(width.getByRole('button', { name: 'Narrow', exact: true })).toHaveClass(/settings__option--active/) // the default
  await width.getByRole('button', { name: 'Full', exact: true }).click()
  await expect(width.getByRole('button', { name: 'Full', exact: true })).toHaveClass(/settings__option--active/)
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await navItem(win, 'Appearance').click()
  await expect(row(win, 'contentWidth').getByRole('button', { name: 'Full', exact: true })).toHaveClass(/settings__option--active/)
  await expect(row(win, 'contentWidth').getByRole('button', { name: 'Narrow', exact: true })).not.toHaveClass(/settings__option--active/)
  await expect.poll(async () => (await readState(userData)).settings.contentWidth).toBe('full')
  await shoot(win, 'settings-15-full-persisted')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
  await quitApp(app)
})
