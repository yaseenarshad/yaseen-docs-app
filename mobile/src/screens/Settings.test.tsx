// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILD, buildLine, buildShortTime, buildTime, versionWords } from '../settings/buildInfo'
import { WHATS_NEW, entryDay } from '../settings/whatsNew'
import { GOOD, SECOND, mount, signInWithForm, type Harness } from './testing'
import { BADGE_HUES, vaultNumber } from './VaultBadge'

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
  it("the words: the version, the build (the commit, as /version.txt names it), the build's date and time in the phone's own time (YAZ-5593)", () => {
    expect(buildTime('2026-11-14T10:42:00Z', 'UTC')).toBe('14 Nov 2026, 10:42')
    expect(buildTime('2026-11-14T10:42:00Z', 'Asia/Karachi')).toBe('14 Nov 2026, 15:42')
    expect(buildTime('2026-11-14T23:30:00Z', 'Pacific/Auckland')).toBe('15 Nov 2026, 12:30')
    expect(versionWords({ version: '0.7.0', built: '2026-11-15T14:02:00Z', commit: 'bb8a4aa30' }, 'UTC')).toBe('Version 0.7.0 · Build bb8a4aa30 · 15 Nov 2026, 14:02')
    // A part that is not known is left out.
    expect(versionWords({ version: '0.7.0', built: '', commit: '' })).toBe('Version 0.7.0')
    expect(versionWords({ version: 'dev', built: 'not a time', commit: '' })).toBe('Version dev')
  })

  it("Settings shows a Version row with package.json's version and the build's date and time", async () => {
    const x = await settings()
    const row = [...x.host.querySelectorAll('.row')].find((r) => r.querySelector('.row__main')?.textContent === 'Version')!
    expect(row).toBeDefined()
    const words = row.querySelector('.settings__version')!.textContent!
    expect(words.startsWith(`Version ${pkg.version} · `)).toBe(true)
    expect(words.endsWith(buildTime(BUILD.built))).toBe(true)
    expect(words).toMatch(/^Version \d+\.\d+\.\d+ · (Build \S+ · )?\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/)
  })
})

describe('the build at the top of Settings (YAZ-5555)', () => {
  it('the words: "Build <commit> · <day> <month>, <time>" in the phone\'s own time (YAZ-5593: the whole short commit, as /version.txt); the version when no commit', () => {
    expect(buildShortTime('2026-11-15T14:02:00Z', 'UTC')).toBe('15 Nov, 14:02')
    expect(buildShortTime('2026-11-15T23:30:00Z', 'Pacific/Auckland')).toBe('16 Nov, 12:30')
    expect(buildLine({ version: '0.8.0', built: '2026-11-15T14:02:00Z', commit: '8432fd9' }, 'UTC')).toBe('Build 8432fd9 · 15 Nov, 14:02')
    expect(buildLine({ version: '0.8.0', built: '2026-11-15T14:02:00Z', commit: '8432fd91c' }, 'UTC')).toBe('Build 8432fd91c · 15 Nov, 14:02')
    expect(buildLine({ version: '0.8.0', built: '', commit: '8432fd91c-dirty' })).toBe('Build 8432fd91c-dirty')
    expect(buildLine({ version: '0.8.0', built: '', commit: '' })).toBe('Build 0.8.0')
    expect(buildLine({ version: 'dev', built: 'not a time', commit: '' })).toBe('Build dev')
  })

  it('YAZ-5659: it shows without opening anything, one short muted line in About, right under What\'s new (with the address and Check for updates)', async () => {
    const x = await settings()
    const line = x.host.querySelector('.settings__build')!
    expect(line).not.toBeNull()
    expect(line.classList).toContain('muted')
    expect(line.textContent).toBe(buildLine(BUILD))
    expect(line.textContent).toMatch(/^Build \S+ · \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/)
    // In About: after the What's new row (which stays closed), before the next section.
    const about = [...x.host.querySelectorAll('.screen h2')].find((e) => e.textContent === 'About Yaseen Docs')!
    expect(toggle(x).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.closest('.settings__update')!.previousElementSibling).toBe(toggle(x).closest('ul'))
    expect(about.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.nextElementSibling!.classList).toContain('settings__host')
    expect(x.host.querySelector('.whats-new')).toBeNull()
  })
})

