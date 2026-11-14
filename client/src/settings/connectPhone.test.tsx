/**
 * Settings › Review › "Phone and friends" (YAZ-5098; round 12, item 8): the GitHub token row and "Connect your phone".
 * The bridge is mocked: no row reaches a real main process, secrets file, git or GitHub. The canvas is a fake 2D
 * context that records each square, so a test can read the code back with the phone's own reader.
 *
 * THE RULE these tests hold: the token is never in the renderer as text. It goes in through one password field and
 * `secrets:set`, and it comes back only as the QR grid of `phone:code`, painted on a canvas and dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import encodeQR from 'qr'
import { decodeQR } from 'qr/decode.js'
import { DEFAULT_SETTINGS, type PhoneCodeAnswer, type PhoneCodeProblem } from '@shared/types'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { formatScanCode, parseScanCode } from '@shared/scanCode'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'
import { PHONE_CODE_SECONDS } from './ConnectPhoneControl'
import { resetGithubTokenStatus } from './githubToken'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      secrets: { has: vi.fn(), set: vi.fn() },
      phone: { code: vi.fn(), hide: vi.fn(async () => undefined) },
      // YAZ-5086: the Friends row of the same group asks for the send's state.
      friends: { status: vi.fn(async () => ({ status: 'no-friends', lastSentAt: null, retryAt: null, friends: 0, groups: 0, missing: 0 })) },
      state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
    },
  }
})

const TOKEN = 'github_pat_EXAMPLE0' + 'x'.repeat(74)
const ROOT = '/vaults/notes'
const secretHas = vi.mocked(api.secrets.has)
const secretSet = vi.mocked(api.secrets.set)
const phoneCode = vi.mocked(api.phone.code)

/** What main answers: the real grid of the real code text. Only main ever holds that text. */
const GRID = encodeQR(formatScanCode({ repo: 'yaseen/notes.v2', branch: 'main', token: TOKEN, expiresAt: null }), 'raw')
const SHOWN: PhoneCodeAnswer = { ok: true, repo: 'yaseen/notes.v2', branch: 'main', grid: GRID }

/** One fake 2D context per canvas: each square painted, and each clear. */
interface FakeCtx {
  fillStyle: unknown
  squares: { x: number; y: number; w: number; h: number; dark: boolean }[]
  clears: number
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(): void
}
const contexts = new Map<HTMLCanvasElement, FakeCtx>()
function ctxOf(canvas: HTMLCanvasElement): FakeCtx {
  let ctx = contexts.get(canvas)
  if (ctx === undefined) {
    const made: FakeCtx = {
      fillStyle: '',
      squares: [],
      clears: 0,
      fillRect(x, y, w, h) {
        made.squares.push({ x, y, w, h, dark: made.fillStyle === '#000' })
      },
      clearRect() {
        made.clears++
        made.squares = []
      },
    }
    ctx = made
    contexts.set(canvas, ctx)
  }
  return ctx
}

/** The canvas as RGBA pixels, from its recorded squares: what a camera would see. */
function pixels(canvas: HTMLCanvasElement) {
  const { width, height } = canvas
  const data = new Uint8ClampedArray(width * height * 4)
  for (const s of ctxOf(canvas).squares)
    for (let y = s.y; y < s.y + s.h; y++)
      for (let x = s.x; x < s.x + s.w; x++) {
        const i = (y * width + x) * 4
        data[i] = data[i + 1] = data[i + 2] = s.dark ? 0 : 255
        data[i + 3] = 255
      }
  return { width, height, data }
}

let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()
const consoleCalls: unknown[][] = []

