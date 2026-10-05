import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { TreeNode } from '@shared/types'
import { buildViewOnlyCatalog } from './viewOnlyCatalog'
import {
  countLinkReferences,
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

  it('a match whose target text would not change is left untouched — byte-identical, padding included (E1b pin)', () => {
    expect(rewriteInner('B', () => true, (t) => t)).toBeNull()
    expect(rewriteInner(' B |Bee', () => true, (t) => t)).toBeNull() // padding survives because the match is never spliced
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

describe('rewriteNoteLinks inside a folder’s values (`in`, D19)', () => {
  const NOTE = [
    '---',
    '# who this is',
    'id: n0tead000001',
    'aliases: [Noor]',
    'in:',
    '  3y7505rsr6fd:',
    '    Status: Interview',
    '    owner: "[[B]]"',
    '    team:',
    '      - "[[B|Bee]]"',
    '      - "[[Sub/B#Scope]]"',
    '      - "[[A]]"',
    '    ref: "[[k3m9x2pq7abc]]"',
    '    note: see [[B]] inline',
    '  mzf9cjhn02vm:',
    '    Status: 2-Todo',
    '    lead: "[[A]]"',
    'pillar: "[[A]]"',
    '---',
    '',
    'Body.',
    '',
  ].join('\n')

  it('renaming the target of a NAME link held in a folder’s value rewrites it there by the top-level rules; an ID link and every other byte, the other blocks included, stay', () => {
    expect(rewriteNoteLinks(NOTE, resolvesB, toC)).toBe(
      NOTE.replace('owner: "[[B]]"', 'owner: "[[C]]"').replace('"[[B|Bee]]"', '"[[C|Bee]]"').replace('"[[Sub/B#Scope]]"', '"[[Sub/C#Scope]]"'),
    )
  })

  it('only the link’s own line changes: the block’s other fields keep their quoting and layout', () => {
    const note = '---\nin:\n  3y7505rsr6fd:\n    Status: "Interview" # by Sam\n    on: \'2026-09-07\'\n    owner: "[[B]]"\n  mzf9cjhn02vm:\n    tags: [a, "b"]\n---\n'
    expect(rewriteNoteLinks(note, resolvesB, toC)).toBe(note.replace('"[[B]]"', '"[[C]]"'))
  })

  it('a non-link string in a folder’s value that merely contains `[[x]]` inside other text is not a link: nothing to write', () => {
    expect(rewriteNoteLinks('---\nin:\n  3y7505rsr6fd:\n    note: see [[B]] inline\n---\n', resolvesB, toC)).toBeNull()
  })

  it('a note whose folder values name nobody renamed is null — `in` is never re-serialised for nothing', () => {
    expect(rewriteNoteLinks('---\nin: {3y7505rsr6fd: {owner: "[[A]]"}}\n---\n', resolvesB, toC)).toBeNull()
  })
})

// ---------- YAZ-864: the ONE reserved key is walked INTO ----------

describe('rewriteNoteLinks inside folder_settings (YAZ-864)', () => {
  it('rewrites an outline `order` entry, keeping every other key and the body byte-for-byte', () => {
    const content =
      '---\nstatus: idea\nfolder_settings:\n  views:\n    - type: outline\n      name: Outline\n      order:\n        - "[[A]]"\n        - "[[B]]"\n    - type: table\n      name: Table\n---\n\n# Home\n'
    const out = rewriteNoteLinks(content, resolvesB, toC)
    expect(out).toContain('- "[[C]]"')
    expect(out).toContain('- "[[A]]"') // the sibling entry is untouched
    expect(out).toContain('status: idea')
    expect(out).toContain('name: Table') // the second view rides along
    expect(out).toContain('\n# Home\n')
  })

  it('rewrites a column `target`, leaving the column\u2019s other keys and the sibling columns alone', () => {
    const content =
      '---\nfolder_settings:\n  columns:\n    sold_to:\n      kind: multi-link\n      target: "[[B]]"\n      required: true\n    owner:\n      kind: link\n      target: "[[A]]"\n    note:\n      kind: text\n  folder: roles\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC)
    expect(out).toContain('target: "[[C]]"')
    expect(out).toContain('kind: multi-link')
    expect(out).toContain('required: true')
    expect(out).toContain('target: "[[A]]"')
    expect(out).toContain('kind: text')
    expect(out).toContain('folder: roles')
  })

  it('the spelling rules are the top level\u2019s, not a second set: alias, heading and pathed forms all follow', () => {
    const content =
      '---\nfolder_settings:\n  columns:\n    a:\n      kind: link\n      target: "[[Sub/B|Bee]]"\n  views:\n    - type: outline\n      order:\n        - "[[ B #H]]"\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('target: "[[Sub/C|Bee]]"') // pathed stays pathed
    expect(out).toContain('"[[C#H]]"') // heading rides along, padding normalised as everywhere else
  })

  it('a STALE entry that never resolved to the renamed page stays exactly as written', () => {
    const content =
      '---\nfolder_settings:\n  views:\n    - type: outline\n      order:\n        - "[[Gone]]"\n        - not a link at all\n        - 7\n      order_note: "[[B]] in an unknown key"\n---\n\nbody [[B]]\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('- "[[Gone]]"')
    expect(out).toContain('- not a link at all')
    expect(out).toContain('- 7')
    expect(out).toContain('order_note: "[[B]] in an unknown key"') // not a leaf, and not whole-value
    expect(out).toContain('body [[C]]\n') // the body still rewrote, so the file WAS written
  })

  it('a page with settings but no reference to the renamed file is null — never written, byte-for-byte safe', () => {
    const content =
      '---\nstatus: idea\nfolder_settings:\n  columns:\n    owner:\n      kind: link\n      target: "[[A]]"\n  views:\n    - type: outline\n      order: ["[[A]]"]\n---\n\n# Not about B\n'
    expect(rewriteNoteLinks(content, resolvesB, toC)).toBeNull()
  })

  it('rewrites a wikilink LINE inside a view’s outline; prose lines, markers and indentation survive (YAZ-900)', () => {
    const content =
      '---\nfolder_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[A]]\n            * [[B]]\n        - see [[B]] inline\n        - [[B]] and [[B]]\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    const views = (parseFrontmatter(splitFrontmatter(out).frontmatter).properties.folder_settings as { views: { outline: string }[] }).views
    expect(views[0].outline).toBe('- [[A]]\n    * [[C]]\n- see [[B]] inline\n- [[B]] and [[B]]')
  })

  it('an outline that only MENTIONS the renamed page mid-line is null — never written', () => {
    const content =
      '---\nfolder_settings:\n  views:\n    - type: outline\n      outline: "- see [[B]] inline"\n      outline_note: "[[B]] in an unknown key"\n---\n\nbody\n'
    expect(rewriteNoteLinks(content, resolvesB, toC)).toBeNull()
  })

  it('a non-string outline rides along untouched — the raw value is never normalised', () => {
    const content = '---\nfolder_settings:\n  views:\n    - type: outline\n      outline: 7\n      order: ["[[B]]"]\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('outline: 7')
    expect(out).toContain('"[[C]]"')
  })

  it('an unusable settings shape is not normalised away — the raw value rides along, only the leaf moves', () => {
    const content =
      '---\nfolder_settings:\n  columns:\n    broken:\n      kind: not-a-kind\n      target: "[[B]]"\n    alsoBroken: 7\n  views: {}\n  stray: keep me\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('kind: not-a-kind') // the tolerant READ would drop this column entirely
    expect(out).toContain('target: "[[C]]"')
    expect(out).toContain('alsoBroken: 7')
    expect(out).toContain('views: {}')
    expect(out).toContain('stray: keep me')
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
  return { path, name, basename, title: basename, folder: folder === name ? '' : folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
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
    const summary = await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records })
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
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[C]]\n')
    // Now every write conflicts: the file is skipped, its content untouched.
    const files2 = { '/v/A.md': { content: '[[B]]\n', mtime: 10 } }
    const bridge2 = installBridge(files2)
    bridge2.writeFile.mockRejectedValue({ code: 'CONFLICT', message: 'file changed on disk since last read', path: '/v/A.md', mtime: 11 })
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records })).toEqual({ updated: 0, skipped: 1 })
    expect(files2['/v/A.md'].content).toBe('[[B]]\n')
  })

  it('a SELF-link follows the file: the renamed note is read and rewritten at its NEW path', async () => {
    const files = { '/v/C.md': { content: 'I link [[B|myself]].\n', mtime: 5 } }
    installBridge(files)
    const records = [rec('/v/B.md', { links: ['B'] })]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
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
    const summary = await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Sub/B.md', newPath: '/v/Sub/C.md', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[B]] and [[Sub/C]]\n')
  })

  it('an ALIAS-form link to the renamed file stays BYTE-IDENTICAL; its name forms still rewrite (E2, GRO-2214)', async () => {
    const files = { '/v/A.md': { content: 'See [[CAC]] and [[ CAC |shown]] and [[B]].\n', mtime: 1 } }
    installBridge(files)
    // B.md answers to `CAC` through frontmatter aliases: `[[CAC]]` keeps pointing at it after
    // the rename (the alias moves with the file), so only the NAME form is rewritten.
    const records = [rec('/v/A.md', { links: ['CAC', 'B'] }), rec('/v/B.md', { aliases: ['CAC'] })]
    expect(countLinkReferences({ ids: true, root, oldPath, records })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[CAC]] and [[ CAC |shown]] and [[C]].\n')
  })

  it('a note referencing the renamed file ONLY by alias is not in the referencing set at all (no read, no write)', async () => {
    const files = { '/v/A.md': { content: 'Only [[CAC]].\n', mtime: 1 } }
    const bridge = installBridge(files)
    const records = [rec('/v/A.md', { links: ['CAC'] }), rec('/v/B.md', { aliases: ['CAC'] })]
    expect(countLinkReferences({ ids: true, root, oldPath, records })).toBe(0) // the banner's N and the rewrite agree
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records })).toEqual({ updated: 0, skipped: 0 })
    expect(bridge.readFile).not.toHaveBeenCalled()
    expect(files['/v/A.md'].content).toBe('Only [[CAC]].\n')
  })

  it('a same-directory rename whose NEW name is shadowed by another file escalates the bare link to the pathed form', async () => {
    const files = { '/v/A.md': { content: '[[B]]\n', mtime: 1 } }
    installBridge(files)
    // Rename Sub/B → Sub/C while a root-level C exists: a bare [[C]] would resolve to /v/C.md,
    // so the rewrite goes pathed — resolution decides the FORM too, not just the target.
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/C.md'),
      rec('/v/Sub/B.md', { folder: 'Sub' }),
    ]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Sub/B.md', newPath: '/v/Sub/C.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Sub/C]]\n')
  })
})

