/** The language of a file name by Monaco's own entries (YAZ-3508): file name, then pattern, then the longest extension. */
import { describe, expect, it } from 'vitest'
import { languageForPath, type LanguageEntry } from './languageForPath'

// The entries as Monaco and `monacoLanguages.ts` register them (YAZ-3479, YAZ-3505).
const LANGS: LanguageEntry[] = [
  { id: 'plaintext', extensions: ['.txt'] },
  { id: 'typescript', extensions: ['.ts', '.tsx', '.cts', '.mts'] },
  { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'dockerfile', filenamePatterns: ['Dockerfile.*'] },
  { id: 'ruby', extensions: ['.rb'], filenames: ['rakefile', 'Gemfile'] },
  { id: 'ruby', filenames: ['Vagrantfile'] },
  { id: 'makefile', extensions: [], filenames: ['Makefile'] },
  { id: 'groovy', extensions: ['.groovy', '.gradle'], filenames: ['Jenkinsfile'] },
  { id: 'json', extensions: ['.json'] },
  { id: 'jsonc', extensions: ['.tsconfig.json'] },
]

describe('languageForPath', () => {
  it('an extension, case aside, wherever the file is', () => {
    expect(languageForPath('/vault/src/app.ts', LANGS)).toBe('typescript')
    expect(languageForPath('/vault/APP.TS', LANGS)).toBe('typescript')
    expect(languageForPath('/vault/build.gradle', LANGS)).toBe('groovy')
  })

  it('a whole file name beats an extension; then a pattern; the longest extension wins', () => {
    expect(languageForPath('/vault/Dockerfile', LANGS)).toBe('dockerfile')
    expect(languageForPath('/vault/deploy/Dockerfile.dev', LANGS)).toBe('dockerfile')
    expect(languageForPath('/vault/Makefile', LANGS)).toBe('makefile')
    expect(languageForPath('/vault/Gemfile', LANGS)).toBe('ruby')
    expect(languageForPath('/vault/Vagrantfile', LANGS)).toBe('ruby')
    expect(languageForPath('/vault/Jenkinsfile', LANGS)).toBe('groovy')
    expect(languageForPath('/vault/base.tsconfig.json', LANGS)).toBe('jsonc')
  })

  it('a Windows path names the file after its last backslash (YAZ-3516)', () => {
    expect(languageForPath('C:\\v\\Dockerfile', LANGS)).toBe('dockerfile')
    expect(languageForPath('C:\\v\\deploy\\Dockerfile.dev', LANGS)).toBe('dockerfile')
  })

  it('nothing known: plain text (LICENSE, Procfile, CODEOWNERS)', () => {
    for (const name of ['LICENSE', 'Procfile', 'CODEOWNERS', 'data.unknown']) expect(languageForPath(`/vault/${name}`, LANGS), name).toBe('plaintext')
  })
})
