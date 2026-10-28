/**
 * Settings › Code › "Jump across files" (YAZ-3500; YAZ-3439 "Download the helpers on first switch-on, after a
 * box that explains"): with the helpers there, On turns it on with no box; without them, the box in the
 * approved words; Cancel keeps it off and downloads nothing; "Download and turn on" shows the progress, then
 * turns it on; a failure says why in one sentence and keeps it off; Cancel during a download stops it.
 * The bridge is mocked: nothing reaches a real main process or the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { LspInstallProgress, LspInstallResult } from '@shared/lspInstall'
import { api } from '../api'
import { HELPERS_BOX_CONFIRM, HELPERS_BOX_TEXT, HELPERS_BOX_TITLE, LanguageHelpersControl, progressText } from './LanguageHelpersControl'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let progress: ((p: LspInstallProgress) => void) | null = null
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    lsp: {
      helpers: vi.fn(async () => ({ ready: false, installing: false })),
      install: vi.fn(),
      cancelInstall: vi.fn(async () => undefined),
      onInstallProgress: vi.fn((listener: (p: LspInstallProgress) => void) => {
        progress = listener
        return () => {
          progress = null
        }
      }),
    },
  },
}))

const lsp = vi.mocked(api.lsp)
let root: Root | null = null
let el: HTMLElement
const onSet = vi.fn()

beforeEach(() => {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
  vi.clearAllMocks()
  onSet.mockReset()
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

function render(on = false): void {
  act(() => root?.render(<LanguageHelpersControl on={on} onSet={onSet} />))
}
const button = (label: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)
const box = () => document.querySelector<HTMLElement>('.confirm[role="dialog"]')
const status = () => box()?.querySelector('.confirm__status')?.textContent ?? null

async function clickOn(): Promise<void> {
  act(() => button('On', el)!.click())
  await settle()
}

describe('"Jump across files" (YAZ-3500)', () => {
  it('helpers there (downloaded, or a dev build\'s node_modules): On turns it on, with no box', async () => {
    lsp.helpers.mockResolvedValueOnce({ ready: true, installing: false })
    render()
    await clickOn()
    expect(box()).toBeNull()
    expect(onSet).toHaveBeenCalledWith(true)
    expect(lsp.install).not.toHaveBeenCalled()
  })

  it('first switch-on: the box in the approved words; Cancel keeps it off and downloads nothing', async () => {
    render()
    await clickOn()
    expect(box()).not.toBeNull()
    expect(box()!.querySelector('.confirm__title')?.textContent).toBe('Turn on jump across files?')
    expect(box()!.querySelector('.confirm__text')?.textContent).toBe(`${HELPERS_BOX_TITLE}${HELPERS_BOX_TEXT}`)
    expect(HELPERS_BOX_TEXT).toBe(
      "Cmd+click a name to open the file where it's made. Shift+F12 lists every place that uses it. This works for TypeScript, JavaScript, React and Python. It needs two helper tools (about 15 MB). They run only while a code file is open.",
    )
    expect([...box()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cancel', 'Download and turn on'])
    act(() => button('Cancel', box()!)!.click())
    expect(box()).toBeNull()
    expect(onSet).not.toHaveBeenCalled()
    expect(lsp.install).not.toHaveBeenCalled()
    expect(lsp.cancelInstall).not.toHaveBeenCalled()
  })

  it('"Download and turn on": the box shows each step, then closes and the switch goes on', async () => {
    let finish: (r: LspInstallResult) => void = () => undefined
    lsp.install.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    render()
    await clickOn()
    act(() => button(HELPERS_BOX_CONFIRM, box()!)!.click())
    await settle()
    expect(status()).toBe('Starting the download…')
    expect(button(HELPERS_BOX_CONFIRM, box()!)!.disabled).toBe(true)
    act(() => progress?.({ helper: 'typescript', phase: 'download', received: 4_200_000, total: 10_000_000, index: 1, count: 2 }))
    expect(status()).toBe('Downloading the TypeScript helper (1 of 2)… 42%')
    act(() => progress?.({ helper: 'python', phase: 'unpack', received: 5, total: 5, index: 2, count: 2 }))
    expect(status()).toBe('Unpacking the Python helper (2 of 2)…')
    expect(onSet).not.toHaveBeenCalled()
    finish({ ok: true })
    await settle()
    expect(box()).toBeNull()
    expect(onSet).toHaveBeenCalledWith(true)
  })

  it('a hash mismatch: the box says "The download did not match. Try again later.", the switch stays off, the button tries again', async () => {
    lsp.install.mockResolvedValueOnce({ ok: false, error: 'mismatch' })
    render()
    await clickOn()
    act(() => button(HELPERS_BOX_CONFIRM, box()!)!.click())
    await settle()
    expect(status()).toBe('The download did not match. Try again later.')
    expect(box()!.querySelector('.confirm__status')?.getAttribute('role')).toBe('alert')
    expect(onSet).not.toHaveBeenCalled()
    lsp.install.mockResolvedValueOnce({ ok: false, error: 'offline' })
    act(() => button(HELPERS_BOX_CONFIRM, box()!)!.click())
    await settle()
    expect(status()).toBe("Couldn't download the helper tools. Check your internet connection and try again.")
    expect(onSet).not.toHaveBeenCalled()
  })

  it('Cancel during the download stops it; a late success changes nothing', async () => {
    let finish: (r: LspInstallResult) => void = () => undefined
    lsp.install.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    render()
    await clickOn()
    act(() => button(HELPERS_BOX_CONFIRM, box()!)!.click())
    await settle()
    act(() => button('Cancel', box()!)!.click())
    expect(lsp.cancelInstall).toHaveBeenCalledTimes(1)
    expect(box()).toBeNull()
    finish({ ok: true })
    await settle()
    expect(onSet).not.toHaveBeenCalled()
    expect(box()).toBeNull()
  })

  it('Off turns it off at once, with no box', async () => {
    render(true)
    act(() => button('Off', el)!.click())
    expect(onSet).toHaveBeenCalledWith(false)
    expect(box()).toBeNull()
    expect(lsp.helpers).not.toHaveBeenCalled()
  })

  it('the progress line with no size counts megabytes', () => {
    expect(progressText({ helper: 'python', phase: 'download', received: 3 * 1024 * 1024, total: null, index: 1, count: 1 })).toBe('Downloading the Python helper… 3.0 MB')
  })
})
