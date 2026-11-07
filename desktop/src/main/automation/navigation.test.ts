import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState, defaultRightPanelIdentity, type WindowEntry } from '@shared/types'
import { navigationLink, parseNavigationLink } from '@shared/navigationLinks'
import { _evictAll } from '../vaultIndex/live'
import { generateNavigationLink, navigate, type NavigationHost } from './navigation'
import { RendererRequests } from './renderer'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-nav-')); await mkdir(join(root, 'Mochi')); await writeFile(join(root, 'Mochi/card.md'), 'card') })
afterEach(async () => { _evictAll(); await rm(root, { recursive: true, force: true }) })
const entry = (id: string, roots: string[]): WindowEntry => ({ id, root: roots[0], roots, tabs: [], file: null, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 1000, height: 800 } })
const host = (windows: WindowEntry[] = []): NavigationHost => ({ state: () => defaultAppState(), windows: () => windows, open: vi.fn(() => 'new'), raise: vi.fn(), apply: vi.fn(async () => ({ acknowledged: true })), inspect: vi.fn(async () => ({})), operate: vi.fn(async () => ({})), usedWorkspace: vi.fn(async () => {}) })

describe('exact context navigation', () => {
  it('reuses only the most recent exact window and preserves unspecified state', async () => {
    const app = host([entry('unrelated', [root, '/other']), entry('recent', [root]), entry('older', [root])])
    expect(await navigate(app, { root, path: join(root, 'Mochi') })).toMatchObject({ window: 'recent', created: false })
    expect(app.open).not.toHaveBeenCalled()
    expect(app.raise).toHaveBeenCalledExactlyOnceWith('recent')
    expect(app.apply).toHaveBeenCalledWith('recent', { path: join(root, 'Mochi') })
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
  it('refuses an unrelated explicit window, missing paths, and missing Favorite membership before raising', async () => {
    const app = host([entry('other', [root, '/elsewhere'])])
    await expect(navigate(app, { root, window: 'other' })).rejects.toMatchObject({ code: 'WINDOW_SCOPE_MISMATCH' })
    await expect(navigate(app, { root, path: join(root, 'absent') })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(navigate(app, { root, path: join(root, 'Mochi'), sidebar: 'favorites' })).rejects.toMatchObject({ code: 'NOT_IN_COLLECTION' })
    expect(app.raise).not.toHaveBeenCalled()
    expect(app.open).not.toHaveBeenCalled()
  })
  it('resolves workspace identities and requires explicit partial opening', async () => {
    const state = defaultAppState(), app = host()
    state.vaultSets = [{ id: 'skills', name: 'Skills', roots: [root, join(root, 'missing')], lastUsed: 0 }]
    app.state = () => state
    await expect(navigate(app, { workspace: 'Skills' })).rejects.toMatchObject({ code: 'MISSING_VAULT' })
    expect(await navigate(app, { workspace: 'skills', allowPartial: true })).toMatchObject({ roots: [root], missing: [join(root, 'missing')] })
    expect(app.usedWorkspace).toHaveBeenCalledWith('skills')
  })
  it('generates lossless navigation-only links and rejects hidden action or secret fields', async () => {
    const target = { roots: [root], path: join(root, 'Mochi'), sidebar: 'favorites' as const, view: 'Cards # ? 日本語' }
    expect(parseNavigationLink(navigationLink(target))).toEqual(target)
    const generated = await generateNavigationLink(defaultAppState(), { root, name: 'Mochi', mode: 'new' })
    expect(parseNavigationLink(generated.url)).toEqual({ roots: [root], path: join(root, 'Mochi'), mode: 'new' })
    for (const input of [{ ...target, command: 'file.delete' }, { ...target, token: 'secret' }, { ...target, publish: true }]) {
      expect(parseNavigationLink('yaseendocs://navigate?v=1&request=' + encodeURIComponent(JSON.stringify(input)))).toBeNull()
    }
    expect(parseNavigationLink('yaseendocs:///note.md')).toBeNull()
    await expect(generateNavigationLink(defaultAppState(), { root, path: join(root, 'Mochi'), sidebar: 'favorites' })).rejects.toMatchObject({ code: 'NOT_IN_COLLECTION' })
    await expect(generateNavigationLink(defaultAppState(), { root, window: 'ephemeral' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
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
})
