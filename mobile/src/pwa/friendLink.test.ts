import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FRIEND_PATH, friendCodeFrom, friendLink } from './friendLink'

/**
 * The friend link (decision 20, round 10 item 7): `https://<site>/friend#<pointer gist ID>`. The ID is after `#`, so the
 * browser never sends it to any server, not even to Cloudflare. The landing page shows it and copies it; the app's
 * "Paste a friend's link" (4E2) reads it with `friendCodeFrom`.
 */

const ID = 'aa5a315d61ae9438b18d'

describe('the friend link', () => {
  it('is the site, /friend, and the ID after #', () => {
    expect(friendLink('https://preview.notecards.yaseenarshad.com', ID)).toBe(`https://preview.notecards.yaseenarshad.com${FRIEND_PATH}#${ID}`)
    expect(friendLink('https://notecards.yaseenarshad.com/', ID)).toBe(`https://notecards.yaseenarshad.com/friend#${ID}`)
  })

  it('refuses an ID that is not a gist ID', () => {
    expect(() => friendLink('https://x.test', 'abc/../x')).toThrow()
  })
})

describe('reading a pasted code or link', () => {
  it('the code alone, the link, and both with spaces or a new line around them', () => {
    expect(friendCodeFrom(ID)).toBe(ID)
    expect(friendCodeFrom(`  ${ID}\n`)).toBe(ID)
    expect(friendCodeFrom(`https://notecards.yaseenarshad.com/friend#${ID}`)).toBe(ID)
    expect(friendCodeFrom(`https://preview.notecards.yaseenarshad.com/friend/#${ID}`)).toBe(ID)
    expect(friendCodeFrom(`Add me on Notecards: https://notecards.yaseenarshad.com/friend#${ID.toUpperCase()}`)).toBe(ID.toUpperCase())
  })

  it('nothing else', () => {
    for (const text of ['', 'hello', 'https://notecards.yaseenarshad.com/', 'https://notecards.yaseenarshad.com/friend#', `https://evil.example/x#${ID}z`, 'g'.repeat(20), 'a'.repeat(65)]) {
      expect([text, friendCodeFrom(text)]).toEqual([text, null])
    }
  })
})

describe('the landing page sends the ID nowhere', () => {
  const code = readFileSync(new URL('./landing.ts', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../../friend.html', import.meta.url), 'utf8')

  it('its script makes no network call of any kind', () => {
    for (const call of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /\bimport\s*\(/, /\.src\s*=/, /location\.(href|assign|replace)\s*=?/, /window\.open/]) {
      expect([String(call), call.test(code)]).toEqual([String(call), false])
    }
  })

  it('its page loads nothing from another origin, and has no inline script', () => {
    expect(html).not.toMatch(/(src|href)="https?:/)
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).toContain('name="referrer" content="no-referrer"')
  })

  it('the words of round 10, item 7', () => {
    expect(html).toContain('Copy this code. Open the app. Tap Paste.')
    expect(html).toMatch(/>Copy</)
  })
})
