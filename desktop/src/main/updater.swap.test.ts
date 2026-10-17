/**
 * The REAL swap script (YAZ-2976 S21–S24) through `/bin/sh` on temp folders: the same `SWAP_SCRIPT`
 * text `installOnExit` starts. `reopen` is always 0 here, so nothing opens on the screen.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SWAP_SCRIPT } from './updater'

let dir: string
let app: string
let marker: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yd-swap-'))
  app = join(dir, 'X.app')
  marker = join(dir, 'updated-to')
  await mkdir(join(app, 'Contents'), { recursive: true })
  await writeFile(join(app, 'Contents', 'which'), 'old')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

/** A process that has already ended: its PID is free, so the wait loop ends at once. */
const endedPid = (): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn('/usr/bin/true')
    child.on('exit', () => resolve(child.pid!))
  })

const swap = (pid: number): Promise<void> =>
  new Promise((resolve, reject) => execFile('/bin/sh', ['-c', SWAP_SCRIPT, 'sh', String(pid), app, marker, '1.0.13', '0'], { cwd: dir }, (err) => (err === null ? resolve() : reject(err))))

const staged = async (): Promise<void> => {
  await mkdir(join(`${app}.update`, 'Contents'), { recursive: true })
  await writeFile(join(`${app}.update`, 'Contents', 'which'), 'new')
}

describe.skipIf(process.platform !== 'darwin')('the swap script (real /bin/sh)', () => {
  it('S21, S22, S24: puts the new app in place, deletes the old one, and writes the marker', async () => {
    await staged()
    await swap(await endedPid())
    expect(await readFile(join(app, 'Contents', 'which'), 'utf8')).toBe('new')
    expect(await readdir(dir)).toEqual(['X.app', 'updated-to'])
    expect(await readFile(marker, 'utf8')).toBe('1.0.13')
  })

  it('S23: the second rename fails (no staged app) → the old app goes back, and no marker', async () => {
    await swap(await endedPid())
    expect(await readFile(join(app, 'Contents', 'which'), 'utf8')).toBe('old')
    expect(await readdir(dir)).toEqual(['X.app'])
  })

  it('waits for the app process to end before it touches the bundle', async () => {
    await staged()
    const running = spawn('/bin/sleep', ['1'])
    const done = swap(running.pid!)
    await new Promise((r) => setTimeout(r, 400))
    expect(await readFile(join(app, 'Contents', 'which'), 'utf8')).toBe('old')
    expect(existsSync(`${app}.update`)).toBe(true)
    await done
    expect(await readFile(join(app, 'Contents', 'which'), 'utf8')).toBe('new')
    expect(await readFile(marker, 'utf8')).toBe('1.0.13')
  })

  it('a path with spaces and shell characters is data, never code', async () => {
    app = join(dir, 'Yaseen Docs $(touch pwned) `x`.app')
    await mkdir(join(app, 'Contents'), { recursive: true })
    await staged()
    await swap(await endedPid())
    expect(await readFile(join(app, 'Contents', 'which'), 'utf8')).toBe('new')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })
})