beforeEach(() => {
  resetGithubTokenStatus()
  contexts.clear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return ctxOf(this) as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext'])
  secretHas.mockReset().mockResolvedValue(false)
  secretSet.mockReset().mockResolvedValue(undefined)
  phoneCode.mockReset().mockResolvedValue(SHOWN)
  onChange.mockReset()
  consoleCalls.length = 0
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args) => void consoleCalls.push(args))
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
  vi.useRealTimers()
  // Never in a log line, a setting, or the browser's storage, whatever the test did.
  expect(JSON.stringify(consoleCalls)).not.toContain('github_pat_')
  expect(JSON.stringify(onChange.mock.calls)).not.toContain('github_pat_')
  expect(JSON.stringify({ ...localStorage })).not.toContain('github_pat_')
  expect(JSON.stringify({ ...sessionStorage })).not.toContain('github_pat_')
  vi.restoreAllMocks()
})

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve())
}
/** The sheet's own chunk (it is lazy), then React's turn. */
const settle = async () => {
  await act(async () => void (await import('./ConnectPhoneSheet')))
  await flush()
}

async function mountReview(reviewOn = true) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  const review = { settings: { ...DEFAULT_REVIEW_SETTINGS, enabled: reviewOn }, save: vi.fn() }
  act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange, review, vaultRoot: ROOT }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Review')?.click())
  // The two rows are lazy chunks (the first load stays the same).
  await act(async () => void (await Promise.all([import('./GithubTokenControl'), import('./ConnectPhoneControl')])))
  await flush()
}
const row = (id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="connect-phone-title"]')
const canvas = () => sheet()?.querySelector('canvas') ?? null
const removeSheet = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="remove-github-token-text"]')
/** Every word and every attribute on the page: the token must be in none. */
const everything = () => document.documentElement.outerHTML

async function saveToken(value = TOKEN) {
  const input = row('githubToken')!.querySelector<HTMLInputElement>('input')!
  input.value = value
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })))
  await act(async () => button(row('githubToken')!, 'Save')!.click())
  await flush()
}

async function openCode() {
  await act(async () => button(row('connectPhone')!, 'Show code')!.click())
  await settle()
}

describe('Settings › Review › Phone and friends (YAZ-5098)', () => {
  it('is a group of the Review page, with the token row and Connect your phone, only while review is on', async () => {
    await mountReview()
    expect([...el.querySelectorAll('.settings-group__title')].map((t) => t.textContent)).toContain('Phone and friends')
    expect(row('githubToken')).not.toBeNull()
    expect(row('connectPhone')).not.toBeNull()
    act(() => root?.unmount())
    el.remove()
    await mountReview(false)
    expect(row('githubToken')).toBeNull()
    expect(row('connectPhone')).toBeNull()
  })

  it('with no token: says so, tells how to make one and where to paste it, and Show code waits', async () => {
    await mountReview()
    expect(secretHas).toHaveBeenCalledWith({ name: 'githubToken' })
    const tokenRow = row('githubToken')!
    expect(tokenRow.textContent).toContain('No token saved.')
    expect(tokenRow.textContent).toContain('Fine-grained tokens')
    expect(tokenRow.textContent).toContain('Contents')
    expect(tokenRow.textContent).toContain('Gists')
    expect(button(row('connectPhone')!, 'Show code')!.disabled).toBe(true)
    expect(row('connectPhone')!.textContent).toContain('Save a GitHub token above first.')
  })

  it('a pasted token goes to main once, leaves the field, and is never in the page, a setting, a log or storage', async () => {
    await mountReview()
    await saveToken(`  ${TOKEN}\n`)
    expect(secretSet).toHaveBeenCalledExactlyOnceWith({ name: 'githubToken', value: TOKEN })
    expect(row('githubToken')!.querySelector<HTMLInputElement>('input')!.value).toBe('')
    expect(row('githubToken')!.textContent).toContain('Token saved.')
    expect(row('githubToken')!.textContent).not.toContain('Fine-grained tokens')
    expect(button(row('connectPhone')!, 'Show code')!.disabled).toBe(false)
    expect(everything()).not.toContain('github_pat_')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a paste that cannot be a token is not sent, and says why in plain words', async () => {
    await mountReview()
    await saveToken('my github password')
    expect(secretSet).not.toHaveBeenCalled()
    expect(row('githubToken')!.textContent).toContain('This is not a GitHub token.')
  })

  it('Remove token removes it from this Mac, and Show code waits again', async () => {
    secretHas.mockResolvedValue(true)
    await mountReview()
    expect(row('githubToken')!.textContent).toContain('Token saved.')
    await act(async () => button(row('githubToken')!, 'Remove token')!.click())
    await act(async () => button(removeSheet()!, 'Remove')!.click())
    await flush()
    expect(secretSet).toHaveBeenCalledExactlyOnceWith({ name: 'githubToken', value: null })
    expect(row('githubToken')!.textContent).toContain('No token saved.')
    expect(button(row('connectPhone')!, 'Show code')!.disabled).toBe(true)
  })
})

