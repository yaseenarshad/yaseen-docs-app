import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keepPrevious } from './keepPrevious'

/**
 * YAZ-5303: a request of an old page can go PAST the worker (Chrome sends it to the network when it stops the old
 * worker during a swap). So each publish keeps the live build's hashed files on the host for one more deploy: the
 * publish copies the chunks that the live `sw.js` lists, and that the new build does not have, into `dist/assets/`.
 */
const LIVE = 'https://preview.example.test'
const liveSw = `var h={version:"old1",files:["/","/assets/index-OLD.js","/assets/service-OLD.js","/assets/review-OLD.css","/assets/same-X.js","/friend","/icons/i.png"],entry:"/assets/index-OLD.js"}`

function dist() {
  const dir = mkdtempSync(join(tmpdir(), 'keep-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'same-X.js'), 'new same')
  writeFileSync(join(dir, 'assets', 'index-NEW.js'), 'new')
  return dir
}

const host = (files: Record<string, { body: string; type: string; status?: number }>) => async (url: string) => {
  const path = new URL(url).pathname
  const f = files[path]
  return f ? new Response(f.body, { status: f.status ?? 200, headers: { 'content-type': f.type } }) : new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
}

describe('keepPrevious', () => {
  it("copies the live build's chunks that the new build lacks; never a page, an icon, or a file the new build has", async () => {
    const dir = dist()
    const got = await keepPrevious(dir, LIVE, host({
      '/sw.js': { body: liveSw, type: 'text/javascript' },
      '/assets/index-OLD.js': { body: 'old index', type: 'text/javascript' },
      '/assets/service-OLD.js': { body: 'old service', type: 'text/javascript' },
      '/assets/review-OLD.css': { body: '.old{}', type: 'text/css' },
    }))
    expect(got.kept.sort()).toEqual(['/assets/index-OLD.js', '/assets/review-OLD.css', '/assets/service-OLD.js'])
    expect(readFileSync(join(dir, 'assets/service-OLD.js'), 'utf8')).toBe('old service')
    expect(readFileSync(join(dir, 'assets/same-X.js'), 'utf8')).toBe('new same')
    expect(existsSync(join(dir, 'friend'))).toBe(false)
  })

  it('a live chunk answered as HTML (it is gone there too) is not copied', async () => {
    const dir = dist()
    const got = await keepPrevious(dir, LIVE, host({ '/sw.js': { body: liveSw, type: 'text/javascript' } }))
    expect(got.kept).toEqual([])
    expect(got.missing.length).toBe(3)
    expect(existsSync(join(dir, 'assets/service-OLD.js'))).toBe(false)
  })

  it('no live site yet, or a kill switch live (no list): nothing to keep, no failure', async () => {
    const dir = dist()
    expect((await keepPrevious(dir, LIVE, async () => new Response('', { status: 404 }))).kept).toEqual([])
    expect((await keepPrevious(dir, LIVE, host({ '/sw.js': { body: 'kill switch', type: 'text/javascript' } }))).kept).toEqual([])
  })
})
