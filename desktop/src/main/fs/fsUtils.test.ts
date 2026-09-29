import { afterEach, describe, expect, it, vi } from 'vitest'
import { link, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isAtomicTmp } from '@shared/fileKind'
import { atomicWrite, createDurable } from './fsUtils'

// Pass-through spies: the durability tests watch each handle's `sync` and the rename/link that names the bytes.
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, open: vi.fn(m.open), rename: vi.fn(m.rename), link: vi.fn(m.link) }
})

afterEach(() => {
  vi.mocked(open).mockReset()
  vi.mocked(rename).mockReset()
  vi.mocked(link).mockReset()
})

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fsutils-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Records, in order, every fsync of a handle `open` hands out and every rename / link, by basename (tmp suffix collapsed). */
async function traceDurability(): Promise<string[]> {
  const log: string[] = []
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const name = (p: unknown) => path.basename(String(p)).replace(/\.tmp-.*/, '.tmp')
  vi.mocked(open).mockImplementation(async (...args) => {
    const fh = await real.open(...args)
    const sync = fh.sync.bind(fh)
    fh.sync = async () => {
      log.push(`sync ${name(args[0])}`)
      return sync()
    }
    return fh
  })
  vi.mocked(rename).mockImplementation(async (from, to) => {
    log.push(`rename ${name(from)} → ${name(to)}`)
    return real.rename(from, to)
  })
  vi.mocked(link).mockImplementation(async (from, to) => {
    log.push(`link ${name(from)} → ${name(to)}`)
    return real.link(from, to)
  })
  return log
}

const ENOTSUP = () => Object.assign(new Error('ENOTSUP: operation not supported, link'), { code: 'ENOTSUP' })

describe('atomicWrite (YAZ-2177)', () => {
  it('fsyncs the tmp file before renaming it over the target', () =>
    withDir(async (dir) => {
      const log = await traceDurability()
      const file = path.join(dir, 'a.md')
      await writeFile(file, 'old')
      const res = await atomicWrite(file, 'new ✓')
      expect(log).toEqual(['sync a.md.tmp', 'rename a.md.tmp → a.md'])
      expect(await readFile(file, 'utf8')).toBe('new ✓')
      expect(res.size).toBe(Buffer.byteLength('new ✓'))
      expect(await readdir(dir)).toEqual(['a.md'])
    }))

  it('a write that fails mid-way closes its handle and leaves neither a tmp file nor a touched target', () =>
    withDir(async (dir) => {
      const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      let closed = false
      vi.mocked(open).mockImplementationOnce(async (...args) => {
        const fh = await real.open(...args)
        const close = fh.close.bind(fh)
        fh.writeFile = () => Promise.reject(new Error('ENOSPC'))
        fh.close = () => ((closed = true), close())
        return fh
      })
      const file = path.join(dir, 'a.md')
      await writeFile(file, 'old')
      await expect(atomicWrite(file, 'new')).rejects.toThrow('ENOSPC')
      expect(closed).toBe(true)
      expect(await readdir(dir)).toEqual(['a.md'])
      expect(await readFile(file, 'utf8')).toBe('old')
    }))
})

describe('createDurable (YAZ-2177)', () => {
  it('fsyncs a tmp sibling, links it to the name, then drops the tmp', () =>
    withDir(async (dir) => {
      const log = await traceDurability()
      const file = path.join(dir, 'new.png')
      await createDurable(file, new Uint8Array([0, 255, 7]))
      expect(log).toEqual(['sync new.png.tmp', 'link new.png.tmp → new.png'])
      expect([...(await readFile(file))]).toEqual([0, 255, 7])
      expect(await readdir(dir)).toEqual(['new.png'])
    }))

  it('refuses an existing name with EEXIST, the code `wx` gave, and leaves its bytes and no tmp', () =>
    withDir(async (dir) => {
      const file = path.join(dir, 'a.md')
      await writeFile(file, 'mine')
      await expect(createDurable(file, 'clobber')).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(file, 'utf8')).toBe('mine')
      expect(await readdir(dir)).toEqual(['a.md'])
    }))

  it('a volume without hard links (exFAT/FAT: ENOTSUP) writes the name itself, fsynced, never by rename', () =>
    withDir(async (dir) => {
      const log = await traceDurability()
      vi.mocked(link).mockRejectedValueOnce(ENOTSUP())
      const file = path.join(dir, 'a.md')
      await createDurable(file, 'body')
      expect(log).toEqual(['sync a.md.tmp', 'sync a.md'])
      expect(await readFile(file, 'utf8')).toBe('body')
      expect(await readdir(dir)).toEqual(['a.md'])
    }))

  it('the no-hard-link fallback still never overwrites: EEXIST, bytes stand, no tmp', () =>
    withDir(async (dir) => {
      vi.mocked(link).mockRejectedValueOnce(ENOTSUP())
      const file = path.join(dir, 'a.md')
      await writeFile(file, 'mine')
      await expect(createDurable(file, 'clobber')).rejects.toMatchObject({ code: 'EEXIST' })
      expect(vi.mocked(rename)).not.toHaveBeenCalled()
      expect(await readFile(file, 'utf8')).toBe('mine')
      expect(await readdir(dir)).toEqual(['a.md'])
    }))

  it('a write that fails mid-way leaves nothing under the name and no tmp', () =>
    withDir(async (dir) => {
      const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      vi.mocked(open).mockImplementationOnce(async (...args) => {
        const fh = await real.open(...args)
        fh.writeFile = () => Promise.reject(new Error('ENOSPC'))
        return fh
      })
      await expect(createDurable(path.join(dir, 'a.png'), new Uint8Array([1]))).rejects.toThrow('ENOSPC')
      expect(await readdir(dir)).toEqual([])
    }))
})

it('every tmp name a write lands in is one `isAtomicTmp` hides, beside its target (YAZ-2179)', () =>
  withDir(async (dir) => {
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const tmps: string[] = []
    vi.mocked(open).mockImplementation((file, ...rest) => (tmps.push(String(file)), real.open(file, ...rest)))
    await atomicWrite(path.join(dir, 'a.md'), 'x')
    await createDurable(path.join(dir, 'p.png'), new Uint8Array([1]))
    expect(tmps.map((t) => path.dirname(t))).toEqual([dir, dir])
    expect(tmps.map((t) => path.basename(t)).every(isAtomicTmp)).toBe(true)
  }))
