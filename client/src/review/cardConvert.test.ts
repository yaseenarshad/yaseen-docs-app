/**
 * The convert actions' writes (YAZ-5037 phase 5), against an in-memory disk with the main process's compare-and-set:
 * each file is written once with the mtime it was read at (`expectedMtime: 0` creates and never overwrites), quietly
 * (the index takes it at once). The block's bytes, the ID and the reviews stay; a second write that fails leaves
 * nothing behind; a locked file and a refused write change nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cardRecords } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'

const disk = vi.hoisted(() => ({
  files: new Map<string, { content: string; mtime: number }>(),
  clock: 10,
  writes: [] as Array<{ path: string; quiet?: boolean; expectedMtime?: number }>,
  deleted: [] as string[],
  /** A path whose next write the disk refuses with this code. */
  refuse: new Map<string, string>(),
  refuseDelete: false,
}))

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  const fail = (code: string, path: string) => new real.BridgeRequestError(code as 'CONFLICT', `${code} ${path}`)
  return {
    ...real,
    api: {
      ...real.api,
      readFile: vi.fn(async (path: string) => {
        const f = disk.files.get(path)
        if (f === undefined) throw fail('NOT_FOUND', path)
        return { path, content: f.content, mtime: f.mtime, size: f.content.length }
      }),
      writeFile: vi.fn(async (req: { path: string; content: string; expectedMtime?: number; quiet?: boolean }) => {
        disk.writes.push({ path: req.path, quiet: req.quiet, expectedMtime: req.expectedMtime })
        const code = disk.refuse.get(req.path)
        if (code !== undefined) {
          disk.refuse.delete(req.path)
          throw fail(code, req.path)
        }
        const f = disk.files.get(req.path)
        if (f !== undefined && req.expectedMtime !== undefined && f.mtime !== req.expectedMtime) throw fail('CONFLICT', req.path)
        const mtime = ++disk.clock
        disk.files.set(req.path, { content: req.content, mtime })
        return { path: req.path, mtime, size: req.content.length }
      }),
      file: {
        ...real.api.file,
        delete: vi.fn(async ({ path }: { path: string }) => {
          if (disk.refuseDelete) throw fail('FORBIDDEN', path)
          disk.deleted.push(path)
          disk.files.delete(path)
          return { path, kind: 'file', trashed: null }
        }),
        rename: vi.fn(async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
          disk.files.set(newPath, disk.files.get(oldPath)!)
          disk.files.delete(oldPath)
          return { oldPath, newPath, kind: 'file' }
        }),
        retitle: vi.fn(async ({ path }: { path: string; title: string }) => ({ oldPath: path, newPath: path.replace(/[^/]+$/, 'what-is-the-capital-of-france-geo-150.md'), kind: 'file' })),
      },
    },
  }
})

import { api } from '../api'
import { ConvertStopped, convertFailure, makeCardFromText, moveCardToFile, moveIntoCard, putCardBackIntoPage, splitIntoCardFiles, turnIntoCardFile, turnIntoPage } from './cardConvert'

const LINE = '<!-- card: GEO-140, 2026-11-01T09:00Z good 12s, 2026-11-05T09:00Z again -->'
const BLOCK = ['```card', 'What is the capital of **France**?', '---', 'The capital is {{Paris}}.', '```', LINE].join('\n')
const PAGE = '/v/geo/europe-geo-1.md'
const CARD = '/v/geo/what-is-the-capital-of-france-geo-140.md'
const page = `---\nid: GEO-1\n---\n# Europe\n\n- Capitals\n  ${BLOCK.split('\n').join('\n  ')}\n\nEnd.\n`
/** The card as a card file holds it (YAZ-5044): its first line is the file's `title`; the card holds its sides only. */
const FILE_BLOCK = ['```card', '---', 'The capital is {{Paris}}.', '```', LINE].join('\n')
const TITLE = 'What is the capital of France?'

const put = (path: string, content: string) => disk.files.set(path, { content, mtime: ++disk.clock })
const text = (path: string) => disk.files.get(path)?.content
const reviews = (path: string) => cardRecords(splitFrontmatter(text(path)!).body).map((c) => [c.id, c.reviews.length])

