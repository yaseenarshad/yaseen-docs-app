import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findVenv, pyrightPath, pyrightServerCommand, pyrightWorkspaceReady, pythonConfigurationReply, pythonProjectRoot, resolvePyright } from './python'
import type { NotificationHandler } from './rpc'
import type { LanguageServer, ServerExit } from './server'

/** The Python helper's rules (YAZ-3455 4C) on a fake disk: where pyright is, the project, the venv, the settings it gets. */

const R = path.resolve('/r')
const p = (...parts: string[]) => path.join(R, ...parts)
const disk = (...files: string[]) => {
  const set = new Set(files.map((f) => path.resolve(f)))
  return (f: string) => set.has(path.resolve(f))
}

describe('python helper (YAZ-3455)', () => {
  it('finds pyright inside the app when packaged, in node_modules above the app in dev', () => {
    const exists = disk(p('Resources', 'lsp', 'pyright', 'langserver.index.js'), p('repo', 'node_modules', 'pyright', 'langserver.index.js'))
    expect(resolvePyright({ isPackaged: true, resourcesPath: p('Resources'), appPath: '', exists })).toBe(p('Resources', 'lsp', 'pyright', 'langserver.index.js'))
    expect(resolvePyright({ isPackaged: false, resourcesPath: '', appPath: p('repo', 'desktop'), exists })).toBe(p('repo', 'node_modules', 'pyright', 'langserver.index.js'))
    expect(resolvePyright({ isPackaged: true, resourcesPath: p('Other'), appPath: '', exists })).toBeNull()
  })

  it("runs on the app's own Node with ELECTRON_RUN_AS_NODE, in the project folder, with /usr/bin out of PATH on macOS", () => {
    const cmd = pyrightServerCommand('/app/lsp/pyright/langserver.index.js', '/proj', '/app/Electron', { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: '/h' })
    expect(cmd).toMatchObject({ name: 'python', command: '/app/Electron', args: ['/app/lsp/pyright/langserver.index.js', '--stdio'], cwd: '/proj' })
    expect(cmd.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', HOME: '/h' })
    expect(pyrightPath('/usr/bin:/bin:/opt/homebrew/bin', 'darwin')).toBe('/bin:/opt/homebrew/bin')
    expect(pyrightPath('/usr/bin:/bin', 'linux')).toBe('/usr/bin:/bin')
  })

  it('the project is the nearest pyproject.toml, setup.py or requirements.txt; else the vault; else the file\'s folder', () => {
    expect(pythonProjectRoot(p('v', 'a', 'pkg', 'm.py'), p('v'), disk(p('v', 'a', 'requirements.txt')))).toBe(p('v', 'a'))
    expect(pythonProjectRoot(p('v', 'a', 'm.py'), p('v'), disk(p('v', 'a', 'setup.py'), p('v', 'pyproject.toml')))).toBe(p('v', 'a'))
    expect(pythonProjectRoot(p('v', 'a', 'm.py'), p('v'), disk())).toBe(p('v'))
    expect(pythonProjectRoot(p('elsewhere', 'm.py'), p('v'), disk())).toBe(p('elsewhere'))
  })

  it('a .venv (or venv) gives its interpreter, when there is one, and every site-packages folder on disk', () => {
    const venv = p('proj', '.venv')
    const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python')
    const exists = disk(path.join(venv, 'pyvenv.cfg'), python, path.join(venv, 'lib', 'python3.12', 'site-packages'))
    const list = (dir: string) => (dir === path.join(venv, 'lib') ? ['python3.12', 'README'] : [])
    expect(findVenv(p('proj'), exists, list)).toEqual({ pythonPath: python, sitePackages: [path.join(venv, 'lib', 'python3.12', 'site-packages')] })
    // No interpreter (S3): the libraries still count.
    const noPython = disk(path.join(p('proj', 'venv'), 'pyvenv.cfg'), path.join(p('proj', 'venv'), 'Lib', 'site-packages'))
    expect(findVenv(p('proj'), noPython, () => [])).toEqual({ sitePackages: [path.join(p('proj', 'venv'), 'Lib', 'site-packages')] })
    expect(findVenv(p('proj'), disk(), () => [])).toBeNull()
  })

  it("answers pyright's workspace/configuration: the python section gets the venv, others null", async () => {
    const reply = pythonConfigurationReply(p('proj'), { pythonPath: '/proj/.venv/bin/python', sitePackages: ['/sp'] })
    const answer = reply('workspace/configuration', { items: [{ section: 'python' }, { section: 'python.analysis' }, { section: 'pyright' }] }) as unknown[]
    expect(answer[0]).toEqual({ pythonPath: '/proj/.venv/bin/python', analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly', extraPaths: ['/sp'] } })
    expect(answer[1]).toMatchObject({ extraPaths: ['/sp'] })
    expect(answer[2]).toBeNull()
    expect(reply('client/registerCapability', {})).toBeNull()
    expect((reply('workspace/configuration', { items: [{ section: 'python' }] }) as Record<string, unknown>[])[0]).not.toHaveProperty('venvPath')
    expect((pythonConfigurationReply(p('proj'), null)('workspace/configuration', { items: [{ section: 'python' }] }) as Record<string, unknown>[])[0]).not.toHaveProperty('pythonPath')
  })

  it("references wait for pyright's file list: its log line, its end, or the time limit", async () => {
    const fake = () => {
      let handler: NotificationHandler = () => undefined
      let end!: (exit: ServerExit) => void
      const server = { onNotification: (h: NotificationHandler) => ((handler = h), () => undefined), exited: new Promise<ServerExit>((r) => (end = r)) } as unknown as LanguageServer
      return { server, say: (message: string) => handler('window/logMessage', { type: 3, message }), end: () => end({ code: 0, signal: null }) }
    }
    const a = fake()
    let ready = false
    void pyrightWorkspaceReady(a.server, 60_000).then(() => (ready = true))
    a.say('Assuming Python version 3.12')
    await Promise.resolve()
    expect(ready).toBe(false)
    a.say('Found 4 source files')
    await vi.waitFor(() => expect(ready).toBe(true))

    const b = fake()
    const ended = pyrightWorkspaceReady(b.server, 60_000)
    b.end()
    await expect(ended).resolves.toBeUndefined()

    await expect(pyrightWorkspaceReady(fake().server, 10)).resolves.toBeUndefined()

    // YAZ-3466: a workspace where pyright counts no file (a dot folder, say) logs this line instead.
    const c = fake()
    let none = false
    void pyrightWorkspaceReady(c.server, 60_000).then(() => (none = true))
    c.say('No source files found.')
    await vi.waitFor(() => expect(none).toBe(true), { timeout: 500 })
  })
})
