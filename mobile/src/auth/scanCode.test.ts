import { describe, expect, it } from 'vitest'
import { SCAN_CODE_VERSION, formatScanCode, parseScanCode, scanCodeMessage, type ScanCode } from './scanCode'

const TOKEN = 'github_pat_11QRQRQRQ0qrqrqrqrqrqr_' + 'q'.repeat(59)
const CODE: ScanCode = { repo: 'yaseen/vault', branch: 'main', token: TOKEN, expiresAt: '2026-12-31T00:00:00.000Z' }

describe('"Scan a code": what the Mac\'s code holds (round 11, item 23)', () => {
  it('reads back what the Mac writes', () => {
    expect(parseScanCode(formatScanCode(CODE))).toEqual({ ok: true, code: CODE })
    expect(parseScanCode(formatScanCode({ ...CODE, expiresAt: null }))).toEqual({ ok: true, code: { ...CODE, expiresAt: null } })
  })

  it('is JSON text, not an address: the iPhone Camera does not offer to open it in Safari', () => {
    const text = formatScanCode(CODE)
    expect(JSON.parse(text)).toEqual({ app: 'notecards', v: SCAN_CODE_VERSION, repo: 'yaseen/vault', branch: 'main', token: TOKEN, expires: '2026-12-31T00:00:00.000Z' })
    expect(text).not.toMatch(/^[a-z]+:/i)
  })

  it('cleans the values as the typed sign-in does', () => {
    const text = JSON.stringify({ app: 'notecards', v: 1, repo: ' https://github.com/yaseen/vault ', branch: 'main', token: ` ${TOKEN}\n` })
    expect(parseScanCode(text)).toEqual({ ok: true, code: { repo: 'yaseen/vault', branch: 'main', token: TOKEN, expiresAt: null } })
  })

  it.each([
    ['https://example.com', 'not-ours'],
    ['hello', 'not-ours'],
    ['{"app":"other","v":1}', 'not-ours'],
    ['[1,2]', 'not-ours'],
    [JSON.stringify({ app: 'notecards', v: 2, repo: 'a/b', branch: 'main', token: TOKEN }), 'newer-app'],
    [JSON.stringify({ app: 'notecards', v: 0, repo: 'a/b', branch: 'main', token: TOKEN }), 'not-ours'],
    [JSON.stringify({ app: 'notecards', v: 1, repo: 'nope', branch: 'main', token: TOKEN }), 'bad-repo'],
    [JSON.stringify({ app: 'notecards', v: 1, repo: 'a/b', branch: 'a..b', token: TOKEN }), 'bad-branch'],
    [JSON.stringify({ app: 'notecards', v: 1, repo: 'a/b', token: TOKEN }), 'bad-branch'],
    [JSON.stringify({ app: 'notecards', v: 1, repo: 'a/b', branch: 'main', token: 'x' }), 'bad-token'],
    [JSON.stringify({ app: 'notecards', v: 1, repo: 'a/b', branch: 'main', token: TOKEN, expires: 'later' }), 'bad-end-date'],
    ['{"app":"notecards","v":1,' + '"x":"' + 'y'.repeat(5000) + '"}', 'not-ours'],
  ])('refuses %s: %s', (text, error) => {
    expect(parseScanCode(text)).toEqual({ ok: false, error })
  })

  it('an error and its message never hold the token', () => {
    const bad = JSON.stringify({ app: 'notecards', v: 1, repo: 'nope', branch: 'main', token: TOKEN })
    const result = parseScanCode(bad)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    if (result.ok) throw new Error('expected a failure')
    expect(scanCodeMessage(result.error)).not.toContain(TOKEN)
  })

  it.each(['not-ours', 'newer-app', 'bad-repo', 'bad-branch', 'bad-token', 'bad-end-date'] as const)('has plain words for %s', (error) => {
    expect(scanCodeMessage(error).length).toBeGreaterThan(10)
  })
})