beforeEach(() => {
  disk.files.clear()
  disk.writes.length = 0
  disk.deleted.length = 0
  disk.refuse.clear()
  disk.refuseDelete = false
  vi.mocked(api.file.retitle).mockClear()
  vi.mocked(api.file.rename).mockClear()
})

describe('Move to its own file', () => {
  it('the card file in the page\'s folder takes the card`s first line as its `title` (YAZ-5044) and the rest of the block, with its ID and history; the page holds the embed at its indent', async () => {
    put(PAGE, page)
    expect(await moveCardToFile(PAGE, 'GEO-140', 0)).toBe(CARD)
    expect(text(CARD)).toBe(`---\nkind: card\ntitle: ${TITLE}\n---\n${FILE_BLOCK}\n`)
    expect(reviews(CARD)).toEqual([['GEO-140', 2]])
    expect(text(PAGE)).toBe('---\nid: GEO-1\n---\n# Europe\n\n- Capitals\n  ![[GEO-140]]\n\nEnd.\n')
    // One compare-and-set each, both quiet (the index takes them at once): the new file at 0, the page at its read.
    expect(disk.writes).toEqual([
      { path: CARD, quiet: true, expectedMtime: 0 },
      { path: PAGE, quiet: true, expectedMtime: expect.any(Number) },
    ])
  })

  it('a name that is taken: the next free one; a file there is never overwritten', async () => {
    put(PAGE, page)
    put(CARD, 'Someone else\'s.\n')
    expect(await moveCardToFile(PAGE, 'GEO-140', 0)).toBe('/v/geo/what-is-the-capital-of-france-geo-140-2.md')
    expect(text(CARD)).toBe('Someone else\'s.\n')
  })

  it('the page changed or refused: the new file goes to the Trash and the page is as it was', async () => {
    put(PAGE, page)
    disk.refuse.set(PAGE, 'CONFLICT')
    await expect(moveCardToFile(PAGE, 'GEO-140', 0)).rejects.toThrow()
    expect(disk.deleted).toEqual([CARD])
    expect(text(PAGE)).toBe(page)
    disk.refuse.set(CARD, 'FORBIDDEN')
    const err = await moveCardToFile(PAGE, 'GEO-140', 0).catch((e: unknown) => e)
    expect(convertFailure(err)).toBe('the disk refused the change. Nothing changed.')
    expect([...disk.files.keys()]).toEqual([PAGE])
  })

  it('a page with `readonly: true` is not changed', async () => {
    put(PAGE, `---\nreadonly: true\n---\n${BLOCK}\n`)
    await expect(moveCardToFile(PAGE, 'GEO-140', 0)).rejects.toBeInstanceOf(ConvertStopped)
    expect(disk.writes).toEqual([])
  })
})

describe('Put back into this page', () => {
  it('the embed becomes the block at its indent, the `title` its first line again, and the card file goes to the Trash: Move then Put back gives the page back (its title line plain text)', async () => {
    put(PAGE, page)
    await moveCardToFile(PAGE, 'GEO-140', 0)
    await putCardBackIntoPage(PAGE, CARD, 'GEO-140', 'GEO-140', 0)
    expect(text(PAGE)).toBe(page.replace('**France**', 'France'))
    expect(disk.deleted).toEqual([CARD])
    expect(disk.files.has(CARD)).toBe(false)
  })

  it('a card file that holds more than this card is not put back (it would go to the Trash with the rest)', async () => {
    put(PAGE, 'Above.\n\n![[GEO-140]]\n')
    put(CARD, `---\nkind: card\n---\nA page.\n\n${BLOCK}\n`)
    await expect(putCardBackIntoPage(PAGE, CARD, 'GEO-140', 'GEO-140', 0)).rejects.toBeInstanceOf(ConvertStopped)
    expect(disk.writes).toEqual([])
    expect(disk.deleted).toEqual([])
  })

  it('a card file that will not go: the page gets its bytes back', async () => {
    put(PAGE, 'Above.\n\n![[GEO-140]]\n')
    put(CARD, `---\nkind: card\n---\n${BLOCK}\n`)
    disk.refuseDelete = true
    await expect(putCardBackIntoPage(PAGE, CARD, 'GEO-140', 'GEO-140', 0)).rejects.toThrow()
    expect(text(PAGE)).toBe('Above.\n\n![[GEO-140]]\n')
    expect(text(CARD)).toBe(`---\nkind: card\n---\n${BLOCK}\n`)
  })
})

