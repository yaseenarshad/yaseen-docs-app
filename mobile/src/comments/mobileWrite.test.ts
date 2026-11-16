import { describe, expect, it } from 'vitest'
import { DEFAULT_MOBILE_SETTINGS, MOBILE_SETTINGS_FILE, mobileSettingsValue, sanitizeMobileSettings, withMobileSetting, type MobileSettingKey } from '@shared/mobileSettings'
import { VAULT_SETTINGS_FILES } from '@shared/vaultSettingsFiles'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { notSentWords } from '../status/NotSent'
import { MOBILE_SETTINGS_PATH, applyVaultSetting } from './mobileWrite'
import { commentsSetup, isPatch, PAGE, PLAN, VAULT } from './testing'
import { withWaiting } from '../page/mobileSettings'
import type { WaitingComment } from './outbox'

/**
 * YAZ-5592: the vault's mobile settings, `.yaseendocs/mobile.json`: the shared schema (only what differs from the
 * defaults, unknown keys kept, sanitised), and the phone's FIRST write of a vault settings file, on the comments' safe
 * path (compare-and-swap, the fresh file, again on a race, never a lost change). Made-up vault and values only.
 */
const off = (key: MobileSettingKey) => ({ file: 'mobile' as const, key, on: false })
const on = (key: MobileSettingKey) => ({ file: 'mobile' as const, key, on: true })

describe('YAZ-5592: the schema (shared/mobileSettings.ts)', () => {
  it('defaults on, on; anything that is not a boolean is the default', () => {
    expect(DEFAULT_MOBILE_SETTINGS).toEqual({ folding: true, stickyHeadings: true, fitTables: false })
    for (const raw of [undefined, null, 'x', 3, [], {}, { folding: 'no', stickyHeadings: 0 }]) expect(sanitizeMobileSettings(raw)).toEqual({ folding: true, stickyHeadings: true, fitTables: false })
    expect(sanitizeMobileSettings({ version: 1, folding: false })).toEqual({ folding: false, stickyHeadings: true, fitTables: false })
    expect(sanitizeMobileSettings({ stickyHeadings: false, later: { a: 1 } })).toEqual({ folding: true, stickyHeadings: false, fitTables: false })
  })

  it('the file holds only what differs from the defaults, beside its version', () => {
    expect(mobileSettingsValue({ folding: true, stickyHeadings: true, fitTables: false })).toEqual({ version: 1 })
    expect(mobileSettingsValue({ folding: false, stickyHeadings: true, fitTables: false })).toEqual({ version: 1, folding: false })
    expect(withMobileSetting(null, 'stickyHeadings', false)).toBe('{\n  "version": 1,\n  "stickyHeadings": false\n}\n')
    expect(withMobileSetting('{"version":1,"stickyHeadings":false}', 'stickyHeadings', true)).toBe('{\n  "version": 1\n}\n')
  })

  it('every key this build does not know stays, where it stood; a newer version stays', () => {
    const later = '{\n  "version": 2,\n  "tablet": { "columns": 2 },\n  "folding": false\n}\n'
    const out = withMobileSetting(later, 'stickyHeadings', false)
    expect(JSON.parse(out)).toEqual({ version: 2, tablet: { columns: 2 }, folding: false, stickyHeadings: false })
    expect(Object.keys(JSON.parse(out))).toEqual(['version', 'tablet', 'folding', 'stickyHeadings'])
  })

  it('YAZ-5658: Wide tables, Same as Desktop by default (`fitTables` off); Fit Screen is written, the other keys stay', () => {
    expect(DEFAULT_MOBILE_SETTINGS.fitTables).toBe(false)
    expect(sanitizeMobileSettings({ fitTables: true })).toEqual({ folding: true, stickyHeadings: true, fitTables: true })
    expect(sanitizeMobileSettings({ fitTables: 'yes' }).fitTables).toBe(false)
    const later = '{\n  "version": 1,\n  "tablet": { "columns": 2 },\n  "folding": false\n}\n'
    const out = withMobileSetting(later, 'fitTables', true)
    expect(Object.keys(JSON.parse(out))).toEqual(['version', 'tablet', 'folding', 'fitTables'])
    expect(withMobileSetting(out, 'fitTables', false)).toBe('{\n  "version": 1,\n  "tablet": {\n    "columns": 2\n  },\n  "folding": false\n}\n')
    expect(applyVaultSetting(null, off('fitTables'))).toEqual({ kind: 'already' })
  })

  it('a file that is not a JSON object is not written over', () => {
    expect(() => withMobileSetting('{ not json', 'folding', false)).toThrow()
    expect(() => withMobileSetting('[1]', 'folding', false)).toThrow()
  })

  it('Vault health lists the file, from its own module', () => {
    expect(MOBILE_SETTINGS_PATH).toBe(`${VAULT_CONFIG_DIR}/${MOBILE_SETTINGS_FILE}`)
    expect(VAULT_SETTINGS_FILES).toContainEqual({ file: 'mobile.json', label: 'mobile' })
  })
})

