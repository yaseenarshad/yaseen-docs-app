import { makeAssetResolver } from '@shared/assetLookup'
import { describe, expect, it } from 'vitest'
import { cardMediaPaths, cardMediaRefs, mediaTarget } from './refs'

describe('the pictures and sounds a card shows, as the Mac draws them (renderCard)', () => {
  it('a Markdown picture, a Markdown sound and a wikilink sound; a wikilink picture stays text on the Mac, so it is not media', () => {
    const text = 'Flag ![the flag|300](assets/flag.png)\n---\n![](audio/fifth.mp3) and ![[chord.m4a|Chord]] and ![[pic.png]] and [[Page]]'
    expect(cardMediaRefs(text)).toEqual(['assets/flag.png', 'audio/fifth.mp3', 'chord.m4a'])
  })

  it('skips a source with a scheme (https:, data:, blob:), and code', () => {
    const text = '![a](https://example.com/x.png) ![b](data:image/png;base64,AAAA) `![c](code.png)`\n\n```\n![d](block.png)\n```\n![e](real.png)'
    expect(cardMediaRefs(text)).toEqual(['real.png'])
  })

  it('reads a hidden word`s picture, a picture in a table and in a list', () => {
    const text = 'Which flag? {{![](flags/fr.png)}}\n\n| a | b |\n| - | - |\n| ![](t.png) | x |\n\n- ![](l.png)'
    expect(cardMediaRefs(text)).toEqual(['flags/fr.png', 't.png', 'l.png'])
  })

  it('file names with spaces, #, % and non-ASCII letters: each part decoded once, as imageSrc does', () => {
    const text = [
      '![](<my pic.png>)',
      '![](my%20other.png)',
      '![](a%23b.png)',
      '![](a#b.png)',
      '![](100%.png)',
      '![](100%25.png)',
      '![](café/größe.png)',
      '![](/root/lead.png)',
      '![[my song #2.mp3]]',
    ].join('\n\n')
    expect(cardMediaRefs(text)).toEqual(['my pic.png', 'my other.png', 'a#b.png', '100%.png', 'café/größe.png', 'root/lead.png'])
  })

  // YAZ-5189 (3D4): DOMPurify's HTML profile keeps an <img>, and the Mac's applyLook gives it the vault URL.
  it('an HTML picture in a card (<img src>), which the Mac shows, is a picture of the card', () => {
    expect(cardMediaRefs('Q <img src="pic.png" width="300">')).toEqual(['pic.png']) // before the fix: []
  })

  it('every <img> the Mac draws: in a block of HTML, with single quotes, with entities, a sound in an <img>; never in code', () => {
    const text = [
      '<p><img alt="a" src=\'one.png\'></p>',
      'Text <img src="a&amp;b.png"/> and <IMG SRC="Up.png">',
      '<img src="sound.mp3">',
      '`<img src="code.png">`',
      '<img src="https://x/y.png"> <img data-src="no.png">',
    ].join('\n\n')
    expect(cardMediaRefs(text)).toEqual(['one.png', 'a&b.png', 'Up.png', 'sound.mp3'])
  })

  it('one picture written twice in a card is one ref', () => {
    expect(cardMediaRefs('![](x.png) ![again](x.png)')).toEqual(['x.png'])
  })

  it('mediaTarget: the vault path part of a source, or null for a scheme', () => {
    expect(mediaTarget('https://x/y.png')).toBeNull()
    expect(mediaTarget('//a/b.png')).toBe('a/b.png')
    expect(mediaTarget('a%20b/c%2Fd.png')).toBe('a b/c/d.png')
  })
})

describe('cardMediaPaths: a card`s files through the shared asset lookup (2B), from the file that HOLDS the card', () => {
  const files = ['topics/flag.png', 'flag.png', 'cards/pics/x.png', 'topics/pics/x.png', 'assets/deep/Bird.PNG', 'my pic.png', 'a#b.png', '100%.png', 'café/größe.png']
  const resolve = makeAssetResolver(files)

  it('a relative link resolves from the holder`s folder first, then the root, then by name anywhere', () => {
    expect(cardMediaPaths('![](flag.png)', 'topics/page.md', resolve)).toEqual(['topics/flag.png'])
    expect(cardMediaPaths('![](flag.png)', 'other/page.md', resolve)).toEqual(['flag.png'])
    expect(cardMediaPaths('![](pics/x.png)', 'cards/a-card.md', resolve)).toEqual(['cards/pics/x.png'])
    expect(cardMediaPaths('![](bird.png)', 'page.md', resolve)).toEqual(['assets/deep/Bird.PNG'])
  })

  it('an embedded card`s link resolves from ITS card file, not from the page that embeds it', () => {
    // The card lives in cards/a-card.md; a page in topics/ embeds it. The holder is the card file.
    expect(cardMediaPaths('![](pics/x.png)', 'cards/a-card.md', resolve)).toEqual(['cards/pics/x.png'])
    expect(cardMediaPaths('![](pics/x.png)', 'topics/page.md', resolve)).toEqual(['topics/pics/x.png'])
  })

  it('names with spaces, #, % and non-ASCII find their file; a link to no file gives nothing', () => {
    expect(cardMediaPaths('![](<my pic.png>) ![](a%23b.png) ![](100%.png) ![](café/größe.png) ![](none.png)', 'p.md', resolve)).toEqual([
      'my pic.png',
      'a#b.png',
      '100%.png',
      'café/größe.png',
    ])
  })
})
