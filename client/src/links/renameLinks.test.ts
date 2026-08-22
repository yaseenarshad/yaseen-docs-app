import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import {
  maskCode,
  renamedTarget,
  renameNotice,
  rewriteBodyLinks,
  rewriteInner,
  rewriteNoteLinks,
  updateLinksAfterRename,
} from './renameLinks'

const resolvesB = (t: string) => t.replace(/\.(md|markdown)$/i, '').replace(/^.*\//, '').toLowerCase() === 'b'
const toC = (t: string) => renamedTarget(t, { newName: 'C.md', newRel: 'Sub/C.md' })

describe('maskCode (the index stripCode discipline, length-preserving)', () => {
  it('blanks fenced blocks (fence lines included) and inline code spans, keeping every offset', () => {
    const body = 'a [[B]]\n```\n[[B]] in code\n```\nand `[[B]]` span\n'
    const masked = maskCode(body)
    expect(masked.length).toBe(body.length)
    expect(masked.indexOf('[[B]]')).toBe(body.indexOf('[[B]]')) // the real link survives at its offset
    expect(masked.match(/\[\[B\]\]/g)).toHaveLength(1) // the fenced and span copies are blanked
  })
})

describe('rewriteInner / renamedTarget (form + suffix + alias preservation)', () => {
  it('preserves |alias and #suffix and drops padding inside the target', () => {
    expect(rewriteInner('B', resolvesB, toC)).toBe('C')
    expect(rewriteInner('B|Bee', resolvesB, toC)).toBe('C|Bee')
    expect(rewriteInner('B#Heading', resolvesB, toC)).toBe('C#Heading')
    expect(rewriteInner('B#^block|Bee', resolvesB, toC)).toBe('C#^block|Bee')
    expect(rewriteInner(' B ', resolvesB, toC)).toBe('C')
    expect(rewriteInner('Other', resolvesB, toC)).toBeNull()
    expect(rewriteInner('#same-file', resolvesB, toC)).toBeNull()
  })

  it('bare stays bare, pathed stays root-relative, an explicit extension stays explicit', () => {
    expect(toC('B')).toBe('C')
    expect(toC('B.md')).toBe('C.md')
    expect(toC('Sub/B')).toBe('Sub/C')
    expect(toC('Sub/B.md')).toBe('Sub/C.md')
    expect(toC('/Sub/B')).toBe('Sub/C')
  })
})

describe('rewriteBodyLinks', () => {
  it('rewrites bare, aliased, heading and embed forms; leaves code and other targets alone', () => {
    const body = 'See [[B]] and [[B|Bee]] and [[B#H|x]] and ![[B]] but not [[A]] nor `[[B]]`.\n```\n[[B]]\n```\n'
    expect(rewriteBodyLinks(body, resolvesB, toC)).toBe('See [[C]] and [[C|Bee]] and [[C#H|x]] and ![[C]] but not [[A]] nor `[[B]]`.\n```\n[[B]]\n```\n')
  })

  it('returns the body unchanged when nothing matches', () => {
    expect(rewriteBodyLinks('no links here', resolvesB, toC)).toBe('no links here')
  })
})

describe('rewriteNoteLinks', () => {
  it('rewrites whole-value frontmatter links (top-level and inside lists) plus the body; everything else survives', () => {
    const content = '---\npillar: "[[B]]"\nrelated:\n  - "[[B|Bee]]"\n  - "[[A]]"\nnote: see [[B]] inline\n---\n\nBody [[B]].\n'
    expect(rewriteNoteLinks(content, resolvesB, toC)).toBe(
      '---\npillar: "[[C]]"\nrelated:\n  - "[[C|Bee]]"\n  - "[[A]]"\nnote: see [[B]] inline\n---\n\nBody [[C]].\n',
    )
  })

  it('null when nothing references the renamed file (the caller never writes)', () => {
    expect(rewriteNoteLinks('---\nk: 1\n---\n\n[[A]]\n', resolvesB, toC)).toBeNull()
  })
})

describe('renameNotice', () => {
  it('one summary line, pluralised, with the skipped tail only when needed', () => {
    expect(renameNotice({ updated: 1, skipped: 0 })).toBe('Updated links in 1 note')
    expect(renameNotice({ updated: 3, skipped: 2 })).toBe('Updated links in 3 notes; 2 skipped (unsaved changes)')
  })
})

// ---------- the effectful runner over a fake bridge ----------

function rec(path: string, over: Partial<IndexRecord> = {}): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.(md|markdown)$/i, '')
  const folder = path.slice('/v/'.length, path.lastIndexOf('/')).replace(/\/$/, '')
  return { path, name, basename, folder: folder === name ? '' : folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, tags: [], links: [], embeds: [], ...over }
}

