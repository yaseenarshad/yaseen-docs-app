import { afterEach, describe, expect, it } from 'vitest'
import appCss from '../app.css?inline'
import { holdColResize } from './colResize'

afterEach(() => holdColResize(false))

describe('holdColResize (YAZ-3719 1A)', () => {
  it('a held edge gives the page the col-resize cursor and takes every frame out of the hit test; the release gives both back', () => {
    holdColResize(true)
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.classList.contains('col-resizing')).toBe(true)
    holdColResize(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.classList.contains('col-resizing')).toBe(false)
  })

  it('app.css takes the frames out while an edge is held: over draw.io the window would get no move and no release', () => {
    expect(appCss).toMatch(/body\.col-resizing\s+iframe\s*\{\s*pointer-events:\s*none;\s*\}/)
  })
})