describe('updateLinksAfterRename reaches notes referenced ONLY inside folder_settings (YAZ-864)', () => {
  const root = '/v'
  const oldPath = '/v/B.md'
  const newPath = '/v/C.md'
  /** Home names B in its outline `order`; Cols names it as a column target. Neither has a `links` entry. */
  const HOME = '---\nfolder_settings:\n  views:\n    - type: outline\n      name: Outline\n      order:\n        - "[[A]]"\n        - "[[B]]"\n---\n'
  const COLS = '---\nfolder_settings:\n  columns:\n    sold_to:\n      kind: multi-link\n      target: "[[B]]"\n---\n'
  /** A folder's settings record, as the index hands it over beside the notes. */
  const settings = (folder: string, raw: string) => rec(`/v/${folder}/.folder.md`, { folder, properties: parseFrontmatter(splitFrontmatter(raw).frontmatter).properties })

  it('counts them in the banner N and rewrites both leaves on disk; a settings file naming nobody is never read', async () => {
    const OTHER = '---\nfolder_settings:\n  columns:\n    owner:\n      kind: link\n      target: "[[A]]"\n---\n'
    const files = {
      '/v/Home/.folder.md': { content: HOME, mtime: 1 },
      '/v/Cols/.folder.md': { content: COLS, mtime: 1 },
      '/v/Other/.folder.md': { content: OTHER, mtime: 1 },
    }
    const bridge = installBridge(files)
    const records = [rec('/v/A.md'), rec('/v/B.md')]
    const folders = [settings('Cols', COLS), settings('Home', HOME), settings('Other', OTHER)]
    // The banner's N and the rewrite agree — the probe walks the same leaves the rewrite does.
    expect(countLinkReferences({ ids: true, root, oldPath, records, folders })).toBe(2)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records, folders })).toEqual({ updated: 2, skipped: 0 })
    expect(files['/v/Home/.folder.md'].content).toContain('- "[[C]]"')
    expect(files['/v/Home/.folder.md'].content).toContain('- "[[A]]"')
    expect(files['/v/Cols/.folder.md'].content).toContain('target: "[[C]]"')
    expect(files['/v/Other/.folder.md'].content).toBe(OTHER) // byte-for-byte: settings, but no reference
    expect(bridge.readFile).not.toHaveBeenCalledWith('/v/Other/.folder.md')
  })

  it('a page referenced ONLY by an outline LINE is counted and rewritten too (YAZ-900)', async () => {
    const OUT = '---\nfolder_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[B]]\n        - prose about [[A]]\n---\n'
    const files = { '/v/Out/.folder.md': { content: OUT, mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/B.md')]
    const folders = [settings('Out', OUT)]
    expect(countLinkReferences({ ids: true, root, oldPath, records, folders })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records, folders })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/Out/.folder.md'].content).toContain('- [[C]]')
    expect(files['/v/Out/.folder.md'].content).toContain('- prose about [[A]]')
  })

  it('a FOLDER rename leaves a bare settings leaf byte-identical, exactly like a bare body link (LOCKED)', async () => {
    const files = { '/v/Home/.folder.md': { content: HOME, mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/Old/B.md', { folder: 'Old' })]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records, folders: [settings('Home', HOME)], dirs: ['/v/Home', '/v/Old'] })).toEqual({ updated: 0, skipped: 0 })
    expect(files['/v/Home/.folder.md'].content).toBe(HOME)
  })
})

// ---------- E1b (GRO-2241): folder rename + cross-directory move ----------

describe('updateLinksAfterRename with kind: dir (folder rename, E1b)', () => {
  const root = '/v'

  it('rewrites PATHED links/embeds into the folder; bare links stay BYTE-IDENTICAL (LOCKED — padding and all)', async () => {
    const files = { '/v/A.md': { content: 'See [[Old/B]] and [[ B ]] and [[B|Bee]] and ![[Old/B]].\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['Old/B', 'B'], embeds: ['Old/B'] }),
      rec('/v/Old/B.md', { folder: 'Old' }),
    ]
    const summary = await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[New/B]] and [[ B ]] and [[B|Bee]] and ![[New/B]].\n')
  })

  it('records under the folder RELOCATE: a referencing note inside the renamed folder is read/written at its NEW path', async () => {
    const files = { '/v/New/inner.md': { content: 'link [[Old/B]]\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/Old/inner.md', { folder: 'Old', links: ['Old/B'] }),
      rec('/v/Old/B.md', { folder: 'Old' }),
    ]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/New/inner.md'].content).toBe('link [[New/B]]\n')
  })

  it('a pathed link to a file OUTSIDE the folder (and a prefix-cousin folder) is untouched', async () => {
    const files = { '/v/A.md': { content: '[[Sub/x]] and [[Older/y]]\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['Sub/x', 'Older/y'] }),
      rec('/v/Sub/x.md', { folder: 'Sub' }),
      rec('/v/Older/y.md', { folder: 'Older' }), // `/v/Older` is NOT under `/v/Old`
    ]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })).toEqual({ updated: 0, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Sub/x]] and [[Older/y]]\n')
  })
})