describe('YAZ-5659: Settings starts with the vaults; each row a number, a name and its path', () => {
  async function twoVaults(): Promise<Harness> {
    const x = await mount()
    await signInWithForm(x, 'yaseen/vault', GOOD)
    await x.click('Settings')
    await x.click('Add vault')
    await signInWithForm(x, 'yaseen/second', SECOND)
    return x
  }
  const rows = (x: Harness) =>
    [...x.host.querySelectorAll('ul[aria-label="Vaults"] > li .vault-row')].map((r) => ({
      n: r.querySelector('.vault-badge')?.textContent,
      hue: r.querySelector<HTMLElement>('.vault-badge')?.dataset.hue,
      name: r.querySelector('.vault-row__name')?.textContent,
      path: r.querySelector('.vault-row__path')?.textContent,
      open: r.querySelector('.vault-row__open')?.textContent ?? null,
    }))
  const topBadge = (x: Harness) => x.host.querySelector('.topbar .vault-badge')?.textContent ?? null

  it('the first section is Vaults: no build line, address or Check for updates above it', async () => {
    const x = await settings()
    const first = x.host.querySelector('.screen h2, .screen .row, .screen .settings__build, .screen .settings__host')!
    expect(first.tagName).toBe('H2')
    expect(first.textContent).toBe('Vaults')
    const heads = [...x.host.querySelectorAll('.screen h2.section')].map((e) => e.textContent)
    expect(heads.indexOf('Vaults')).toBe(0)
    expect(heads.at(-1)).toBe('This phone')
  })

  it('a row: the number badge, the name in words over "owner/repo · branch", the Open pill on the open vault, the ⋯', async () => {
    h = await twoVaults()
    await h.click('Settings')
    expect(rows(h)).toEqual([
      { n: '1', hue: 'blue', name: 'Vault', path: 'yaseen/vault · main', open: null },
      { n: '2', hue: 'amber', name: 'Second', path: 'yaseen/second · main', open: 'Open' },
    ])
    const row = h.host.querySelector('.vault-row')!
    expect(row.querySelector('.vault-badge')!.getAttribute('aria-hidden')).toBe('true')
    expect(row.querySelector('.icon-btn')!.textContent!.trim()).toBe('⋯')
    expect(h.button('Second, yaseen/second, open')).not.toBeNull()
    expect(h.button('Open Vault, yaseen/vault')).not.toBeNull()
  })

  it('the numbers follow the list; opening a vault keeps them; YAZ-5663: never a number in the top bar', async () => {
    h = await twoVaults()
    expect(topBadge(h)).toBeNull()
    await h.click('Settings')
    await h.click('Open Vault, yaseen/vault')
    expect(topBadge(h)).toBeNull()
    await h.click('Settings')
    expect(rows(h).map((r) => [r.n, r.name, r.open])).toEqual([
      ['1', 'Vault', 'Open'],
      ['2', 'Second', null],
    ])
  })

  it('removing a vault renumbers the rest (remove 1: the old 2 becomes 1)', async () => {
    h = await twoVaults()
    await h.click('Settings')
    await h.click('More for yaseen/vault')
    await h.click('Remove from this phone')
    await h.click('Remove')
    expect(rows(h).map((r) => [r.n, r.hue, r.name])).toEqual([['1', 'blue', 'Second']])
    await h.click('Back')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('second')
  })

  it('the badge: 34 px rounded square, medium weight, a soft colour per number (1 blue, 2 amber, 3 green, 4 pink, again)', () => {
    expect(BADGE_HUES).toEqual(['blue', 'amber', 'green', 'pink'])
    const list = ['a/one', 'a/two', 'a/three', 'a/four', 'a/five'].map((repo) => ({ repo, branch: 'main' }))
    expect(list.map((v) => vaultNumber(list, `${v.repo}@main`))).toEqual([1, 2, 3, 4, 5])
    expect(vaultNumber(list, 'a/gone@main')).toBeNull()
    const css = readFileSync(join(HERE, '../styles.css'), 'utf8')
    expect(css).toMatch(/\.vault-badge \{[^}]*width: 34px;[^}]*height: 34px;[^}]*border-radius: 9px;[^}]*font-weight: 500;/)
    for (const hue of BADGE_HUES) {
      expect(css).toContain(`.vault-badge[data-hue='${hue}'] {`)
      expect(css).toContain(`:where([data-scheme='dark']) .vault-badge[data-hue='${hue}'] {`)
    }
    // YAZ-5663: the top bar has no badge, so no top-bar size of it either.
    expect(css).not.toContain('vault-badge--top')
  })

  it('a long name and a long path each stay on one line, cut with "…", never wrapped into the other', async () => {
    h = await twoVaults()
    await h.click('Settings')
    const style = document.createElement('style')
    style.dataset.test = ''
    style.textContent = readFileSync(join(HERE, '../styles.css'), 'utf8')
    document.head.append(style)
    for (const sel of ['.vault-row__name', '.vault-row__path']) {
      const css = getComputedStyle(h.host.querySelector(sel)!)
      expect(css.whiteSpace).toBe('nowrap')
      expect(css.textOverflow).toBe('ellipsis')
      expect(css.overflow).toBe('hidden')
    }
    expect(getComputedStyle(h.host.querySelector('.vault-row__name')!).fontSize).toBe('16px')
    expect(getComputedStyle(h.host.querySelector('.vault-row__name')!).fontWeight).toBe('500')
    expect(getComputedStyle(h.host.querySelector('.vault-row__words')!).minWidth).toBe('0px')
    expect(getComputedStyle(h.host.querySelector('.vault-badge')!).flexShrink).toBe('0')
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
