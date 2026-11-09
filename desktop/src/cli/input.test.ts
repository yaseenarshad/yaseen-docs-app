import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boundedStdin, commandInput } from './input'
import type { Io } from './cli'
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-input-')) })
afterEach(() => rm(root, { recursive: true, force: true }))
const io: Io = { stdin: async () => '', stdout: () => {}, stderr: () => {} }
describe('bounded CLI input', () => {
  it('preserves binary bytes and refuses an oversized file before reading its body', async () => {
    const path = join(root, 'input'), bytes = Buffer.from([0, 255, 128, 10])
    await writeFile(path, bytes)
    expect(await commandInput(`@${path}`, io, 4)).toEqual(bytes)
    await expect(commandInput(`@${path}`, io, 3)).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })
  it('stops consuming stdin when its bound is crossed', async () => {
    let consumed = 0
    async function* input() { for (let i = 0; i < 10; i++) { consumed++; yield Buffer.from([255, 0]) } }
    await expect(boundedStdin(input(), 4)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(consumed).toBe(3)
    expect(await boundedStdin(input(), 20)).toEqual(Buffer.from(Array.from({ length: 10 }, () => [255, 0]).flat()))
  })
  it.skipIf(process.platform === 'win32')('requires a secret file to be private to its owner', async () => {
    const path = join(root, 'secret')
    await writeFile(path, 'test-only', { mode: 0o644 })
    await expect(commandInput(`@${path}`, io, 100, true)).rejects.toMatchObject({ code: 'UNSAFE_INPUT' })
    await chmod(path, 0o600)
    expect((await commandInput(`@${path}`, io, 100, true)).toString()).toBe('test-only')
  })
})
