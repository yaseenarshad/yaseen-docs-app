import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, readFileSync, rmSync } from 'node:fs'
import { access, mkdir, mkdtemp, open, rename, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ReleaseNote, UpdateState } from '@shared/types'

/**
 * The updater (YAZ-2976 D2): GitHub Releases, no new dependency. A check reads `releases/latest`;
 * a newer tag with a `-arm64.dmg` that has a `digest` downloads in the background (D6) to
 * `<userData>/updates/<version>.dmg.part` through a sha256 tap (S8, S9), mounts read-only and out of
 * Finder's sight, checks the app inside against THIS app's designated requirement (S10: only a build
 * the same certificate signed passes, D1), and `ditto`s it beside the running bundle as
 * `<bundle>.update`. The swap is a detached shell after the quit sequence (S21–S23).
 *
 * Child processes are the second exception to the no-spawn ruling (`git/exec.ts` is the first), on
 * the same terms: absolute paths only, `execFile` with no shell, argv arrays; the swap script takes
 * its values as positional arguments, so no path is ever pasted into shell text.
 *
 * `net.fetch` (the host's `fetch`) writes the file from our own process, so it carries no quarantine
 * mark and Gatekeeper does not stop the swapped app (S26). Electron-free: `index.ts` passes the host.
 */

export const UPDATE_FEED = 'https://api.github.com/repos/yaseenarshad/yaseen-docs-app/releases'
/** The `manual` button (S13, D3) and Windows' only way to update. */
export const RELEASES_PAGE = 'https://github.com/yaseenarshad/yaseen-docs-app/releases/latest'
/** The bundle name inside the `.dmg` (electron-builder's `productName`). */
const APP_IN_DMG = 'Yaseen Docs.app'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000
const GITHUB_JSON = { Accept: 'application/vnd.github+json' }

export interface Run {
  /** Runs `file` with `args`, no shell; rejects on a non-zero exit. */
  (file: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }>
}

/** The Electron and process half (`index.ts`), faked by the tests. */
export interface UpdaterHost {
  fetch(url: string, init?: { headers: Record<string, string> }): Promise<Response>
  run: Run
  /** Starts `file args` detached from this process, stdio ignored: it outlives the app (the swap). */
  spawnDetached(file: string, args: readonly string[]): void
  userData: string
  /** The running `.app` (`<appPath>/../../..` in a packaged app). */
  bundle: string
  version: string
  platform: NodeJS.Platform
  isPackaged: boolean
  /** `YASEEN_DOCS_UPDATE_FEED`: the fake feed of a dev or e2e run (S7). */
  feed: string | undefined
  pid: number
}

export interface Updater {
  /** On `ready`, before the first window: reads the `updated-to` marker (S24), then the first check 10 s from now and every 12 h after (D7); no check in a dev run with no feed (S7). */
  start(): void
  /** One check now: the state it ends in. Never two at once; while `downloading` or `ready` it answers the state and fetches nothing (S6). */
  check(): Promise<UpdateState>
  state(): UpdateState
  notes(): Promise<ReleaseNote[]>
  /** In the quit sequence's `exit`: with an update staged, start the swap; `reopen` opens the new app after it (S21, S22). */
  installOnExit(reopen: boolean): void
}

interface GithubAsset {
  name: string
  browser_download_url: string
  digest?: string | null
}
interface GithubRelease {
  tag_name: string
  name: string | null
  published_at: string | null
  body: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: GithubAsset[]
}

const parts = (v: string): number[] => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0)

/** `x.y.z` order, a leading `v` ignored: > 0 when `a` is the newer one. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export const newer = (a: string, b: string): boolean => compareVersions(a, b) > 0

/** The Mac `.dmg` with GitHub's `sha256:<hex>` digest; none → the release is not ready yet (S2). */
export function pickAsset(release: GithubRelease): { url: string; sha256: string } | null {
  const asset = release.assets?.find((a) => a.name.endsWith('-arm64.dmg') && typeof a.digest === 'string' && a.digest.startsWith('sha256:'))
  return asset === undefined ? null : { url: asset.browser_download_url, sha256: asset.digest!.slice('sha256:'.length).toLowerCase() }
}