// ---------- YAZ-2290 D10: a folder is a page, and its name links follow it ----------

describe('updateLinksAfterRename: links to the FOLDER itself (YAZ-2290 D10)', () => {
  const root = '/v'
  const FOLDER_ID = 'f7n2w8rt4xyz'
  /** Another folder's settings: its Outline names Projects on a line of its own, and a column targets it. */
  const TEAM = '---\nfolder_settings:\n  columns:\n    project:\n      kind: link\n      target: "[[Projects]]"\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[Projects]]\n        - prose about [[Projects]]\n---\n'
  const settingsOf = (raw: string) => parseFrontmatter(splitFrontmatter(raw).frontmatter).properties.folder_settings
  const team = () => rec('/v/Team/.folder.md', { properties: { folder_settings: settingsOf(TEAM) } })

  it('a rename rewrites bare `[[Projects]]` to the new name — in a note and in another folder\u2019s Outline — and the count is those two files', async () => {
    const A = `See [[Projects]], [[projects|the work]] and [[Projects#Scope]]; not [[Sub]], [[${FOLDER_ID}]] or \`[[Projects]]\`.\n`
    const files = { '/v/A.md': { content: A, mtime: 1 }, '/v/Team/.folder.md': { content: TEAM, mtime: 1 }, '/v/N.md': { content: 'nothing\n', mtime: 1 } }
    const bridge = installBridge(files)
    const records = [rec('/v/A.md', { links: ['Projects', 'projects', 'Sub', FOLDER_ID] }), rec('/v/N.md'), rec('/v/Projects/Plan.md')]
    const opts = { ids: true, root, oldPath: '/v/Projects', newPath: '/v/Work', kind: 'dir' as const, records, folders: [team()], dirs: ['/v/Projects', '/v/Projects/Sub', '/v/Team'] }
    expect(countLinkReferences(opts)).toBe(2)
    expect(await updateLinksAfterRename(opts)).toEqual({ updated: 2, skipped: 0 })
    // A bare link to a folder INSIDE the renamed one keeps resolving (LOCKED E1b); an id link names no place.
    expect(files['/v/A.md'].content).toBe(`See [[Work]], [[Work|the work]] and [[Work#Scope]]; not [[Sub]], [[${FOLDER_ID}]] or \`[[Projects]]\`.\n`)
    expect(files['/v/Team/.folder.md'].content).toContain('- [[Work]]')
    expect(files['/v/Team/.folder.md'].content).toContain('- prose about [[Projects]]') // prose is not a link line
    expect(files['/v/Team/.folder.md'].content).toContain('target: "[[Work]]"')
    expect(bridge.readFile).not.toHaveBeenCalledWith('/v/N.md')
  })

  it('a pathed link follows a MOVE — to the folder and to what is inside it — while a bare one that still reaches it is left byte-identical', async () => {
    const files = { '/v/A.md': { content: '[[Team/Projects]], [[ Projects ]], [[Team/Projects/Sub]] and [[Team/Projects/Plan]]\n', mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['Team/Projects', 'Projects', 'Team/Projects/Sub', 'Team/Projects/Plan'] }), rec('/v/Team/Projects/Plan.md')]
    const dirs = ['/v/Archive', '/v/Team', '/v/Team/Projects', '/v/Team/Projects/Sub']
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Team/Projects', newPath: '/v/Archive/Projects', kind: 'dir', records, dirs })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Archive/Projects]], [[ Projects ]], [[Archive/Projects/Sub]] and [[Archive/Projects/Plan]]\n')
  })

  it('a bare link ESCALATES to the path when the move hands the name to a shallower folder', async () => {
    const files = { '/v/A.md': { content: '[[Projects]]\n', mtime: 1 } }
    installBridge(files)
    const dirs = ['/v/Deep', '/v/Deep/Er', '/v/Other', '/v/Other/Projects', '/v/Projects']
    const records = [rec('/v/A.md', { links: ['Projects'] })]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Projects', newPath: '/v/Deep/Er/Projects', kind: 'dir', records, dirs })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Deep/Er/Projects]]\n')
  })

  it.each([
    ['a note NAMED Projects', rec('/v/Notes/Projects.md')],
    ['a note ALIASED Projects', rec('/v/Roadmap.md', { aliases: ['Projects'] })],
  ])('%s holds the link: the folder\u2019s rename counts and touches nothing', async (_name, holder) => {
    const files = { '/v/A.md': { content: '[[Projects]]\n', mtime: 1 } }
    const bridge = installBridge(files)
    const opts = { ids: true, root, oldPath: '/v/Projects', newPath: '/v/Work', kind: 'dir' as const, records: [rec('/v/A.md', { links: ['Projects'] }), holder], dirs: ['/v/Projects'] }
    expect(countLinkReferences(opts)).toBe(0)
    expect(await updateLinksAfterRename(opts)).toEqual({ updated: 0, skipped: 0 })
    expect(bridge.readFile).not.toHaveBeenCalled()
  })

  it('a folder\u2019s own settings file is read and rewritten at its NEW path, like any note inside it', async () => {
    const files = { '/v/Work/.folder.md': { content: TEAM, mtime: 1 } }
    installBridge(files)
    const own = rec('/v/Projects/.folder.md', { properties: { folder_settings: settingsOf(TEAM) } })
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Projects', newPath: '/v/Work', kind: 'dir', records: [], folders: [own], dirs: ['/v/Projects'] })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/Work/.folder.md'].content).toContain('- [[Work]]')
  })
})

