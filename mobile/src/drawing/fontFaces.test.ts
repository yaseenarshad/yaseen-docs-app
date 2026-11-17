// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { engineFontFiles } from './engineFonts.testing'
import { FONT_FILES } from './engine/fontFiles'
import { facesFor, fontFaceCss, parseRange, textUse } from './fontFaces'

describe('the drawing fonts of the phone (YAZ-5440)', () => {
  it('the table is the engine`s own list of font files (the CJK fallback and the local fonts left out)', () => {
    const engine = engineFontFiles()
    expect(FONT_FILES, `the engine's fonts changed; the new table:\n${engine.map((f) => JSON.stringify(f)).join('\n')}`).toEqual(engine)
    expect(FONT_FILES.some((f) => f.family === 'Excalifont')).toBe(true)
    expect(FONT_FILES.some((f) => /Xiaolai/.test(f.file))).toBe(false)
  })

  it('a range reads as code points; the faces are the ones the text needs, in its weight', () => {
    expect(parseRange('U+20-7e, U+a0,U+4??')).toEqual([[0x20, 0x7e], [0xa0, 0xa0], [0x400, 0x4ff]])
    const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Excalifont, Xiaolai, sans-serif">Beans</text><text font-family="Nunito">Ж</text></svg>', 'image/svg+xml').documentElement
    const faces = facesFor(textUse(svg), FONT_FILES)
    // Latin Excalifont only (not its Cyrillic or Greek files); Nunito's Cyrillic file in its one weight (500).
    expect(faces.map((f) => f.file)).toEqual(['Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2', 'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTA3j6zbXWjgevT5.woff2'])
    expect(fontFaceCss(faces[0], 'data:font/woff2;base64,AA')).toMatch(/^@font-face \{ font-family: "Excalifont"; src: url\(data:font\/woff2;base64,AA\); .*unicode-range: U\+20-7e/)
  })
})
