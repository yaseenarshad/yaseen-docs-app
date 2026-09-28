/**
 * Launch one build for a measurement and drive it over the DevTools protocol (YAZ-2131 1C).
 * Every launch is isolated: `--user-data-dir=<profile>` AND `YASEEN_DOCS_USER_DATA_DIR=<profile>`
 * (the override main applies before the single-instance lock), so a run coexists with the
 * installed app and never sees the real profile. It only ever signals PIDs it spawned.
 * Zero dependencies: node's global fetch + WebSocket.
 */
import { execFileSync, spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:net'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => performance.timeOrigin + performance.now()

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer().once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

/** A CDP session: `ev` evaluates an expression (awaited, by value), `waitFor` polls one, `mouse`/`type` send input. */
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    pending.get(d.id)?.(d)
    pending.delete(d.id)
  }
  // A target that dies under a command fails it rather than hanging the run.
  ws.onclose = () => {
    for (const settle of pending.values()) settle({ error: { message: 'the DevTools socket closed' } })
    pending.clear()
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  /** Evaluates `expression`; a renderer frozen longer than `timeoutMs` (a 20k-line open on v0.9.27) rejects instead of hanging. */
  const ev = async (expression, timeoutMs = 120_000) => {
    let timer
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`TIMEOUT after ${timeoutMs} ms`)), timeoutMs))),
    ]).finally(() => clearTimeout(timer))
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
  /** Polls `expression` until truthy; resolves to the epoch ms at that moment. */
  const waitFor = async (expression, timeoutMs = 30_000) => {
    const end = performance.now() + timeoutMs
    while (performance.now() < end) {
      if (await ev(expression, end - performance.now())) return now()
      await sleep(10)
    }
    throw new Error(`TIMEOUT waiting for ${expression}`)
  }
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra })
  const type = async (ch) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  return { ev, waitFor, mouse, type, close: () => ws.close() }
}

/** Helper processes (renderer, gpu-process, utility) of `pid`, by Chromium `--type`. */
export function helpers(pid) {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='])
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter(([, ppid]) => ppid === String(pid))
    .map(([p, , ...cmd]) => ({ pid: Number(p), type: cmd.join(' ').match(/--type=([a-z-]+)/)?.[1] ?? 'other' }))
}

/** CPU seconds and RSS MB of each pid (`ps` TIME is `[h:]m:ss.cc`); a pid that is gone is left out. */
export function usage(pids) {
  let out = ''
  try {
    out = execFileSync('ps', ['-o', 'pid=,time=,rss=', '-p', pids.join(',')]).toString()
  } catch (e) {
    out = e.stdout?.toString() ?? '' // ps exits 1 when one pid is gone
  }
  return new Map(
    out.trim().split('\n').filter(Boolean).map((l) => {
      const [pid, time, rss] = l.trim().split(/\s+/)
      return [Number(pid), { cpuSec: time.split(':').reduce((a, p) => a * 60 + Number(p), 0), rssMb: Math.round(Number(rss) / 102.4) / 10 }]
    }),
  )
}

/**
 * Starts `bin` on `profile`. `spawnedAt` is epoch ms. Main runs with `--inspect=0` so the harness can
 * read main's own clock and call `app.quit()` (the ⌘Q path) — on every build alike, so A/B stays fair.
 * The two Chromium switches keep frames and timers running when another window covers ours.
 */
export async function launch({ bin, profile }) {
  const port = await freePort()
  const spawnedAt = now()
  const child = spawn(bin, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--inspect=0', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    env: { ...process.env, YASEEN_DOCS_USER_DATA_DIR: profile },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const exited = new Promise((r) => child.once('exit', () => r(now())))
  // stderr is drained for the whole session (a full pipe would block the app); the first thing main prints is its inspector URL.
  const mainWs = new Promise((resolve, reject) => {
    let err = ''
    child.stderr.on('data', (d) => {
      if (err === null) return
      err += d
      const m = err.match(/Debugger listening on (ws:\/\/\S+)/)
      if (m) {
        resolve(m[1])
        err = null
      }
    })
    setTimeout(() => reject(new Error('main printed no inspector URL')), 15_000).unref()
  })
  mainWs.catch(() => {}) // only a caller of main() cares
  let mainSession
  /** Main's inspector session (Node, CommonJS: `process.mainModule.require('electron')` is main's electron). */
  const main = async () => (mainSession ??= await attach(await mainWs))

  /**
   * Sessions on the app's window pages (`app://yaseen/…?win=<id>`, `.win` = the id) once `count` exist.
   * First proves main is on the isolated profile: a run that would touch the real one stops here.
   */
  const windows = async (count = 1, timeoutMs = 30_000) => {
    const userData = await (await main()).ev(`process.mainModule.require('electron').app.getPath('userData')`)
    if (realpathSync(userData) !== realpathSync(profile)) throw new Error(`main is on ${userData}, not the isolated profile ${profile}`)
    const end = performance.now() + timeoutMs
    while (performance.now() < end) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page' && t.url.startsWith('app://yaseen/'))
        if (list.length >= count) return await Promise.all(list.map(async (t) => Object.assign(await attach(t.webSocketDebuggerUrl), { win: new URL(t.url).searchParams.get('win') })))
      } catch {
        // the DevTools endpoint is not listening yet
      }
      await sleep(10)
    }
    throw new Error(`fewer than ${count} app windows within ${timeoutMs} ms`)
  }

  /**
   * Quits the way ⌘Q does (`app.quit()` → before-quit → flush) and resolves to the epoch ms the
   * process was gone. A quit that hangs (a frozen renderer) is SIGKILLed after 10 s, together with
   * the helpers this launch spawned, so nothing of ours is left running.
   */
  const quit = async () => {
    const kids = helpers(child.pid).map((h) => h.pid)
    try {
      const m = await main()
      await m.ev(`void setTimeout(() => process.mainModule.require('electron').app.quit())`, 2000)
      m.close() // Node holds an --inspect process at exit until its debugger disconnects
    } catch {
      child.kill('SIGTERM')
    }
    const gone = await Promise.race([exited, sleep(10_000)])
    if (gone !== undefined) return gone
    child.kill('SIGKILL')
    for (const pid of kids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    await exited
    return null
  }
  return { pid: child.pid, spawnedAt, main, windows, quit }
}
