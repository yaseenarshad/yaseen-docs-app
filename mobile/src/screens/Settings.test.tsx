// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILD, buildLine, buildShortTime, buildTime, versionWords } from '../settings/buildInfo'
import { WHATS_NEW, entryDay } from '../settings/whatsNew'
import { GOOD, mount, signInWithForm, type Harness } from './testing'

/** YAZ-5446: Settings › Version, What's new, and an erase that never happens by accident. */
const HERE = import.meta.dirname
const pkg = JSON.parse(readFileSync(join(HERE, '../../package.json'), 'utf8')) as { version: string }

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  document.head.querySelectorAll('style[data-test]').forEach((s) => s.remove())
})

async function settings() {
  h = await mount()
  await signInWithForm(h, 'yaseen/vault', GOOD)
  await h.click('Settings')
  return h
}
const toggle = (x: Harness) => x.host.querySelector<HTMLButtonElement>('.whats-new__toggle')!

describe('the version (YAZ-5446)', () => {
  it("the words: the version, the build's date and time in the phone's own time, the commit", () => {
    expect(buildTime('2026-11-14T10:42:00Z', 'UTC')).toBe('14 Nov 2026, 10:42')
    expect(buildTime('2026-11-14T10:42:00Z', 'Asia/Karachi')).toBe('14 Nov 2026, 15:42')
    expect(buildTime('2026-11-14T23:30:00Z', 'Pacific/Auckland')).toBe('15 Nov 2026, 12:30')
    expect(versionWords({ version: '0.7.0', built: '2026-11-14T10:42:00Z', commit: 'abc1234' }, 'UTC')).toBe('0.7.0 · 14 Nov 2026, 10:42 · abc1234')
    // A part that is not known is left out.
    expect(versionWords({ version: '0.7.0', built: '', commit: '' })).toBe('0.7.0')
    expect(versionWords({ version: 'dev', built: 'not a time', commit: '' })).toBe('dev')
  })

  it("Settings shows a Version row with package.json's version and the build's date and time", async () => {
    const x = await settings()
    const row = [...x.host.querySelectorAll('.row')].find((r) => r.querySelector('.row__main')?.textContent === 'Version')!
    expect(row).toBeDefined()
    const words = row.querySelector('.settings__version')!.textContent!
    expect(words.startsWith(`${pkg.version} · ${buildTime('2026-11-14T10:42:00Z')}`)).toBe(true)
    expect(words).toMatch(/^\d+\.\d+\.\d+ · \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/)
  })
})

