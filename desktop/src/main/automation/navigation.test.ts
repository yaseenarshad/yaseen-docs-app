import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATION_LIMITS } from '@shared/automation'
import { validateOutput } from '@shared/automationCommands'
import { defaultAppState, defaultRightPanelIdentity, VAULT_CONFIG_DIR, type WindowEntry } from '@shared/types'
import { setFavorites } from '../favorites'
import { setFocusFolders } from '../focusFolders'
import { navigate, type NavigationHost } from './navigation'
import { RendererRequests } from './renderer'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-nav-')); await mkdir(join(root, 'Mochi')); await writeFile(join(root, 'Mochi/card.md'), 'card') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const entry = (id: string, roots: string[]): WindowEntry => ({ id, root: roots[0], roots, tabs: [], file: null, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 1000, height: 800 } })
const host = (windows: WindowEntry[] = []): NavigationHost => ({ state: () => defaultAppState(), windows: () => windows, open: vi.fn(() => 'new'), raise: vi.fn(), apply: vi.fn(async () => ({ path: null, tab: null, sidebar: 'files', sidebarCollapsed: false, acknowledged: true })), usedWorkspace: vi.fn(async () => {}) })
/** The result, after it is proven against the declared output (YAZ-4506). */
const checked = async (value: Promise<unknown>) => { const result = await value; validateOutput('navigation.open', result); return result }

