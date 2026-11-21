import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cardTime } from '@shared/cardLine'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { IDS_FILE } from '@shared/pageId'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR } from '@shared/types'
import { backfillCreated } from './backfillCreated'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-backfill-created-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('backfillCreated (YAZ-6168)', () => {
  it('stamps unstamped pages and card files with birthtimeMs, skips already-stamped, bad YAML, hidden files, .folder.md, and nested ID sub-vaults', async () => {
    const plainPage = path.join(root, 'plain.md')
    const fmPage = path.join(root, 'with-fm.md')
    const alreadyPage = path.join(root, 'already.md')
    const brokenPage = path.join(root, 'broken.md')
    const cardFile = path.join(root, 'card-yaz-1.md')
    const stampedCardFile = path.join(root, 'card-yaz-2.md')
    const hiddenFile = path.join(root, '.hidden.md')
    const folderSettings = path.join(root, FOLDER_SETTINGS_FILE)
    const nestedDir = path.join(root, 'subvault')
    const nestedPage = path.join(nestedDir, 'nested.md')

    await writeFile(plainPage, '# Hello\n\nBody.\n')
    await writeFile(fmPage, '---\nid: YAZ-1\ntitle: Note\n---\nBody.\n')
    await writeFile(alreadyPage, '---\nid: YAZ-2\ncreated: 2024-01-01T00:00:00.000Z\n---\nKeep me.\n')
    await writeFile(brokenPage, '---\nstatus: [unclosed\n---\nBroken.\n')
    await writeFile(cardFile, '---\nkind: card\n---\n```card\nQ?\n---\nA\n```\n<!-- card: YAZ-1, title "Q" -->\n')
    await writeFile(stampedCardFile, '---\nkind: card\n---\n```card\nQ2?\n---\nA2\n```\n<!-- card: YAZ-2, created 2024-05-05T10:00:00.000Z, title "Q2" -->\n')
    await writeFile(hiddenFile, '---\nid: YAZ-9\n---\nHidden.\n')
    await writeFile(folderSettings, '---\nid: YAZ-10\n---\n')
    await mkdir(path.join(nestedDir, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(path.join(nestedDir, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify({ enabled: true, letters: 'SUB' }))
    await writeFile(nestedPage, '---\nid: SUB-1\n---\nOwned by subvault.\n')

    const plainBirth = cardTime((await stat(plainPage)).birthtimeMs)
    const cardBirth = cardTime((await stat(cardFile)).birthtimeMs)

    const res = await backfillCreated(root)
    expect(res).toEqual({ written: 3, skipped: 3 })

    // Plain page gained frontmatter with `created:` matching its birthtime
    const plainAfter = await readFile(plainPage, 'utf8')
    expect(parseFrontmatter(splitFrontmatter(plainAfter).frontmatter).properties.created).toBe(plainBirth)
    expect(splitFrontmatter(plainAfter).body).toBe('# Hello\n\nBody.\n')

    // Page with existing frontmatter kept its properties and gained `created:`
    const fmProps = parseFrontmatter(splitFrontmatter(await readFile(fmPage, 'utf8')).frontmatter).properties
    expect(fmProps.id).toBe('YAZ-1')
    expect(fmProps.title).toBe('Note')
    expect(String(fmProps.created)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

    // Card file gained `created <iso>` right after its card ID on the card line
    expect(await readFile(cardFile, 'utf8')).toBe(
      `---\nkind: card\n---\n\`\`\`card\nQ?\n---\nA\n\`\`\`\n<!-- card: YAZ-1, created ${cardBirth}, title "Q" -->\n`,
    )

    // Skipped files remain untouched
    expect(await readFile(alreadyPage, 'utf8')).toBe('---\nid: YAZ-2\ncreated: 2024-01-01T00:00:00.000Z\n---\nKeep me.\n')
    expect(await readFile(brokenPage, 'utf8')).toBe('---\nstatus: [unclosed\n---\nBroken.\n')
    expect(await readFile(stampedCardFile, 'utf8')).toBe(
      '---\nkind: card\n---\n```card\nQ2?\n---\nA2\n```\n<!-- card: YAZ-2, created 2024-05-05T10:00:00.000Z, title "Q2" -->\n',
    )
    expect(await readFile(hiddenFile, 'utf8')).toBe('---\nid: YAZ-9\n---\nHidden.\n')
    expect(await readFile(folderSettings, 'utf8')).toBe('---\nid: YAZ-10\n---\n')
    expect(await readFile(nestedPage, 'utf8')).toBe('---\nid: SUB-1\n---\nOwned by subvault.\n')

    // Second run is idempotent
    expect(await backfillCreated(root)).toEqual({ written: 0, skipped: 6 })
  })
})
