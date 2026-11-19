// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { loadVaultData, type VaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { pageLook } from './pageLook'
import { loadVaultLook } from './vaultLook'
import { renderPage } from './pageRender'

/**
 * YAZ-5792: on the phone, a link to a card follows the vault's link format as on the Mac (`cardPillEnds`, `cardPill`):
 * the card's own ID for `{number}`, the card icon where `{icon}` stands. A piped one (`[[ID|words]]`, YAZ-5835) shows
 * the words with the same pieces. The reader vault's card DEMO-40 is "Capital of Spain".
 */
let data: VaultData

beforeAll(async () => {
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const pills = JSON.stringify({ version: 2, format: '{icon} {name}({number}){mark}' })
  await seedReaderVault(store, tokenStoreOn(backend), { ...READER_FILES, '.yaseendocs/link-pills.json': pills })
  data = await loadVaultData(store, READER_ID, 'vault')
  // The look, read once for the data: it gives the data's link source the vault's format (YAZ-5792), as the app does.
  await loadVaultLook(store, data)
})

const parts = (end: { pieces: readonly { part: string; text?: string }[] } | null | undefined) => end?.pieces.map((p) => (p.text === undefined ? p.part : `${p.part}:${p.text}`)) ?? null

describe('a card link on the phone follows the vault`s link format (YAZ-5792)', () => {
  it('pageLook: the card opens, its ends hold the card`s number, the icon is a piece (`{icon} {name}`)', () => {
    const show = pageLook(data, 'Trip plan.md').link('DEMO-40')
    expect(show.label).toBe('Capital of Spain')
    expect(show.open).toMatchObject({ kind: 'card', id: 'DEMO-40' })
    expect(parts(show.ends?.head)).toEqual(['icon', 'text: '])
    expect(parts(show.ends?.tail)).toEqual(['text:(', 'number:40', 'text:)', 'mark'])
    expect(show.iconOnName).toBe(false)
  })

  it('YAZ-5835: a piped card link shows its words with the card`s pieces, as on the Mac', () => {
    const show = pageLook(data, 'Trip plan.md').link('DEMO-40|Madrid')
    expect(show.label).toBe('Madrid')
    expect(show.open).toMatchObject({ kind: 'card', id: 'DEMO-40' })
    expect(parts(show.ends?.tail)).toEqual(['text:(', 'number:40', 'text:)', 'mark'])
  })

  it('renderPage: the `<a>` holds the Mac`s card pill, the card icon as a piece', async () => {
    const host = document.createElement('div')
    await renderPage('See [[DEMO-40]].', pageLook(data, 'Trip plan.md'), host)
    const a = host.querySelector<HTMLAnchorElement>('a[data-open="card"]')!
    expect(a.className).toBe('page-pill')
    expect(a.textContent).toBe(' Capital of Spain(40)')
    expect(a.querySelector('.link-pill__icon.card-icon')).not.toBeNull()
  })
})
