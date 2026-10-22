import { describe, expect, it } from 'vitest'
import { BOARD_META_KEY, parseBoardMetaBlock, serializeBoard, stampBoardMetaScene } from '@shared/drawingAssets'
import { DIAGRAM_CREATED_ATTR, DIAGRAM_UPDATED_ATTR, diagramDocumentError, parseDiagramMetaAttrs, stampDiagramMeta } from '@shared/diagramFile'
import { DIAGRAM_READ_ONLY_ATTR, isDiagramReadOnly, isDrawingReadOnly, isNoteReadOnly, READ_ONLY_KEY, setDiagramReadOnly, setNoteReadOnly, withDrawingReadOnly } from '@shared/readOnly'

/**
 * The read-only switch IN the file (YAZ-3076 D1), for the three formats: set, clear, read, and a
 * file with no entry. The cases are YAZ-3113's S1-S8 and S11; the door around them is `boardReadOnly.test.ts`.
 */

describe('a note: `readonly: true` in the frontmatter', () => {
  const NOTE = '---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\n---\n# Body\n\ntext\n'

  it('S1: no frontmatter, no key, or no block at all is editable', () => {
    expect(isNoteReadOnly('# Body\n')).toBe(false)
    expect(isNoteReadOnly(NOTE)).toBe(false)
    expect(isNoteReadOnly('---\n---\nbody')).toBe(false)
    expect(isNoteReadOnly('')).toBe(false)
  })

  it('S8: only the value `true` counts', () => {
    expect(isNoteReadOnly('---\nreadonly: true\n---\n')).toBe(true)
    for (const value of ['"yes"', '1', '"true"', 'false', 'yes', '']) expect(isNoteReadOnly(`---\nreadonly: ${value}\n---\n`), value).toBe(false)
    // The word in the body, or under another key, is not the switch.
    expect(isNoteReadOnly('---\nnote: readonly\n---\nreadonly: true\n')).toBe(false)
    // A block that does not parse is editable: the switch is never guessed.
    expect(isNoteReadOnly('---\nreadonly: true\n  bad: [\n---\n')).toBe(false)
  })

  it('S2: on writes the key; every other key, the order, the comment and the body stay byte for byte', () => {
    const on = setNoteReadOnly(NOTE, true)
    expect(on).toBe('---\n# the owner\'s comment\ntags: [a, b]\nstatus: "draft"\nreadonly: true\n---\n# Body\n\ntext\n')
    expect(isNoteReadOnly(on)).toBe(true)
  })

  it('S3: off removes the key and never writes `false`', () => {
    const off = setNoteReadOnly(setNoteReadOnly(NOTE, true), false)
    expect(off).toBe(NOTE)
    expect(off).not.toContain(READ_ONLY_KEY)
  })

  it('S4: a note with no frontmatter grows a block of only the switch, and off gives back the same bytes', () => {
    const plain = '# Body\n\ntext\n'
    const on = setNoteReadOnly(plain, true)
    expect(on).toBe('---\nreadonly: true\n---\n# Body\n\ntext\n')
    expect(setNoteReadOnly(on, false)).toBe(plain)
    // CRLF and a `...` terminator keep their frame.
    const crlf = '---\r\na: 1\r\n...\r\nbody'
    expect(setNoteReadOnly(setNoteReadOnly(crlf, true), false)).toBe(crlf)
  })

  it('S8: on over a wrong value writes the correct one; off removes a wrong one too', () => {
    expect(setNoteReadOnly('---\nreadonly: "yes"\n---\nx', true)).toBe('---\nreadonly: true\n---\nx')
    expect(setNoteReadOnly('---\na: 1\nreadonly: 1\n---\nx', false)).toBe('---\na: 1\n---\nx')
  })

  it('S11: the same value again returns the SAME string, so `transformFile` writes nothing', () => {
    const on = setNoteReadOnly(NOTE, true)
    expect(setNoteReadOnly(on, true)).toBe(on)
    expect(setNoteReadOnly(NOTE, false)).toBe(NOTE)
    expect(setNoteReadOnly('# no block\n', false)).toBe('# no block\n')
  })
})

