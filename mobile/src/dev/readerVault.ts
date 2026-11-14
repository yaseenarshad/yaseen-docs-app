import { saveAccount } from '../auth/account'
import { saveVaultList, vaultId, type PhoneVault, type TokenStore, type VaultStore } from '../store'
import { gitBlobSha } from '../sync/gitSha'
import { INDEX_STATE, phoneRecord, type PhoneIndex } from '../sync/phoneIndex'

/**
 * A made-up vault for the reader (4C, YAZ-5079): the tests and the screen fixtures put it on a phone as 3B would leave it
 * after a first download (the files, the checkpoint, the index). No real vault, no network. Only tests and the
 * `--mode fixtures` build reach this file.
 */

export const READER_VAULT: PhoneVault = { repo: 'yaseen/vault', branch: 'main', addedAt: 1 }
export const READER_ID = vaultId(READER_VAULT)
export const READER_TOKEN = 'github_pat_11READER00' + 'r'.repeat(72)

/** One card block with its line, as the Mac writes it. */
export const cardBlock = (id: string, body: string, line: string[] = []) => `\`\`\`card\n${body}\n\`\`\`\n<!-- card: ${[id, ...line].join(', ')} -->`

/** A made-up picture: 96 × 54, a sun over a hill. */
export const SUN_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAIAAAC3LQuFAAABSUlEQVR42u3QXyvDcRzF8fMQXXskkiRJ0pIkSZIkaWZmZmZmZoaf/x7FeRCuXPxuNPXZvp/t5rNOva7PqTdmihQDZk8oBsyVKAbMn1IMWChTDFg8oxiwVKEYsHxOMWClSjFg9YIT4yeb+mssmyjUGF1fl/9GGcfaJUMbWCfn3sd6nXENWSfnu8DGFYNKqpNzvGCzwaAcgRwv2LpmUI5AjhdsNxmRo04u9Qg7N4zIHSj1CLstRuQOlHqEvVtG5A6UeoT9NiNyB0o9wsEdg3LUcbzgsMOgHIEcLzi6Z1COQI4XHHcZV1Id3wWKDwxtyDrufZR6jG5gnVHGUX7kxOjrMpZNVJ4oBlSfKQbUMooB9ReKAY1XigHNN4oBrXeKAe0PigGdT4oB3S+KAb1vigFZYVoMCqRACqRACqRACqRACiQKpEAKpEAKFM0vgV0627niZ7gAAAAASUVORK5CYII='), (c) => c.charCodeAt(0))

const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`

export const READER_FILES: Record<string, string | Uint8Array> = {
  'Spanish words.md': page(
    'title: Spanish words\nid: DEMO-1\naliases: [Español]\n',
    [
      '# Spanish words',
      'Words for a trip to **Madrid** in May. See [[Trip plan]] and [[Git cheat sheet|the git notes]].',
      '## Places',
      '- [x] Book the train\n- [ ] Learn the numbers\n- Museums\n  - El Prado',
      '| Spanish | English |\n| --- | --- |\n| la biblioteca | the library |\n| el tren | the train |',
      cardBlock('DEMO-12', 'la biblioteca\n---\nthe library', ['2026-11-01T10:00Z good', '2026-11-04T09:30Z good']),
      '> [!tip] Good to know\n> Shops close from 2 to 5 pm.',
      '> Un poco cada día.',
      '![The plaza at noon](assets/plaza.png)',
      '![[assets/sun.png]]',
      'From the card file:',
      '![[DEMO-40]]',
      '![[DEMO-77]]',
      '```sh\ngit pull --rebase\n```',
      'Read the [[Guide.pdf]], or [the web page](https://example.com/madrid). A link to [[Nowhere yet]].',
      '<script>window.readerRan = 1</script><img src="x.png" onerror="window.readerRan = 2">',
    ].join('\n\n'),
  ),
  'git/Git cheat sheet.md': page('title: Git cheat sheet\nid: DEMO-2\n', `Short notes.\n\n${cardBlock('DEMO-38', 'git pull\n---\nFetch and merge')}`),
  'Trip plan.md': page('title: Trip plan\nid: DEMO-3\n', 'Madrid, May 3 to 10.\n\n1. Pack\n2. Fly\n\nBack to [[Spanish words]].'),
  'Café notes.md': page('title: Café notes\nid: DEMO-4\n', 'Über straße 🙂'),
  'cards/capital-of-spain-demo-40.md': page('kind: card\ntitle: Capital of Spain\n', cardBlock('DEMO-40', 'Madrid\n---\nOn the Manzanares river.', ['2026-10-20T08:00Z good', '2026-10-24T08:00Z good', '2026-11-02T08:00Z hard'])),
  'cards/two-cards-demo-41.md': page('kind: card\ntitle: Two cards in one\n', `${cardBlock('DEMO-41', 'One')}\n\n${cardBlock('DEMO-42', 'Two')}`),
  '.yaseendocs/review.json': '{"enabled": true}',
  '.yaseendocs/ids.json': '{"enabled": true, "letters": "DEMO"}',
  'assets/sun.png': SUN_PNG,
  'docs/Guide.pdf': new TextEncoder().encode('%PDF-1.4 made up'),
}

/** Files of the vault that are NOT on the phone (3D brings them later): the checkpoint names them all the same. */
export const READER_NOT_STORED: Record<string, Uint8Array> = { 'assets/plaza.png': SUN_PNG }

/** Puts `files` on the phone as a finished first download: the files, the index, then the checkpoint (3B's order). */
export async function seedReaderVault(
  store: VaultStore,
  tokens: TokenStore,
  files: Record<string, string | Uint8Array> = READER_FILES,
  notStored: Record<string, Uint8Array> = READER_NOT_STORED,
  commit = 'c0ffee',
): Promise<void> {
  await tokens.write(READER_ID, READER_TOKEN)
  await saveAccount(store, READER_ID, { login: 'demo', name: 'Demo Person', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
  await saveVaultList(store, { vaults: [READER_VAULT], open: READER_ID })
  await writeVaultFiles(store, files, notStored, commit)
}

/** The files, the index and the checkpoint of a new commit (a pass that brought `files`). Returns the index. */
export async function writeVaultFiles(store: VaultStore, files: Record<string, string | Uint8Array>, notStored: Record<string, Uint8Array> = {}, commit = 'c0ffee'): Promise<PhoneIndex> {
  const shas: Record<string, string> = {}
  const records: PhoneIndex['records'] = {}
  for (const [path, content] of Object.entries(files)) {
    await store.write(READER_ID, path, content)
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    shas[path] = await gitBlobSha(bytes)
    if (/\.md$/.test(path) && !path.startsWith('.')) records[path] = phoneRecord(path, bytes.length, typeof content === 'string' ? content : null, { ctime: 1, mtime: 1 })
  }
  for (const [path, bytes] of Object.entries(notStored)) shas[path] = await gitBlobSha(bytes)
  const index: PhoneIndex = { commit, records }
  await store.setState(READER_ID, INDEX_STATE, index)
  await store.setCheckpoint(READER_ID, { commit, etag: null, shas })
  return index
}
