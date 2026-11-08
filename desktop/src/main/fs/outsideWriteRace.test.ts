import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { link, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile as fsWriteFile } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeFile } from './file'
import { _quickDevices } from './fsUtils'
import { saveDrawing } from './drawing'
import { saveDiagram } from './diagram'
import { writeAsset } from './assets'
import { setBoardReadOnly } from './boardReadOnly'
import { renameBoardFolders } from './boardFolderRename'
import { shrinkVault } from './shrink'
import { serializeBoard, withPicturesOut } from '@shared/drawingAssets'
import { failure } from './testFixture'

// Pass-through spies: each test makes another program write the target at one step of a save (YAZ-4576).
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, open: vi.fn(m.open), rename: vi.fn(m.rename), stat: vi.fn(m.stat), link: vi.fn(m.link) }
})
vi.mock('node:fs', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs')>()
  return { ...m, renameSync: vi.fn(m.renameSync) }
})

const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const realSync = await vi.importActual<typeof import('node:fs')>('node:fs')
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yaz-4576-'))
  // Each test starts on a drive with no time yet: the async rename, which the step spies see.
  _quickDevices.clear()
})
afterEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(real.open)
  vi.mocked(rename).mockReset().mockImplementation(real.rename)
  vi.mocked(renameSync).mockReset().mockImplementation(realSync.renameSync)
  vi.mocked(link).mockReset().mockImplementation(real.link)
  vi.mocked(stat).mockReset().mockImplementation(real.stat)
  await rm(root, { recursive: true, force: true })
})

type Step = 'tmp open' | 'tmp fsync' | 'tmp close' | 'after rename'
type Writer = 'in place' | 'atomic'

/** Another program, as `fs.writeFileSync` (same inode) or as an editor that renames its own tmp file in. */
const outside = (file: string, body: string, how: Writer) =>
  how === 'in place' ? real.writeFile(file, body) : real.writeFile(`${file}.other`, body).then(() => real.rename(`${file}.other`, file))

/** The outside write runs once, at `step` of the save's tmp-file sequence for `file`. */
function landAt(step: Step, file: string, body: string, how: Writer): void {
  let done = false
  const once = async () => {
    if (!done) await outside(file, body, how)
    done = true
  }
  const isTmp = (p: unknown) => String(p).startsWith(`${file}.tmp-`)
  vi.mocked(open).mockImplementation(async (...args) => {
    if (step === 'tmp open' && isTmp(args[0])) await once()
    const fh = await real.open(...args)
    if (!isTmp(args[0])) return fh
    const sync = fh.sync.bind(fh)
    const close = fh.close.bind(fh)
    fh.sync = async () => (step === 'tmp fsync' && (await once()), sync())
    fh.close = async () => (step === 'tmp close' && (await once()), close())
    return fh
  })
  vi.mocked(rename).mockImplementation(async (from, to) => {
    await real.rename(from, to)
    if (step === 'after rename' && isTmp(from)) await once()
  })
}

const tmpsLeft = async () => (await readdir(root)).filter((n) => n.includes('.tmp-'))

