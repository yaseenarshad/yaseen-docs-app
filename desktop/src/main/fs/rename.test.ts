import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renameFile } from './rename'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('renameFile (Links E1, GRO-2194)', () => {
  it('renames a markdown file in place and returns both paths', async () => {
    const oldPath = path.join(root, 'Zeta', 'z.markdown')
    const newPath = path.join(root, 'Zeta', 'zed.markdown')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath })
    expect(await readFile(newPath, 'utf8')).toBe('z')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('renames a .base file (kind unchanged) and allows md ↔ markdown within the markdown kind', async () => {
    const oldBase = path.join(root, 'alpha', 'Topics.base')
    const newBase = path.join(root, 'alpha', 'Areas.base')
    expect(await renameFile({ oldPath: oldBase, newPath: newBase })).toEqual({ oldPath: oldBase, newPath: newBase })
    // .md → .markdown stays within the markdown kind (the kind is what is UNCHANGED).
    const oldMd = path.join(root, 'alpha', 'a.md')
    const newMd = path.join(root, 'alpha', 'ay.markdown')
    expect(await renameFile({ oldPath: oldMd, newPath: newMd })).toEqual({ oldPath: oldMd, newPath: newMd })
  })

  it('ALREADY_EXISTS when the target exists — never overwrites', async () => {
    const oldPath = path.join(root, 'b.md')
    const newPath = path.join(root, 'A.md')
    const err = await failure(renameFile({ oldPath, newPath }))
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(err.path).toBe(newPath)
    expect(await readFile(oldPath, 'utf8')).toBe('# b\n') // source untouched
    expect(await readFile(newPath, 'utf8')).toBe('# A\n') // target untouched
  })

  it('allows a case-only rename (the target stat hits the source itself on a case-insensitive fs)', async () => {
    const oldPath = path.join(root, 'CaseOnly.md')
    await writeFile(oldPath, 'case')
    const newPath = path.join(root, 'caseonly.md')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath })
    expect(await readFile(newPath, 'utf8')).toBe('case')
  })

  it('BAD_REQUEST when the parent directory differs (E1b lifts this) or the kind changes', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'Empty', 'b.md') }))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'b.base') }))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'b.md') }))).toBe('BAD_REQUEST') // same path
  })

  it('UNSUPPORTED_EXTENSION on non-vault paths, NOT_FOUND on a missing source, NOT_ABSOLUTE / BAD_REQUEST on bad input', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, 'notes.txt'), newPath: path.join(root, 'other.txt') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'b.txt') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath: path.join(root, 'missing.md'), newPath: path.join(root, 'other.md') }))).toBe('NOT_FOUND')
    expect(await code(renameFile({ oldPath: 'relative.md', newPath: path.join(root, 'other.md') }))).toBe('NOT_ABSOLUTE')
    expect(await code(renameFile(undefined))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md') }))).toBe('BAD_REQUEST')
  })
})