describe('updateLinksAfterRename across a cross-directory file MOVE (E1b)', () => {
  const root = '/v'

  it('a bare link stays BYTE-IDENTICAL when the bare name still resolves to the moved file (pin)', async () => {
    const files = { '/v/A.md': { content: 'See [[ B ]] and [[Old/B]].\n', mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['B', 'Old/B'] }), rec('/v/Old/B.md', { folder: 'Old' })]
    const summary = await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Old/B.md', newPath: '/v/New/B.md', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[ B ]] and [[New/B]].\n') // padding intact — never spliced
  })

  it('a bare link ESCALATES to the pathed form when the move hands the bare name to another file (pin)', async () => {
    // B moves deeper than the duplicate Sub/B: the shallowest rule now picks Sub/B for [[B]].
    const files = { '/v/A.md': { content: '[[B]] here\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/B.md'),
      rec('/v/Sub/B.md', { folder: 'Sub' }),
    ]
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/B.md', newPath: '/v/Deep/er/B.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Deep/er/B]] here\n')
  })
})

describe('view-only rename references stay outside the semantic index (YAZ-1310)', () => {
  const root = '/v'
  const viewFile = (path: string, kind: 'text' | 'pdf' = 'text'): TreeNode => ({
    type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1,
  })

  it('counts and rewrites explicit-extension body/frontmatter links while preserving suffixes, aliases and code masks', async () => {
    const content = '---\nsource: "[[data.json#meta|JSON source]]"\n---\n\n[[ data.json ]] [[data.json#row|shown]] `[[data.json]]`\n```\n[[data.json]]\n```\n'
    const files = { '/v/A.md': { content, mtime: 1 } }
    const bridge = installBridge(files)
    const records = [rec('/v/A.md', { links: ['data.json'] })]
    const viewOnlyCatalog = buildViewOnlyCatalog(root, [viewFile('/v/data.json')])

    expect(records.some((record) => record.path === '/v/data.json')).toBe(false)
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/data.json', records, viewOnlyCatalog })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/data.json', newPath: '/v/data-v2.JSON', records, viewOnlyCatalog })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toContain('source: "[[data-v2.JSON#meta|JSON source]]"')
    expect(files['/v/A.md'].content).toContain('[[data-v2.JSON]] [[data-v2.JSON#row|shown]] `[[data.json]]`')
    expect(files['/v/A.md'].content).toContain('```\n[[data.json]]\n```')
    expect(bridge.readFile).toHaveBeenCalledExactlyOnceWith('/v/A.md')
    expect(bridge.writeFile).toHaveBeenCalledTimes(1)
    expect(bridge.writeFile.mock.calls[0]?.[0].path).toBe('/v/A.md')
  })

  it.each([
    ['/v/tool.py', '/v/tool-v2.PY', 'text'],
    ['/v/report.pdf', '/v/report-v2.PDF', 'pdf'],
  ] as const)('rewrites a supported %s link without a target IndexRecord', async (oldPath, newPath, kind) => {
    const oldName = oldPath.slice(oldPath.lastIndexOf('/') + 1)
    const newName = newPath.slice(newPath.lastIndexOf('/') + 1)
    const files = { '/v/A.md': { content: `[[${oldName}]]\n`, mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: [oldName] })]
    const viewOnlyCatalog = buildViewOnlyCatalog(root, [viewFile(oldPath, kind)])
    expect(await updateLinksAfterRename({ ids: true, root, oldPath, newPath, records, viewOnlyCatalog })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${newName}]]\n`)
  })

  it('uses the post-move catalog to escalate a basename that a shallower duplicate wins', async () => {
    const files = { '/v/A.md': { content: '[[data.json]]\n', mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['data.json'] })]
    const viewOnlyCatalog = buildViewOnlyCatalog(root, [
      viewFile('/v/data.json'),
      { type: 'dir', name: 'other', path: '/v/other', children: [viewFile('/v/other/data.JSON')] },
    ])
    expect(await updateLinksAfterRename({
      ids: true,
      root,
      oldPath: '/v/data.json',
      newPath: '/v/z/deep/data.json',
      records,
      viewOnlyCatalog,
    })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[z/deep/data.json]]\n')
  })
})

// ---------- the E1c dry-run count (GRO-2242) ----------

describe('id links are never rewritten (YAZ-2293 D5)', () => {
  const root = '/v'
  const B = rec('/v/B.md', { id: 'k3m9x2pq7abc' })

  it('a note linking only by id is not a reference: the count is 0 and nothing is read or written', async () => {
    const records = [rec('/v/A.md', { links: ['k3m9x2pq7abc'] }), B]
    const { readFile, writeFile } = installBridge({ '/v/A.md': { content: 'see [[k3m9x2pq7abc]]\n', mtime: 1 } })
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/B.md', records })).toBe(0)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/B.md', newPath: '/v/C.md', records })).toEqual({ updated: 0, skipped: 0 })
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('in a note linking by name AND by id, the name is rewritten and the id is left byte-identical', async () => {
    const records = [rec('/v/A.md', { links: ['B', 'k3m9x2pq7abc'] }), B]
    const files = { '/v/A.md': { content: '[[B]] and [[k3m9x2pq7abc]] and [[k3m9x2pq7abc|label]]\n', mtime: 1 } }
    installBridge(files)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/B.md', newPath: '/v/C.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[C]] and [[k3m9x2pq7abc]] and [[k3m9x2pq7abc|label]]\n')
  })

  it('one rename, two linkers: the note linking by NAME is the whole count and the only file touched — the note linking by ID (body and property) and the renamed note itself are never read or written (scenario C1, D15)', async () => {
    const records = [rec('/v/ById.md', { links: ['k3m9x2pq7abc'] }), rec('/v/ByName.md', { links: ['B'] }), B]
    const byId = '---\nparent: "[[k3m9x2pq7abc]]"\n---\nsee [[k3m9x2pq7abc]] and [[k3m9x2pq7abc#Scope]]\n'
    const renamed = '---\nid: k3m9x2pq7abc\n---\nbody\n'
    const files = {
      '/v/ById.md': { content: byId, mtime: 1 },
      '/v/ByName.md': { content: 'see [[B]]\n', mtime: 1 },
      '/v/C.md': { content: renamed, mtime: 1 },
    }
    const { readFile, writeFile } = installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/B.md', records })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/B.md', newPath: '/v/C.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(['/v/ByName.md'])
    expect(writeFile.mock.calls.map(([req]) => req.path)).toEqual(['/v/ByName.md'])
    expect(files['/v/ByName.md'].content).toBe('see [[C]]\n')
    expect(files['/v/ById.md']).toEqual({ content: byId, mtime: 1 })
    expect(files['/v/C.md']).toEqual({ content: renamed, mtime: 1 })
  })

  it('a NAME link held in a folder’s value is rewritten on disk; the note holding only an ID link there is never read (D19)', async () => {
    const byName = '---\nin:\n  3y7505rsr6fd:\n    owner: "[[B]]"\n---\n'
    const byId = '---\nin:\n  3y7505rsr6fd:\n    owner: "[[k3m9x2pq7abc]]"\n---\n'
    const records = [rec('/v/ById.md', { links: ['k3m9x2pq7abc'] }), rec('/v/ByName.md', { links: ['B'] }), B]
    const files = { '/v/ById.md': { content: byId, mtime: 1 }, '/v/ByName.md': { content: byName, mtime: 1 } }
    const { readFile } = installBridge(files)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/B.md', newPath: '/v/C.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/ByName.md'].content).toBe(byName.replace('[[B]]', '[[C]]'))
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(['/v/ByName.md'])
    expect(files['/v/ById.md']).toEqual({ content: byId, mtime: 1 })
  })

  it('a FOLDER move leaves the id links to the notes inside it alone too, while a pathed name link is rewritten', async () => {
    const records = [rec('/v/A.md', { links: ['k3m9x2pq7abc', 'Dir/B'] }), rec('/v/ById.md', { links: ['k3m9x2pq7abc'] }), rec('/v/Dir/B.md', { folder: 'Dir', id: 'k3m9x2pq7abc' })]
    const files = { '/v/A.md': { content: '[[k3m9x2pq7abc]] and [[Dir/B]]\n', mtime: 1 }, '/v/ById.md': { content: '[[k3m9x2pq7abc]]\n', mtime: 1 } }
    const { writeFile } = installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/Dir', kind: 'dir', records })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Dir', newPath: '/v/Moved', kind: 'dir', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[k3m9x2pq7abc]] and [[Moved/B]]\n')
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(files['/v/ById.md']).toEqual({ content: '[[k3m9x2pq7abc]]\n', mtime: 1 })
  })
})

describe('a link that spells a title (YAZ-2420 D17)', () => {
  const root = '/v'
  const ABDUL = '/v/candidates/up-001-abdul-k3m9x2pq7abc.md'
  const abdul = rec(ABDUL, { title: 'UP-001 - Abdul', properties: { title: 'UP-001 - Abdul' } })

  it('E: renaming or moving a note with a title leaves `[[Its Title]]` as written and out of the count; a link spelling its file name is rewritten', async () => {
    const records = [rec('/v/ByFile.md', { links: ['up-001-abdul-k3m9x2pq7abc'] }), rec('/v/ByTitle.md', { links: ['UP-001 - Abdul'] }), abdul]
    const files = {
      '/v/ByFile.md': { content: '[[up-001-abdul-k3m9x2pq7abc]]\n', mtime: 1 },
      '/v/ByTitle.md': { content: '[[UP-001 - Abdul]] and [[up-001 - abdul|him]]\n', mtime: 1 },
    }
    const { readFile } = installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: ABDUL, records })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: ABDUL, newPath: '/v/hired/abdul-k3m9x2pq7abc.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/ByFile.md'].content).toBe('[[abdul-k3m9x2pq7abc]]\n')
    expect(files['/v/ByTitle.md'].content).toBe('[[UP-001 - Abdul]] and [[up-001 - abdul|him]]\n')
    expect(readFile).not.toHaveBeenCalledWith('/v/ByTitle.md')
  })

  it('a note with no title is renamed as before, and its new file name is its title from then on: `[[Old]]` becomes a bare `[[New]]` beside a deeper note titled New', async () => {
    const records = [rec('/v/A.md', { links: ['Old'] }), rec('/v/Sub/Old.md'), rec('/v/x/y/z/new-7tq2m8vd4xhn.md', { title: 'New', properties: { title: 'New' } })]
    const files = { '/v/A.md': { content: '[[Old]]\n', mtime: 1 } }
    installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/Sub/Old.md', records })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Sub/Old.md', newPath: '/v/Sub/New.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[New]]\n')
  })
})

describe('a note that holds its own `title:` line, renamed (YAZ-2523 🔒 V12)', () => {
  const root = '/v'
  const OLD = '/v/docs/deploy.md'
  const NEW = '/v/docs/release.md'
  const TITLES = ['Deploy checklist', 'deploy']

  it.each(TITLES)('where the vault does not use IDs, `title: %s` is an ordinary property: bare, pathed and frontmatter links to deploy.md are rewritten and counted', async (title) => {
    const records = [rec('/v/A.md', { links: ['deploy', 'deploy'] }), rec('/v/P.md', { links: ['docs/deploy'] }), rec(OLD, { properties: { title } })]
    const files = { '/v/A.md': { content: '---\nnext: "[[deploy]]"\n---\n\n[[deploy]]\n', mtime: 1 }, '/v/P.md': { content: '[[docs/deploy]]\n', mtime: 1 } }
    installBridge(files)
    expect(countLinkReferences({ ids: false, root, oldPath: OLD, records })).toBe(2)
    expect(await updateLinksAfterRename({ ids: false, root, oldPath: OLD, newPath: NEW, records })).toEqual({ updated: 2, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('---\nnext: "[[release]]"\n---\n\n[[release]]\n')
    expect(files['/v/P.md'].content).toBe('[[docs/release]]\n')
  })

  it.each(TITLES)('where the vault uses IDs, a link that spells `title: %s` travels with the note: left as written, not counted', async (title) => {
    const records = [rec('/v/A.md', { links: [title, title] }), rec(OLD, { title, properties: { title } })]
    const content = `---\nnext: "[[${title}]]"\n---\n\n[[${title}]]\n`
    const files = { '/v/A.md': { content, mtime: 1 } }
    installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: OLD, records })).toBe(0)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: OLD, newPath: NEW, records })).toEqual({ updated: 0, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(content)
  })

  it('where the vault does not use IDs, the note is titled by its new file name afterwards: a bare link stays bare beside a deeper note of that name', async () => {
    const records = [rec('/v/A.md', { links: ['deploy'] }), rec(OLD, { properties: { title: 'Deploy checklist' } }), rec('/v/x/y/z/release.md')]
    const files = { '/v/A.md': { content: '[[deploy]]\n', mtime: 1 } }
    installBridge(files)
    expect(await updateLinksAfterRename({ ids: false, root, oldPath: OLD, newPath: NEW, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[release]]\n')
  })
})

describe('a title edit (YAZ-2420 D16): a link that spelled the old title spells the new one', () => {
  const root = '/v'
  const ID = 'k3m9x2pq7abc'
  const OLD = `/v/candidates/abdul-${ID}.md`
  const NEW = `/v/candidates/up-001-abdul-${ID}.md`
  const abdul = rec(OLD, { id: ID, title: 'Abdul', properties: { id: ID, title: 'Abdul' } })

  it('`[[Old title]]` is rewritten to `[[New title]]` and counted; a link by file name or by path follows the new file; an id link is neither rewritten nor counted', async () => {
    const records = [rec('/v/ById.md', { links: [ID] }), rec('/v/ByName.md', { links: [`abdul-${ID}`, `candidates/abdul-${ID}`] }), rec('/v/ByTitle.md', { links: ['Abdul', 'abdul'] }), abdul]
    const files = {
      '/v/ById.md': { content: `[[${ID}]]\n`, mtime: 1 },
      '/v/ByName.md': { content: `[[abdul-${ID}]] and [[candidates/abdul-${ID}]]\n`, mtime: 1 },
      '/v/ByTitle.md': { content: '[[Abdul]], [[abdul|him]] and [[Abdul#Rates]]\n', mtime: 1 },
    }
    const { readFile } = installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: OLD, records, title: 'UP-001 - Abdul' })).toBe(2)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: OLD, newPath: NEW, records, title: 'UP-001 - Abdul' })).toEqual({ updated: 2, skipped: 0 })
    expect(files['/v/ByTitle.md'].content).toBe('[[UP-001 - Abdul]], [[UP-001 - Abdul|him]] and [[UP-001 - Abdul#Rates]]\n')
    expect(files['/v/ByName.md'].content).toBe(`[[up-001-abdul-${ID}]] and [[candidates/up-001-abdul-${ID}]]\n`)
    expect(readFile).not.toHaveBeenCalledWith('/v/ById.md')
  })

  it('a title edit that keeps the file name still rewrites the links that spelled the old title', async () => {
    const records = [rec('/v/A.md', { links: ['Abdul'] }), abdul]
    const files = { '/v/A.md': { content: '[[Abdul]]\n', mtime: 1 } }
    installBridge(files)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: OLD, newPath: OLD, records, title: 'Abdul!' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Abdul!]]\n')
  })

  it('a note with no `title:` is titled by its file name: its first title edit turns `[[Plan]]` into `[[Big Plan]]`', async () => {
    const records = [rec('/v/A.md', { links: ['Plan'] }), rec('/v/Plan.md', { id: ID })]
    const files = { '/v/A.md': { content: '[[Plan]]\n', mtime: 1 } }
    installBridge(files)
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/Plan.md', records, title: 'Big Plan' })).toBe(1)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Plan.md', newPath: `/v/big-plan-${ID}.md`, records, title: 'Big Plan' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Big Plan]]\n')
  })

  it('a new title a link cannot spell (`A | B`) is linked by the note\u2019s id instead, its `|label` and `#heading` kept (YAZ-2478)', async () => {
    const records = [rec('/v/A.md', { links: ['Abdul'] }), abdul]
    const files = { '/v/A.md': { content: '[[Abdul]], [[Abdul|him]] and [[Abdul#Rates]]\n', mtime: 1 } }
    installBridge(files)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: OLD, newPath: `/v/candidates/a-b-${ID}.md`, records, title: 'A | B' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${ID}]], [[${ID}|him]] and [[${ID}#Rates]]\n`)
  })

  it('a new title another note already has is linked by the note\u2019s id instead (YAZ-2478)', async () => {
    const other = rec('/v/ali-7tq2m8vd4xhn.md', { id: '7tq2m8vd4xhn', title: 'Ali', properties: { title: 'Ali' } })
    const records = [rec('/v/A.md', { links: ['Abdul'] }), abdul, other]
    const files = { '/v/A.md': { content: '[[Abdul]]\n', mtime: 1 } }
    installBridge(files)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: OLD, newPath: `/v/candidates/ali-${ID}.md`, records, title: 'Ali' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${ID}]]\n`)
  })

  it('a note with no id is still linked by its new file name when the new title cannot be spelled', async () => {
    const records = [rec('/v/A.md', { links: ['Plan'] }), rec('/v/Plan.md')]
    const files = { '/v/A.md': { content: '[[Plan]]\n', mtime: 1 } }
    installBridge(files)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: '/v/Plan.md', newPath: `/v/a-b-${ID}.md`, records, title: 'A | B' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[a-b-${ID}]]\n`)
  })

  it('a typed path of titles that reached the note (`[[Candidates/Abdul]]`) is counted and rewritten to its id, on its own title edit and on its folder\u2019s (YAZ-2478)', async () => {
    const folders = [rec('/v/candidates/.folder.md', { title: 'Candidates', properties: { title: 'Candidates' } })]
    const records = [rec('/v/A.md', { links: ['Candidates/Abdul'] }), abdul]
    const files = { '/v/A.md': { content: '[[Candidates/Abdul]] and [[candidates/abdul|him]]\n', mtime: 1 } }
    installBridge(files)
    const note = { ids: true, root, oldPath: OLD, newPath: NEW, records, folders, title: 'UP-001 - Abdul' }
    expect(countLinkReferences(note)).toBe(1)
    expect(await updateLinksAfterRename(note)).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${ID}]] and [[${ID}|him]]\n`)

    files['/v/A.md'] = { content: '[[Candidates/Abdul]]\n', mtime: 1 }
    const folder = { ids: true, root, oldPath: '/v/candidates', newPath: '/v/hired', kind: 'dir' as const, records, folders, dirs: ['/v/candidates'], title: 'Hired' }
    expect(countLinkReferences(folder)).toBe(1)
    expect(await updateLinksAfterRename(folder)).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${ID}]]\n`)
  })

  it('a title edit of one note leaves a link that spells ANOTHER note\u2019s title alone', async () => {
    const other = rec('/v/other-7tq2m8vd4xhn.md', { title: 'Other', properties: { title: 'Other' } })
    const records = [rec('/v/A.md', { links: ['Other'] }), abdul, other]
    const { readFile } = installBridge({ '/v/A.md': { content: '[[Other]]\n', mtime: 1 } })
    expect(countLinkReferences({ ids: true, root, oldPath: OLD, records, title: 'UP-001 - Abdul' })).toBe(0)
    expect(await updateLinksAfterRename({ ids: true, root, oldPath: OLD, newPath: NEW, records, title: 'UP-001 - Abdul' })).toEqual({ updated: 0, skipped: 0 })
    expect(readFile).not.toHaveBeenCalled()
  })
})

