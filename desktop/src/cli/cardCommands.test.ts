import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDS_FILE } from '@shared/pageId'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { cardArchive, cardEdit, cardExtract, cardInline, CardUsageError } from './cardCommands'
import type { Io } from './cli'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yaseendocs-card-cli-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeIo(stdinText = ''): { io: Io; out: () => string; err: () => string } {
  let out = ''
  let err = ''
  return {
    io: {
      stdin: async () => stdinText,
      stdout: (t) => {
        out += t
      },
      stderr: (t) => {
        err += t
      },
    },
    out: () => out,
    err: () => err,
  }
}

function flagsOf(entries: Record<string, string | true> = {}): Map<string, string | true> {
  return new Map(Object.entries(entries))
}

async function makeVault(name: string, files: Record<string, string>, withIds = true): Promise<string> {
  const root = path.join(dir, name)
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  if (withIds) {
    await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify({ enabled: true, letters: ['YAZ'] }), 'utf8')
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
  return root
}

const inlineCard = (text: string, line: string, indent = '') =>
  `${indent}\`\`\`card\n${text
    .split('\n')
    .map((l) => (l === '' ? '' : `${indent}${l}`))
    .join('\n')}\n${indent}\`\`\`\n${indent}<!-- card: ${line} -->\n`

describe('cardEdit (YAZ-6156)', () => {
  it('edits an inline card title, body (stdin), props, remove-prop, and hide/show title while keeping reviews', async () => {
    const review = '2026-11-12T14:05:31.204Z good 12s'
    const root = await makeVault('v', {
      'geo.md': `---\nid: YAZ-1\n---\n# Geography\n\n${inlineCard('Old front\n---\nOld back', `YAZ-10, title "Old title", tags "old" "drop", level "A1", ${review}`)}`,
    })
    const geo = path.join(root, 'geo.md')

    const cap = makeIo('New front {{France}}\n---\nParis\n')
    await cardEdit(
      'yaz-10',
      root,
      flagsOf({ '--title': 'Capital of France', '--body': '-', '--hide-title': true, '--json': true }),
      cap.io,
      ['tags=europe', 'tags=capitals', 'count=3', 'verified=true'],
      ['LEVEL'],
    )
    expect(JSON.parse(cap.out())).toEqual({ id: 'YAZ-10', page: geo, title: 'Capital of France' })

    const updated = await readFile(geo, 'utf8')
    expect(updated).toContain('New front {{France}}\n---\nParis\n```')
    expect(updated).toContain(`<!-- card: YAZ-10, title "Capital of France", tags "europe" "capitals", count 3, verified true, notitle, ${review} -->`)
    expect(updated).not.toContain('level')

    // Show title again via plain-text output.
    const cap2 = makeIo()
    await cardEdit('YAZ-10', root, flagsOf({ '--show-title': true }), cap2.io)
    expect(cap2.out()).toBe(`edited YAZ-10 (${geo})\n`)
    const afterShow = await readFile(geo, 'utf8')
    expect(afterShow).not.toContain('notitle')
    expect(afterShow).toContain(review)
  })

  it('renames a standalone card file when --title changes and returns oldPath + renamed: true', async () => {
    const root = await makeVault('v', {
      'Cards/old-name-yaz-10.md': `---\nkind: card\n---\n${inlineCard('Question\n---\nAnswer', 'YAZ-10, title "Old name"')}`,
    })
    const oldPath = path.join(root, 'Cards/old-name-yaz-10.md')
    const expectedNew = path.join(root, 'Cards/new-title-yaz-10.md')

    const cap = makeIo()
    await cardEdit('YAZ-10', root, flagsOf({ '--title': 'New title', '--json': true }), cap.io)
    expect(JSON.parse(cap.out())).toEqual({
      id: 'YAZ-10',
      page: expectedNew,
      oldPath,
      renamed: true,
      title: 'New title',
    })
    expect(await readdir(path.join(root, 'Cards'))).toEqual(['new-title-yaz-10.md'])
    expect(await readFile(expectedNew, 'utf8')).toContain('<!-- card: YAZ-10, title "New title" -->')
  })

  it('refuses to rename a standalone card file if destination already exists, leaving both files untouched', async () => {
    const orig = `---\nkind: card\n---\n${inlineCard('Q\n---\nA', 'YAZ-10, title "Old"')}`
    const root = await makeVault('v', {
      'old-yaz-10.md': orig,
      'taken-yaz-10.md': 'Other file.\n',
    })
    const cap = makeIo()
    await expect(cardEdit('YAZ-10', root, flagsOf({ '--title': 'Taken' }), cap.io)).rejects.toThrow(/is already there/)
    expect(await readFile(path.join(root, 'old-yaz-10.md'), 'utf8')).toBe(orig)
    expect(await readFile(path.join(root, 'taken-yaz-10.md'), 'utf8')).toBe('Other file.\n')
  })

  it('does not rename a standalone card file when --title is unchanged or omitted', async () => {
    const root = await makeVault('v', {
      'custom-name.md': `---\nkind: card\n---\n${inlineCard('Q\n---\nA', 'YAZ-10, title "Keep me"')}`,
    })
    const file = path.join(root, 'custom-name.md')
    const cap = makeIo()
    await cardEdit('YAZ-10', root, flagsOf({ '--body': 'Updated Q\n---\nUpdated A', '--json': true }), cap.io)
    expect(JSON.parse(cap.out())).toEqual({ id: 'YAZ-10', page: file, title: 'Keep me' })
    expect(await readdir(root)).toContain('custom-name.md')
  })

  it('rejects invalid usage: unknown flags, missing edits, conflicting flags, bad id, reserved prop names', async () => {
    const root = await makeVault('v', {
      'geo.md': `---\nid: YAZ-1\n---\n${inlineCard('Q', 'YAZ-10')}`,
    })
    const cap = makeIo()
    await expect(cardEdit('YAZ-10', root, flagsOf({ '--bogus': true }), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({}), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({ '--hide-title': true, '--show-title': true }), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardEdit('not-an-id', root, flagsOf({ '--title': 'X' }), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({ '--title': 'Two\nlines' }), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({ '--body': '  \n' }), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({}), cap.io, ['title=bad'])).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({}), cap.io, ['off=true'])).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({}), cap.io, ['missingEquals'])).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-10', root, flagsOf({}), cap.io, [], ['next'])).rejects.toThrow(CardUsageError)
    await expect(cardEdit('YAZ-999', root, flagsOf({ '--title': 'X' }), cap.io)).rejects.toThrow(/no card YAZ-999/)
  })
})