/**
 * The text after `designated => ` in `codesign -d -r-` output (stdout on macOS 26; both streams are
 * passed in). An implicit requirement prints with a `# ` prefix — an ad-hoc build's `cdhash H"…"`.
 */
export function parseRequirement(output: string): string | null {
  return /^(?:#\s*)?designated => (.+)$/m.exec(output)?.[1].trim() ?? null
}

/** This bundle's designated requirement, or null when it has none worth checking against: ad-hoc (a `cdhash`, which every build changes) or unsigned. */
export async function ownRequirement(run: Run, bundle: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await run('/usr/bin/codesign', ['-d', '-r-', bundle])
    const req = parseRequirement(`${stdout}\n${stderr}`)
    return req === null || /\bcdhash\b/.test(req) ? null : req
  } catch {
    return null
  }
}

/**
 * The swap (S21–S23), run by `/bin/sh -c SWAP_SCRIPT sh <pid> <app> <marker> <version> <reopen>`. It
 * waits for the app's process to end; two renames on one disk put `<app>.update` in place, and only a
 * swap that landed writes the `updated-to` marker (S24). If the new app is not in place, `<app>.old`
 * goes back (S23). `reopen` = 1 opens whichever app stands at `<app>` (S21; S22 passes 0).
 */
export const SWAP_SCRIPT = [
  'pid=$1 app=$2 marker=$3 version=$4 reopen=$5',
  'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
  'if mv "$app" "$app.old" && mv "$app.update" "$app"; then rm -rf "$app.old"; printf %s "$version" > "$marker"; else [ -d "$app" ] || mv "$app.old" "$app"; fi',
  '[ "$reopen" = 1 ] && open "$app"',
  'exit 0',
].join('\n')

/** `host.run` for the app: `execFile`, no shell, 10 min cap (a deep verify of ~270 MB takes seconds). */
export const runFile: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err === null ? resolve({ stdout, stderr }) : reject(new Error(`${file} ${args[0] ?? ''} failed: ${stderr.trim() || err.message}`))))
  })

export function spawnDetached(file: string, args: readonly string[]): void {
  spawn(file, args, { detached: true, stdio: 'ignore' }).unref()
}

