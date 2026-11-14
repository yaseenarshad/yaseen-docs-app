import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cspOf, headersFor, parseHeaders } from './headers'

/**
 * The headers of the site (`public/_headers`, Cloudflare static assets; YAZ-5087). The CSP is checked against the calls
 * the code really makes: a new origin in the app's code fails here until the CSP names it, and the CSP may name nothing
 * the code does not call (decision 8, round 12 item 13, decision 13).
 */

const here = new URL('..', import.meta.url).pathname
const rules = parseHeaders(readFileSync(join(here, 'public/_headers'), 'utf8'))
const page = headersFor(rules, '/')
const csp = cspOf(page['content-security-policy'] ?? '')

const appSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'dev' ? [] : appSources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'testing.ts' ? [path] : []
  })

/** Every https origin written in the app's code (not its tests, not the dev fixtures). */
const originsInCode = new Map<string, string[]>()
for (const file of appSources(join(here, 'src'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const origin = `https://${m[1].toLowerCase()}`
    originsInCode.set(origin, [...(originsInCode.get(origin) ?? []), file.slice(here.length)])
  }
}

/**
 * Origins in the code that the page never CALLS, each with the reason. Anything else in the code must be in `connect-src`.
 * - github.com: the "Set up your phone" guide's link (the person opens it in Safari) and the sign-in's address parse.
 * - avatars.githubusercontent.com: the comment that names it; the address itself comes from GitHub's answer (`img-src`).
 */
const NOT_CALLED: Record<string, string> = {
  'https://github.com': 'a link the person opens, and text the sign-in parses',
  'https://avatars.githubusercontent.com': 'pictures only (img-src), round 12 item 13',
}

describe('the Content-Security-Policy of the app', () => {
  it('connect-src: exactly the origins the code calls (GitHub\'s API), nothing more', () => {
    const called = [...originsInCode.keys()].filter((o) => !(o in NOT_CALLED)).sort()
    expect(called).toEqual(['https://api.github.com'])
    expect(csp.get('connect-src')).toEqual(called)
  })

  it('each origin in the code is either called (connect-src) or listed here with its reason', () => {
    for (const [origin, files] of originsInCode) {
      expect([origin, files, origin in NOT_CALLED || csp.get('connect-src')!.includes(origin)]).toEqual([origin, files, true])
    }
  })

  it("img-src: self, blob:, data: and GitHub's avatar host only; media-src: self and blob: (3D keeps media in IndexedDB)", () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'blob:', 'data:', 'https://avatars.githubusercontent.com'])
    expect(csp.get('media-src')).toEqual(["'self'", 'blob:'])
  })

  it('scripts: this site only. No inline script, no eval, no third-party script, font or analytics', () => {
    expect(csp.get('default-src')).toEqual(["'self'"])
    expect(csp.get('script-src')).toEqual(["'self'"])
    expect(csp.get('font-src')).toEqual(["'self'"])
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    const all = page['content-security-policy']
    expect(all).not.toMatch(/unsafe-eval|wasm-unsafe-eval|\*|http:/)
    for (const name of ['index.html', 'friend.html']) {
      const html = readFileSync(join(here, name), 'utf8')
      expect([name, /<script(?![^>]*\bsrc=)[^>]*>/.test(html)]).toEqual([name, false])
      expect([name, /(src|href)="https?:/.test(html)]).toEqual([name, false])
    }
  })

  it('no plugin, no frame of the page elsewhere, no base or form tricks; the worker comes from this site', () => {
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'none'"])
    expect(csp.get('form-action')).toEqual(["'none'"])
    expect(csp.get('worker-src')).toEqual(["'self'"])
    expect(csp.get('manifest-src')).toEqual(["'self'"])
  })

  it('every path gets the same policy (the single-page fallback, the friend page, the files)', () => {
    for (const path of ['/index.html', '/some/route', '/friend', '/assets/index-abc.js', '/manifest.webmanifest']) {
      expect([path, headersFor(rules, path)['content-security-policy']]).toEqual([path, page['content-security-policy']])
    }
  })

  it("the worker file has its own policy: it may fetch this site's files and nothing else", () => {
    const sw = cspOf(headersFor(rules, '/sw.js')['content-security-policy'] ?? '')
    expect(sw.get('default-src')).toEqual(["'none'"])
    expect(sw.get('connect-src')).toEqual(["'self'"])
    expect(headersFor(rules, '/sw.js')['content-security-policy']).not.toContain('github')
  })
})

describe('the other headers', () => {
  it('no referrer ever (the friend link and the token never leak), no type sniffing, the camera for this site only', () => {
    for (const path of ['/', '/friend', '/assets/index-abc.js', '/sw.js']) {
      const h = headersFor(rules, path)
      expect([path, h['referrer-policy'], h['x-content-type-options']]).toEqual([path, 'no-referrer', 'nosniff'])
      expect(h['permissions-policy']).toMatch(/(^|, )camera=\(self\)(,|$)/)
      expect(h['permissions-policy']).toMatch(/microphone=\(\)/)
      expect(h['permissions-policy']).toMatch(/geolocation=\(\)/)
    }
  })

  it('hashed files: cached for a year; the page, the friend page, the worker and the manifest: always asked again', () => {
    expect(headersFor(rules, '/assets/index-abc.js')['cache-control']).toBe('public, max-age=31536000, immutable')
    for (const path of ['/', '/index.html', '/friend', '/friend.html', '/sw.js', '/manifest.webmanifest', '/version.txt']) {
      expect([path, headersFor(rules, path)['cache-control']]).toEqual([path, 'no-cache'])
    }
  })
})

describe('the rules file reader (Cloudflare _headers)', () => {
  it('splats, several rules joined, and a detach', () => {
    const r = parseHeaders('# c\n/*\n  A: 1\n  B: x\n/a/*\n  A: 2\n  ! B\n')
    expect(headersFor(r, '/a/b')).toEqual({ a: '1, 2' })
    expect(headersFor(r, '/c')).toEqual({ a: '1', b: 'x' })
  })
})
