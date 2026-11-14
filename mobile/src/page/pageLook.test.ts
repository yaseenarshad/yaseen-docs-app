// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { loadVaultData } from '../search/vaultData'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { drawCard } from './pageLook'
import { ATTACK, remoteAttributes, watchWrites } from './testing'

/** YAZ-5209: a card's text on the phone (a page's own card, an embedded card, the card view all draw with `drawCard`). */
describe('a card on the phone fetches nothing from another host (YAZ-5209)', () => {
  it('an attack card: no remote value is ever written or inserted; the final DOM holds none; web media are links', async () => {
    const backend = memoryBackend()
    const store = await openVaultStore(backend)
    await seedReaderVault(store, tokenStoreOn(backend), READER_FILES)
    const data = await loadVaultData(store, READER_ID, 'vault')
    const watch = watchWrites()
    const host = document.createElement('div')
    document.body.append(host)
    try {
      host.append(drawCard(data, 'Spanish words.md', `${ATTACK}\n---\n![[sun.png]] ![vault](assets/sun.png) ![[song.mp3]]`))
    } finally {
      watch.stop()
    }
    expect(watch.remote).toEqual([])
    expect(remoteAttributes(host)).toEqual([])
    // Nothing from the card's text that loads; the app's own sound player (its button and icon) is not from the text.
    const loaders = [...host.querySelectorAll('video, audio, source, track, picture, object, embed, iframe, link, meta, base, svg, form, input, button, [background], [style], [srcset], [poster]')]
    expect(loaders.filter((el) => el.closest('.card__audio') === null).map((el) => el.outerHTML)).toEqual([])
    const web = [...host.querySelectorAll<HTMLAnchorElement>('a.page-media--web')]
    expect(web.map((a) => a.textContent)).toContain('Picture from the web · md picture')
    expect(web.map((a) => a.textContent)).toContain('Sound from the web · md sound')
    expect(web.every((a) => a.target === '_blank' && a.rel === 'noopener noreferrer')).toBe(true)
    // A vault picture waits for 3D's media; no address at all yet.
    expect(host.querySelector('img[data-vault-src="assets/sun.png"]')?.getAttribute('src')).toBeNull()
    host.remove()
  })
})