export function createUpdater(host: UpdaterHost, onState: (state: UpdateState) => void): Updater {
  const feed = host.feed ?? UPDATE_FEED
  const updates = join(host.userData, 'updates')
  const marker = join(host.userData, 'updated-to')
  const staged = `${host.bundle}.update`

  let state: UpdateState = { kind: 'idle' }

  const set = (next: UpdateState): void => {
    state = next
    onState(next)
  }

  const getJson = async <T>(url: string): Promise<T> => {
    const res = await host.fetch(url, { headers: GITHUB_JSON })
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`)
    return (await res.json()) as T
  }

  /**
   * The requirement a new build must meet (S10), or null when this copy cannot replace itself (S13):
   * Windows (D3), an unpackaged run, a mounted `.dmg` or App Translocation, a folder the user cannot
   * write, an ad-hoc build. Asked once, and only when a newer version exists — never at launch.
   */
  let installable: Promise<string | null> | undefined
  const canInstall = (): Promise<string | null> =>
    (installable ??= (async () => {
      if (host.platform !== 'darwin' || !host.isPackaged) return null
      if (host.bundle.startsWith('/Volumes/') || host.bundle.includes('/AppTranslocation/')) return null
      try {
        await access(dirname(host.bundle), constants.W_OK)
      } catch {
        return null
      }
      return ownRequirement(host.run, host.bundle)
    })())

  /**
   * S8: `.part` → sha256 → `.dmg` → mount → verify → stage. One update on disk at most (S11): the last
   * download goes first, the `.dmg` goes after staging, and a failed one leaves nothing behind.
   */
  const download = async (version: string, asset: { url: string; sha256: string }, requirement: string): Promise<void> => {
    await rm(updates, { recursive: true, force: true })
    await mkdir(updates, { recursive: true })
    const part = join(updates, `${version}.dmg.part`)
    const dmg = join(updates, `${version}.dmg`)
    try {
      const res = await host.fetch(asset.url)
      if (!res.ok || res.body === null) throw new Error(`the download answered ${res.status}`)
      const hash = createHash('sha256')
      const file = await open(part, 'w')
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk)
          await file.write(chunk)
        }
      } finally {
        await file.close()
      }
      if (hash.digest('hex') !== asset.sha256) throw new Error(`the sha256 of ${version}.dmg does not match the release (S9)`)
      await rename(part, dmg)
      const mount = await mkdtemp(join(tmpdir(), 'yaseen-docs-update-'))
      try {
        await host.run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg])
        try {
          const app = join(mount, APP_IN_DMG)
          await host.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, app])
          await rm(staged, { recursive: true, force: true })
          await host.run('/usr/bin/ditto', [app, staged])
        } finally {
          await host.run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => undefined)
        }
      } finally {
        await rmdir(mount).catch(() => undefined) // never recursive: it may still be a mount
      }
    } catch (err) {
      await rm(staged, { recursive: true, force: true })
      throw err
    } finally {
      await rm(updates, { recursive: true, force: true })
    }
  }

  const runCheck = async (): Promise<UpdateState> => {
    const release = await getJson<GithubRelease>(`${feed}/latest`)
    const version = release.tag_name.replace(/^v/, '')
    if (!newer(version, host.version)) return state // S1
    const asset = pickAsset(release)
    if (asset === null) return state // S2: CI still builds it; the next check finds it
    const requirement = await canInstall()
    if (requirement === null) {
      set({ kind: 'manual', version })
      return state
    }
    const before = state
    set({ kind: 'downloading', version })
    try {
      await download(version, asset, requirement)
    } catch (err) {
      set(before) // S9, S10: the next check tries again
      throw err
    }
    set({ kind: 'ready', version })
    return state
  }

  let running: Promise<UpdateState> | null = null
  const check = (): Promise<UpdateState> => {
    if (state.kind === 'downloading' || state.kind === 'ready') return Promise.resolve(state)
    running ??= runCheck().finally(() => (running = null))
    return running
  }

  return {
    start() {
      // S24: the swap wrote the version it installed, so this launch is that version's first one. Read
      // here, on `ready` of the one primary instance, never at load: a second launch must not eat it.
      // Deleted either way. No broadcast: no window exists yet, and each reads `state()` on mount.
      try {
        if (readFileSync(marker, 'utf8').trim() === host.version) state = { kind: 'updated', version: host.version }
        rmSync(marker, { force: true })
      } catch {
        // no marker: a plain launch
      }
      if (!host.isPackaged && host.feed === undefined) return // S7
      // S3: a failed timer check is silent to the user; the log is for us.
      const quiet = (): void => void check().catch((err: unknown) => console.error(`[update] check failed: ${String(err)}`))
      setTimeout(() => {
        quiet()
        setInterval(quiet, CHECK_EVERY_MS)
      }, FIRST_CHECK_MS)
    },
    check,
    state: () => state,
    async notes() {
      const all = (await getJson<GithubRelease[]>(`${feed}?per_page=20`)).filter((r) => r.draft !== true && r.prerelease !== true)
      all.sort((a, b) => compareVersions(b.tag_name, a.tag_name))
      const ahead = all.filter((r) => newer(r.tag_name, host.version))
      return (ahead.length > 0 ? ahead : all.slice(0, 5)).map((r) => ({ version: r.tag_name.replace(/^v/, ''), title: r.name ?? r.tag_name, date: r.published_at ?? '', body: r.body ?? '' }))
    },
    installOnExit(reopen) {
      if (state.kind !== 'ready') return
      try {
        host.spawnDetached('/bin/sh', ['-c', SWAP_SCRIPT, 'sh', String(host.pid), host.bundle, marker, state.version, reopen ? '1' : '0'])
      } catch (err) {
        console.error(`[update] the swap did not start: ${String(err)}`) // the app still exits; the next check stages again
      }
    },
  }
}