describe('the build at the top of Settings (YAZ-5555)', () => {
  it('the words: "Build <commit> · <day> <month>, <time>" in the phone\'s own time; the version when no commit', () => {
    expect(buildShortTime('2026-11-15T14:02:00Z', 'UTC')).toBe('15 Nov, 14:02')
    expect(buildShortTime('2026-11-15T23:30:00Z', 'Pacific/Auckland')).toBe('16 Nov, 12:30')
    expect(buildLine({ version: '0.8.0', built: '2026-11-15T14:02:00Z', commit: '8432fd9' }, 'UTC')).toBe('Build 8432fd9 · 15 Nov, 14:02')
    expect(buildLine({ version: '0.8.0', built: '2026-11-15T14:02:00Z', commit: '8432fd91c' }, 'UTC')).toBe('Build 8432fd9 · 15 Nov, 14:02')
    expect(buildLine({ version: '0.8.0', built: '', commit: '8432fd91c-dirty' })).toBe('Build 8432fd9-dirty')
    expect(buildLine({ version: '0.8.0', built: '', commit: '' })).toBe('Build 0.8.0')
    expect(buildLine({ version: 'dev', built: 'not a time', commit: '' })).toBe('Build dev')
  })

  it('it shows without opening anything: one short muted line, the first thing on the screen', async () => {
    const x = await settings()
    const line = x.host.querySelector('.settings__build')!
    expect(line).not.toBeNull()
    expect(line.classList).toContain('muted')
    expect(line.textContent).toBe(buildLine(BUILD))
    expect(line.textContent).toMatch(/^Build \S+ · \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/)
    // Above every row and section of Settings (and above What's new, which stays closed).
    const first = x.host.querySelector('.screen h2, .screen .row')!
    expect(line.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(x.host.querySelector('.whats-new')).toBeNull()
  })
})

describe("What's new (YAZ-5446)", () => {
  it('the list: newest first, its newest is the version of package.json, plain words, no issue keys', () => {
    expect(WHATS_NEW.length).toBeGreaterThanOrEqual(5)
    expect(WHATS_NEW[0].version).toBe(pkg.version)
    const n = (v: string) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0)
    for (let i = 1; i < WHATS_NEW.length; i++) {
      expect(n(WHATS_NEW[i - 1].version)).toBeGreaterThan(n(WHATS_NEW[i].version))
      expect(WHATS_NEW[i - 1].date >= WHATS_NEW[i].date).toBe(true)
    }
    for (const e of WHATS_NEW) {
      expect(e.items.length).toBeGreaterThan(0)
      for (const item of e.items) expect(item).not.toMatch(/YAZ-\d+/)
    }
    expect(entryDay('2026-11-14')).toBe('14 Nov 2026')
  })

  it('closed at first; a tap opens it (the chevron turns, aria-expanded), and a tap closes it', async () => {
    const x = await settings()
    const t = toggle(x)
    expect(t.textContent).toContain("What's new")
    expect(t.querySelector('.whats-new__chevron')?.textContent).toBe('›')
    expect(t.getAttribute('aria-expanded')).toBe('false')
    expect(x.host.querySelector('.whats-new')).toBeNull()

    await act(async () => t.click())
    await x.waitText(WHATS_NEW[0].items[0])
    expect(t.getAttribute('aria-expanded')).toBe('true')
    const box = x.host.querySelector('#whats-new')!
    expect(t.getAttribute('aria-controls')).toBe('whats-new')
    // Each version: a heading (version and day), bullets, and a line between versions.
    const heads = [...box.querySelectorAll('.whats-new__head')].map((e) => e.textContent!.replace(/\s+/g, ' '))
    expect(heads).toEqual(WHATS_NEW.map((e) => `${e.version} · ${entryDay(e.date)}`))
    expect(box.querySelectorAll('.whats-new__entry')[0].querySelectorAll('li')).toHaveLength(WHATS_NEW[0].items.length)
    expect(box.querySelectorAll('hr.whats-new__line')).toHaveLength(WHATS_NEW.length - 1)

    await act(async () => t.click())
    expect(t.getAttribute('aria-expanded')).toBe('false')
    expect(x.host.querySelector('.whats-new')).toBeNull()
  })

  it('open, it scrolls inside its own short box (at most 40% of the screen), contained, with no scroll bar; the chevron turns', async () => {
    const x = await settings()
    const style = document.createElement('style')
    style.dataset.test = ''
    style.textContent = readFileSync(join(HERE, '../styles.css'), 'utf8')
    document.head.append(style)
    await act(async () => toggle(x).click())
    await x.waitText(WHATS_NEW[0].items[0])
    const box = x.host.querySelector('#whats-new')!
    expect(box.classList).toContain('whats-new')
    const css = getComputedStyle(box)
    expect(parseFloat(css.maxHeight)).toBeCloseTo(window.innerHeight * 0.4) // 40vh
    expect(css.overflowY).toBe('auto')
    expect(css.getPropertyValue('overscroll-behavior')).toBe('contain')
    expect(css.getPropertyValue('scrollbar-width')).toBe('none')
    expect(getComputedStyle(x.host.querySelector('.whats-new__chevron')!).transform).toBe('rotate(90deg)')
    // The box is the scroller of its list; the screen stays the only other one (YAZ-5436).
    expect(box.closest('.screen')).not.toBeNull()
  })
})

describe('Sign out and erase this phone: never by accident (YAZ-5446)', () => {
  it('it is the very last thing in Settings, apart from the other rows, in red', async () => {
    const x = await settings()
    const erase = x.button('Sign out and erase this phone')!
    expect(erase.classList).toContain('btn--danger')
    expect(erase.closest('.settings__erase')).not.toBeNull()
    const buttons = [...x.host.querySelectorAll('.screen button')]
    expect(buttons[buttons.length - 1]).toBe(erase)
    // After the version and What's new.
    expect(toggle(x).compareDocumentPosition(erase) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const css = readFileSync(join(HERE, '../styles.css'), 'utf8')
    expect(css).toMatch(/\.settings__erase \{\s*margin-top: 48px;/)
  })

  it('one tap does not erase: the ask shows first, Cancel has the focus, the erase button is red', async () => {
    const x = await settings()
    await x.click('Sign out and erase this phone')
    await x.settle()
    // Nothing is erased yet.
    expect(await x.tokens.read('yaseen/vault@main')).toBe(GOOD)
    const ask = x.host.querySelector('[role="alertdialog"]')!
    expect(ask).not.toBeNull()
    const [cancel, yes] = [...ask.querySelectorAll('.confirm__buttons button')]
    expect(cancel.textContent).toBe('Cancel')
    expect(document.activeElement).toBe(cancel)
    expect(yes.textContent).toBe('Erase this phone')
    expect(yes.classList).toContain('btn--danger')
    // A second tap on the same place (where the ask's first button now is) is Cancel: still nothing erased.
    await act(async () => (cancel as HTMLButtonElement).click())
    expect(await x.tokens.read('yaseen/vault@main')).toBe(GOOD)
    expect(x.host.querySelector('[role="alertdialog"]')).toBeNull()
  })
})
