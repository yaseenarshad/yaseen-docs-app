// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_OPTIONS } from '@client/settings/options'
import { phoneStylesheets } from '../../publish/stylesheets'
import { APPEARANCE_KEY, readAppearance, saveAppearance } from '../store/appearancePref'
import { drawingBox } from '../drawing/drawingBox'

/** YAZ-5565: Settings › Appearance on the phone: saved on the phone, painted on the page, followed by the drawings. */

/** The iPhone's own setting, as a media query whose answer the test turns. */
function fakeSystem(dark: boolean) {
  const fns = new Set<() => void>()
  const media = { matches: dark, media: '(prefers-color-scheme: dark)', addEventListener: (_: string, f: () => void) => fns.add(f), removeEventListener: (_: string, f: () => void) => fns.delete(f) }
  vi.stubGlobal('matchMedia', () => media)
  return {
    turn(next: boolean) {
      media.matches = next
      for (const f of fns) f()
    },
  }
}

const HEAD = `<meta name="color-scheme" content="light dark" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e1e1e" />`
const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)
const colorScheme = () => document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content
const scheme = () => document.documentElement.dataset.scheme

/** A fresh copy of the module (its state is the page's). */
const load = async () => {
  vi.resetModules()
  return import('./appearance')
}

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = HEAD
  delete document.documentElement.dataset.scheme
})
afterEach(() => vi.unstubAllGlobals())

describe('Settings › Appearance (YAZ-5565)', () => {
  it("the Mac's words and order: System, Light, Dark", async () => {
    const { APPEARANCE_OPTIONS } = await load()
    expect(APPEARANCE_OPTIONS).toEqual(THEME_OPTIONS)
  })

  it('saved on this phone, in localStorage; a storage that throws gives System and loses nothing', () => {
    expect(readAppearance()).toBe('system')
    saveAppearance('dark')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
    expect(readAppearance()).toBe('dark')
    localStorage.setItem(APPEARANCE_KEY, 'purple')
    expect(readAppearance()).toBe('system')
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(readAppearance(broken)).toBe('system')
    expect(() => saveAppearance('light', broken)).not.toThrow()
  })

  it('System follows the iPhone live: the page, the bar colours and color-scheme as before', async () => {
    const system = fakeSystem(false)
    const a = await load()
    a.startAppearance()
    expect([scheme(), colorScheme(), ...metas()]).toEqual(['light', 'light dark', '#ffffff', '#1e1e1e'])
    system.turn(true)
    expect([scheme(), colorScheme(), ...metas()]).toEqual(['dark', 'light dark', '#ffffff', '#1e1e1e'])
  })

  it('Dark or Light, chosen: painted at once and saved; the iPhone turning changes nothing; the next start paints it first', async () => {
    const system = fakeSystem(false)
    const a = await load()
    a.startAppearance()
    a.setAppearance('dark')
    expect([scheme(), colorScheme(), ...metas()]).toEqual(['dark', 'dark', '#1e1e1e', '#1e1e1e'])
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
    system.turn(true)
    system.turn(false)
    expect(scheme()).toBe('dark')
    a.setAppearance('light')
    system.turn(true)
    expect([scheme(), colorScheme(), ...metas()]).toEqual(['light', 'light', '#ffffff', '#ffffff'])
    // The next start of the app (a fresh page): the saved choice is on the page before anything draws.
    document.head.innerHTML = HEAD
    delete document.documentElement.dataset.scheme
    const again = await load()
    again.startAppearance()
    expect([again.appearance(), scheme(), ...metas()]).toEqual(['light', 'light', '#ffffff', '#ffffff'])
    // Back to System: the iPhone's (dark now) and the page's own bar colours.
    again.setAppearance('system')
    expect([scheme(), colorScheme(), ...metas()]).toEqual(['dark', 'light dark', '#ffffff', '#1e1e1e'])
  })

  it('YAZ-5661: back on screen (from GitHub, the iPhone\'s Settings, the app switcher), the page paints again', async () => {
    const system = fakeSystem(false)
    const a = await load()
    a.startAppearance()
    // The iPhone turned dark while the app slept, and no change came.
    ;(matchMedia('') as { matches: boolean }).matches = true
    window.dispatchEvent(new Event('pageshow'))
    expect([scheme(), ...metas()]).toEqual(['dark', '#ffffff', '#1e1e1e'])
    system.turn(false)
    // Dark chosen; the bar tags as the page first had them (a page shown again from the cache).
    a.setAppearance('dark')
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = '#ffffff'
    document.dispatchEvent(new Event('visibilitychange'))
    expect([scheme(), colorScheme(), ...metas()]).toEqual(['dark', 'dark', '#1e1e1e', '#1e1e1e'])
  })

  it("YAZ-5661: the page's own background is the theme's (iOS colours the strip behind the clock from it)", () => {
    const css = readFileSync(`${import.meta.dirname}/../styles.css`, 'utf8')
    expect(css).toMatch(/\nhtml \{[^}]*background: var\(--bg\);/)
  })

  it('the drawings draw in the chosen theme, and again when it changes', async () => {
    fakeSystem(false)
    const a = await load()
    const { watchDrawings } = await import('../drawing/watchDrawings')
    a.startAppearance()
    a.setAppearance('dark')
    const themes: string[] = []
    const root = document.createElement('div')
    root.append(drawingBox('garden.excalidraw', 'garden.excalidraw')!)
    document.body.append(root)
    URL.createObjectURL = (() => 'blob:test/1') as typeof URL.createObjectURL
    URL.revokeObjectURL = () => undefined
    const watch = watchDrawings(root, {
      read: async () => ({ bytes: new TextEncoder().encode('{"type":"excalidraw","elements":[]}') }),
      files: () => [],
      load: async () => ({ drawPicture: async (input) => (themes.push(input.theme), { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 10, height: 10, ms: 1 }) }),
    })
    for (let i = 0; i < 100 && themes.length < 1; i++) await new Promise((r) => setTimeout(r, 10))
    a.setAppearance('light')
    for (let i = 0; i < 100 && themes.length < 2; i++) await new Promise((r) => setTimeout(r, 10))
    watch.stop()
    root.remove()
    expect(themes).toEqual(['dark', 'light'])
  })

  it('no stylesheet of the phone keeps a dark rule on the media query (it would ignore Light and Dark)', () => {
    const left = phoneStylesheets().filter((f) => /prefers-color-scheme/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    expect(left.map((f) => f.replace(/^.*\/(mobile|client)\//, '$1/'))).toEqual([])
  })
})
