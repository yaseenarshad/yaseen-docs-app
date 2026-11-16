import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appStylesheets } from '../../publish/stylesheets'

/**
 * YAZ-5510, YAZ-5511: A REAL LAYOUT FOR A TEST. jsdom draws nothing, so a test that asks where a thing IS on the screen
 * (a box right of its number, a button that `elementFromPoint` finds) hands the markup the test drew (React, in jsdom)
 * to headless Chrome with the phone's own stylesheets (`appStylesheets()`, every one the app loads, in order), at a
 * phone's size, and runs `expression` there. No build, no server: the markup goes in with `Page.setDocumentContent`.
 * Chrome is the Mac's (`CHROME` to change it); `HAS_CHROME` is false when there is none, so a test can skip.
 * The whole app is checked in the real build by `publish/proveLayout.ts`.
 */
export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const HAS_CHROME = existsSync(CHROME)

const css = () => appStylesheets().map((file) => readFileSync(file, 'utf8')).join('\n')

export async function inChrome<T>(html: string, expression: string, { width = 375, height = 667, scheme = 'light' }: { width?: number; height?: number; scheme?: 'light' | 'dark' } = {}): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), 'notecards-test-chrome-'))
  // The DevTools protocol over a pipe (fd 3 in, fd 4 out, each message ending in a NUL): no port, no WebSocket (jsdom's
  // globals would stand in Node's way).
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  const toChrome = chrome.stdio[3] as Writable
  const fromChrome = chrome.stdio[4] as Readable
  let seq = 0
  const pending = new Map<number, (m: { result?: any; error?: { message: string } }) => void>()
  let buffer = ''
  fromChrome.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let end: number
    while ((end = buffer.indexOf('\0')) >= 0) {
      const m = JSON.parse(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      if (m.id !== undefined) pending.get(m.id)?.(m)
    }
  })
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
      toChrome.write(JSON.stringify({ id, method, params, sessionId }) + '\0')
    })
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const on = (method: string, params: object = {}) => send(method, params, sessionId)
    await on('Page.enable')
    await on('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true })
    await on('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    const { frameTree } = await on('Page.getFrameTree')
    const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css()}</style></head><body>${html}</body></html>`
    await on('Page.setDocumentContent', { frameId: frameTree.frame.id, html: doc })
    await new Promise((r) => setTimeout(r, 200))
    const out = await on('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (out.exceptionDetails) throw new Error(`In Chrome: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text}`)
    return out.result.value as T
  } finally {
    // Chrome writes its profile until it has gone: wait for that, then remove it.
    const gone = chrome.exitCode !== null || chrome.signalCode !== null ? Promise.resolve() : new Promise((r) => chrome.once('exit', r))
    chrome.kill()
    await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))])
    // Its helper processes can still write a file or two after it exits (CI's macOS: ENOTEMPTY, YAZ-4965). The profile
    // is in the temp folder: a removal that still fails after the retries leaves it there; it never fails the check.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (err) {
      console.warn(`[chrome] the temp profile stays: ${String(err)}`)
    }
  }
}
