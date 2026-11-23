import { describe, expect, it } from 'vitest'
import {
  cleanDrawingLine,
  compactInlineScene,
  drawingTitleOf,
  EMPTY_INLINE_SCENE_JSON,
  findInlineDrawings,
  formatDrawingLine,
  inlineDrawingBlock,
  moveInlineDrawingOut,
  parseDrawingLine,
  putDrawingBack,
  safeFenceFor,
  withDrawingTitle,
} from '@shared/inlineDrawing'

const SAMPLE_SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'yaseen-docs',
  elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 }],
  appState: {},
  files: {},
})

describe('shared/inlineDrawing', () => {
  it('parses and formats drawing option lines', () => {
    const opts = parseDrawingLine('<!-- drawing: 640x360 view=10,-20,1.5 locked -->')
    expect(opts).toEqual({ width: 640, height: 360, view: { x: 10, y: -20, zoom: 1.5 }, locked: true, page: null, rest: [] })
    expect(formatDrawingLine(opts)).toBe('<!-- drawing: 640x360 view=10,-20,1.5 locked -->')
    expect(cleanDrawingLine('  <!-- drawing: locked -->  ')).toBe('<!-- drawing: locked -->')
    expect(cleanDrawingLine('<!-- card: GEO-1 -->')).toBeNull()
    expect(cleanDrawingLine('<!-- drawing: -->')).toBeNull()
    expect(cleanDrawingLine('<!-- drawing: locked -->\nextra')).toBeNull()
  })

  it('strips embedded files and compacts scene JSON', () => {
    const withFile = JSON.stringify(
      {
        type: 'excalidraw',
        version: 2,
        elements: [{ id: 'img1', type: 'image', fileId: 'abc' }],
        appState: {},
        files: { abc: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA' } },
      },
      null,
      2,
    )
    const { json, embeddedCount } = compactInlineScene(withFile)
    expect(embeddedCount).toBe(1)
    expect(json).not.toContain('\n')
    expect(JSON.parse(json).files).toEqual({})
  })

  it('picks a longer fence when JSON contains triple backticks', () => {
    expect(safeFenceFor(EMPTY_INLINE_SCENE_JSON)).toBe('```')
    expect(safeFenceFor('{"text":"```code```"}')).toBe('````')
    const block = inlineDrawingBlock('{"text":"```hi```"}', '<!-- drawing: locked -->')
    expect(block.startsWith('````excalidraw\n')).toBe(true)
    expect(block.endsWith('\n````\n<!-- drawing: locked -->')).toBe(true)
  })

  it('finds inline drawings and ignores code blocks of other languages', () => {
    const md = [
      '# Notes',
      '```ts',
      'const x = 1',
      '```',
      '```excalidraw',
      SAMPLE_SCENE,
      '```',
      '<!-- drawing: 500x300 locked -->',
      'After',
    ].join('\n')
    const found = findInlineDrawings(md)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ open: 4, close: 6, lineAt: 7, indent: '', json: SAMPLE_SCENE, drawingLine: '<!-- drawing: 500x300 locked -->' })
  })

  it('moves an inline drawing out to a standalone embed keeping options and CRLF', () => {
    const md = `---\ntitle: Test\n---\r\nIntro\r\n  \`\`\`excalidraw\r\n  ${SAMPLE_SCENE}\r\n  \`\`\`\r\n  <!-- drawing: 640x360 view=10,20,1.2 locked -->\r\nEnd\r\n`
    const { page, json } = moveInlineDrawingOut(md, 0, 'Test drawing.excalidraw')
    expect(json.trim()).toBe(SAMPLE_SCENE)
    expect(page).toContain('  ![[Test drawing.excalidraw|640x360 view=10,20,1.2 locked]]\r\n')
    expect(page).not.toContain('```excalidraw')
  })

  it('puts a standalone drawing embed back into the page at its indent (and preserves optional title)', () => {
    const md = '# Page\n\n  ![[Sketch.excalidraw|500x300 locked]]\n\nTail\n'
    const next = putDrawingBack(md, 'Sketch.excalidraw|500x300 locked', 0, SAMPLE_SCENE, '500x300 locked')
    expect(next).toContain('  ```excalidraw\n  ' + SAMPLE_SCENE + '\n  ```\n  <!-- drawing: 500x300 locked -->')
    expect(next).not.toContain('![[Sketch.excalidraw')

    const withTitle = putDrawingBack(md, 'Sketch.excalidraw|500x300 locked', 0, SAMPLE_SCENE, '500x300 locked', 'Sketch')
    expect(withTitle).toContain('  ```excalidraw\n  ' + SAMPLE_SCENE + '\n  ```\n  <!-- drawing: title "Sketch", 500x300 locked -->')

    const titleOnly = putDrawingBack('![[Sketch.excalidraw]]\n', 'Sketch.excalidraw', 0, SAMPLE_SCENE, null, 'Sketch')
    expect(titleOnly).toBe(`\`\`\`excalidraw\n${SAMPLE_SCENE}\n\`\`\`\n<!-- drawing: title "Sketch" -->\n`)
  })

  it('parses, formats, and updates inline drawing titles while preserving options', () => {
    const line = '<!-- drawing: title "Auth \\"Flow\\"", 640x360 locked -->'
    expect(cleanDrawingLine(line)).toBe(line)
    expect(drawingTitleOf(line)).toBe('Auth "Flow"')
    expect(parseDrawingLine(line)).toEqual({ width: 640, height: 360, view: null, locked: true, page: null, rest: [] })

    const titleOnly = '<!-- drawing: title "Solo" -->'
    expect(cleanDrawingLine(titleOnly)).toBe(titleOnly)
    expect(drawingTitleOf(titleOnly)).toBe('Solo')
    expect(parseDrawingLine(titleOnly)).toEqual({ width: null, height: null, view: null, locked: false, page: null, rest: [] })

    expect(withDrawingTitle('<!-- drawing: 640x360 locked -->', 'My Diagram')).toBe('<!-- drawing: title "My Diagram", 640x360 locked -->')
    expect(withDrawingTitle(line, '')).toBe('<!-- drawing: 640x360 locked -->')
    expect(withDrawingTitle(titleOnly, '')).toBeNull()
    expect(formatDrawingLine({ width: 500, height: 300, view: null, locked: false, page: null, rest: [] }, 'Arch')).toBe('<!-- drawing: title "Arch", 500x300 -->')

    const md = `\`\`\`excalidraw\n${SAMPLE_SCENE}\n\`\`\`\n<!-- drawing: title "Auth Flow", 640x360 locked -->\n`
    const moved = moveInlineDrawingOut(md, 0, 'Auth Flow.excalidraw')
    expect(moved.page).toBe('![[Auth Flow.excalidraw|640x360 locked]]\n')
  })
})