describe('a drawing: `"readonly": true` in the `yaseendraw` block', () => {
  const block = { createdAt: 1000, updatedAt: 2000, cloudId: 'x' }
  const scene = (meta?: unknown): Record<string, unknown> => ({ ...(meta === undefined ? {} : { [BOARD_META_KEY]: meta }), type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [{ id: 'a' }], appState: { viewBackgroundColor: '#fff' }, files: {} })

  it('S1 and S8: no block, no key, or any value but `true` is editable', () => {
    expect(isDrawingReadOnly(scene())).toBe(false)
    expect(isDrawingReadOnly(scene(block))).toBe(false)
    for (const value of ['yes', 1, 'true', false, null]) expect(isDrawingReadOnly(scene({ ...block, readonly: value })), String(value)).toBe(false)
    expect(isDrawingReadOnly(scene('not a block'))).toBe(false)
    expect(isDrawingReadOnly(scene({ ...block, readonly: true }))).toBe(true)
    // Only the block counts: a top-level key of the same name is not the switch.
    expect(isDrawingReadOnly({ ...scene(block), readonly: true })).toBe(false)
  })

  it('S5: on writes the key in the block; every other key of the block and of the file stays', () => {
    const on = withDrawingReadOnly(scene(block), true, 5)
    expect(on).toEqual(scene({ ...block, readonly: true }))
    expect(Object.keys(on)[0]).toBe(BOARD_META_KEY)
    expect(isDrawingReadOnly(on)).toBe(true)
  })

  it('S5: off removes the key, and on then off gives back the same bytes', () => {
    const before = serializeBoard(scene(block))
    const on = withDrawingReadOnly(scene(block), true, 5)
    const off = withDrawingReadOnly(on, false, 5)
    expect(serializeBoard(off)).toBe(before)
    expect(JSON.stringify(off)).not.toContain(READ_ONLY_KEY)
  })

  it('a board with no block gets one FIRST, dated by the file, so the save door keeps the switch', () => {
    const on = withDrawingReadOnly(scene(), true, 7000)
    expect(Object.keys(on)[0]).toBe(BOARD_META_KEY)
    expect(on[BOARD_META_KEY]).toEqual({ createdAt: 7000, updatedAt: 7000, readonly: true })
    // The tree and the save door read the block off the head: it must parse there, extras and all.
    const head = serializeBoard(on).slice(0, 1024)
    expect(parseBoardMetaBlock(head)).toEqual({ createdAt: 7000, updatedAt: 7000, readonly: true })
    // The next save of the board (YAZ-1834 D5) carries the switch forward, in the same place.
    const saved = stampBoardMetaScene(scene(), { createdAt: 1, updatedAt: 9000 }, parseBoardMetaBlock(head))
    expect(saved[BOARD_META_KEY]).toEqual({ createdAt: 7000, updatedAt: 9000, readonly: true })
  })

  it('off of a block that held only the switch drops the block', () => {
    const off = withDrawingReadOnly(scene({ readonly: true }), false, 5)
    expect(off).toEqual(scene())
  })

  it('S8: on over a wrong value writes `true`', () => {
    expect(withDrawingReadOnly(scene({ ...block, readonly: 'yes' }), true, 5)[BOARD_META_KEY]).toEqual({ ...block, readonly: true })
  })

  it('S11: the same value again returns the SAME object, so the door writes nothing', () => {
    const on = scene({ ...block, readonly: true })
    expect(withDrawingReadOnly(on, true, 5)).toBe(on)
    const off = scene(block)
    expect(withDrawingReadOnly(off, false, 5)).toBe(off)
    const bare = scene()
    expect(withDrawingReadOnly(bare, false, 5)).toBe(bare)
  })
})

