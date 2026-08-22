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
import { defaultAppState, type AppState } from '../../shared/types'

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

/** One-window seed on `vault`/`file` — the no-native-dialog "open folder" (schema: shared/types.ts AppState v1). */
export function seededState(vault: string, file: string | null, opts: { expanded?: string[] } = {}): AppState {
  const state = defaultAppState()
  state.recents = [{ path: vault, lastOpened: Date.now() }]
  state.windows = [{ id: 'w1', root: vault, file, bounds: { x: 60, y: 60, width: 1100, height: 750 } }]
  state.folders = { [vault]: { expanded: opts.expanded ?? [], lastFile: file, folds: {}, baseGroups: {} } }
  return state
}

export async function readState(userData: string): Promise<AppState> {
  return JSON.parse(await readFile(path.join(userData, 'yaseendocs.json'), 'utf8')) as AppState
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
