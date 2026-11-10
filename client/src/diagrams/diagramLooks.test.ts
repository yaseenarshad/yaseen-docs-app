import { describe, expect, it, vi } from 'vitest'

describe('a diagram’s pill looks outside its editor (YAZ-4748 D9)', () => {
  it('none before the window’s resolver is in, nor for a diagram with no link', async () => {
    vi.resetModules()
    const { diagramLinkLooks, setDiagramLinkLooks } = await import('./diagramLooks')
    expect(diagramLinkLooks('<mxCell value="[[YAZ-1]]"/>')).toBeUndefined()
    setDiagramLinkLooks(() => ({ label: 'x' }))
    expect(diagramLinkLooks('<mxCell value="no links"/>')).toBeUndefined()
  })

  it('each link once, its text decoded twice (HTML in an XML attribute), as the resolver says', async () => {
    vi.resetModules()
    const { diagramLinkLooks, setDiagramLinkLooks } = await import('./diagramLooks')
    const resolve = vi.fn((inner: string) => (inner === 'Gone' ? null : { label: `Page ${inner}` }))
    setDiagramLinkLooks(resolve)
    expect(diagramLinkLooks('<a value="[[YAZ-1]] and [[Q&amp;amp;A]]"/><b value="[[YAZ-1]] [[Gone]]"/>')).toEqual({
      'YAZ-1': { label: 'Page YAZ-1' },
      'Q&A': { label: 'Page Q&A' },
      Gone: null,
    })
    expect(resolve).toHaveBeenCalledTimes(3)
  })
})
