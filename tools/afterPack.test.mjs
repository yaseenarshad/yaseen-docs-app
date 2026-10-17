import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const { trimChromiumLocales } = createRequire(import.meta.url)('../desktop/build/adhocSign.cjs')

describe('trimChromiumLocales (🔒 YAZ-2131 D1, YAZ-2182)', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (file) => {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'pak')
  }

  it("keeps the framework's English locale folders and every app-level .lproj marker on the Mac; a second run changes nothing", () => {
    dir = mkdtempSync(join(tmpdir(), 'yaz-2182-locales-'))
    const app = join(dir, 'Yaseen Docs.app', 'Contents')
    const fw = join(app, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources')
    for (const l of ['en', 'en_FEMININE', 'en_GB', 'en_GB_NEUTER', 'de', 'de_FEMININE', 'es_419', 'zh_TW']) put(join(fw, `${l}.lproj`, 'locale.pak'))
    put(join(fw, 'resources.pak'))
    for (const l of ['en', 'de', 'zh_TW']) mkdirSync(join(app, 'Resources', `${l}.lproj`), { recursive: true })
    const kept = ['en.lproj', 'en_FEMININE.lproj', 'en_GB.lproj', 'en_GB_NEUTER.lproj', 'resources.pak']

    trimChromiumLocales(dir, 'darwin', 'Yaseen Docs')
    expect(readdirSync(fw).sort()).toEqual(kept)
    expect(readdirSync(join(fw, 'en.lproj'))).toEqual(['locale.pak'])
    expect(readdirSync(join(app, 'Resources')).sort()).toEqual(['de.lproj', 'en.lproj', 'zh_TW.lproj'])

    trimChromiumLocales(dir, 'darwin', 'Yaseen Docs')
    expect(readdirSync(fw).sort()).toEqual(kept)
    expect(readdirSync(join(app, 'Resources')).sort()).toEqual(['de.lproj', 'en.lproj', 'zh_TW.lproj'])
  })

  it("keeps Windows' en-US and en-GB paks only; a second run changes nothing", () => {
    dir = mkdtempSync(join(tmpdir(), 'yaz-2182-locales-'))
    for (const l of ['en-US', 'en-GB', 'de', 'es-419', 'zh-TW']) put(join(dir, 'locales', `${l}.pak`))
    trimChromiumLocales(dir, 'win32', 'Yaseen Docs')
    expect(readdirSync(join(dir, 'locales')).sort()).toEqual(['en-GB.pak', 'en-US.pak'])
    trimChromiumLocales(dir, 'win32', 'Yaseen Docs')
    expect(readdirSync(join(dir, 'locales')).sort()).toEqual(['en-GB.pak', 'en-US.pak'])
  })
})

const { signIdentity } = createRequire(import.meta.url)('../desktop/build/adhocSign.cjs')

describe('signIdentity (YAZ-2976 D1, S27)', () => {
  it('signs with the certificate when the keychain has it, named by MAC_SIGN_IDENTITY or by default', () => {
    expect(signIdentity({}, (n) => n === 'Yaseen Local Signing')).toBe('Yaseen Local Signing')
    expect(signIdentity({ MAC_SIGN_IDENTITY: 'Other' }, (n) => n === 'Other')).toBe('Other')
  })

  it('falls back to ad-hoc with a warning when the certificate is missing', () => {
    const warn = console.warn
    const said = []
    console.warn = (m) => said.push(m)
    try {
      expect(signIdentity({}, () => false)).toBe('-')
    } finally {
      console.warn = warn
    }
    expect(said.join('')).toContain('ad-hoc')
  })

  it('throws instead when REQUIRE_SIGN_IDENTITY is 1: a release never ships an ad-hoc build', () => {
    expect(() => signIdentity({ REQUIRE_SIGN_IDENTITY: '1' }, () => false)).toThrow(/REQUIRE_SIGN_IDENTITY/)
    expect(signIdentity({ REQUIRE_SIGN_IDENTITY: '1' }, () => true)).toBe('Yaseen Local Signing')
  })
})