describe('links to a folder by its TITLE (YAZ-2420 D17)', () => {
  const root = '/v'
  const FOLDER_ID = 'f7n2w8rt4xyz'
  const upwork = rec('/v/upwork/.folder.md', { id: FOLDER_ID, title: 'Upwork', properties: { id: FOLDER_ID, title: 'Upwork' } })

  it('a folder\u2019s title edit rewrites `[[Old folder title]]` to `[[New folder title]]` and counts it; a pathed link follows the folder, an id link is left as written', async () => {
    const records = [rec('/v/A.md', { links: ['Upwork', 'upwork/Plan', FOLDER_ID] }), rec('/v/ById.md', { links: [FOLDER_ID] }), rec('/v/upwork/Plan.md')]
    const files = { '/v/A.md': { content: `[[Upwork]], [[upwork/Plan]] and [[${FOLDER_ID}]]\n`, mtime: 1 }, '/v/ById.md': { content: `[[${FOLDER_ID}]]\n`, mtime: 1 } }
    const { readFile } = installBridge(files)
    const opts = { ids: true, root, oldPath: '/v/upwork', newPath: '/v/upwork-2026', kind: 'dir' as const, records, folders: [upwork], dirs: ['/v/upwork'], title: 'Upwork 2026' }
    expect(countLinkReferences(opts)).toBe(1)
    expect(await updateLinksAfterRename(opts)).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[Upwork 2026]], [[upwork-2026/Plan]] and [[${FOLDER_ID}]]\n`)
    expect(readFile).not.toHaveBeenCalledWith('/v/ById.md')
  })

  it('a folder\u2019s new title a link cannot spell, or that a note already has, is linked by the folder\u2019s id instead; a folder with no id by its new name (YAZ-2478)', async () => {
    const files = { '/v/A.md': { content: '[[Upwork]] and [[Upwork|jobs]]\n', mtime: 1 } }
    installBridge(files)
    const opts = { ids: true, root, oldPath: '/v/upwork', newPath: '/v/a-b', kind: 'dir' as const, records: [rec('/v/A.md', { links: ['Upwork'] }), rec('/v/Jobs.md')], folders: [upwork], dirs: ['/v/upwork'] }
    expect(await updateLinksAfterRename({ ...opts, title: 'A | B' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${FOLDER_ID}]] and [[${FOLDER_ID}|jobs]]\n`)

    files['/v/A.md'] = { content: '[[Upwork]]\n', mtime: 1 }
    expect(await updateLinksAfterRename({ ...opts, newPath: '/v/jobs', title: 'Jobs' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${FOLDER_ID}]]\n`)

    files['/v/A.md'] = { content: '[[Upwork]]\n', mtime: 1 }
    expect(await updateLinksAfterRename({ ...opts, folders: [rec('/v/upwork/.folder.md', { title: 'Upwork', properties: { title: 'Upwork' } })], title: 'A | B' })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[a-b]]\n')
  })

  it('a folder with no `title:` is titled by its name: its first title edit turns `[[Projects]]` into `[[Upwork 2026]]`', async () => {
    const files = { '/v/A.md': { content: '[[Projects]]\n', mtime: 1 } }
    installBridge(files)
    const opts = { ids: true, root, oldPath: '/v/Projects', newPath: '/v/upwork-2026', kind: 'dir' as const, records: [rec('/v/A.md', { links: ['Projects'] })], folders: [rec('/v/Projects/.folder.md', { title: 'Projects' })], dirs: ['/v/Projects'], title: 'Upwork 2026' }
    expect(await updateLinksAfterRename(opts)).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Upwork 2026]]\n')
  })

  it.each([
    ['renaming', undefined],
    ['retitling', 'Work'],
  ])('%s a folder whose DIRECTORY is named Projects leaves a `[[Projects]]` that reaches ANOTHER folder by its title alone, and out of the count', async (_how, title) => {
    const files = { '/v/A.md': { content: '[[Projects]]\n', mtime: 1 } }
    const { readFile } = installBridge(files)
    const titled = rec('/v/client-work/.folder.md', { title: 'Projects', properties: { title: 'Projects' } })
    const opts = { ids: true, root, oldPath: '/v/Deep/Projects', newPath: '/v/Deep/work', kind: 'dir' as const, records: [rec('/v/A.md', { links: ['Projects'] })], folders: [titled, rec('/v/Deep/Projects/.folder.md', { title: 'Projects' })], dirs: ['/v/Deep', '/v/Deep/Projects', '/v/client-work'], ...(title === undefined ? {} : { title }) }
    expect(countLinkReferences(opts)).toBe(0)
    expect(await updateLinksAfterRename(opts)).toEqual({ updated: 0, skipped: 0 })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('renaming or moving a folder with a title leaves `[[Its Title]]` as written and out of the count: the title travels in its `.folder.md`', async () => {
    const files = { '/v/A.md': { content: '[[Upwork]]\n', mtime: 1 } }
    const { readFile } = installBridge(files)
    const opts = { ids: true, root, oldPath: '/v/upwork', newPath: '/v/Archive/upwork', kind: 'dir' as const, records: [rec('/v/A.md', { links: ['Upwork'] })], folders: [upwork], dirs: ['/v/Archive', '/v/upwork'] }
    expect(countLinkReferences(opts)).toBe(0)
    expect(await updateLinksAfterRename(opts)).toEqual({ updated: 0, skipped: 0 })
    expect(readFile).not.toHaveBeenCalled()
  })
})

describe('countLinkReferences (the banner N — the exact referencing-set filter, no reads, no writes)', () => {
  const root = '/v'

  it('counts records whose links OR embeds resolve to the moved path — bare, pathed and embed forms', () => {
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/Hub.md', { embeds: ['B'] }),
      rec('/v/Pathed.md', { links: ['Sub/B'] }),
      rec('/v/Other.md', { links: ['C'] }),
      rec('/v/Sub/B.md'),
      rec('/v/C.md'),
    ]
    // Bare [[B]] resolves to the shallowest B — none at the root, so /v/Sub/B.md wins.
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/Sub/B.md', records })).toBe(3)
  })

  it('0 when nothing references the moved path (→ no banner at all, the locked N === 0 rule)', () => {
    const records = [rec('/v/A.md', { links: ['C'] }), rec('/v/B.md'), rec('/v/C.md')]
    expect(countLinkReferences({ ids: true, root, oldPath: '/v/B.md', records })).toBe(0)
  })

  it('agrees with what updateLinksAfterRename then touches (one construction, never two truths)', async () => {
    const files = {
      '/v/A.md': { content: 'See [[B]].\n', mtime: 1 },
      '/v/H.md': { content: '![[B]]\n', mtime: 1 },
    }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['B'] }), rec('/v/H.md', { embeds: ['B'] }), rec('/v/B.md')]
    const n = countLinkReferences({ ids: true, root, oldPath: '/v/B.md', records })
    const summary = await updateLinksAfterRename({ ids: true, root, oldPath: '/v/B.md', newPath: '/v/B2.md', records })
    expect(n).toBe(2)
    expect(summary).toEqual({ updated: n, skipped: 0 })
  })
})