describe('the checker\'s bugs of YAZ-5098', () => {
  it('Remove token asks first (YAZ-5219): no removal on the first click; Cancel keeps the token; Remove removes it', async () => {
    secretHas.mockResolvedValue(true)
    await mountReview()
    await act(async () => button(row('githubToken')!, 'Remove token')!.click())
    expect(secretSet).not.toHaveBeenCalled()
    expect(removeSheet()!.textContent).toContain('A phone that is already connected keeps working')
    expect(removeSheet()!.textContent).toContain('stops sending your numbers to friends')
    await act(async () => button(removeSheet()!, 'Cancel')!.click())
    expect(removeSheet()).toBeNull()
    expect(secretSet).not.toHaveBeenCalled()
    expect(row('githubToken')!.textContent).toContain('Token saved.')
    await act(async () => button(row('githubToken')!, 'Remove token')!.click())
    await act(async () => button(removeSheet()!, 'Remove')!.click())
    await flush()
    expect(secretSet).toHaveBeenCalledExactlyOnceWith({ name: 'githubToken', value: null })
  })

  it('a plain password of letters and digits is refused (YAZ-5220), and the words do not repeat it', async () => {
    await mountReview()
    await saveToken('CorrectHorseBatteryStaple2026')
    expect(secretSet).not.toHaveBeenCalled()
    expect(row('githubToken')!.textContent).toContain('This is not a GitHub token.')
    expect(row('githubToken')!.textContent).toContain('github_pat_')
    expect(everything()).not.toContain('CorrectHorse')
  })

  it('the window loses focus while the code is on its way: the code must not paint in a window that is not in front', async () => {
    secretHas.mockResolvedValue(true)
    let answer: (a: PhoneCodeAnswer) => void = () => undefined
    phoneCode.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    await mountReview()
    await openCode()
    act(() => window.dispatchEvent(new Event('blur')))
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await act(async () => answer(SHOWN))
    await flush()
    expect(canvas()).toBeNull()
    expect([...contexts.values()].every((c) => c.squares.length === 0)).toBe(true)
    expect(sheet()!.textContent).toContain('The code is hidden.')
  })

  it('each hide and each close tells main, so main lets a new code be asked (YAZ-5218)', async () => {
    secretHas.mockResolvedValue(true)
    await mountReview()
    await openCode()
    act(() => window.dispatchEvent(new Event('blur')))
    expect(vi.mocked(api.phone.hide)).toHaveBeenCalled()
  })
})

