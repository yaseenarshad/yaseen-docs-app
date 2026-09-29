/**
 * THE SURFACE PIN (YAZ-2131 6A, YAZ-2200): `window.yaseenDocs` as a renderer can reach it, byte
 * for byte. Taken on the hand-written preload before the bridge became a table (🔒 D9); the
 * table-built preload must reproduce it exactly. Per method: its path, its declared arity, and the
 * IPC it makes when called — the channel, the exact arguments it forwards (three sentinels in, so a
 * dropped, extra or reshaped argument shows), what an answer and an error envelope resolve to, and,
 * for a subscription, what the listener receives and how it unsubscribes.
 */
import { expect, it, vi } from 'vitest'

const exposed: Record<string, unknown> = {}
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => void (exposed[name] = value) },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))
vi.spyOn(crypto, 'randomUUID').mockReturnValue('0-0-0-0-0')

const { ipcRenderer } = await import('electron')
const invoke = vi.mocked(ipcRenderer.invoke)
const on = vi.mocked(ipcRenderer.on)
const send = vi.mocked(ipcRenderer.send)
const off = vi.mocked(ipcRenderer.removeListener)
const json = (v: unknown) => JSON.stringify(v)
/** Every push payload carries the fields any listener might unwrap (`watch` filters by id, `properties.onChange` takes `.properties`). */
const PAYLOAD = { id: '0-0-0-0-0', ev: 'ev', root: 'r', properties: 'props' }

const loaded = await import('./index')
const atLoad = [`expose ${Object.keys(exposed).join(', ')}`, ...on.mock.calls.map(([ch]) => `on ${ch}`)]

async function describeMethod(fn: (...args: unknown[]) => unknown, name: string): Promise<string> {
  for (const m of [invoke, on, send, off]) m.mockClear()
  const heard: unknown[][] = []
  const listener = (...args: unknown[]) => void heard.push(args)
  const args = name === 'watch' ? ['a0', listener] : /^on[A-Z]/.test(name) ? [listener] : ['a0', 'a1', 'a2']
  invoke.mockResolvedValue({ ok: true, value: 'answer' })
  const out = fn(...args)
  const parts = [...invoke.mock.calls.map(([ch, ...a]) => `invoke ${ch} ${json(a)}`), ...send.mock.calls.map(([ch, ...a]) => `send ${ch} ${json(a)}`)]
  if (out instanceof Promise) {
    parts.push(`=> ${json(await out)}`)
    invoke.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'gone', path: '/p' } })
    parts.push(`!> ${json(await (fn(...args) as Promise<unknown>).catch((e: unknown) => e))}`)
    return parts.join('; ')
  }
  const handlers = on.mock.calls.map(([ch, h]) => [ch, h] as const)
  for (const [ch, h] of handlers) {
    ;(h as (...a: unknown[]) => void)({ sender: 'event' }, PAYLOAD)
    parts.push(`on ${ch} -> listener${json(heard.splice(0))}`)
  }
  if (typeof out === 'function') {
    send.mockClear()
    out()
    for (const [ch, h] of off.mock.calls) parts.push(`off ${ch}${handlers.some(([c, g]) => c === ch && g === h) ? '' : ' (a different handler!)'}`)
    for (const [ch, ...a] of send.mock.calls) parts.push(`send ${ch} ${json(a)}`)
  }
  return parts.length === 0 ? '(no IPC)' : parts.join('; ')
}

it('window.yaseenDocs is exactly this surface (YAZ-2200)', async () => {
  expect(exposed.yaseenDocs).toBe(loaded.bridge)
  const lines = [...atLoad]
  const walk = async (o: Record<string, unknown>, at: string): Promise<void> => {
    for (const key of Object.keys(o).sort()) {
      const v = o[key]
      if (typeof v === 'function') lines.push(`${at}${key}/${v.length}: ${await describeMethod(v as (...a: unknown[]) => unknown, key)}`)
      else await walk(v as Record<string, unknown>, `${at}${key}.`)
    }
  }
  await walk(exposed.yaseenDocs as Record<string, unknown>, '')
  expect(lines.join('\n')).toMatchSnapshot()
})
