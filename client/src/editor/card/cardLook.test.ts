/**
 * `cardLook` (YAZ-5153, 2A1): a card's look in a vault, from an editor-free file. The desktop's pictures and sounds are
 * `app://vault/…` URLs (`imageSrc`); another host (the phone) gives its own way to turn a vault path into a URL.
 */
import { describe, expect, it } from 'vitest'
import { cardLook } from './cardLook'
import { renderCard } from './cardRender'
import { createWikilinkResolveSource } from '../wikilink/linkResolve'
import { imageSrc } from '../image/imageSrc'

describe('cardLook (YAZ-5153)', () => {
  it('the desktop: a picture and a sound load from `app://vault/…`, from the page`s folder', () => {
    const look = cardLook(createWikilinkResolveSource(), undefined, { root: '/v', pagePath: '/v/Bio/Cells.md' })
    expect(look.image?.('img/a b.png')).toBe(imageSrc('/v', 'Bio', 'img/a b.png'))
    expect(look.image?.('img/a b.png')).toMatch(/^app:\/\/vault\//)
  })

  it('another host: its own `src` turns the vault path into the URL, for pictures and sounds alike', () => {
    const asked: string[][] = []
    const src = (root: string, dir: string, ref: string) => {
      asked.push([root, dir, ref])
      return `blob:phone/${dir}/${ref}`
    }
    const look = cardLook(createWikilinkResolveSource(), undefined, { root: '/v', pagePath: '/v/Bio/Cells.md', src })
    const card = renderCard('![pic](img/a.png)\n\n![](sound/b.mp3)', {}, look)
    expect(card.querySelector('img')?.getAttribute('src')).toBe('blob:phone/Bio/img/a.png')
    expect(asked).toContainEqual(['/v', 'Bio', 'img/a.png'])
    expect(asked).toContainEqual(['/v', 'Bio', 'sound/b.mp3'])
  })

  it('links: a found page and a dead link, as the page shows them', () => {
    const source = createWikilinkResolveSource()
    source.update((t) => (t === 'France' ? '/v/France.md' : null), [], [], false, [])
    const look = cardLook(source, undefined)
    expect(look.link?.('France')).toMatchObject({ label: 'France', resolved: true })
    expect(look.link?.('Gone')).toMatchObject({ label: 'Gone', resolved: false })
  })
})
