import { describe, expect, it } from 'vitest'
import { checkDist, missingParts, NEVER_BUNDLED, NOT_FIRST_LOAD } from './checkBuild'

/** The build check (YAZ-5087): what must never be in the published files. */

const ok = [
  { path: 'index.html', text: '<!doctype html><script type="module" src="/assets/index-a.js"></script>' },
  { path: 'assets/index-a.js', text: 'console.log(1)' },
  { path: 'sw.js', text: 'self.addEventListener("fetch",()=>{})' },
]

describe('checkDist', () => {
  it('a clean build has no problem', () => expect(checkDist(ok)).toEqual([]))

  it('the screen fixtures (the dev-only route and its fakes)', () => {
    for (const text of ['mountFixture(root)', 'location.hash.startsWith("#fixture")', 'fakeSync()', 'fakeScanner()']) {
      expect(checkDist([...ok, { path: 'assets/x.js', text }])).toHaveLength(1)
    }
  })

  it('a source map, a localhost address, a token', () => {
    expect(checkDist([...ok, { path: 'assets/index-a.js.map', text: '{}' }])[0]).toMatch(/source map/)
    expect(checkDist([...ok, { path: 'assets/index-a.js', text: '//# sourceMappingURL=index-a.js.map' }])[0]).toMatch(/source map/)
    expect(checkDist([...ok, { path: 'assets/y.js', text: 'fetch("http://localhost:5173/x")' }])[0]).toMatch(/localhost/)
    expect(checkDist([...ok, { path: 'assets/y.js', text: 'fetch("http://127.0.0.1:8787")' }])[0]).toMatch(/localhost/)
    expect(checkDist([...ok, { path: 'assets/y.js', text: 'const t="github_pat_11ABCDEFG0' + 'a'.repeat(70) + '"' }])[0]).toMatch(/token/)
    expect(checkDist([...ok, { path: 'assets/y.js', text: 'const t="ghp_' + 'a'.repeat(36) + '"' }])[0]).toMatch(/token/)
  })

  it('the parts the publish needs: the headers file, the worker, the manifest, the icons, the friend page', () => {
    const all = ['index.html', 'friend.html', 'group.html', 'join.html', '_headers', 'sw.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'version.txt']
    expect(missingParts(all)).toEqual([])
    expect(missingParts(all.filter((p) => p !== 'sw.js' && p !== '_headers'))).toEqual(['_headers', 'sw.js'])
  })

  it('YAZ-5377: the deny lists match what they name, and not the app', () => {
    const never = (m: string) => NEVER_BUNDLED.some((r) => r.test(m))
    for (const m of ['mobile/src/dev/cssAudit.ts', 'mobile/src/dev/fakes.ts', 'mobile/src/page/rawText.test.tsx', 'mobile/src/dev/readerFixtures.tsx', 'mobile/src/friends/check3/run.ts']) expect(never(m), m).toBe(true)
    // YAZ-5092 C3: the test helpers, the research tools, and the checker folders 4 to 6.
    for (const m of ['mobile/src/github/testing.ts', 'mobile/src/friends/check4/model4.testing.ts', 'mobile/src/friends/researchOut.testing.ts', 'mobile/src/friends/check5/run5.research.ts', 'mobile/src/friends/check5/hand.ts', 'mobile/src/friends/check6/run6.ts']) expect(never(m), m).toBe(true)
    for (const m of ['mobile/src/screens/Settings.tsx', 'mobile/src/main.tsx', 'shared/cardLine.ts', 'node_modules/react/index.js', 'mobile/src/friends/checkName.ts', 'mobile/src/settings/testingWords.ts']) expect(never(m), m).toBe(false)
    const lazyOnly = (m: string) => NOT_FIRST_LOAD.some((r) => r.test(m))
    for (const m of ['shared/friendsList.ts', 'shared/friendStats.ts', 'mobile/src/friends/removeQueue.ts', 'node_modules/yaml/browser/index.js', 'node_modules/ts-fsrs/dist/index.mjs', 'node_modules/marked/lib/marked.esm.js']) expect(lazyOnly(m), m).toBe(true)
    for (const m of ['mobile/src/friends/ui/lazy.ts', 'mobile/src/screens/waitingRemoves.ts', 'shared/timeZone.ts', 'node_modules/react-dom/client.js']) expect(lazyOnly(m), m).toBe(false)
  })
})