describe('a diagram: `yaseendraw-readonly="1"` on `<mxfile>`', () => {
  const PAGE = '<diagram id="p" name="Page-1"><mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram>'
  const file = (attrs = '') => `<mxfile${attrs}>${PAGE}</mxfile>\n`
  const dated = ` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000" host="app"`

  it('S1 and S8: no attribute, a bare model, or any value but "1" is editable', () => {
    expect(isDiagramReadOnly(file(dated))).toBe(false)
    expect(isDiagramReadOnly('<mxGraphModel><root/></mxGraphModel>')).toBe(false)
    for (const value of ['"0"', '"true"', '"yes"', '""', "'2'"]) expect(isDiagramReadOnly(file(` ${DIAGRAM_READ_ONLY_ATTR}=${value}`)), value).toBe(false)
    expect(isDiagramReadOnly(file(` ${DIAGRAM_READ_ONLY_ATTR}="1"`))).toBe(true)
    expect(isDiagramReadOnly(file(` ${DIAGRAM_READ_ONLY_ATTR}='1'`))).toBe(true)
    // Another attribute that only ENDS in the name is not the switch; nor is one on an inner tag.
    expect(isDiagramReadOnly(file(` x-${DIAGRAM_READ_ONLY_ATTR}="1"`))).toBe(false)
    expect(isDiagramReadOnly(`<mxfile><diagram ${DIAGRAM_READ_ONLY_ATTR}="1" id="p"><mxGraphModel/></diagram></mxfile>`)).toBe(false)
  })

  it('reads the root tag past a BOM, an XML declaration and a comment', () => {
    const xml = `﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- a > b -->\n<mxfile ${DIAGRAM_READ_ONLY_ATTR}="1">${PAGE}</mxfile>`
    expect(isDiagramReadOnly(xml)).toBe(true)
    expect(setDiagramReadOnly(xml, false)).toBe(`﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- a > b -->\n<mxfile>${PAGE}</mxfile>`)
  })

  it('S6: on adds the attribute at the end of the root tag (the dates stay first); off gives back the same bytes', () => {
    const before = file(dated)
    const on = setDiagramReadOnly(before, true)
    expect(on).toBe(file(`${dated} ${DIAGRAM_READ_ONLY_ATTR}="1"`))
    expect(isDiagramReadOnly(on)).toBe(true)
    expect(parseDiagramMetaAttrs(on)).toEqual({ createdAt: 1000, updatedAt: 2000 })
    expect(setDiagramReadOnly(on, false)).toBe(before)
    // A self-closing root keeps its slash.
    expect(setDiagramReadOnly('<mxfile/>', true)).toBe(`<mxfile ${DIAGRAM_READ_ONLY_ATTR}="1"/>`)
  })

  it('S7: a bare `<mxGraphModel>` is wrapped in `<mxfile><diagram>` as draw.io saves it, then marked', () => {
    const bare = '<?xml version="1.0"?>\n<mxGraphModel dx="1"><root><mxCell id="0" /></root></mxGraphModel>\n'
    const on = setDiagramReadOnly(bare, true)
    expect(on).toBe(`<?xml version="1.0"?>\n<mxfile ${DIAGRAM_READ_ONLY_ATTR}="1"><diagram id="page-1" name="Page-1"><mxGraphModel dx="1"><root><mxCell id="0" /></root></mxGraphModel></diagram></mxfile>\n`)
    expect(diagramDocumentError(on)).toBeNull()
    expect(isDiagramReadOnly(on)).toBe(true)
    // Off leaves the wrapper: it is how draw.io writes the file anyway.
    expect(setDiagramReadOnly(on, false)).toBe(`<?xml version="1.0"?>\n<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel dx="1"><root><mxCell id="0" /></root></mxGraphModel></diagram></mxfile>\n`)
    // Off of a bare model has nothing to remove.
    expect(setDiagramReadOnly(bare, false)).toBe(bare)
  })

  it('S8: on over a wrong value writes "1"; off removes every spelling', () => {
    expect(setDiagramReadOnly(file(` ${DIAGRAM_READ_ONLY_ATTR}="yes" host="x"`), true)).toBe(file(` host="x" ${DIAGRAM_READ_ONLY_ATTR}="1"`))
    expect(setDiagramReadOnly(file(` ${DIAGRAM_READ_ONLY_ATTR} = '0' host="x"`), false)).toBe(file(' host="x"'))
  })

  it('S11: the same value again returns the SAME string', () => {
    const on = file(` ${DIAGRAM_READ_ONLY_ATTR}="1"`)
    expect(setDiagramReadOnly(on, true)).toBe(on)
    expect(setDiagramReadOnly(file(dated), false)).toBe(file(dated))
  })

  it('a save of an EDITABLE diagram keeps no attribute; the stamp keeps one that is there', () => {
    const on = setDiagramReadOnly(file(dated), true)
    const stamped = stampDiagramMeta(on, { createdAt: 1, updatedAt: 3000 })
    expect(isDiagramReadOnly(stamped)).toBe(true)
  })

  it('something that is not a diagram is returned as it is', () => {
    for (const xml of ['', 'not xml', '<svg/>', '<mxfile']) expect(setDiagramReadOnly(xml, true)).toBe(xml)
  })
})

describe('a note as the index holds it: its parsed properties (YAZ-3076 D6, S57)', () => {
  it('only `readonly: true` counts, the rule of `isNoteReadOnly`', async () => {
    const { isReadOnlyProperties } = await import('@shared/readOnly')
    expect(isReadOnlyProperties({ readonly: true })).toBe(true)
    for (const value of ['yes', 1, 'true', false, null, undefined]) expect(isReadOnlyProperties({ readonly: value }), String(value)).toBe(false)
    expect(isReadOnlyProperties({})).toBe(false)
  })
})