describe('an outside write during a guarded save is never lost (YAZ-4576)', () => {
  const cases = (['tmp open', 'tmp fsync', 'tmp close'] as const).flatMap((step) => (['in place', 'atomic'] as const).map((how) => [step, how] as const))

  it.each(cases)('writeFile: an outside write (%s, %s) before the rename is CONFLICT, and its bytes stay', async (step, how) => {
    const file = path.join(root, 'Typing.md')
    await fsWriteFile(file, 'Typed base\n\nOther paragraph\n')
    const { mtimeMs } = await stat(file)
    landAt(step, file, 'Typed base\n\nAgent paragraph\n', how)
    const err = await failure(writeFile({ path: file, content: 'Human base\n\nOther paragraph\n', expectedMtime: mtimeMs }))
    expect(err).toMatchObject({ code: 'CONFLICT', path: file, mtime: (await stat(file)).mtimeMs })
    expect(await readFile(file, 'utf8')).toBe('Typed base\n\nAgent paragraph\n')
    expect(await tmpsLeft()).toEqual([])
  })

  it.each(['in place', 'atomic'] as const)('writeFile: an outside write (%s) after the rename lands last', async (how) => {
    const file = path.join(root, 'Typing.md')
    await fsWriteFile(file, 'Typed base\n')
    landAt('after rename', file, 'Agent base\n', how)
    await writeFile({ path: file, content: 'Human base\n', expectedMtime: (await stat(file)).mtimeMs })
    expect(await readFile(file, 'utf8')).toBe('Agent base\n')
  })

  it('writeFile with a CLI revision: an outside write during the fsync is CONFLICT', async () => {
    const file = path.join(root, 'Cli.md')
    await fsWriteFile(file, 'one\n')
    const { revisionOf } = await import('./revision')
    const { mtimeMs } = await stat(file)
    landAt('tmp fsync', file, 'agent\n', 'in place')
    const err = await failure(writeFile({ path: file, content: 'two\n', expectedRevision: revisionOf('one\n', mtimeMs) }))
    expect(err.code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe('agent\n')
  })

  it('a file deleted during the save is no conflict: the save puts it back', async () => {
    const file = path.join(root, 'Gone.md')
    await fsWriteFile(file, 'old\n')
    const { mtimeMs } = await stat(file)
    vi.mocked(open).mockImplementation(async (...args) => {
      if (String(args[0]).startsWith(`${file}.tmp-`)) await real.unlink(file).catch(() => undefined)
      return real.open(...args)
    })
    await writeFile({ path: file, content: 'mine\n', expectedMtime: mtimeMs })
    expect(await readFile(file, 'utf8')).toBe('mine\n')
  })

  it('a save with no outside write costs one more stat of the target, and still writes', async () => {
    const file = path.join(root, 'Calm.md')
    await fsWriteFile(file, 'a\n')
    const { mtimeMs } = await stat(file)
    const stats = () => vi.mocked(stat).mock.calls.filter(([p]) => p === file).length
    vi.mocked(stat).mockClear()
    await writeFile({ path: file, content: 'b\n' })
    expect(stats()).toBe(2) // the conflict check and the mtime after the rename, as before
    const before = (await stat(file)).mtimeMs
    vi.mocked(stat).mockClear()
    const res = await writeFile({ path: file, content: 'c\n', expectedMtime: before })
    expect(stats()).toBe(3) // + the check right before the rename
    expect(mtimeMs).not.toBe(res.mtime)
    expect(res.mtime).toBe((await stat(file)).mtimeMs)
    expect(await readFile(file, 'utf8')).toBe('c\n')
  })

  const scene = (id: string) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id, type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: false }], appState: {}, files: {} })
  const diagram = (id: string) => `<mxfile><diagram id="${id}" name="Page-1"><mxGraphModel><root><mxCell id="0" /></root></mxGraphModel></diagram></mxfile>\n`
  const boards: [string, string, string, (mtime: number) => Promise<unknown>][] = [
    ['saveDrawing', 'Board.excalidraw', scene('a'), (mtime) => saveDrawing({ root, path: 'Board.excalidraw', json: scene('b'), expectedMtime: mtime, newFiles: [] })],
    ['saveDiagram', 'Flow.drawio', diagram('a'), (mtime) => saveDiagram({ root, path: 'Flow.drawio', xml: diagram('b'), expectedMtime: mtime })],
    ['writeAsset', 'Embed.excalidraw', scene('a'), (mtime) => writeAsset({ root, path: 'Embed.excalidraw', content: scene('b'), expectedMtime: mtime })],
    ['setBoardReadOnly', 'Locked.excalidraw', scene('a'), (mtime) => setBoardReadOnly({ root, path: 'Locked.excalidraw', on: true, expectedMtime: mtime })],
  ]
  it.each(boards)('%s: an outside write during the fsync is CONFLICT, and its bytes stay', async (_name, rel, body, save) => {
    const file = path.join(root, rel)
    await fsWriteFile(file, body)
    const { mtimeMs } = await stat(file)
    landAt('tmp fsync', file, `${body} `, 'in place')
    expect(await failure(save(mtimeMs))).toMatchObject({ code: 'CONFLICT', mtime: (await stat(file)).mtimeMs })
    expect(await readFile(file, 'utf8')).toBe(`${body} `)
    expect(await tmpsLeft()).toEqual([])
  })

  // Two more writers that checked the mtime but did not pass it on (YAZ-4602): an outside write skips the board.
  it('shrinkVault: an outside write during the fsync skips the board, and its bytes stay', async () => {
    const file = path.join(root, 'Big.excalidraw')
    const body = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'e', type: 'image', fileId: 'aaa', isDeleted: false }], appState: {}, files: { aaa: { mimeType: 'image/png', id: 'aaa', dataURL: 'data:image/png;base64,QQ==' } } })
    await fsWriteFile(file, body)
    landAt('tmp fsync', file, `${body} `, 'in place')
    expect(await shrinkVault(root)).toMatchObject({ shrunk: 0, skipped: 1 })
    expect(await readFile(file, 'utf8')).toBe(`${body} `)
  })

  // The gap that stays (YAZ-4576 residual): main can run other work between the last check and an async rename.
  it('a quick drive: other work on main between the last check and the rename cannot slip in a program that renames its file in', async () => {
    const file = path.join(root, 'Typing.md')
    await fsWriteFile(file, 'Typed base\n')
    const { mtimeMs, dev } = await stat(file)
    _quickDevices.add(dev)
    let done = false
    const once = () => void (!done && ((done = true), writeFileSync(`${file}.other`, 'Agent base\n'), realSync.renameSync(`${file}.other`, file)))
    // The last await before the rename arms the other program for main's next turn; an async rename gives it that turn.
    vi.mocked(link).mockImplementation(async (from, to) => (await real.link(from, to), void setImmediate(once)))
    vi.mocked(rename).mockImplementation(async (from, to) => (once(), real.rename(from, to)))
    const res = await writeFile({ path: file, content: 'Human base\n', expectedMtime: mtimeMs })
    await new Promise(setImmediate)
    expect(done).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('Agent base\n') // it landed after the rename
    expect(res.mtime).not.toBe((await real.stat(file)).mtimeMs) // and the save's mtime is its own: the watcher sees theirs as a change
  })

  // The hard link (YAZ-4576 residual): a write in place right up to the rename is caught, on either path.
  it.each([['a quick drive', true], ['a drive with no time yet', false]] as const)('%s: a write in place between the last check and the rename is CONFLICT, and its bytes go back', async (_name, quick) => {
    const file = path.join(root, 'Typing.md')
    await fsWriteFile(file, 'Typed base\n\nOther paragraph\n')
    const { mtimeMs, dev } = await stat(file)
    if (quick) _quickDevices.add(dev)
    const inPlace = (from: unknown) => String(from).startsWith(`${file}.tmp-`) && !done && ((done = true), writeFileSync(file, 'Typed base\n\nAgent paragraph\n'))
    let done = false
    vi.mocked(renameSync).mockImplementation((from, to) => (inPlace(from), realSync.renameSync(from, to)))
    vi.mocked(rename).mockImplementation(async (from, to) => (inPlace(from), real.rename(from, to)))
    const err = await failure(writeFile({ path: file, content: 'Human base\n\nOther paragraph\n', expectedMtime: mtimeMs }))
    expect(done).toBe(true)
    expect(err).toMatchObject({ code: 'CONFLICT', mtime: (await real.stat(file)).mtimeMs })
    expect(await readFile(file, 'utf8')).toBe('Typed base\n\nAgent paragraph\n')
    expect(await tmpsLeft()).toEqual([])
  })

  it('a drive with no hard links (exFAT, FAT) still saves, with the check alone', async () => {
    const file = path.join(root, 'Stick.md')
    await fsWriteFile(file, 'a\n')
    vi.mocked(link).mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    const res = await writeFile({ path: file, content: 'b\n', expectedMtime: (await stat(file)).mtimeMs })
    expect(await readFile(file, 'utf8')).toBe('b\n')
    expect(res.mtime).toBe((await real.stat(file)).mtimeMs)
    expect(await tmpsLeft()).toEqual([])
  })

  it('a drive gets the blocking pair after a rename under 1 ms, and loses it after one of 1 ms or more', async () => {
    const file = path.join(root, 'Drive.md')
    await fsWriteFile(file, '0\n')
    const { dev } = await stat(file)
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const asyncRenames = () => vi.mocked(rename).mock.calls.filter(([, to]) => to === file).length
    vi.mocked(rename).mockImplementation(async (from, to) => (await real.rename(from, to), void clock.mockReturnValue(0.5)))
    vi.mocked(renameSync).mockImplementation((from, to) => (realSync.renameSync(from, to), void clock.mockReturnValue(5)))
    const save = async (content: string) => (clock.mockReturnValue(0), writeFile({ path: file, content, expectedMtime: (await real.stat(file)).mtimeMs }))
    await save('1\n')
    expect([asyncRenames(), _quickDevices.has(dev)]).toEqual([1, true])
    await save('2\n')
    expect([asyncRenames(), vi.mocked(renameSync).mock.calls.length, _quickDevices.has(dev)]).toEqual([1, 1, false])
    await save('3\n')
    expect(asyncRenames()).toBe(2)
    expect(await readFile(file, 'utf8')).toBe('3\n')
    clock.mockRestore()
  })

  it('a folder rename: an outside write during the fsync leaves the board unwritten, and its bytes stay', async () => {
    const file = path.join(root, 'Out.excalidraw')
    const body = serializeBoard(withPicturesOut(JSON.parse(scene('a')) as Record<string, unknown>, true, 1, 1, 'Pics'))
    await fsWriteFile(file, body)
    landAt('tmp fsync', file, `${body} `, 'in place')
    expect(await renameBoardFolders(root, path.join(root, 'Pics'), path.join(root, 'Photos'))).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(`${body} `)
  })
})
