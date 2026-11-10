/**
 * The (i) words of a drawing's and a diagram's cog rows (YAZ-4748 demo, `cogHints.ts`): each says what its row does and
 * where the choice is kept; the two kinds of board each read their own noun; the fold and hover rows name the app's mode.
 */
import { describe, expect, it } from 'vitest'
import { EXPORT_DRAWING_HINT, EXPORT_IMAGE_HINT, foldArrowsHint, hoverOutlineHint, linkPreviewHint, PICTURE_HINTS, readOnlyHint } from './cogHints'

describe('YAZ-4748 demo: the cog hints', () => {
  it('Read only: one sentence per kind, each naming its own kind, and that the switch is kept in the file', () => {
    expect(readOnlyHint('drawing')).toBe('Stops edits to this drawing. The switch is saved in the file, so it goes where the file goes.')
    expect(readOnlyHint('diagram')).toBe('Stops edits to this diagram. The switch is saved in the file, so it goes where the file goes.')
  })

  it('Link preview on hover: names its kind, the app setting that must be on too, and that it is saved in the file', () => {
    for (const kind of ['drawing', 'diagram'] as const) {
      const hint = linkPreviewHint(kind)
      expect(typeof hint).toBe('string')
      expect(hint).toContain(`a link pill in this ${kind}`)
      expect(hint).toContain('Settings › Files & Links › Preview on hover › Links in drawings and diagrams')
      expect(hint).toMatch(/Saved in this file\.$/)
    }
    expect(linkPreviewHint('drawing')).not.toContain('diagram to')
    expect(linkPreviewHint('diagram')).not.toContain('drawing to')
  })

  it('Fold arrows: a list of its four pills; App names the Settings page and, when known, the app’s mode now', () => {
    const hint = foldArrowsHint('Hover')
    expect(typeof hint).not.toBe('string')
    if (typeof hint === 'string') return
    expect(hint.lead).toBe('The arrows left of a bullet in a text box. A folded bullet always shows its arrow.')
    expect(hint.rows.map(([term]) => term)).toEqual(['App', 'Hover', 'Always', 'Off'])
    expect(hint.rows[0][1]).toBe('Follows Settings › Drawings and diagrams (now Hover)')
    expect(hint.rows[3][1]).toBe('No folding: every line shows, the folds stay saved')
    expect(hint.foot).toBe('Saved in this file.')
    const unknown = foldArrowsHint(undefined)
    expect(typeof unknown !== 'string' && unknown.rows[0][1]).toBe('Follows Settings › Drawings and diagrams')
  })

  it('Hover outline: a list of App, On and Off; App names the Settings page and, when known, the app’s mode now', () => {
    const hint = hoverOutlineHint('Off')
    if (typeof hint === 'string') throw new Error('a list hint')
    expect(hint.lead).toBe('A faint outline shows what a click will pick, while you hover.')
    expect(hint.rows.map(([term]) => term)).toEqual(['App', 'On', 'Off'])
    expect(hint.rows[0][1]).toBe('Follows Settings › Drawings and diagrams (now Off)')
    expect(hint.foot).toBe('Saved in this file.')
    const unknown = hoverOutlineHint(undefined)
    expect(typeof unknown !== 'string' && unknown.rows[0][1]).toBe('Follows Settings › Drawings and diagrams')
  })

  it('the picture moves and the exports are a drawing’s alone: each one sentence about this drawing', () => {
    expect(Object.keys(PICTURE_HINTS)).toEqual(['inside', 'assets', 'folder', 'allow'])
    for (const hint of [...Object.values(PICTURE_HINTS), EXPORT_IMAGE_HINT, EXPORT_DRAWING_HINT]) {
      expect(typeof hint).toBe('string')
      expect(hint).toContain('drawing')
      expect(hint).not.toContain('diagram')
    }
    expect(PICTURE_HINTS.assets).toContain("the vault's assets folder")
    expect(EXPORT_IMAGE_HINT).toBe('Saves a picture or a PDF of this drawing, to a place you pick.')
    expect(EXPORT_DRAWING_HINT).toBe('Saves a copy of this drawing as an .excalidraw file, which Excalidraw can open.')
  })
})
