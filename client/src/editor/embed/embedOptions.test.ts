import { describe, expect, it } from 'vitest'
import { formatEmbedOptions, isBoardTarget, movedEnough, newEmbed, newEmbedAlt, optionsSuffix, parseEmbedOptions, splitEmbed, type EmbedOptions } from '@shared/embedOptions'
import { rewriteBodyLinks } from '@shared/linkRewrite'

const base: EmbedOptions = { width: 640, height: 360, view: { x: 120, y: -40, zoom: 0.8 }, locked: false, page: null, rest: [] }

describe('embed options (YAZ-4820 1A)', () => {
  it('reads every word and writes the same text back', () => {
    const text = '640x360 view=120,-40,0.8 locked page=R2lE'
    const parsed = parseEmbedOptions(text)
    expect(parsed).toEqual({ ...base, locked: true, page: 'R2lE' })
    expect(formatEmbedOptions(parsed!)).toBe(text)
    expect(parseEmbedOptions(formatEmbedOptions(parsed!))).toEqual(parsed)
  })

  it('is no options for a plain alias, a bad size or a zero size', () => {
    expect(parseEmbedOptions('the plan')).toBeNull()
    expect(parseEmbedOptions('640x')).toBeNull()
    expect(parseEmbedOptions('0x360')).toBeNull()
    expect(parseEmbedOptions('640x0')).toBeNull()
    expect(parseEmbedOptions('0')).toBeNull()
    expect(parseEmbedOptions('')).toBeNull()
  })

  it('reads Obsidian`s width alone (`|300`, A7): the height is the board`s, and it writes back as it was', () => {
    const parsed = parseEmbedOptions('300')
    expect(parsed).toEqual({ width: 300, height: null, view: null, locked: false, page: null, rest: [] })
    expect(formatEmbedOptions(parsed!)).toBe('300')
    expect(formatEmbedOptions(parseEmbedOptions('300 locked')!)).toBe('300 locked')
    // The first write with a height keeps the user's width.
    expect(formatEmbedOptions({ ...parsed!, height: 169, view: { x: 1, y: 2, zoom: 1 } })).toBe('300x169 view=1,2,1')
  })

  it('a new embed`s `locked` alone (YAZ-2571 round 7): no size, so the window takes its own; it writes back as it was', () => {
    expect(parseEmbedOptions('locked')).toEqual({ width: null, height: null, view: null, locked: true, page: null, rest: [] })
    expect(formatEmbedOptions(parseEmbedOptions('locked')!)).toBe('locked')
    expect(splitEmbed('CloudFront.drawio|locked')).toEqual({ target: 'CloudFront.drawio', options: 'locked' })
    expect(splitEmbed('CloudFront.drawio|My name|locked')).toEqual({ target: 'CloudFront.drawio', options: 'locked' })
    // An alias that only starts with one of our words stays an alias.
    expect(parseEmbedOptions('locked door')).toBeNull()
    expect(newEmbed('CloudFront.drawio')).toBe('![[CloudFront.drawio|locked]]')
    expect(newEmbed('EMB-40')).toBe('![[EMB-40|locked]]')
    expect(newEmbedAlt('CloudFront')).toBe('CloudFront|locked')
    // The first write with a size keeps the lock.
    expect(formatEmbedOptions({ ...parseEmbedOptions('locked')!, width: 700, height: 394 })).toBe('700x394 locked')
  })

  it('keeps a word it does not know, in its place after ours', () => {
    const parsed = parseEmbedOptions('640x360 grid=on view=1,2,1 shadow')
    expect(parsed?.rest).toEqual(['grid=on', 'shadow'])
    expect(formatEmbedOptions(parsed!)).toBe('640x360 view=1,2,1 grid=on shadow')
  })

  it('ignores a broken view and keeps the size', () => {
    expect(parseEmbedOptions('640x360 view=1,2')?.view).toBeNull()
    expect(parseEmbedOptions('640x360 view=a,b,c')?.view).toBeNull()
    expect(parseEmbedOptions('640x360 view=1,2,0')?.view).toBeNull()
  })

  it('rounds the view it writes: whole units, zoom to 2 decimals', () => {
    expect(formatEmbedOptions({ ...base, view: { x: 120.6, y: -40.4, zoom: 0.8333 } })).toBe('640x360 view=121,-40,0.83')
  })

  it('splits an embed into its target and options', () => {
    expect(splitEmbed('CloudFront.drawio|640x360 locked')).toEqual({ target: 'CloudFront.drawio', options: '640x360 locked' })
    expect(splitEmbed(' Sketch.excalidraw ')).toEqual({ target: 'Sketch.excalidraw', options: null })
    expect(optionsSuffix(base)).toBe('|640x360 view=120,-40,0.8')
  })

  it('knows a board by its extension, in any case', () => {
    expect(isBoardTarget('a/B.DRAWIO')).toBe(true)
    expect(isBoardTarget('Sketch.excalidraw')).toBe(true)
    expect(isBoardTarget('photo.png')).toBe(false)
    expect(isBoardTarget('Page')).toBe(false)
  })

  it('writes only after a real move: more than 4 px or 2% zoom (item 18)', () => {
    expect(movedEnough(null, base)).toBe(true)
    expect(movedEnough(base, { ...base, view: { x: 124, y: -40, zoom: 0.8 } })).toBe(false) // 4 units × 0.8 = 3.2 px
    expect(movedEnough(base, { ...base, view: { x: 126, y: -40, zoom: 0.8 } })).toBe(true) // 4.8 px
    expect(movedEnough(base, { ...base, view: { x: 120, y: -40, zoom: 0.81 } })).toBe(false)
    expect(movedEnough(base, { ...base, view: { x: 120, y: -40, zoom: 0.83 } })).toBe(true)
    expect(movedEnough(base, { ...base, width: 641 })).toBe(true)
    expect(movedEnough(base, { ...base, locked: true })).toBe(true)
  })

  it('a rename keeps the options of an embed', () => {
    const body = 'See ![[Old.drawio|640x360 view=1,2,1 locked]] and [[Old.drawio]].'
    const out = rewriteBodyLinks(body, (t) => t === 'Old.drawio', () => 'New.drawio')
    expect(out).toBe('See ![[New.drawio|640x360 view=1,2,1 locked]] and [[New.drawio]].')
  })
})
