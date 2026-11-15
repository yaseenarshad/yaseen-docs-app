// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { seedReaderVault } from '../dev/readerVault'
import { closeAll, sheetStack } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { HOLD_MS } from '../search/holdFolder'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5460, the entry: a finger held on a folder row of Search's tree opens the folder's menu; "Open folder page" opens
 * its page through the one file door (full screen, or a sheet when the vault says "explore"); a tap still opens and
 * closes the folder; a finger that moves is no hold.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  document.body.replaceChildren()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

async function openSearch(files = FOLDER_FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.settle()
  return x
}

const row = (x: Harness, name: string) => [...x.host.querySelectorAll<HTMLElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === name) ?? null
const pointer = (el: Element, type: string, x = 10, y = 10) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }))
const menu = () => document.querySelector('.hold-menu [role="menu"]')
const item = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.hold-menu__item')].find((b) => b.textContent === name) ?? null

async function hold(x: Harness, el: HTMLElement): Promise<void> {
  await act(async () => void pointer(el, 'pointerdown'))
  expect(el.hasAttribute('data-pressing')).toBe(true)
  await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
  await x.settle()
}

describe('hold a folder (YAZ-5460)', () => {
  it('a hold opens the menu, eats the click after it, and "Open folder page" opens the page full screen', async () => {
    h = await openSearch()
    const projects = row(h, 'Projects')!
    expect(projects.getAttribute('aria-expanded') ?? projects.parentElement?.getAttribute('aria-expanded')).toBe('false')
    await hold(h, projects)
    expect(projects.hasAttribute('data-pressing')).toBe(false)
    expect(menu()?.getAttribute('aria-label')).toBe('Projects')
    expect([...document.querySelectorAll('.hold-menu__item')].map((b) => b.textContent)).toEqual(['Open folder page', 'Copy path', 'Cancel'])
    // The finger lifts: its click does not fold the folder.
    await act(async () => void pointer(projects, 'pointerup'))
    await act(async () => projects.click())
    expect(row(h, 'Projects')!.parentElement?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => item('Open folder page')!.click())
    await waitFor(h, () => h!.host.querySelector('.folder-page') !== null)
    expect(menu()).toBeNull()
    expect(h.host.querySelector('.topbar__title, h1')?.textContent).toContain('Projects')
    expect(sheetStack()).toHaveLength(0)
  })

  it('a tap still opens and closes the folder; a finger that moves is no hold; Cancel closes the menu', async () => {
    h = await openSearch()
    const projects = row(h, 'Projects')!
    await act(async () => void pointer(projects, 'pointerdown'))
    await act(async () => void pointer(projects, 'pointerup'))
    await act(async () => projects.click())
    expect(row(h, 'Projects')!.parentElement?.getAttribute('aria-expanded')).toBe('true')
    expect(row(h, 'Garden shed')).not.toBeNull()
    // A scroll: the finger moves away before the hold.
    await act(async () => void pointer(projects, 'pointerdown', 10, 10))
    await act(async () => void pointer(projects, 'pointermove', 10, 40))
    expect(projects.hasAttribute('data-pressing')).toBe(false)
    await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
    expect(menu()).toBeNull()
    // A page row has no hold.
    await act(async () => void pointer(row(h!, 'Garden shed')!, 'pointerdown'))
    await act(async () => void (await new Promise((r) => setTimeout(r, HOLD_MS + 30))))
    expect(menu()).toBeNull()
    await hold(h, projects)
    await act(async () => item('Cancel')!.click())
    expect(menu()).toBeNull()
  })

  it('"explore": the folder page opens in a sheet over Search', async () => {
    h = await openSearch({ ...FOLDER_FILES, '.yaseendocs/link-click.json': '{"click":"explore"}' })
    await hold(h, row(h, 'Projects')!)
    await act(async () => item('Open folder page')!.click())
    await waitFor(h, () => document.querySelector('.explore-sheet .folder-page') !== null)
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'folder', path: 'Projects' }])
    expect(h.host.querySelector('.tree')).not.toBeNull()
  })
})