describe('YAZ-5592: the write (mobileWrite.ts), pure and idempotent', () => {
  it('no file: made; a file already so: nothing (a retry); a file that does not read: refused', () => {
    expect(applyVaultSetting(null, off('folding'))).toEqual({ kind: 'set', content: '{\n  "version": 1,\n  "folding": false\n}\n' })
    expect(applyVaultSetting(null, on('folding'))).toEqual({ kind: 'already' })
    expect(applyVaultSetting('{"version":1,"folding":false}\n', off('folding'))).toEqual({ kind: 'already' })
    expect(applyVaultSetting('{ not json', off('folding'))).toEqual({ kind: 'refused', why: 'invalid' })
  })

  it('a waiting change shows at once over the file; a refused one does not', () => {
    const w = (setting: WaitingComment['setting'], refused?: WaitingComment['refused']): WaitingComment => ({ id: 'x', path: MOBILE_SETTINGS_PATH, body: '', at: '', madeAt: 0, notBefore: 0, setting, ...(refused ? { refused } : {}) })
    expect(withWaiting({ folding: true, stickyHeadings: true, fitTables: false }, [w(off('stickyHeadings'))])).toEqual({ folding: true, stickyHeadings: false, fitTables: false })
    expect(withWaiting({ folding: true, stickyHeadings: true, fitTables: false }, [w(off('stickyHeadings')), w(on('stickyHeadings'))])).toEqual({ folding: true, stickyHeadings: true, fitTables: false })
    expect(withWaiting({ folding: true, stickyHeadings: true, fitTables: false }, [w(off('folding'), 'invalid')])).toEqual({ folding: true, stickyHeadings: true, fitTables: false })
    expect(notSentWords(w(off('stickyHeadings')))).toBe('This vault on mobile, Sticky headings: Off')
    expect(notSentWords(w(on('fitTables')))).toBe('This vault on mobile, Wide tables: Fit Screen')
    expect(withWaiting({ folding: true, stickyHeadings: true, fitTables: false }, [w(on('fitTables'))]).fitTables).toBe(true)
  })
})

describe('YAZ-5592: the round trip on the safe path (fake GitHub, made-up vault)', () => {
  it('no file yet: one commit makes it with compare-and-swap; the phone reads it back; nothing waits after', async () => {
    const t = await commentsSetup({ [PAGE]: PLAN })
    await t.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: off('stickyHeadings') })
    await t.settle()
    const file = (await t.remote(MOBILE_SETTINGS_PATH))!
    expect(file).toBe('{\n  "version": 1,\n  "stickyHeadings": false\n}\n')
    expect(sanitizeMobileSettings(JSON.parse(file))).toEqual({ folding: true, stickyHeadings: false, fitTables: false })
    expect(t.patches()).toBe(1)
    expect(t.s.github.calls.some((c) => c.method === 'PATCH' && c.url.includes('force=true'))).toBe(false)
    expect(t.port.waiting()).toEqual([])
    expect((await t.s.store.read(VAULT, MOBILE_SETTINGS_PATH))?.content).toBe(file)
    // On again: the file goes back to its version alone (the default is never stored).
    await t.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: on('stickyHeadings') })
    await t.settle()
    expect(await t.remote(MOBILE_SETTINGS_PATH)).toBe('{\n  "version": 1\n}\n')
    expect(t.port.waiting()).toEqual([])
  })

  it('a file with keys this build does not know: they stay', async () => {
    const t = await commentsSetup({ [PAGE]: PLAN, [MOBILE_SETTINGS_PATH]: '{\n  "version": 1,\n  "tablet": true\n}\n' })
    await t.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: off('folding') })
    await t.settle()
    expect(JSON.parse((await t.remote(MOBILE_SETTINGS_PATH))!)).toEqual({ version: 1, tablet: true, folding: false })
  })

  it('the race: the Mac changes the file just before the ref move; the phone writes again on the fresh file, and both changes stay', async () => {
    const t = await commentsSetup({ [PAGE]: PLAN })
    let raced = false
    t.setHook(async (_url, init, forward) => {
      if (isPatch(init) && !raced) {
        raced = true
        await t.macPush({ [MOBILE_SETTINGS_PATH]: '{\n  "version": 1,\n  "folding": false,\n  "tablet": true\n}\n' })
      }
      return forward()
    })
    await t.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: off('stickyHeadings') })
    await t.settle()
    expect(JSON.parse((await t.remote(MOBILE_SETTINGS_PATH))!)).toEqual({ version: 1, folding: false, tablet: true, stickyHeadings: false })
    expect(t.patches()).toBe(2)
    expect(t.port.waiting()).toEqual([])
  })

  it('two changes made offline go in one commit, in order; a file that does not read is refused, kept on the phone, nothing written', async () => {
    const t = await commentsSetup({ [PAGE]: PLAN })
    await t.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: off('folding') })
    await t.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: off('stickyHeadings') })
    await t.settle()
    expect(JSON.parse((await t.remote(MOBILE_SETTINGS_PATH))!)).toEqual({ version: 1, folding: false, stickyHeadings: false })

    const u = await commentsSetup({ [PAGE]: PLAN, [MOBILE_SETTINGS_PATH]: '{ half a file' })
    await u.port.add({ path: MOBILE_SETTINGS_PATH, body: '', setting: off('folding') })
    await u.settle()
    expect(await u.remote(MOBILE_SETTINGS_PATH)).toBe('{ half a file')
    expect(u.patches()).toBe(0)
    expect(u.port.waiting().map((c) => c.refused)).toEqual(['invalid'])
  })
})
