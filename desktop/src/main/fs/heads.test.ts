import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HEAD_CHARS, HEAD_READ_BYTES } from '@shared/types'
import { readHeads } from './heads'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

describe('readHeads (YAZ-2648 D6)', () => {
  it('answers in the order asked with the top of each note, the frontmatter off; a path that fails, a folder and a file that is no note are null and fail nothing', async () => {
    const note = path.join(root, 'head.md')
    await writeFile(note, '---\ntitle: Head\n---\nFirst line\n\n- a bullet\n')
    await mkdir(path.join(root, 'Folder.md'))
    const heads = await readHeads([path.join(root, 'A.md'), path.join(root, 'gone.md'), note, path.join(root, 'notes.txt'), path.join(root, 'Folder.md'), 'relative.md'])
    expect(heads.map((head) => head?.text ?? null)).toEqual(['# A\n', null, 'First line\n\n- a bullet\n', null, null, null])
    expect(heads[2]).toMatchObject({ path: note })
    expect(heads[2]?.mtime).toBeGreaterThan(0)
    expect((await failure(readHeads('not a list'))).code).toBe('BAD_REQUEST')

    // S55: an empty note, and a note of a properties block alone, have a head with no text: the page shows its title.
    const empty = path.join(root, 'empty.md')
    const onlyBlock = path.join(root, 'only-block.md')
    await writeFile(empty, '')
    await writeFile(onlyBlock, '---\ntitle: Only\n---\n')
    expect((await readHeads([empty, onlyBlock])).map((head) => head?.text ?? null)).toEqual(['', ''])
  })

  it('reads only the head of a big note: the text is cut at HEAD_CHARS, never inside a character, and a frontmatter block still open where the read stops gives no text', async () => {
    // The surrogate pair straddles the character limit of the answer.
    const big = path.join(root, 'big.md')
    await writeFile(big, `${'a'.repeat(HEAD_CHARS - 1)}😀${'€'.repeat(HEAD_READ_BYTES)}`)
    const openBlock = path.join(root, 'open-block.md')
    await writeFile(openBlock, `---\nkey: ${'v'.repeat(HEAD_READ_BYTES)}\n---\nbody\n`)
    const [head, none] = await readHeads([big, openBlock])
    expect(head?.text).toBe('a'.repeat(HEAD_CHARS - 1))
    expect(none?.text).toBe('')

    // The read stops one byte into the eleventh `€` (3 bytes each): ten whole ones, and no replacement mark.
    const block = `---\nk: ${'v'.repeat(HEAD_READ_BYTES - 31 - 12)}\n---\n`
    const cut = path.join(root, 'cut.md')
    await writeFile(cut, `${block}${'€'.repeat(100)}`)
    expect((await readHeads([cut]))[0]?.text).toBe('€'.repeat(10))
  })
})
