/**
 * Where a perf run keeps its vaults and profiles (YAZ-2131 1C): one scratch dir the harness owns,
 * marks and removes. Never the real profile (`~/Library/Application Support/Yaseen Docs`), never a
 * real vault: the dir must sit under a temp root, and must be empty or already carry the marker.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MARKER = '.yaseen-docs-perf'
const TMP_ROOTS = [os.tmpdir(), '/tmp'].filter((p) => fs.existsSync(p)).flatMap((p) => [p, fs.realpathSync(p)])
const underTmp = (p) => TMP_ROOTS.some((t) => p.startsWith(t + path.sep))

/** Claims `dir` for this run; throws unless it is under a temp root and empty or ours. Checked before anything is created. */
export function claimWorkDir(dir) {
  if (!underTmp(path.resolve(dir))) throw new Error(`refusing --work ${dir}: it must be under ${TMP_ROOTS.join(' or ')}`)
  fs.mkdirSync(dir, { recursive: true })
  const at = fs.realpathSync(dir)
  if (!underTmp(at)) throw new Error(`refusing --work ${dir}: it resolves to ${at}, outside the temp roots`)
  const entries = fs.readdirSync(at)
  if (entries.length > 0 && !entries.includes(MARKER)) throw new Error(`refusing --work ${dir}: not empty and not made by this harness`)
  fs.writeFileSync(path.join(at, MARKER), '')
  return {
    root: at,
    /** A fresh, empty folder for one scenario × build. */
    dirFor(name) {
      const d = path.join(at, name)
      fs.rmSync(d, { recursive: true, force: true })
      fs.mkdirSync(d, { recursive: true })
      return d
    },
    remove: () => fs.rmSync(at, { recursive: true, force: true }),
  }
}

/**
 * Writes `<profile>/yaseendocs.json` the way desktop/e2e/helpers.ts `seededState` does: one entry per
 * window (a `windows[]` entry skips the native folder dialog), each on the Files lens.
 * `wins`: `[{ id, root, tabs }]`; the active file is the first tab.
 */
export function writeState(profile, wins) {
  fs.mkdirSync(profile, { recursive: true })
  const state = {
    version: 1,
    settings: {},
    sidebarWidth: 280,
    recents: [...new Set(wins.map((w) => w.root))].map((p) => ({ path: p, lastOpened: Date.now() })),
    windows: wins.map((w, i) => ({
      id: w.id,
      root: w.root,
      file: w.tabs[0] ?? null,
      tabs: w.tabs,
      rightPanel: { open: false, width: 420, items: [], expanded: null },
      sidebarCollapsed: false,
      sidebarLens: 'files',
      focusDirs: [],
      focusFavorites: [],
      bounds: { x: 40 + i * 40, y: 40 + i * 30, width: 1280, height: 860 },
    })),
    folders: Object.fromEntries(wins.map((w) => [w.root, { expanded: [], lastFile: w.tabs[0] ?? null, folds: {}, baseGroups: {}, name: null }])),
  }
  fs.writeFileSync(path.join(profile, 'yaseendocs.json'), JSON.stringify(state, null, 2))
}
