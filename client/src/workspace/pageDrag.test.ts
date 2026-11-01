import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE_PAGE_MIME, dragWidth, foreignDrag, readPageDrag, writePageDrag } from './pageDrag'

const dataWith = (type: string, value: string): DataTransfer => ({
  types: [type],
  getData: vi.fn((requested: string) => (requested === type ? value : '')),
  setData: vi.fn(),
} as unknown as DataTransfer)

const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'

describe('private workspace page drag payload', () => {
  it('rejects foreign, malformed, relative, and invalid-owner payloads', () => {
    expect(readPageDrag(dataWith('text/plain', '/v/a.md'))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, '{bad json'))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: 'relative.md', owner: 'main', from: W1, copy: 0 })))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'somewhere', from: W1, copy: 0 })))).toBeNull()
    // YAZ-3637 D1: no window, or a copy that is not a whole number from 0, is no page drag.
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main', copy: 0 })))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main', from: W1, copy: -1 })))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main', from: W1, copy: 1.5 })))).toBeNull()
  })

  it('round-trips an absolute page, its workspace owner, its window and its copy; the window and the vault go in a type of their own (YAZ-3637 D1)', () => {
    const data = dataWith(WORKSPACE_PAGE_MIME, '')
    writePageDrag(data, { path: '/v/a.md', owner: 'main', from: W1, copy: 1 }, 0)
    expect(data.setData).toHaveBeenCalledTimes(2)
    expect(data.setData).toHaveBeenCalledWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main', from: W1, copy: 1 }))
    expect(data.setData).toHaveBeenCalledWith(`application/x-yaseen-from-${W1}.0`, '1')
    expect(data.effectAllowed).toBe('move')
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main', from: W1, copy: 1 })))).toEqual({
      path: '/v/a.md',
      owner: 'main',
      from: W1,
      copy: 1,
    })
  })

  it('foreignDrag reads the window and the vault off the type names alone — null for this window\'s own drag, for no such type and for a malformed one', () => {
    const types = (...t: string[]) => ({ types: t, getData: vi.fn(() => '') } as unknown as DataTransfer)
    expect(foreignDrag(types(WORKSPACE_PAGE_MIME, `application/x-yaseen-from-${W1}.2`), W2)).toEqual({ from: W1, root: 2 })
    expect(foreignDrag(types(WORKSPACE_PAGE_MIME, `application/x-yaseen-from-${W1}.2`), W1)).toBeNull()
    // The right panel's pages (root -1) no other window takes.
    expect(foreignDrag(types(WORKSPACE_PAGE_MIME, `application/x-yaseen-from-${W1}.-1`), W2)).toBeNull()
    expect(foreignDrag(types(WORKSPACE_PAGE_MIME), W2)).toBeNull()
    expect(foreignDrag(types('text/plain'), W2)).toBeNull()
    expect(foreignDrag(types(`application/x-yaseen-from-${W1}.x`), W2)).toBeNull()
    // The type never carries the data: nothing is read.
    const data = types(`application/x-yaseen-from-${W1}.0`)
    foreignDrag(data, W2)
    expect(data.getData).not.toHaveBeenCalled()
  })

  it('a strip tab\'s drag carries its width as the tab on show in a type name (YAZ-3808 6A4); dragWidth reads it, and no width or a bad one reads null', () => {
    const types: string[] = []
    const data = { types, setData: vi.fn((type: string) => void types.push(type)) } as unknown as DataTransfer
    writePageDrag(data, { path: '/v/a.md', owner: 'main', from: W1, copy: 0 }, 0, 131.6)
    expect(types).toContain('application/x-yaseen-width-132')
    expect(dragWidth(data)).toBe(132)
    const none = dataWith(WORKSPACE_PAGE_MIME, '')
    writePageDrag(none, { path: '/v/a.md', owner: 'main', from: W1, copy: 0 }, 0, 0) // no layout: no width
    expect(none.setData).toHaveBeenCalledTimes(2)
    expect(dragWidth(none)).toBeNull()
    expect(dragWidth({ types: ['application/x-yaseen-width-wide'] } as unknown as DataTransfer)).toBeNull()
  })
})
