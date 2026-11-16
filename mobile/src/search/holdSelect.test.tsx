// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { seedReaderVault } from '../dev/readerVault'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from './searchState'
import { HOLD_MS } from './holdFolder'
import { blockSelectionUntilLift } from './holdGuard'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5526: a finger held on a folder (or a file) row too long only shows the menu: the phone starts no text selection
 * over the screen and no Copy, Look Up, Translate bar. The rows and the chrome have the phone's selection and callout
 * off (CSS); the reader's text keeps them; a press on a tree stops `selectstart` and `contextmenu` until the lift.
 */

// ---- The stylesheets (jsdom has no layout: the rules are read here) ----
// (jsdom's URL is not Node's: the path is read off the module's own file URL.)
const root = join(decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')), '..', '..')
const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
const rules = cssFiles(root).flatMap((file) =>
  [...readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  })),
)
const noSelect = (body: string) => /(^|[\s;])user-select:\s*none/.test(body) && /-webkit-user-select:\s*none/.test(body)
const noCallout = (body: string) => /-webkit-touch-callout:\s*none/.test(body)
/** The rules that name `selector` itself (alone in a list, not as a part of a longer selector). */
const rulesOf = (selector: string) => rules.filter((r) => r.selectors.includes(selector))

describe('YAZ-5526: no phone selection on rows and controls (the CSS)', () => {
  const chrome = [
    '.tree__row',
    '.hold-menu',
    '.topbar',
    '.tabbar',
    'button',
    '.review__top',
    '.review__head',
    '.review__answers',
    '.review__dock',
    '.explore-sheet__head',
    '.headings-sheet__head',
    '.status-sheet__head',
  ]
  it.each(chrome)('%s: user-select none and -webkit-touch-callout none', (selector) => {
    const own = rulesOf(selector)
    expect(own.some((r) => noSelect(r.body))).toBe(true)
    expect(own.some((r) => noCallout(r.body))).toBe(true)
  })

  it('the reader body (a page\'s and a card\'s text) keeps its selection: no rule turns it off there or above it', () => {
    for (const selector of ['html', 'body', '#root', '.app', '.screen', '.screen--reader', '.reader', '.reader__body', '.phone-card__body', '.card__side']) {
      for (const r of rulesOf(selector)) {
        expect(noSelect(r.body), `${selector} { ${r.body.trim()} }`).toBe(false)
        expect(noCallout(r.body), `${selector} { ${r.body.trim()} }`).toBe(false)
      }
    }
    // No rule names the reader's body with selection off, in any form.
    const offInReader = rules.filter((r) => noSelect(r.body) && r.selectors.some((s) => /\.reader(__body)?\b/.test(s) && !/button/.test(s)))
    expect(offInReader).toEqual([])
  })

  it('a field in the top bar stays a field (Safari: a field under `user-select: none` takes no typing)', () => {
    expect(rules.some((r) => r.selectors.includes('.topbar input') && /user-select:\s*text/.test(r.body))).toBe(true)
  })
})

// ---- The guard ----
const selectStart = (on: EventTarget = document.body) => {
  const e = new Event('selectstart', { bubbles: true, cancelable: true })
  on.dispatchEvent(e)
  return e.defaultPrevented
}
const contextMenu = (on: EventTarget = document.body) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  on.dispatchEvent(e)
  return e.defaultPrevented
}
const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('YAZ-5526: blockSelectionUntilLift', () => {
  it('stops selectstart and contextmenu from the press until the finger lifts, then lets them be', async () => {
    expect(selectStart()).toBe(false)
    blockSelectionUntilLift()
    expect(selectStart()).toBe(true)
    expect(contextMenu()).toBe(true)
    document.dispatchEvent(new Event('touchend', { bubbles: true }))
    await tick()
    expect(selectStart()).toBe(false)
    expect(contextMenu()).toBe(false)
  })

  it('a cancel (a scroll took the finger) ends it too', async () => {
    blockSelectionUntilLift()
    document.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    await tick()
    expect(selectStart()).toBe(false)
  })
})

// ---- In the app: a hold on a folder row and on a file row ----
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

async function openSearch(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FOLDER_FILES)
  const x = await mount({ phone })
  await x.click('Search')
  const until = Date.now() + 3000
  while (x.host.querySelector('.tree') === null) {
    if (Date.now() > until) throw new Error('no tree')
    await tick(10)
  }
  await x.settle()
  return x
}
const pointer = (el: Element, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))
const menu = () => document.querySelector('.hold-menu [role="menu"]')

describe('YAZ-5526: a long hold in Search only shows the menu', () => {
  it('a folder held past the menu: the menu is open, and the phone\'s selection and callout are stopped, on the row and on the menu, until the lift', async () => {
    h = await openSearch()
    const folder = [...h.host.querySelectorAll<HTMLElement>('.tree__row--dir')].find((r) => r.querySelector('.tree__label')?.textContent === 'Projects')!
    await act(async () => void pointer(folder, 'pointerdown'))
    expect(selectStart(folder)).toBe(true)
    // Held well past the menu (the "a little too long" of the report).
    await tick(HOLD_MS * 3)
    await h.settle()
    expect(menu()).not.toBeNull()
    expect(selectStart(folder)).toBe(true)
    expect(selectStart(document.querySelector('.hold-menu__dim')!)).toBe(true)
    expect(contextMenu(document.querySelector('.hold-menu__sheet')!)).toBe(true)
    await act(async () => void pointer(folder, 'pointerup'))
    await tick()
    expect(menu()).not.toBeNull()
    expect(selectStart()).toBe(false)
  })

  it('a file row held long: no menu, and no selection either', async () => {
    h = await openSearch()
    const file = h.host.querySelector<HTMLElement>('.tree__row--file')!
    expect(file).not.toBeNull()
    await act(async () => void pointer(file, 'pointerdown'))
    await tick(HOLD_MS * 3)
    expect(menu()).toBeNull()
    expect(selectStart(file)).toBe(true)
    expect(contextMenu(file)).toBe(true)
    await act(async () => void pointer(file, 'pointerup'))
    await tick()
    expect(selectStart(file)).toBe(false)
  })
})
