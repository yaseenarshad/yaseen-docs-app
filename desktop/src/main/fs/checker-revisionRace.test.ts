import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, open, readFile, rm, stat, writeFile as fsWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { saveDrawing } from './drawing'
import { saveDiagram } from './diagram'
import { revisionOf } from './revision'
import { restoreBoardVersion } from '../git/history'
import { failure } from './testFixture'

// Checker (YAZ-4502 final round, YAZ-4576 follow-up): the CLI's `drawing save` and `diagram save` send only
// `expectedRevision` (automation/boards.ts). The mtime check right before the rename must cover them too.
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, open: vi.fn(m.open) }
})
const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
let root: string
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'checker-4576-')) })
afterEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(real.open)
  await rm(root, { recursive: true, force: true })
})

/** Another program writes `file` in place while the save fsyncs its tmp file. */
function outsideAtFsync(file: string, body: string): void {
  let done = false
  vi.mocked(open).mockImplementation(async (...args) => {
    const fh = await real.open(...args)
    if (!String(args[0]).startsWith(`${file}.tmp-`)) return fh
    const sync = fh.sync.bind(fh)
    fh.sync = async () => { if (!done) { done = true; await real.writeFile(file, body) } return sync() }
    return fh
  })
}

const scene = (id: string) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id, type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: false }], appState: {}, files: {} })
const diagram = (id: string) => `<mxfile><diagram id="${id}" name="Page-1"><mxGraphModel><root><mxCell id="0" /></root></mxGraphModel></diagram></mxfile>\n`

describe('checker: a revision-only board save keeps an outside write that lands during its fsync', () => {
  it.each([
    ['drawing save', 'Board.excalidraw', scene('a'), (rev: string) => saveDrawing({ root, path: 'Board.excalidraw', json: scene('b'), newFiles: [], expectedRevision: rev })],
    ['diagram save', 'Flow.drawio', diagram('a'), (rev: string) => saveDiagram({ root, path: 'Flow.drawio', xml: diagram('b'), expectedRevision: rev })],
  ] as const)('%s with --revision only: CONFLICT, and the outside bytes stay', async (_name, rel, body, save) => {
    const file = path.join(root, rel)
    await fsWriteFile(file, body)
    const rev = revisionOf(body, (await stat(file)).mtimeMs)
    outsideAtFsync(file, `${body} `)
    expect((await failure(save(rev))).code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(`${body} `)
  })

  // YAZ-4602: `history restore --revision` writes a drawing itself and a diagram through `saveDiagram`.
  it.each([['drawing', 'Board.excalidraw', scene], ['diagram', 'Flow.drawio', diagram]] as const)('history restore of a %s with --revision: CONFLICT, and the outside bytes stay', async (_kind, rel, body) => {
    const file = path.join(root, rel)
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' }).trim()
    await fsWriteFile(file, body('a'))
    git('init', '-q')
    git('add', rel)
    git('commit', '-qm', 'one')
    await fsWriteFile(file, body('b'))
    const rev = revisionOf(body('b'), (await stat(file)).mtimeMs)
    outsideAtFsync(file, `${body('b')} `)
    expect((await failure(restoreBoardVersion(root, rel, `${git('rev-parse', 'HEAD')}:${rel}`, rev))).code).toBe('CONFLICT')
    expect(await readFile(file, 'utf8')).toBe(`${body('b')} `)
  })
})
