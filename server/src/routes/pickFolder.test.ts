import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess, ExecFileException } from 'node:child_process'
import { execFile } from 'node:child_process'
import type { ApiError, PickFolderResponse } from '@shared/types'
import { app } from '../app'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

type ExecFileCallback = (err: ExecFileException | null, stdout: string, stderr: string) => void
type ExecFileLike = (cmd: string, args: readonly string[], opts: { timeout?: number }, cb: ExecFileCallback) => ChildProcess

const execFileMock = vi.mocked(execFile as unknown as ExecFileLike)

/** Makes the next osascript call complete with the given result. */
function osascriptReturns(err: ExecFileException | null, stdout = '', stderr = ''): void {
  execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    cb(err, stdout, stderr)
    return {} as ChildProcess
  })
}

function execError(code: number | string, message = 'osascript failed'): ExecFileException {
  return Object.assign(new Error(message), { code, cmd: 'osascript' })
}

const post = () => app.request('/api/pick-folder', { method: 'POST' })

const realPlatform = process.platform
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('POST /api/pick-folder', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    setPlatform('darwin')
  })
  afterEach(() => setPlatform(realPlatform))

  it('returns the chosen path without the trailing slash / newline', async () => {
    osascriptReturns(null, '/Users/yasin/notes/\n')
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()) as PickFolderResponse).toEqual({ path: '/Users/yasin/notes' })
    const [cmd, args, opts] = execFileMock.mock.calls[0]
    expect(cmd).toBe('osascript')
    expect(args).toEqual([
      '-e',
      'tell application "System Events" to activate',
      '-e',
      'POSIX path of (choose folder with prompt "Open folder")',
    ])
    expect(opts.timeout).toBe(5 * 60 * 1000)
  })

  it('keeps the filesystem root as "/"', async () => {
    osascriptReturns(null, '/\n')
    expect((await (await post()).json()) as PickFolderResponse).toEqual({ path: '/' })
  })

  it('maps a dismissed dialog to { cancelled: true }', async () => {
    osascriptReturns(execError(1), '', 'execution error: User canceled. (-128)\n')
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()) as PickFolderResponse).toEqual({ cancelled: true })
  })

  it('500 PICKER_FAILED on any other osascript failure', async () => {
    osascriptReturns(execError('ENOENT', 'spawn osascript ENOENT'))
    const res = await post()
    expect(res.status).toBe(500)
    const body = (await res.json()) as ApiError
    expect(body.error.code).toBe('PICKER_FAILED')
    expect(body.error.message).toContain('spawn osascript ENOENT')
  })

  it('500 PICKER_FAILED when osascript exits 1 for a reason other than cancel', async () => {
    osascriptReturns(execError(1), '', 'execution error: System Events got an error (-1743)\n')
    const res = await post()
    expect(res.status).toBe(500)
    expect(((await res.json()) as ApiError).error.code).toBe('PICKER_FAILED')
  })

  it('501 NOT_SUPPORTED off macOS and never spawns osascript', async () => {
    setPlatform('linux')
    const res = await post()
    expect(res.status).toBe(501)
    expect(((await res.json()) as ApiError).error.code).toBe('NOT_SUPPORTED')
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
