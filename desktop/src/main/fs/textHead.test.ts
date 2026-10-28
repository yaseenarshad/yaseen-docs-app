/**
 * A code file's head for its hover card (YAZ-3508): at most `TEXT_HEAD_READ_BYTES` off disk, cut to
 * `TEXT_HEAD_LINES` lines, and refused as `readFile` refuses a file the code tab cannot open.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, TEXT_HEAD_LINES, TEXT_HEAD_READ_BYTES } from '@shared/types'
import { cutCharBytes, readTextHead } from './textHead'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-texthead-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const put = async (name: string, content: string | Uint8Array): Promise<string> => {
  const p = path.join(dir, name)
  await writeFile(p, content)
  return p
}
const code = (n: number) => Array.from({ length: n }, (_, i) => `const line${i} = ${i}`).join('\n')

describe('readTextHead', () => {
  it('a small file: all of it, each break as \\n, no BOM; not cut', async () => {
    const p = await put('a.ts', '﻿const a = 1\r\nconst b = 2\rconst c = 3\n')
    expect(await readTextHead(p)).toMatchObject({ path: p, text: 'const a = 1\nconst b = 2\nconst c = 3\n', cut: false })
  })

  it(`the first ${TEXT_HEAD_LINES} lines of a longer file, and it says the file goes on`, async () => {
    const head = await readTextHead(await put('long.ts', code(200)))
    expect(head.text.split('\n')).toHaveLength(TEXT_HEAD_LINES)
    expect(head.text.split('\n')[59]).toBe('const line59 = 59')
    expect(head.cut).toBe(true)
  })

  it(`a 5 MB file: only ${TEXT_HEAD_READ_BYTES} bytes are read, so a line cut by the read is left out`, async () => {
    const long = `${'x'.repeat(TEXT_HEAD_READ_BYTES + 10)}\nnext\n`
    const head = await readTextHead(await put('one-long-line.json', long))
    // One line longer than the read: it ends at the read, and nothing else is answered.
    expect(head.text.length).toBe(TEXT_HEAD_READ_BYTES)
    expect(head.cut).toBe(true)
    const big = await readTextHead(await put('big.ts', code(300_000)))
    expect(big.size).toBeGreaterThan(5_000_000)
    expect(big.text.split('\n')).toHaveLength(TEXT_HEAD_LINES)
  })

  it('a read that stops inside a character drops its first bytes; the rest decodes', async () => {
    const lines = Array.from({ length: 20 }, () => 'é'.repeat(500)).join('\n')
    const head = await readTextHead(await put('accents.txt', lines))
    expect(head.text).not.toContain('�')
    expect(head.cut).toBe(true)
    expect(cutCharBytes(new Uint8Array([0x61, 0xc3]))).toBe(1)
    expect(cutCharBytes(new Uint8Array([0x61, 0xe2, 0x82]))).toBe(2)
    expect(cutCharBytes(new Uint8Array([0x61, 0xc3, 0xa9]))).toBe(0)
    expect(cutCharBytes(new Uint8Array([0xf0, 0x9f, 0x8e, 0x89]))).toBe(0)
  })

  it('a file the code tab cannot open is refused the same way: too big, not UTF-8, a NUL', async () => {
    const tooBig = await put('too-big.log', new Uint8Array(MAX_FILE_BYTES + 1))
    await expect(readTextHead(tooBig)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    await expect(readTextHead(await put('latin1.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a])))).rejects.toMatchObject({ code: 'IO_ERROR' })
    await expect(readTextHead(await put('nul.txt', 'a\u0000b'))).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('only a text kind file; a missing one is NOT_FOUND', async () => {
    await expect(readTextHead(await put('note.md', '# hi'))).rejects.toMatchObject({ code: 'UNSUPPORTED_EXTENSION' })
    await expect(readTextHead(path.join(dir, 'gone.ts'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await readTextHead(await put('Dockerfile', 'FROM node:22\n'))).text).toBe('FROM node:22\n')
  })
})
