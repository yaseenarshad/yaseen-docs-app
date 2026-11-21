// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LOOK_FILE } from '@shared/tableLook'
import { VAULT_SETTINGS_FILES } from '@shared/vaultSettingsFiles'
import { ICONS_FILE } from '@shared/vaultIcons'
import { GOOD, mount, newPhone, signInWithForm, type Harness } from '../screens/testing'
import { healthLine, readVaultHealth, type HealthRow } from './healthRows'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

/** YAZ-5559: Settings › Vault health, read only, from the shared list of the vault's settings files. Made-up vault. */
const VAULT = 'yaseen/vault@main'
const HERE = import.meta.dirname

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
})

/** Every settings file but the table look and the icons; the link clicks file is not JSON. */
async function phoneWithFiles() {
  const phone = await newPhone()
  for (const { file } of VAULT_SETTINGS_FILES) {
    if (file === TABLE_LOOK_FILE || file === ICONS_FILE) continue
    await phone.store.write(VAULT, `.yaseendocs/${file}`, file === 'link-click.json' ? '{ not json' : '{"version":1}')
  }
  return phone
}

describe('the list of settings files (YAZ-5559)', () => {
  it('is the shared one: each name from its own module, no name twice, each a plain <stem>.json', () => {
    const names = VAULT_SETTINGS_FILES.map((f) => f.file)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9-]*\.json$/)
    expect(names).toEqual(expect.arrayContaining(['table-look.json', 'card-look.json', 'text-formatting.json', 'review.json', 'daily-pages.json', 'icons.json', 'folder-pages.json', 'new-places.json', 'link-click.json', 'link-pills.json', 'show-ids.json', 'mobile.json']))
    // The phone spells no file name: its code reads the shared list.
    const code = readFileSync(join(HERE, 'healthRows.ts'), 'utf8') + readFileSync(join(HERE, 'VaultHealth.tsx'), 'utf8')
    expect(code).not.toMatch(/['"`][a-z-]+\.json['"`]/)
  })
})

describe('the words (YAZ-5559)', () => {
  const row = (label: string, state: HealthRow['state']): HealthRow => ({ file: `${label}.json`, label, state })
  it('names the settings that use the defaults, at most three, then a count', () => {
    expect(healthLine([row('text formatting', 'here'), row('table look', 'missing'), row('icons', 'missing')])).toBe('Using defaults: table look, icons')
    expect(healthLine([row('a', 'missing'), row('b', 'unreadable'), row('c', 'missing'), row('d', 'missing'), row('e', 'missing'), row('f', 'here')])).toBe('Using defaults: a, b, c and 2 more')
    expect(healthLine([row('a', 'here'), row('b', 'here')])).toBe('Every settings file is here')
    expect(healthLine([row('a', 'missing'), row('b', 'missing')])).toBe('Using defaults: all settings (no settings files)')
  })

  it("reads the phone's copy: here, missing, or not valid JSON; it writes nothing", async () => {
    const { store } = await phoneWithFiles()
    const write = vi.spyOn(store, 'write')
    const rows = await readVaultHealth(store, VAULT)
    expect(rows.map((r) => r.file)).toEqual(VAULT_SETTINGS_FILES.map((f) => f.file))
    expect(rows.filter((r) => r.state === 'missing').map((r) => r.label)).toEqual(['table look', 'icons'])
    expect(rows.filter((r) => r.state === 'unreadable').map((r) => r.label)).toEqual(['link clicks'])
    expect(healthLine(rows)).toBe('Using defaults: link clicks, table look, icons')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('Settings › Vault health (YAZ-5559)', () => {
  it('one line for the open vault; a tap shows the list; a tap hides it', async () => {
    h = await mount({ phone: await phoneWithFiles() })
    await signInWithForm(h, 'yaseen/vault', GOOD)
    await h.click('Settings')
    await h.waitText('Using defaults')
    const toggle = h.host.querySelector<HTMLButtonElement>('.vault-health__toggle')!
    expect(toggle.textContent).toContain('Vault health Using defaults: link clicks, table look, icons')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(h.host.querySelector('#vault-health-list')).toBeNull()
    // Under the vaults, before Friends.
    const friends = [...h.host.querySelectorAll('h2.section')].find((e) => e.textContent === 'Friends')!
    expect(toggle.compareDocumentPosition(friends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await act(async () => toggle.click())
    const list = h.host.querySelector('#vault-health-list')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const rows = [...list.querySelectorAll('li.row')].map((li) => li.textContent)
    expect(rows).toHaveLength(VAULT_SETTINGS_FILES.length)
    expect(rows).toContain('Table looktable-look.jsonMac defaults')
    expect(rows).toContain('Text formattingtext-formatting.jsonIn the vault')
    expect(rows).toContain('Link clickslink-click.jsonNot valid JSON: Mac defaults')
    expect(list.textContent).toContain('Read only.')
    // Read only: no control in the list.
    expect(list.querySelectorAll('button, input, select, a')).toHaveLength(0)

    await act(async () => toggle.click())
    expect(h.host.querySelector('#vault-health-list')).toBeNull()
  })
})