describe('exact context navigation', () => {
  it('closes an empty start window once a created window applies, and leaves vault windows alone', async () => {
    const app = host([entry('start', []), entry('gone', []), entry('other', ['/other'])])
    app.closeStartWindow = vi.fn(async (id: string) => id === 'start')
    // A start window that a concurrent call already closed is skipped, not an error (YAZ-4565).
    expect(await checked(navigate(app, { root, path: join(root, 'Mochi'), mode: 'new' }))).toMatchObject({ window: 'new', created: true, closedStartWindows: ['start'] })
    expect(app.closeStartWindow).toHaveBeenCalledTimes(2)
    vi.mocked(app.closeStartWindow).mockClear()
    app.apply = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'RENDERER_TIMEOUT' }) })
    await expect(navigate(app, { root, mode: 'new' })).rejects.toBeTruthy()
    expect(app.closeStartWindow).not.toHaveBeenCalled()
  })

  it('reuses only the most recent exact window and preserves unspecified state', async () => {
    const app = host([entry('unrelated', [root, '/other']), entry('recent', [root]), entry('older', [root])])
    expect(await checked(navigate(app, { root, path: join(root, 'Mochi') }))).toMatchObject({ window: 'recent', created: false })
    expect(app.open).not.toHaveBeenCalled()
    expect(app.raise).toHaveBeenCalledExactlyOnceWith('recent')
    expect(app.apply).toHaveBeenCalledWith('recent', { path: join(root, 'Mochi') })
  })

  it('takes an explicit live window, refuses a closed one, and refuses one with new mode', async () => {
    const app = host([entry('recent', [root]), entry('older', [root])])
    expect(await checked(navigate(app, { window: 'older', path: join(root, 'Mochi') }))).toMatchObject({ window: 'older', created: false, roots: [root] })
    await expect(navigate(app, { window: 'gone' })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
    await expect(navigate(app, { window: 'older', mode: 'new' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(app.raise).toHaveBeenCalledOnce()
  })

  it('creates a fresh context for new mode and waits for its actual acknowledgement', async () => {
    const app = host([entry('existing', [root])])
    let done!: (value: unknown) => void, applying!: () => void
    const started = new Promise<void>(resolve => { applying = resolve })
    app.apply = vi.fn(() => { applying(); return new Promise(resolve => { done = resolve }) })
    let finished = false
    const result = navigate(app, { root, mode: 'new', path: join(root, 'Mochi') }).then(value => { finished = true; return value })
    await started
    expect(finished).toBe(false)
    expect(app.open).toHaveBeenCalledWith({ root, roots: [root], file: null })
    done({ acknowledged: true })
    expect(await result).toMatchObject({ window: 'new', created: true, applied: { acknowledged: true } })
  })

  it('refuses an unrelated explicit window, missing and outside paths, and missing Favorite membership before raising', async () => {
    const app = host([entry('other', [root, '/elsewhere'])])
    await expect(navigate(app, { root, window: 'other' })).rejects.toMatchObject({ code: 'WINDOW_SCOPE_MISMATCH' })
    await expect(navigate(app, { root, path: join(root, 'absent') })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(navigate(app, { root, path: tmpdir() })).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
    await expect(navigate(app, { root, path: 'Mochi' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(navigate(app, { root, path: join(root, 'Mochi'), sidebar: 'favorites' })).rejects.toMatchObject({ code: 'NOT_IN_COLLECTION' })
    await expect(navigate(app, { root, group: 'Any' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(navigate(app, {})).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(app.raise).not.toHaveBeenCalled()
    expect(app.open).not.toHaveBeenCalled()
  })

  it('opens a Favorite, a folder inside it, and a folder in a Favorites group, and names the group it reveals', async () => {
    const app = host([entry('w1', [root])]), mochi = join(root, 'Mochi'), deep = join(root, 'Deep'), inner = join(deep, 'Inner')
    await mkdir(inner, { recursive: true })
    await setFavorites(root, [mochi])
    await setFocusFolders(root, 'vault', [{ id: 'g1', name: 'Study', items: [{ vault: root.split('/').at(-1)!, path: 'Deep' }], created: 1, at: 1 }], 'favorites')
    await checked(navigate(app, { root, path: mochi, sidebar: 'favorites' }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path: mochi, sidebar: 'favorites' })
    await checked(navigate(app, { root, path: join(mochi, 'card.md'), sidebar: 'favorites', reveal: true }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path: join(mochi, 'card.md'), sidebar: 'favorites', reveal: true })
    await checked(navigate(app, { root, path: inner, sidebar: 'favorites', group: 'study' }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path: inner, sidebar: 'favorites', group: 'g1' })
    // A folder of the top level is not in the group alone, and is not in Focus.
    await expect(navigate(app, { root, path: mochi, sidebar: 'favorites', group: 'g1' })).rejects.toMatchObject({ code: 'NOT_IN_COLLECTION' })
    await expect(navigate(app, { root, path: mochi, sidebar: 'focus' })).rejects.toMatchObject({ code: 'NOT_IN_COLLECTION' })
    await expect(navigate(app, { root, sidebar: 'favorites', group: 'Missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('reads a renamed vault’s groups without writing the healed file (reads never change content)', async () => {
    const app = host([entry('w1', [root])]), deep = join(root, 'Deep')
    await mkdir(deep)
    await setFocusFolders(root, 'vault', [{ id: 'g1', name: 'Study', items: [{ vault: root.split('/').at(-1)!, path: 'Deep' }], created: 1, at: 1 }], 'favorites')
    // The file names the vault by an older folder name: a GUI read would heal and write it.
    const config = join(root, VAULT_CONFIG_DIR), [file] = (await readdir(config)).filter(name => name.includes('favorite'))
    const name = root.split('/').at(-1)!, renamed = (await readFile(join(config, file), 'utf8')).replaceAll(`"${name}"`, '"Old name"')
    await writeFile(join(config, file), renamed)
    await checked(navigate(app, { root, path: deep, sidebar: 'favorites', group: 'g1' }))
    expect(await readFile(join(config, file), 'utf8')).toBe(renamed)
    expect(await readdir(config)).toEqual([file])
  })

  it('checks a requested view against the saved folder page and passes its exact name (YAZ-4518)', async () => {
    const app = host([entry('w1', [root])]), path = join(root, 'Mochi')
    await writeFile(join(path, '.folder.md'), '---\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n    - type: board\n      name: CLI Board\n---\n')
    await checked(navigate(app, { window: 'w1', path, view: 'cli board' }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path, view: 'CLI Board' })
    vi.mocked(app.raise).mockClear()
    await expect(navigate(app, { window: 'w1', path, view: 'Missing' })).rejects.toMatchObject({ code: 'NOT_FOUND', details: { views: ['Table', 'CLI Board'] } })
    await expect(navigate(app, { window: 'w1', path: join(path, 'card.md'), view: 'Table' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(app.raise).not.toHaveBeenCalled()
  })

  it('knows the default views of a folder page with no saved views, by the vault’s kind', async () => {
    const app = host([entry('w1', [root])]), path = join(root, 'Mochi')
    await checked(navigate(app, { window: 'w1', path, view: 'table' }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path, view: 'Table' })
    await expect(navigate(app, { window: 'w1', path, view: 'Board' })).rejects.toMatchObject({ code: 'NOT_FOUND', details: { views: ['Table'] } })
    await mkdir(join(root, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(join(root, VAULT_CONFIG_DIR, 'ids.json'), JSON.stringify({ enabled: true, letters: 'NAV' }))
    await checked(navigate(app, { window: 'w1', path, view: 'Board' }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path, view: 'Board' })
  })

  it('picks a view by the rule the live tab uses: an exact name first, else one match without case (YAZ-4527 P9)', async () => {
    const app = host([entry('w1', [root])]), path = join(root, 'Mochi')
    await writeFile(join(path, '.folder.md'), '---\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n    - type: list\n      name: table\n---\n')
    for (const name of ['Table', 'table']) {
      await checked(navigate(app, { window: 'w1', path, view: name }))
      expect(app.apply).toHaveBeenLastCalledWith('w1', { path, view: name })
    }
    await expect(navigate(app, { window: 'w1', path, view: 'TABLE' })).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET', details: { views: ['Table', 'table'] } })
  })

  it('checks a list scope against the list the window shows and stores none in it (YAZ-4527 P3)', async () => {
    const other = await mkdtemp(join(tmpdir(), 'docs-nav-other-'))
    try {
      const app = host([entry('one', [root]), entry('two', [root, other])])
      // A vault alone shows its own list; a workspace shows the workspace list while its switch is on (the default).
      await expect(navigate(app, { window: 'one', sidebar: 'favorites', scope: 'workspace' })).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { scope: 'vault' } })
      await expect(navigate(app, { window: 'two', sidebar: 'focus', scope: 'vault' })).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { scope: 'workspace' } })
      await expect(navigate(app, { window: 'one', scope: 'vault' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      expect(app.raise).not.toHaveBeenCalled()
      await checked(navigate(app, { window: 'one', sidebar: 'favorites', scope: 'vault' }))
      expect(app.apply).toHaveBeenLastCalledWith('one', { sidebar: 'favorites' })
      const state = defaultAppState()
      state.settings.workspaceLists = { favorites: false, focus: true }
      app.state = () => state
      await checked(navigate(app, { window: 'two', sidebar: 'favorites', scope: 'vault' }))
      expect(app.apply).toHaveBeenLastCalledWith('two', { sidebar: 'favorites' })
    } finally { await rm(other, { recursive: true, force: true }) }
  })

  it('resolves workspace identities, keeps every vault, lists candidates for an ambiguous name, and requires explicit partial opening', async () => {
    const other = await mkdtemp(join(tmpdir(), 'docs-nav-other-'))
    try {
      const state = defaultAppState(), app = host()
      state.vaultSets = [{ id: 'all', name: 'All Folders', roots: [root, other], lastUsed: 0 }, { id: 'skills', name: 'Skills', roots: [root, join(root, 'missing')], lastUsed: 0 },
        { id: 'twin-a', name: 'Twin', roots: [root], lastUsed: 0 }, { id: 'twin-b', name: 'twin', roots: [other], lastUsed: 0 }]
      app.state = () => state
      expect(await checked(navigate(app, { workspace: 'all folders', mode: 'new' }))).toMatchObject({ roots: [root, other], created: true })
      expect(app.open).toHaveBeenLastCalledWith({ root, roots: [root, other], file: null })
      expect(app.usedWorkspace).toHaveBeenLastCalledWith('all')
      await expect(navigate(app, { workspace: 'Twin' })).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET', details: { candidates: [{ id: 'twin-a', name: 'Twin' }, { id: 'twin-b', name: 'twin' }], total: 2, truncated: false } })
      expect(await checked(navigate(app, { workspace: 'twin-b' }))).toMatchObject({ roots: [other] })
      await expect(navigate(app, { workspace: 'Skills' })).rejects.toMatchObject({ code: 'MISSING_VAULT' })
      expect(await checked(navigate(app, { workspace: 'skills', allowPartial: true }))).toMatchObject({ roots: [root], missing: [join(root, 'missing')] })
      expect(app.usedWorkspace).toHaveBeenLastCalledWith('skills')
      await expect(navigate(app, { workspace: 'Nowhere' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    } finally { await rm(other, { recursive: true, force: true }) }
  })

  it('takes paths with spaces, quotes, $, ;, and Unicode as data', async () => {
    const app = host([entry('w1', [root])]), odd = join(root, 'Q "uote" $HOME; rm -rf ünï 🌍')
    await mkdir(odd)
    await checked(navigate(app, { root, path: odd }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path: odd })
  })

  it('takes the names below the vault as they are on disk, on a disk that ignores case', async () => {
    const app = host([entry('w1', [root])]), mochi = join(root, 'Mochi')
    const ignoresCase = await stat(join(root, 'mochi')).then(() => true, () => false)
    if (!ignoresCase) return
    await setFavorites(root, [mochi])
    await checked(navigate(app, { root, path: join(root, 'mochi/CARD.md'), sidebar: 'favorites' }))
    expect(app.apply).toHaveBeenLastCalledWith('w1', { path: join(mochi, 'card.md'), sidebar: 'favorites' })
  })

  it('runs one navigation at a time, so a quick second call sees the first one’s window', async () => {
    const windows: WindowEntry[] = [entry('start', [])]
    const app = host(windows)
    app.open = vi.fn(() => { windows.push(entry('made', [root])); return 'made' })
    app.closeStartWindow = vi.fn(async (id: string) => { windows.splice(windows.findIndex(window => window.id === id), 1); return true })
    const [first, second] = await Promise.all([navigate(app, { root }), navigate(app, { root })])
    expect(first).toMatchObject({ window: 'made', created: true, closedStartWindows: ['start'] })
    expect(second).toMatchObject({ window: 'made', created: false, closedStartWindows: [] })
    expect(app.open).toHaveBeenCalledOnce()
  })
})

describe('targets the sidebar cannot show (YAZ-4638, YAZ-4639)', () => {
  it('refuses a hidden item, or a path below one, before any window moves (YAZ-4638)', async () => {
    const app = host([entry('w1', [root])])
    await mkdir(join(root, '.yaseendocs/inner'), { recursive: true }); await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'Mochi/.folder.md'), '---\n---\n')
    for (const path of [join(root, '.yaseendocs'), join(root, '.yaseendocs/inner'), join(root, 'Mochi/.folder.md'), join(root, 'node_modules')]) {
      await expect(navigate(app, { window: 'w1', path, sidebar: 'files' }), path).rejects.toMatchObject({ code: 'HIDDEN_TARGET' })
    }
    expect(app.raise).not.toHaveBeenCalled()
    expect(app.apply).not.toHaveBeenCalled()
  })

  it('takes a vault folder as the path as that vault with no page, as opening a vault does (YAZ-4639)', async () => {
    const other = await mkdtemp(join(tmpdir(), 'docs-nav-other-'))
    try {
      const app = host([entry('one', [root]), entry('two', [root, other])])
      await setFavorites(root, [join(root, 'Mochi')])
      for (const path of [root, `${root}/`]) {
        expect(await checked(navigate(app, { root, path, sidebar: 'favorites', reveal: true }))).toMatchObject({ window: 'one', created: false })
        expect(app.apply).toHaveBeenLastCalledWith('one', { sidebar: 'favorites', reveal: true })
      }
      await checked(navigate(app, { roots: [root, other], path: other, sidebar: 'files' }))
      expect(app.apply).toHaveBeenLastCalledWith('two', { sidebar: 'files' })
      await expect(navigate(app, { root, path: root, view: 'Table' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    } finally { await rm(other, { recursive: true, force: true }) }
  })

  it('lets the next navigation run when a window never answers, within the CLI’s default wait (YAZ-4638)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const requests = new RendererRequests('automation:request'), page = { id: 1, send: vi.fn() }
      requests.setReady(page, true)
      const app = host([entry('w1', [root])])
      app.apply = vi.fn((_id, target) => requests.navigate(page, target))
      const stuck = navigate(app, { window: 'w1', path: join(root, 'Mochi') })
      const failed = expect(stuck).rejects.toMatchObject({ code: 'RENDERER_TIMEOUT' })
      // The file checks are real I/O: wait for each send before the clock moves.
      const sent = async (count: number) => { while (page.send.mock.calls.length < count) await new Promise(done => setImmediate(done)) }
      let next = false
      const later = navigate(app, { window: 'w1', path: join(root, 'Mochi/card.md') }).then(value => { next = true; return value })
      await sent(1)
      await vi.advanceTimersByTimeAsync(AUTOMATION_LIMITS.waitMs - 1)
      expect(page.send).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1); await failed
      await sent(2)
      requests.reply(1, { id: page.send.mock.calls[1][1].id, ok: true, value: { acknowledged: true } })
      await later
      expect(next).toBe(true)
    } finally { vi.useRealTimers() }
  })
})

describe('renderer acknowledgement', () => {
  it('holds a cold request until ready and accepts only the selected renderer reply', async () => {
    const requests = new RendererRequests('automation:request'), page = { id: 1, send: vi.fn() }
    let finished = false
    const result = requests.navigate(page, { sidebar: 'favorites' }).then(value => { finished = true; return value })
    expect(page.send).not.toHaveBeenCalled()
    requests.setReady(page, true)
    const message = page.send.mock.calls[0][1]
    requests.reply(2, { id: message.id, ok: true, value: 'wrong window' })
    await Promise.resolve()
    expect(finished).toBe(false)
    requests.reply(1, { id: message.id, ok: true, value: 'applied' })
    expect(await result).toBe('applied')
  })
  it('reports a closed window instead of claiming the request applied', async () => {
    const requests = new RendererRequests('automation:request'), page = { id: 1, send: vi.fn() }
    const result = requests.navigate(page, {})
    requests.closed(1)
    await expect(result).rejects.toMatchObject({ code: 'WINDOW_CLOSED' })
  })
  it('passes a renderer refusal on with its code and details', async () => {
    const requests = new RendererRequests('automation:request'), page = { id: 1, send: vi.fn() }
    requests.setReady(page, true)
    const result = requests.navigate(page, { view: 'Gone' })
    requests.reply(1, { id: page.send.mock.calls[0][1].id, ok: false, error: { code: 'NOT_FOUND', message: 'no', details: { views: [] } } })
    await expect(result).rejects.toMatchObject({ code: 'NOT_FOUND', details: { views: [] } })
  })
})