function installBridge(files: Record<string, { content: string; mtime: number }>) {
  const readFile = vi.fn(async (path: string) => {
    const f = files[path]
    if (f === undefined) return Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist', path })
    return { path, content: f.content, mtime: f.mtime, size: f.content.length }
  })
  const writeFile = vi.fn(async ({ path, content, expectedMtime }: { path: string; content: string; expectedMtime?: number }) => {
    const f = files[path]
    if (f !== undefined && expectedMtime !== undefined && f.mtime !== expectedMtime) {
      return Promise.reject({ code: 'CONFLICT', message: 'file changed on disk since last read', path, mtime: f.mtime })
    }
    files[path] = { content, mtime: (f?.mtime ?? 0) + 1 }
    return { path, mtime: files[path].mtime, size: content.length }
  })
  Object.defineProperty(window, 'yaseenDocs', { value: { readFile, writeFile }, configurable: true, writable: true })
  return { readFile, writeFile }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('updateLinksAfterRename', () => {
  const root = '/v'
  const oldPath = '/v/B.md'
  const newPath = '/v/C.md'

  it('rewrites exactly the referencing notes (links AND embeds, via the shared resolver) and counts them', async () => {
    const files = {
      '/v/A.md': { content: 'See [[B]] and [[B|Bee]].\n', mtime: 10 },
      '/v/E.md': { content: '![[B]]\n', mtime: 20 },
      '/v/N.md': { content: 'nothing\n', mtime: 30 },
    }
    const bridge = installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/B.md'),
      rec('/v/E.md', { embeds: ['B'] }),
      rec('/v/N.md'),
    ]
    const summary = await updateLinksAfterRename({ root, oldPath, newPath, records })
    expect(summary).toEqual({ updated: 2, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[C]] and [[C|Bee]].\n')
    expect(files['/v/E.md'].content).toBe('![[C]]\n')
    expect(files['/v/N.md'].content).toBe('nothing\n')
    expect(bridge.writeFile).toHaveBeenCalledTimes(2)
  })

  it('a CONFLICT re-reads once and retries; a second conflict skips the file', async () => {
    const files = { '/v/A.md': { content: '[[B]]\n', mtime: 10 } }
    const bridge = installBridge(files)
    // First write attempt conflicts (mtime moved between read and write); the retry lands.
    bridge.writeFile.mockRejectedValueOnce({ code: 'CONFLICT', message: 'file changed on disk since last read', path: '/v/A.md', mtime: 11 })
    const records = [rec('/v/A.md', { links: ['B'] }), rec('/v/B.md')]
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[C]]\n')
    // Now every write conflicts: the file is skipped, its content untouched.
    const files2 = { '/v/A.md': { content: '[[B]]\n', mtime: 10 } }
    const bridge2 = installBridge(files2)
    bridge2.writeFile.mockRejectedValue({ code: 'CONFLICT', message: 'file changed on disk since last read', path: '/v/A.md', mtime: 11 })
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 0, skipped: 1 })
    expect(files2['/v/A.md'].content).toBe('[[B]]\n')
  })

  it('a SELF-link follows the file: the renamed note is read and rewritten at its NEW path', async () => {
    const files = { '/v/C.md': { content: 'I link [[B|myself]].\n', mtime: 5 } }
    installBridge(files)
    const records = [rec('/v/B.md', { links: ['B'] })]
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/C.md'].content).toBe('I link [[C|myself]].\n')
  })

  it('a bare link whose name belongs to a DIFFERENT (shallower) file is left alone — resolution decides, not text', async () => {
    const files = { '/v/A.md': { content: '[[B]] and [[Sub/B]]\n', mtime: 1 } }
    installBridge(files)
    // Two files named B: the bare name resolves to the SHALLOWER /v/B.md; we rename the deeper one.
    const records = [
      rec('/v/A.md', { links: ['B', 'Sub/B'] }),
      rec('/v/B.md'),
      rec('/v/Sub/B.md', { folder: 'Sub' }),
    ]
    const summary = await updateLinksAfterRename({ root, oldPath: '/v/Sub/B.md', newPath: '/v/Sub/C.md', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[B]] and [[Sub/C]]\n')
  })
})
