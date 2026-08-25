/**
 * Desktop G1 (GRO-2178): shared harness for the Playwright-Electron smoke suite.
 *
 * The permanent home of the idioms proven in the `node_modules/.verify/*.mjs` throwaways:
 * launch the REAL app (`desktop/out/main/index.js`, run `npm run build` first — `npm run e2e`
 * does) against a temp `--user-data-dir`, seed `<userData>/yaseendocs.json` with a `windows[]`
 * entry to skip the native folder dialog (the locked no-dialog-in-tests rule), and always work
 * on a COPY of a generated fixture vault — the real vault and real app state are never touched.
 */
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultAppState, type AppState, type WindowBounds } from '../../shared/types'

export const REPO_ROOT = path.resolve(__dirname, '..', '..')
export const MAIN_ENTRY = path.join(REPO_ROOT, 'desktop', 'out', 'main', 'index.js')
export const ARTIFACTS_DIR = path.join(__dirname, 'artifacts')

// ---------- app lifecycle ----------

export interface LaunchOptions {
  /** The temp dir passed as `--user-data-dir` (state file lives at `<userData>/yaseendocs.json`). */
  userData: string
  /** Written to `<userData>/yaseendocs.json` before launch — a `windows[]` entry skips the native dialog. */
  seedState?: AppState
}

export async function launchApp({ userData, seedState }: LaunchOptions): Promise<ElectronApplication> {
  if (seedState !== undefined) {
    await writeFile(path.join(userData, 'yaseendocs.json'), JSON.stringify(seedState, null, 2))
  }
  return _electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userData}`] })
}

/**
 * The REAL quit path (what ⌘Q runs): `app.quit()` fires `before-quit`, which flushes every
 * renderer's autosave and the pending state write before `app.exit(0)`. Resolves once the
 * process is actually gone, so the state file on disk is final when this returns.
 */
export async function quitApp(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((resolve) => app.on('close', () => resolve()))
  // The evaluate connection can drop mid-call while the app exits — that is success, not failure.
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await Promise.race([
    closed,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('app did not exit within 15s of app.quit()')), 15_000)),
  ])
}

export const windowCount = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

/** The window restored for `windows[]` entry `winId` (main loads `<renderer>?win=<id>`). */
export async function appWindow(app: ElectronApplication, winId: string, timeout = 15_000): Promise<Page> {
  const t0 = Date.now()
  for (;;) {
    const page = app.windows().find((p) => p.url().includes(`win=${winId}`))
    if (page !== undefined) return page
    if (Date.now() - t0 > timeout) throw new Error(`no window with ?win=${winId} appeared within ${timeout}ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

// ---------- fixture vault ----------

/** The file the smoke suite seeds open; has nested bullets so outline folding is exercisable. */
export const SEED_FILE = 'Welcome note.md'
export const SEED_BODY = 'seed-welcome-body'
export const PARENT_BULLET = 'Parent bullet'
export const CHILD_BULLET = 'Child bullet alpha'
export const LAST_BULLET = 'Second parent'

/**
 * Generates a small synthetic vault (nested folders, a few `.md` files) into a fresh temp dir.
 * Callers never open this directly — `copyVault` it first (mirror of the never-touch-the-real-vault rule).
 */
export async function buildFixtureVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'g1-vault-src-'))
  await mkdir(path.join(root, 'Projects', 'archive'), { recursive: true })
  await Promise.all([
    writeFile(
      path.join(root, SEED_FILE),
      `# Welcome\n\n${SEED_BODY}\n\n* ${PARENT_BULLET}\n  * ${CHILD_BULLET}\n  * Child bullet beta\n* ${LAST_BULLET}\n`,
    ),
    writeFile(path.join(root, 'Ideas.md'), '# Ideas\n\nsynthetic-idea-body\n'),
    writeFile(path.join(root, 'Projects', 'Roadmap.md'), '# Roadmap\n\nsynthetic-roadmap-body\n'),
    writeFile(path.join(root, 'Projects', 'archive', 'Old plan.md'), '# Old plan\n\nsynthetic-archive-body\n'),
  ])
  return root
}

/** Copies the generated vault to a second temp dir; tests type into the copy only. */
export async function copyVault(src: string): Promise<string> {
  const dest = await mkdtemp(path.join(tmpdir(), 'g1-vault-'))
  await cp(src, dest, { recursive: true })
  return dest
}

// ---------- app state ----------

/**
 * The lens every seeded run starts on (YAZ-847). The app's own default is `topics` — the
 * folder-page tree since YAZ-848 — while every spec in this suite is about the FILE TREE, so the
 * seeds below pre-select `files`: the same kind of pre-configuration as the `windows[]` entry
 * that skips the native folder dialog, not a change to the default. `lenses.spec.ts` seeds its
 * own state (including a pre-847 file with no lens key at all) to pin the default and the
 * switch; `topics.spec.ts` seeds `topics` to drive the tree itself.
 */
const SEEDED_LENS = 'files' as const

/** One-window seed on `vault`/`file` — the no-native-dialog "open folder" (schema: shared/types.ts AppState v1). */
export function seededState(vault: string, file: string | null, opts: { expanded?: string[] } = {}): AppState {
  const state = defaultAppState()
  state.sidebarLens = SEEDED_LENS
  state.recents = [{ path: vault, lastOpened: Date.now() }]
  state.windows = [{ id: 'w1', root: vault, file, tabs: file === null ? [] : [file], bounds: { x: 60, y: 60, width: 1100, height: 750 } }]
  state.folders = { [vault]: { expanded: opts.expanded ?? [], lastFile: file, folds: {}, baseGroups: {}, topicsExpanded: [] } }
  return state
}

