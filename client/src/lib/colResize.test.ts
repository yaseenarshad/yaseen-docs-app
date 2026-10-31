import { afterEach, describe, expect, it } from 'vitest'
import appCss from '../app.css?inline'
import { holdColResize, holdFrames } from './colResize'

afterEach(() => holdColResize(false))

describe('holdColResize and holdFrames (YAZ-3719 1A, 1B)', () => {
  it('a held edge gives the page the col-resize cursor and takes every frame out of the hit test; the release gives both back', () => {
    holdColResize(true)
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.classList.contains('drag-held')).toBe(true)
    holdColResize(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.classList.contains('drag-held')).toBe(false)
  })

  it('a drag with its own cursor (an image or a line handle) holds the frames alone', () => {
    holdFrames(true)
    expect(document.body.classList.contains('drag-held')).toBe(true)
    expect(document.body.style.cursor).toBe('')
    holdFrames(false)
    expect(document.body.classList.contains('drag-held')).toBe(false)
  })

  it('app.css takes the frames out while a drag is held: over draw.io the window would get no move and no release', () => {
    expect(appCss).toMatch(/body\.drag-held\s+iframe\s*\{\s*pointer-events:\s*none;\s*\}/)
  })
})
