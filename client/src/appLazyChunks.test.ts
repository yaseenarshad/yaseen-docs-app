/**
 * A module App loads lazily (`import('./x')`) must not also be imported by App at startup (YAZ-4955). The build cannot
 * split such a module: it stays in the startup bundle and the build warns "dynamic import will not move module into
 * another chunk". A small eager helper of a lazy module goes in its own file (`vault/folderHome.ts`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(join(__dirname, 'App.tsx'), 'utf8')

describe('App: each lazy chunk is lazy only (YAZ-4955)', () => {
  it('no module is both imported at startup and loaded with import()', () => {
    const lazy = new Set([...APP.matchAll(/(?<!typeof )import\('(\.[^']+)'\)/g)].map((m) => m[1]))
    const eager = [...APP.matchAll(/^import (?!type )[^;]*? from '(\.[^']+)'/gm)].map((m) => m[1])
    expect(lazy.size).toBeGreaterThan(0)
    expect(eager.filter((path) => lazy.has(path))).toEqual([])
  })
})
