import { describe, expect, it } from 'vitest'
import { checkDist, missingParts } from './checkBuild'

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
})