describe('Turn into a page, Turn into a card file', () => {
  it('a card file: `kind: card` goes, `title:` stays and is the card`s first line again (YAZ-5044), then the page name rule (retitle)', async () => {
    put(CARD, `---\nkind: card\ntitle: ${TITLE}\n---\n${FILE_BLOCK}\n`)
    expect(await turnIntoPage(CARD)).toBe('/v/geo/what-is-the-capital-of-france-geo-150.md')
    expect(text(CARD)).toBe(`---\ntitle: ${TITLE}\n---\n${BLOCK.replace('**France**', 'France')}\n`)
    expect(api.file.retitle).toHaveBeenCalledWith({ path: CARD, title: 'What is the capital of France?' })
  })

  it('a page with one card: `kind: card`, its title in `aliases`, its `id:` kept, and the card\'s name; one with other text is refused', async () => {
    put(PAGE, `---\nid: GEO-1\ntitle: Capitals\n---\n${BLOCK}\n`)
    expect(await turnIntoCardFile(PAGE)).toBe(CARD)
    expect(text(CARD)).toBe(`---\nid: GEO-1\nkind: card\naliases:\n  - Capitals\ntitle: ${TITLE}\n---\n${FILE_BLOCK}\n`)
    expect(reviews(CARD)).toEqual([['GEO-140', 2]])
    put(PAGE, page)
    await expect(turnIntoCardFile(PAGE)).rejects.toBeInstanceOf(ConvertStopped)
    expect(text(PAGE)).toBe(page)
  })
})

describe('the notice\'s fixes', () => {
  const second = BLOCK.replace('France', 'Spain').replace('GEO-140', 'GEO-141')
  const many = `---\nkind: card\n---\n${BLOCK}\n\n${second}\n`

  it('Split: the first card stays, the other goes to its own card file with its ID and history', async () => {
    put(CARD, many)
    expect(await splitIntoCardFiles(CARD)).toEqual(['/v/geo/what-is-the-capital-of-spain-geo-141.md'])
    expect(text(CARD)).toBe(`---\nkind: card\n---\n${BLOCK}\n`)
    expect(text('/v/geo/what-is-the-capital-of-spain-geo-141.md')).toBe(`---\nkind: card\ntitle: What is the capital of Spain?\n---\n${FILE_BLOCK.replace('GEO-140', 'GEO-141')}\n`)
  })

  it('Split whose last write fails: every new file goes, the card file is as it was', async () => {
    put(CARD, many)
    disk.refuse.set(CARD, 'CONFLICT')
    await expect(splitIntoCardFiles(CARD)).rejects.toThrow()
    expect(disk.deleted).toEqual(['/v/geo/what-is-the-capital-of-spain-geo-141.md'])
    expect([...disk.files.keys()]).toEqual([CARD])
    expect(text(CARD)).toBe(many)
  })

  it('Move into the card and Make a card from the text: one write each', async () => {
    put(CARD, `---\nkind: card\n---\nAbove.\n\n${BLOCK}\n`)
    await moveIntoCard(CARD)
    expect(text(CARD)).toBe(`---\nkind: card\n---\n\`\`\`card\nAbove.\n\nWhat is the capital of **France**?\n---\nThe capital is {{Paris}}.\n\`\`\`\n${LINE}\n`)
    put(CARD, '---\nkind: card\ntitle: Capital\n---\nParis.\n')
    await makeCardFromText(CARD)
    expect(text(CARD)).toBe('---\nkind: card\ntitle: Capital\n---\n```card\nParis.\n```\n')
  })
})