describe('Connect your phone: the code (YAZ-5098)', () => {
  beforeEach(() => secretHas.mockResolvedValue(true))

  it('is not on the page until you click Show code; then a dialog paints a code the phone reads back', async () => {
    await mountReview()
    expect(phoneCode).not.toHaveBeenCalled()
    expect(sheet()).toBeNull()
    expect(document.querySelector('canvas')).toBeNull()
    await openCode()
    expect(phoneCode).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(sheet()).not.toBeNull()
    expect(sheet()!.textContent).toContain('Anyone who can see this code can change your vault.')
    expect(sheet()!.textContent).toContain('yaseen/notes.v2')
    expect(sheet()!.textContent).toContain('60 seconds')
    // The camera's view: the phone's reader and the phone's parser get the repo, the branch and the token.
    const text = decodeQR(pixels(canvas()!), { format: 'RGBA' })
    expect(parseScanCode(text)).toEqual({ ok: true, code: { repo: 'yaseen/notes.v2', branch: 'main', token: TOKEN, expiresAt: null } })
    // The page holds pixels, not text: no word, no attribute, no data URL of the code.
    expect(everything()).not.toContain('github_pat_')
    expect(sheet()!.outerHTML).not.toContain('data:')
  })

  it(`hides by itself after ${PHONE_CODE_SECONDS} seconds: the canvas is wiped, and Show code paints a new one`, async () => {
    await mountReview()
    vi.useFakeTimers()
    await openCode()
    expect(ctxOf(canvas()!).squares.length).toBeGreaterThan(0)
    const painted = canvas()!
    await act(async () => vi.advanceTimersByTime((PHONE_CODE_SECONDS - 1) * 1000))
    expect(ctxOf(painted).squares.length).toBeGreaterThan(0)
    await act(async () => vi.advanceTimersByTime(1000))
    expect(ctxOf(painted).squares).toEqual([])
    expect(painted.width).toBe(0)
    expect(canvas()).toBeNull()
    expect(sheet()!.textContent).toContain('The code is hidden.')
    await act(async () => button(sheet()!, 'Show code')!.click())
    await flush()
    expect(phoneCode).toHaveBeenCalledTimes(2)
    expect(ctxOf(canvas()!).squares.length).toBeGreaterThan(0)
  })

  it('hides when the window loses focus, and when the page is hidden', async () => {
    await mountReview()
    await openCode()
    let painted = canvas()!
    act(() => window.dispatchEvent(new Event('blur')))
    expect(ctxOf(painted).squares).toEqual([])
    expect(canvas()).toBeNull()
    await act(async () => button(sheet()!, 'Show code')!.click())
    await flush()
    painted = canvas()!
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    delete (document as unknown as Record<string, unknown>).visibilityState
    expect(ctxOf(painted).squares).toEqual([])
    expect(canvas()).toBeNull()
  })

  it('Done and Esc close the dialog and wipe the code; Esc does not close Settings', async () => {
    await mountReview()
    await openCode()
    let painted = canvas()!
    await act(async () => button(sheet()!, 'Done')!.click())
    expect(sheet()).toBeNull()
    expect(ctxOf(painted).squares).toEqual([])
    await openCode()
    painted = canvas()!
    act(() => sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(sheet()).toBeNull()
    expect(ctxOf(painted).squares).toEqual([])
    expect(el.querySelector('.settings-dialog')).not.toBeNull()
  })

  it('a code that arrives after the dialog closed is never painted', async () => {
    let answer: (a: PhoneCodeAnswer) => void = () => undefined
    phoneCode.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    await mountReview()
    await openCode()
    await act(async () => button(sheet()!, 'Done')!.click())
    await act(async () => answer(SHOWN))
    await flush()
    expect([...contexts.values()].every((c) => c.squares.length === 0)).toBe(true)
  })

  it.each<[PhoneCodeProblem, string]>([
    ['no-token', 'Save a GitHub token'],
    ['no-git', 'Git is not on this Mac'],
    ['not-a-repo', 'not a git repo'],
    ['no-remote', 'no GitHub remote'],
    ['not-github', 'not on GitHub'],
    ['no-branch', 'not on a branch'],
  ])('%s: plain words, and no code', async (problem, words) => {
    phoneCode.mockResolvedValue({ ok: false, problem })
    await mountReview()
    await openCode()
    expect(sheet()!.textContent).toContain(words)
    expect(canvas()).toBeNull()
    expect([...contexts.values()].every((c) => c.squares.length === 0)).toBe(true)
  })

  it('the rows and the dialog are chunks of their own: Settings loads the rows with import(), and the dialog on Show code', () => {
    const registry = readFileSync(join(__dirname, 'registry.tsx'), 'utf8')
    for (const file of ['GithubTokenControl', 'ConnectPhoneControl']) {
      expect(registry).toContain(`import('./${file}')`)
      expect(registry).not.toMatch(new RegExp(`^import .*'\\./${file}'`, 'm'))
    }
    const source = readFileSync(join(__dirname, 'ConnectPhoneControl.tsx'), 'utf8')
    expect(source).toMatch(/import\('\.\/ConnectPhoneSheet'\)/)
    expect(source).not.toMatch(/^import .*ConnectPhoneSheet'/m)
    expect(source).not.toMatch(/from 'qr/)
  })
})