export async function readState(userData: string): Promise<AppState> {
  return JSON.parse(await readFile(path.join(userData, 'yaseendocs.json'), 'utf8')) as AppState
}

// ---------- multi-window seeds & gestures (G3, GRO-2180) ----------

/** One `windows[]` entry for `multiWindowState`; bounds cascade from a default when omitted. */
export interface SeedWindow {
  id: string
  root: string
  file: string | null
  bounds?: WindowBounds
}

/**
 * `seededState` for several windows (possibly on several roots): one `windows[]` entry per
 * seed, a `folders` entry per distinct root, `recents` exactly as given (most-recent first).
 */
export function multiWindowState(wins: SeedWindow[], recentRoots: string[]): AppState {
  const state = defaultAppState()
  state.sidebarLens = SEEDED_LENS
  const now = Date.now()
  state.recents = recentRoots.map((p, i) => ({ path: p, lastOpened: now - i }))
  state.windows = wins.map((w, i) => ({
    id: w.id,
    root: w.root,
    file: w.file,
    tabs: w.file === null ? [] : [w.file],
    bounds: w.bounds ?? { x: 60 + i * 40, y: 60 + i * 30, width: 1000, height: 700 },
  }))
  for (const w of wins) {
    state.folders[w.root] ??= { expanded: [], lastFile: w.file, folds: {}, baseGroups: {}, topicsExpanded: [] }
  }
  return state
}

/** The `?win=<id>` a window was created with (null for a page the manager did not create). */
export const winParam = (page: Page): string | null => new URL(page.url()).searchParams.get('win')

/** Waits for a window whose `?win=` id is NOT in `known` — how tests catch a freshly created window. */
export async function extraWindow(app: ElectronApplication, known: readonly string[], timeout = 15_000): Promise<Page> {
  const t0 = Date.now()
  for (;;) {
    const page = app.windows().find((p) => {
      const id = winParam(p)
      return id !== null && !known.includes(id)
    })
    if (page !== undefined) return page
    if (Date.now() - t0 > timeout) throw new Error(`no window beyond [${known.join(', ')}] appeared within ${timeout}ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * Drives a menu item by its stable id — the REAL user path for menu gestures (menu.ts assigns
 * ids for exactly this). `focusWinId` focuses that window first, so handlers that resolve the
 * focused window (File › New Window reads `BrowserWindow.getFocusedWindow()`) see the right one.
 *
 * Focus is asynchronous AND conditional (GRO-2197): while the app is not frontmost, macOS
 * refuses to activate it — `win.focus()` returns with `getFocusedWindow()` still null, and a
 * click fired in that state used to hit the old no-focused-window no-op. So: focus, poll
 * briefly (~500ms) for the focus to actually LAND; only if it has not, steal app focus ONCE
 * (`app.focus({ steal: true })` — the suite runs headed on a machine someone may be using, so
 * never steal when the plain focus took) and poll again (~3s total). Then click regardless:
 * main's own last-focused fallback (`pickMenuTargetWindow`) covers the single-window case even
 * when macOS never granted focus at all.
 */
export async function clickMenuItem(app: ElectronApplication, itemId: string, focusWinId?: string): Promise<void> {
  await app.evaluate(
    async ({ Menu, BrowserWindow, app: electronApp }, arg) => {
      const target =
        arg.focusWinId === undefined
          ? undefined
          : BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${arg.focusWinId}`))
      if (target !== undefined) {
        const focusLanded = async (deadline: number): Promise<boolean> => {
          while (BrowserWindow.getFocusedWindow() !== target) {
            if (Date.now() >= deadline) return false
            await new Promise((r) => setTimeout(r, 50))
          }
          return true
        }
        target.focus()
        if (!(await focusLanded(Date.now() + 500))) {
          electronApp.focus({ steal: true })
          target.focus()
          await focusLanded(Date.now() + 2500) // best effort — the click below runs either way
        }
      }
      const item = Menu.getApplicationMenu()?.getMenuItemById(arg.itemId)
      if (item == null) throw new Error(`no menu item with id ${arg.itemId}`)
      item.click()
    },
    { itemId, focusWinId },
  )
}

/** Replays macOS's `open-url` (a clicked `yaseendocs://` link) on the running app — the E1 entry point. */
export async function emitOpenUrl(app: ElectronApplication, url: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, u) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, u)
  }, url)
}

/** Replays macOS's `open-file` (Finder "Open With") — E2 rides the same link pipeline as E1. */
export async function emitOpenFile(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, p) => {
    electronApp.emit('open-file', { preventDefault: () => undefined }, p)
  }, filePath)
}

/** Closes the window of state entry `winId` through the REAL close path (flush handshake included). */
export async function closeWindow(app: ElectronApplication, winId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes(`win=${id}`))
      ?.close()
  }, winId)
}

// ---------- evidence ----------

export async function md5(file: string): Promise<string> {
  return createHash('md5').update(await readFile(file)).digest('hex')
}

/** Screenshots are the evidence format (locked): step-numbered PNGs under the gitignored artifacts dir. */
export async function shoot(page: Page, name: string): Promise<string> {
  await mkdir(ARTIFACTS_DIR, { recursive: true })
  const file = path.join(ARTIFACTS_DIR, `${name}.png`)
  await page.screenshot({ path: file })
  return file
}
