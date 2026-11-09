/** YAZ-4507 independent checker: real socket -> IPC -> renderer, hidden throughout. */
import { test, expect, _electron } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultAppState, defaultRightPanelIdentity } from '../../shared/types'

const exec = promisify(execFile)
test('an acknowledged Favorites navigation leaves the renderer ready for another command', async () => {
  test.setTimeout(30_000)
  const scratch = await mkdtemp(join(tmpdir(), 'checker-nav-repeat-'))
  const root = join(scratch, 'Demo Skills'), profile = join(scratch, 'profile'), folder = join(root, 'Mochi')
  await mkdir(folder, { recursive: true }); await mkdir(profile, { mode: 0o700 }); await mkdir(join(root, '.yaseendocs'))
  await writeFile(join(folder, 'card.md'), '# Example card\n')
  await writeFile(join(root, '.yaseendocs/favorites.json'), JSON.stringify({ version: 1, favorites: ['Mochi'] }))
  const state = defaultAppState()
  state.settings.startupWindows = 'all'
  state.recents = [{ path: root, lastOpened: 1 }]
  state.windows = [{ id: 'w1', root, roots: [root], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 1000, height: 700 } }]
  await writeFile(join(profile, 'yaseendocs.json'), JSON.stringify(state))
  const env = { ...process.env, YASEEN_DOCS_USER_DATA_DIR: profile, YASEEN_DOCS_E2E: '1', YASEEN_DOCS_E2E_HIDDEN: '1', YASEEN_DOCS_FAKE_CLIPBOARD: '1' }
  const app = await _electron.launch({ args: [resolve('desktop/out/main/index.js'), `--user-data-dir=${profile}`], env })
  const call = async (args: Record<string, unknown>) => {
    const argv = ['desktop/out/main/cli.js', 'navigation', 'open', '--profile', profile, '--input', JSON.stringify(args), '--wait-ms', '5000']
    try { return JSON.parse((await exec(process.execPath, argv, { env })).stdout) }
    catch (error) { return JSON.parse((error as { stderr: string }).stderr) }
  }
  try {
    await expect.poll(async () => app.windows().length).toBe(1)
    const first = await call({ root, path: folder, sidebar: 'favorites', mode: 'new' })
    expect(first.ok).toBe(true)
    const page = app.windows().find(page => page.url().includes(`win=${first.value.window}`))!
    await page.waitForSelector(`[data-path="${folder}"]`)
    await page.screenshot({ path: join(scratch, 'first-acknowledged.png') })
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.isVisible()))).toBe(false)
    const second = await call({ window: first.value.window, path: folder, sidebar: 'favorites' })
    expect(second).toMatchObject({ ok: true, value: { created: false, window: first.value.window } })
  } finally {
    // These fixtures contain no user data. Do not wait for a stuck request during failed-test cleanup.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    if (app.process().exitCode === null) app.process().kill('SIGKILL')
    await rm(scratch, { recursive: true, force: true })
  }
})