describe('cardArchive (YAZ-6156)', () => {
  it('archives and unarchives a card atomically, supporting --json and plain text', async () => {
    const review = '2026-11-12T14:05:31.204Z good'
    const root = await makeVault('v', {
      'deck.md': `---\nid: YAZ-1\n---\n${inlineCard('Front\n---\nBack', `YAZ-11, title "Deck card", ${review}`)}`,
    })
    const deck = path.join(root, 'deck.md')

    const c1 = makeIo()
    await cardArchive('yaz-11', root, flagsOf({ '--json': true }), c1.io)
    expect(JSON.parse(c1.out())).toEqual({ id: 'YAZ-11', page: deck, archived: true })
    expect(await readFile(deck, 'utf8')).toContain(`<!-- card: YAZ-11, title "Deck card", off, ${review} -->`)

    const c2 = makeIo()
    await cardArchive('YAZ-11', root, flagsOf({ '--unarchive': true }), c2.io)
    expect(c2.out()).toBe(`YAZ-11 unarchived (${deck})\n`)
    const after = await readFile(deck, 'utf8')
    expect(after).toContain(`<!-- card: YAZ-11, title "Deck card", ${review} -->`)
    expect(after).not.toContain(', off')
  })

  it('rejects unknown flags, invalid card IDs, and missing cards', async () => {
    const root = await makeVault('v', { 'deck.md': '---\nid: YAZ-1\n---\n' })
    const cap = makeIo()
    await expect(cardArchive('YAZ-11', root, flagsOf({ '--force': true }), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardArchive('bad', root, flagsOf({}), cap.io)).rejects.toThrow(CardUsageError)
    await expect(cardArchive('YAZ-99', root, flagsOf({}), cap.io)).rejects.toThrow(/no card YAZ-99/)
  })
})

describe('cardExtract (YAZ-6156)', () => {
  it('extracts an indented inline card to a standalone card file and preserves exact indent with ![[ID]]', async () => {
    const review = '2026-11-12T14:05:31.204Z good'
    const root = await makeVault('v', {
      'Notes/geo.md': `---\nid: YAZ-1\n---\n- Topic\n${inlineCard('Capital of {{France}}\n---\nParis', `YAZ-10, title "Capital of France", ${review}`, '  ')}\n`,
    })
    const geo = path.join(root, 'Notes/geo.md')
    const expectedCard = path.join(root, 'Notes/capital-of-france-yaz-10.md')

    const cap = makeIo()
    await cardExtract('YAZ-10', root, flagsOf({ '--json': true }), cap.io)
    expect(JSON.parse(cap.out())).toEqual({
      id: 'YAZ-10',
      page: geo,
      card: expectedCard,
      title: 'Capital of France',
    })

    const pageAfter = await readFile(geo, 'utf8')
    expect(pageAfter).toBe('---\nid: YAZ-1\n---\n- Topic\n  ![[YAZ-10]]\n\n')

    const cardAfter = await readFile(expectedCard, 'utf8')
    expect(cardAfter).toBe(`---\nkind: card\n---\n\`\`\`card\nCapital of {{France}}\n---\nParis\n\`\`\`\n<!-- card: YAZ-10, title "Capital of France", ${review} -->\n`)
  })

  it('extracts into --to <dir> and refuses standalone card files, collisions, or invalid --to folders', async () => {
    const root = await makeVault('v', {
      'geo.md': `---\nid: YAZ-1\n---\n${inlineCard('Q\n---\nA', 'YAZ-10, title "River"')}`,
      'Cards/.keep': '',
      'own-yaz-11.md': `---\nkind: card\n---\n${inlineCard('Solo', 'YAZ-11, title "Solo"')}`,
      '.trash/.keep': '',
    })
    const cardsDir = path.join(root, 'Cards')

    // Refuses already-standalone card file.
    await expect(cardExtract('YAZ-11', root, flagsOf({}), makeIo().io)).rejects.toThrow(/already a standalone card file/)

    // Refuses hidden folder.
    await expect(cardExtract('YAZ-10', root, flagsOf({ '--to': path.join(root, '.trash') }), makeIo().io)).rejects.toThrow(/not a folder the vault shows/)

    // Refuses missing folder.
    await expect(cardExtract('YAZ-10', root, flagsOf({ '--to': path.join(root, 'Nope') }), makeIo().io)).rejects.toThrow(/no folder/)

    // Extracts to Cards/ with plain text output.
    const cap = makeIo()
    await cardExtract('YAZ-10', root, flagsOf({ '--to': cardsDir }), cap.io)
    const dest = path.join(cardsDir, 'river-yaz-10.md')
    expect(cap.out()).toBe(`extracted YAZ-10 to ${dest}\n`)
    expect(await readFile(dest, 'utf8')).toContain('<!-- card: YAZ-10, title "River" -->')
    expect(await readFile(path.join(root, 'geo.md'), 'utf8')).toContain('![[YAZ-10]]')
  })

  it('refuses when destination card file already exists and leaves the page untouched', async () => {
    const pageContent = `---\nid: YAZ-1\n---\n${inlineCard('Q', 'YAZ-10, title "Taken"')}`
    const root = await makeVault('v', {
      'geo.md': pageContent,
      'taken-yaz-10.md': 'Existing.\n',
    })
    await expect(cardExtract('YAZ-10', root, flagsOf({}), makeIo().io)).rejects.toThrow(/is already there/)
    expect(await readFile(path.join(root, 'geo.md'), 'utf8')).toBe(pageContent)
    expect(await readFile(path.join(root, 'taken-yaz-10.md'), 'utf8')).toBe('Existing.\n')
  })
})

describe('cardInline (YAZ-6156)', () => {
  it('inlines a standalone card file at its indented embed, migrates comments, and moves old file to .trash', async () => {
    const root = await makeVault('v', {
      'geo.md': [
        '---',
        'id: YAZ-1',
        'comments:',
        '  - id: c1',
        '    n: 1',
        '    at: 2026-11-10T10:00:00.000Z',
        '    by: yaseen',
        '    body: Page comment',
        '---',
        '- Section',
        '  ![[YAZ-10]]',
        '',
      ].join('\n'),
      'Cards/capital-of-france-yaz-10.md': [
        '---',
        'kind: card',
        'comments:',
        '  - id: c2',
        '    n: 1',
        '    at: 2026-11-11T10:00:00.000Z',
        '    by: agent',
        '    body: Card comment',
        '---',
        '```card',
        'Capital of {{France}}',
        '---',
        'Paris',
        '```',
        '<!-- card: YAZ-10, title "Capital of France", 2026-11-12T14:05:31.204Z good -->',
        '',
      ].join('\n'),
    })
    const geo = path.join(root, 'geo.md')
    const cardPath = path.join(root, 'Cards/capital-of-france-yaz-10.md')

    const cap = makeIo()
    await cardInline('YAZ-10', geo, flagsOf({ '--json': true }), cap.io)
    expect(JSON.parse(cap.out())).toEqual({ id: 'YAZ-10', page: geo, trashed: cardPath })

    const pageAfter = await readFile(geo, 'utf8')
    expect(pageAfter).not.toContain('![[YAZ-10]]')
    expect(pageAfter).toContain('  ```card\n  Capital of {{France}}\n  ---\n  Paris\n  ```\n  <!-- card: YAZ-10, title "Capital of France", 2026-11-12T14:05:31.204Z good -->')
    expect(pageAfter).toContain('Page comment')
    expect(pageAfter).toContain('Card comment')
    expect(pageAfter).toContain('n: 2')

    // Old card file is moved to <vault>/.trash/ (never rm'd).
    expect(await readdir(path.join(root, 'Cards'))).toEqual([])
    const trashedFiles = await readdir(path.join(root, '.trash'))
    expect(trashedFiles).toEqual(['capital-of-france-yaz-10.md'])
    expect(await readFile(path.join(root, '.trash/capital-of-france-yaz-10.md'), 'utf8')).toContain('Card comment')
  })

  it('matches embeds by basename without .md and by vault-relative path', async () => {
    const root = await makeVault('v', {
      'page1.md': '---\nid: YAZ-1\n---\n![[river-yaz-10]]\n',
      'page2.md': '---\nid: YAZ-2\n---\n![[Cards/lake-yaz-11]]\n',
      'Cards/river-yaz-10.md': `---\nkind: card\n---\n${inlineCard('Nile', 'YAZ-10, title "River"')}`,
      'Cards/lake-yaz-11.md': `---\nkind: card\n---\n${inlineCard('Baikal', 'YAZ-11, title "Lake"')}`,
    })

    const c1 = makeIo()
    await cardInline('YAZ-10', path.join(root, 'page1.md'), flagsOf({}), c1.io)
    expect(c1.out()).toBe(`inlined YAZ-10 into ${path.join(root, 'page1.md')} (trashed ${path.join(root, 'Cards/river-yaz-10.md')})\n`)
    expect(await readFile(path.join(root, 'page1.md'), 'utf8')).toContain('<!-- card: YAZ-10, title "River" -->')

    await cardInline('YAZ-11', path.join(root, 'page2.md'), flagsOf({}), makeIo().io)
    expect(await readFile(path.join(root, 'page2.md'), 'utf8')).toContain('<!-- card: YAZ-11, title "Lake" -->')
  })

  it('refuses when frontmatter keys would be lost unless --force is passed', async () => {
    const cardContent = `---\nkind: card\nsource: Wikipedia\ncustom_flag: true\n---\n${inlineCard('Q\n---\nA', 'YAZ-10, title "Extra"')}`
    const root = await makeVault('v', {
      'geo.md': '---\nid: YAZ-1\n---\n![[YAZ-10]]\n',
      'extra-yaz-10.md': cardContent,
    })
    const geo = path.join(root, 'geo.md')
    const cardPath = path.join(root, 'extra-yaz-10.md')

    // Refused without --force, listing the keys that would be lost.
    await expect(cardInline('YAZ-10', geo, flagsOf({}), makeIo().io)).rejects.toThrow(/source, custom_flag/)
    expect(await readFile(geo, 'utf8')).toBe('---\nid: YAZ-1\n---\n![[YAZ-10]]\n')
    expect(await readFile(cardPath, 'utf8')).toBe(cardContent)

    // Succeeds with --force and moves file to .trash.
    const cap = makeIo()
    await cardInline('YAZ-10', geo, flagsOf({ '--force': true, '--json': true }), cap.io)
    expect(JSON.parse(cap.out())).toEqual({ id: 'YAZ-10', page: geo, trashed: cardPath })
    expect(await readFile(geo, 'utf8')).toContain('<!-- card: YAZ-10, title "Extra" -->')
    expect(await readdir(path.join(root, '.trash'))).toEqual(['extra-yaz-10.md'])
  })

  it('refuses inline cards (not standalone), missing embed, and bad usage', async () => {
    const root = await makeVault('v', {
      'geo.md': `---\nid: YAZ-1\n---\n${inlineCard('Inline', 'YAZ-10')}`,
      'other.md': '---\nid: YAZ-2\n---\nNo embed here.\n',
      'solo-yaz-11.md': `---\nkind: card\n---\n${inlineCard('Solo', 'YAZ-11, title "Solo"')}`,
    })
    await expect(cardInline('YAZ-10', path.join(root, 'other.md'), flagsOf({}), makeIo().io)).rejects.toThrow(/not a standalone card file/)
    await expect(cardInline('YAZ-11', path.join(root, 'other.md'), flagsOf({}), makeIo().io)).rejects.toThrow(/no lone embed/)
    await expect(cardInline('bad', path.join(root, 'other.md'), flagsOf({}), makeIo().io)).rejects.toThrow(CardUsageError)
    await expect(cardInline('YAZ-11', path.join(root, 'other.md'), flagsOf({ '--bogus': true }), makeIo().io)).rejects.toThrow(CardUsageError)
  })

  it('handles .trash name collisions without overwriting an existing trashed file', async () => {
    const root = await makeVault('v', {
      'geo.md': '---\nid: YAZ-1\n---\n![[yaz-10]]\n',
      'clash-yaz-10.md': `---\nkind: card\n---\n${inlineCard('Fresh', 'YAZ-10, title "Clash"')}`,
      '.trash/clash-yaz-10.md': 'Earlier trashed copy.\n',
    })
    await cardInline('YAZ-10', path.join(root, 'geo.md'), flagsOf({}), makeIo().io)
    const trashed = (await readdir(path.join(root, '.trash'))).sort()
    expect(trashed).toHaveLength(2)
    expect(await readFile(path.join(root, '.trash/clash-yaz-10.md'), 'utf8')).toBe('Earlier trashed copy.\n')
    const newer = trashed.find((f) => f !== 'clash-yaz-10.md')!
    expect(await readFile(path.join(root, '.trash', newer), 'utf8')).toContain('Fresh')
  })
})

describe('Electron-free guarantee', () => {
  it('nothing cardCommands.ts reaches imports electron', () => {
    const seen = new Set<string>()
    const walkImports = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
        const spec = m[1]
        expect(spec, `${path.relative(process.cwd(), file)} imports ${spec}`).not.toBe('electron')
        if (spec.startsWith('.')) walkImports(`${path.resolve(path.dirname(file), spec)}.ts`)
      }
    }
    walkImports(path.resolve(__dirname, 'cardCommands.ts'))
    expect(seen.size).toBeGreaterThan(3)
  })
})
