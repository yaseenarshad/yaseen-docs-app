import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_KEY, EMPTY_SCENE, picturesFolderOf, picturesOut } from '@shared/drawingAssets'
import { findInlineDrawings } from '@shared/inlineDrawing'
import { NEW_PLACES_FILE } from '@shared/newPlaces'
import { isDiagramReadOnly, isDrawingReadOnly } from '@shared/readOnly'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { BoardUsageError, boardCommand } from './boardCommands'

/** Minimal 1x1 transparent PNG bytes & base64 data URL. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

let dir: string
let prevUserData: string | undefined

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-6157-')))
  // Isolate app state so local user settings never leak into tests.
  prevUserData = process.env.YASEEN_DOCS_USER_DATA
  process.env.YASEEN_DOCS_USER_DATA = path.join(dir, '_userdata')
})

afterEach(async () => {
  if (prevUserData === undefined) delete process.env.YASEEN_DOCS_USER_DATA
  else process.env.YASEEN_DOCS_USER_DATA = prevUserData
  await rm(dir, { recursive: true, force: true })
})

interface RunResult {
  out: string
  err: string
}

async function runBoard(args: string[], flags: Record<string, string | true> = {}): Promise<RunResult> {
  let out = ''
  let err = ''
  await boardCommand(args, new Map(Object.entries(flags)), {
    stdin: async () => '',
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
  })
  return { out, err }
}

async function makeVault(name = 'vault'): Promise<string> {
  const root = path.join(dir, name)
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  return root
}

function sceneWithImage(fileId: string, embedded = true): string {
  const scene = {
    ...EMPTY_SCENE,
    elements: [{ id: 'el-1', type: 'image', fileId, isDeleted: false, x: 0, y: 0, width: 10, height: 10 }],
    files: embedded
      ? { [fileId]: { id: fileId, mimeType: 'image/png', dataURL: PNG_DATA_URL, created: 1700000000000 } }
      : {},
  }
  return `${JSON.stringify(scene, null, 2)}\n`
}

describe('boardCommand dispatcher', () => {
  it('refuses missing or unknown subcommand with BoardUsageError', async () => {
    await expect(runBoard([])).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['bogus'])).rejects.toThrow(BoardUsageError)
  })
})

describe('board new', () => {
  it('creates an empty stamped .excalidraw drawing by default and supports --json', async () => {
    const root = await makeVault()
    const plain = await runBoard(['new', root], { '--title': 'Architecture' })
    const file = path.join(root, 'Architecture.excalidraw')
    expect(plain.out).toBe(`made ${file}\n`)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(parsed.type).toBe('excalidraw')
    expect(parsed[BOARD_META_KEY]).toMatchObject({ createdAt: expect.any(Number), updatedAt: expect.any(Number) })

    const jsonRes = await runBoard(['new', root], { '--title': 'Flow', '--json': true })
    const payload = JSON.parse(jsonRes.out) as { path: string; kind: string; mtime: number; size: number }
    expect(payload).toMatchObject({
      path: path.join(root, 'Flow.excalidraw'),
      kind: 'drawing',
      mtime: expect.any(Number),
      size: expect.any(Number),
    })
  })

  it('creates an empty stamped .drawio diagram with --kind diagram', async () => {
    const root = await makeVault()
    const res = await runBoard(['new', root], { '--title': 'System Map', '--kind': 'diagram', '--json': true })
    const payload = JSON.parse(res.out) as { path: string; kind: string; mtime: number; size: number }
    const expected = path.join(root, 'System Map.drawio')
    expect(payload.path).toBe(expected)
    expect(payload.kind).toBe('diagram')
    const xml = await readFile(expected, 'utf8')
    expect(xml).toContain('<mxfile')
    expect(xml).toContain('yaseendraw-created=')
  })

  it('respects vault new-places.json newBoardPictures setting', async () => {
    const root = await makeVault()
    await writeFile(
      path.join(root, VAULT_CONFIG_DIR, NEW_PLACES_FILE),
      JSON.stringify({ newBoard: { pictures: 'assets' } }),
      'utf8',
    )
    await runBoard(['new', root], { '--title': 'Lean' })
    const parsed = JSON.parse(await readFile(path.join(root, 'Lean.excalidraw'), 'utf8')) as Record<string, unknown>
    expect(picturesOut(parsed[BOARD_META_KEY])).toBe(true)
  })

  it('never overwrites an existing board and validates arguments', async () => {
    const root = await makeVault()
    await runBoard(['new', root], { '--title': 'Dup' })
    await expect(runBoard(['new', root], { '--title': 'Dup' })).rejects.toThrow(/already exists/)
    await expect(runBoard(['new', path.join(root, 'missing')], { '--title': 'X' })).rejects.toThrow(/no folder/)
    await expect(runBoard(['new', root], { '--title': '' })).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['new', root], { '--title': 'a/b' })).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['new', root], { '--title': 'A\nB' })).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['new', root], { '--title': 'X', '--kind': 'svg' })).rejects.toThrow(BoardUsageError)
  })
})

describe('board pictures', () => {
  it('moves embedded pictures --out to assets/, is idempotent, supports --folder, and moves --inside', async () => {
    const root = await makeVault()
    const file = path.join(root, 'PicBoard.excalidraw')
    await writeFile(file, sceneWithImage('img123', true), 'utf8')

    // Move --out to assets/
    const out1 = await runBoard(['pictures', file], { '--out': true, '--json': true })
    const p1 = JSON.parse(out1.out) as { path: string; out: boolean; moved: boolean; mtime: number }
    expect(p1).toMatchObject({ path: file, out: true, moved: true })
    const assetBytes = await readFile(path.join(root, 'assets', 'img123.png'))
    expect(assetBytes.toString('base64')).toBe(PNG_BASE64)
    const lean = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(lean.files).toEqual({})
    expect(picturesOut(lean[BOARD_META_KEY])).toBe(true)

    // Second --out is a no-op
    const out2 = await runBoard(['pictures', file], { '--out': true, '--json': true })
    expect(JSON.parse(out2.out)).toMatchObject({ path: file, out: true, moved: false })

    // Move --out --folder custom-pics
    const outFolder = await runBoard(['pictures', file], { '--out': true, '--folder': 'custom-pics', '--json': true })
    expect(JSON.parse(outFolder.out)).toMatchObject({ path: file, out: true, folder: 'custom-pics', moved: true })
    expect((await readFile(path.join(root, 'custom-pics', 'img123.png'))).toString('base64')).toBe(PNG_BASE64)
    const withFolder = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(picturesFolderOf(withFolder[BOARD_META_KEY])).toBe('custom-pics')

    // Move --inside
    const inside = await runBoard(['pictures', file], { '--inside': true, '--json': true })
    expect(JSON.parse(inside.out)).toMatchObject({ path: file, out: false, moved: true })
    const embedded = JSON.parse(await readFile(file, 'utf8')) as { files: Record<string, { dataURL: string }>; yaseendraw: unknown }
    expect(embedded.files.img123?.dataURL).toBe(PNG_DATA_URL)
    expect(picturesOut(embedded.yaseendraw)).toBe(false)
    expect(picturesFolderOf(embedded.yaseendraw)).toBeNull()
  })

  it('refuses to move when a referenced image is missing and validates flags', async () => {
    const root = await makeVault()
    const file = path.join(root, 'MissingPic.excalidraw')
    const raw = sceneWithImage('ghost99', false)
    await writeFile(file, raw, 'utf8')

    await expect(runBoard(['pictures', file], { '--out': true })).rejects.toThrow(/1 picture is missing/)
    expect(await readFile(file, 'utf8')).toBe(raw)

    await expect(runBoard(['pictures', file], {})).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['pictures', file], { '--out': true, '--inside': true })).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['pictures', file], { '--inside': true, '--folder': 'pics' })).rejects.toThrow(BoardUsageError)
  })
})

describe('board readonly', () => {
  it('toggles read-only on and --off for .excalidraw drawings', async () => {
    const root = await makeVault()
    await runBoard(['new', root], { '--title': 'Sketch' })
    const file = path.join(root, 'Sketch.excalidraw')

    const onRes = await runBoard(['readonly', file], { '--json': true })
    expect(JSON.parse(onRes.out)).toMatchObject({ path: file, readOnly: true, mtime: expect.any(Number) })
    expect(isDrawingReadOnly(JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>)).toBe(true)

    const offRes = await runBoard(['readonly', file], { '--off': true })
    expect(offRes.out).toBe(`${file} is editable\n`)
    expect(isDrawingReadOnly(JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>)).toBe(false)
  })

  it('toggles read-only on and --off for .drawio diagrams and refuses .md', async () => {
    const root = await makeVault()
    await runBoard(['new', root], { '--title': 'Net', '--kind': 'diagram' })
    const file = path.join(root, 'Net.drawio')

    const onRes = await runBoard(['readonly', file])
    expect(onRes.out).toBe(`${file} is read-only\n`)
    expect(isDiagramReadOnly(await readFile(file, 'utf8'))).toBe(true)

    const offRes = await runBoard(['readonly', file], { '--off': true, '--json': true })
    expect(JSON.parse(offRes.out)).toMatchObject({ path: file, readOnly: false })
    expect(isDiagramReadOnly(await readFile(file, 'utf8'))).toBe(false)

    const md = path.join(root, 'Note.md')
    await writeFile(md, '# Note\n', 'utf8')
    await expect(runBoard(['readonly', md])).rejects.toThrow(/only \.excalidraw and \.drawio/)
  })
})

describe('board inline', () => {
  it('creates an empty inline drawing at end or after a heading, with --title and --unlocked', async () => {
    const root = await makeVault()
    const page = path.join(root, 'Notes.md')
    await writeFile(page, '# Top\n\n## Diagrams\nIntro.\n\n## Footer\nEnd.\n', 'utf8')

    const r1 = await runBoard(['inline', page], { '--title': 'Flow', '--after': 'Diagrams', '--json': true })
    expect(JSON.parse(r1.out)).toEqual({ page, index: 0, title: 'Flow' })
    const afterFirst = await readFile(page, 'utf8')
    expect(afterFirst.indexOf('```excalidraw')).toBeGreaterThan(afterFirst.indexOf('## Diagrams'))
    expect(afterFirst.indexOf('```excalidraw')).toBeLessThan(afterFirst.indexOf('## Footer'))
    expect(afterFirst).toContain('<!-- drawing: title "Flow", locked -->')

    const r2 = await runBoard(['inline', page], { '--unlocked': true, '--json': true })
    expect(JSON.parse(r2.out)).toEqual({ page, index: 1 })
    const blocks = findInlineDrawings(await readFile(page, 'utf8'))
    expect(blocks).toHaveLength(2)
    expect(blocks[1]!.drawingLine).toBeNull()
  })

  it('pulls in --from .excalidraw, extracts embedded base64 images to assets/, replaces matching lone embed preserving indent & options, and supports --trash', async () => {
    const root = await makeVault()
    const board = path.join(root, 'Arch.excalidraw')
    await writeFile(board, sceneWithImage('pic42', true), 'utf8')

    const page = path.join(root, 'Spec.md')
    await writeFile(
      page,
      '# Spec\n\n- Overview\n  ![[Arch.excalidraw|640x360 view=10,20,0.5 locked]]\n\nDone.\n',
      'utf8',
    )

    const res = await runBoard(['inline', page], { '--from': board, '--title': 'System', '--trash': true, '--json': true })
    expect(JSON.parse(res.out)).toEqual({
      page,
      index: 0,
      from: board,
      trashed: true,
      title: 'System',
    })

    // Base64 image extracted to <root>/assets/ and never written into .md
    const md = await readFile(page, 'utf8')
    expect(md).not.toContain('data:image/png;base64')
    expect(md).not.toContain('![[Arch.excalidraw')
    expect(md).toContain('  ```excalidraw\n')
    expect(md).toContain('  <!-- drawing: title "System", 640x360 view=10,20,0.5 locked -->')
    expect((await readFile(path.join(root, 'assets', 'pic42.png'))).toString('base64')).toBe(PNG_BASE64)

    // Original board moved to <root>/.trash/ (never rm'd)
    await expect(stat(board)).rejects.toThrow()
    const trashedEntries = await readdir(path.join(root, '.trash'))
    expect(trashedEntries).toContain('Arch.excalidraw')
  })

  it('inserts --from at --after when no matching lone embed exists and refuses invalid flags', async () => {
    const root = await makeVault()
    const board = path.join(root, 'Other.excalidraw')
    await writeFile(board, `${JSON.stringify(EMPTY_SCENE)}\n`, 'utf8')
    const page = path.join(root, 'Doc.md')
    await writeFile(page, '# Doc\n\n## Canvas\nHere.\n', 'utf8')

    const res = await runBoard(['inline', page], { '--from': board, '--after': 'Canvas' })
    expect(res.out).toBe(`inlined ${board} into ${page} (#0)\n`)
    expect(findInlineDrawings(await readFile(page, 'utf8'))).toHaveLength(1)

    await expect(runBoard(['inline', page], { '--trash': true })).rejects.toThrow(BoardUsageError)
    await expect(runBoard(['inline', board])).rejects.toThrow(/only \.md\/\.markdown/)
    await expect(runBoard(['inline', page], { '--after': 'NoSuchHeading' })).rejects.toThrow(/no heading/)
  })
})

describe('board extract', () => {
  it('extracts inline drawing preserving indent and options, stamps metadata + pictures: assets when images referenced', async () => {
    const root = await makeVault()
    const page = path.join(root, 'Design.md')
    const scene = {
      ...EMPTY_SCENE,
      elements: [{ id: 'i1', type: 'image', fileId: 'img99', isDeleted: false, x: 0, y: 0, width: 10, height: 10 }],
    }
    await writeFile(
      page,
      `# Design\n\n  \`\`\`excalidraw\n  ${JSON.stringify(scene)}\n  \`\`\`\n  <!-- drawing: title "API Flow", 640x360 view=5,10,0.75 locked -->\n`,
      'utf8',
    )

    const res = await runBoard(['extract', page], { '--json': true })
    const expectedBoard = path.join(root, 'API Flow.excalidraw')
    expect(JSON.parse(res.out)).toEqual({ page, board: expectedBoard, index: 0 })

    // Page replaced with embed preserving indent & options
    const updated = await readFile(page, 'utf8')
    expect(updated).toContain('  ![[API Flow.excalidraw|640x360 view=5,10,0.75 locked]]')
    expect(findInlineDrawings(updated)).toHaveLength(0)

    // Extracted board is stamped with dates and pictures: 'assets'
    const extracted = JSON.parse(await readFile(expectedBoard, 'utf8')) as Record<string, unknown>
    expect(extracted[BOARD_META_KEY]).toMatchObject({ createdAt: expect.any(Number), updatedAt: expect.any(Number) })
    expect(picturesOut(extracted[BOARD_META_KEY])).toBe(true)
  })

  it('supports --to <dir> and --title, refuses multi-drawing without --index, and cleans up on page write failure', async () => {
    const root = await makeVault()
    const sub = path.join(root, 'diagrams')
    await mkdir(sub, { recursive: true })
    const page = path.join(root, 'Multi.md')
    const empty = JSON.stringify(EMPTY_SCENE)
    await writeFile(
      page,
      `# Multi\n\n\`\`\`excalidraw\n${empty}\n\`\`\`\n<!-- drawing: locked -->\n\n\`\`\`excalidraw\n${empty}\n\`\`\`\n<!-- drawing: locked -->\n`,
      'utf8',
    )

    // Multi-drawing without --index is refused
    await expect(runBoard(['extract', page])).rejects.toThrow(/pass --index <0\.\.1>/)

    // Extract #1 to subfolder with custom --title
    const res = await runBoard(['extract', page], { '--index': '1', '--title': 'Second', '--to': sub, '--json': true })
    const expectedBoard = path.join(sub, 'Second.excalidraw')
    expect(JSON.parse(res.out)).toEqual({ page, board: expectedBoard, index: 1 })
    const md = await readFile(page, 'utf8')
    expect(md).toContain('![[diagrams/Second.excalidraw|locked]]')
    expect(findInlineDrawings(md)).toHaveLength(1)

    // Refuses to overwrite existing file
    await expect(runBoard(['extract', page], { '--title': 'Second', '--to': sub })).rejects.toThrow(/already exists/)

    // Cleans up newly written board file if page write fails (read-only directory prevents atomicWrite tmp sibling)
    const roDir = path.join(root, 'ro-page-dir')
    await mkdir(roDir, { recursive: true })
    const roPage = path.join(roDir, 'Locked.md')
    await writeFile(roPage, `# Locked\n\n\`\`\`excalidraw\n${empty}\n\`\`\`\n`, 'utf8')
    await chmod(roDir, 0o555)
    try {
      await expect(runBoard(['extract', roPage], { '--title': 'Rollback', '--to': sub })).rejects.toThrow()
      await expect(stat(path.join(sub, 'Rollback.excalidraw'))).rejects.toThrow()
    } finally {
      await chmod(roDir, 0o755)
    }

    // 0 inline drawings refused
    const emptyPage = path.join(root, 'Empty.md')
    await writeFile(emptyPage, '# No drawings\n', 'utf8')
    await expect(runBoard(['extract', emptyPage])).rejects.toThrow(/no inline drawings/)
  })
})
