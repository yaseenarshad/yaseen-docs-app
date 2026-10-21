/**
 * A note's hover preview (YAZ-3075 D1, D2): the frame and header of the board panel, and the Space
 * preview's `ReadOnlyNote` cut to `NOTE_PREVIEW_CHARS` at a line end. `createCrepe` and `api` are
 * stand-ins, as in `QuickLook.test.tsx`; the C-numbers are the cases on YAZ-3086.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createRef, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cutAtLineEnd } from '../editor/ReadOnlyNote'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import NotePreview, { NOTE_PREVIEW_CHARS } from './NotePreview'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { readFile, crepes } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
  crepes: [] as Array<{ defaultValue?: string; destroy: () => void }>,
}))

// The panel reads one file and writes nothing.
vi.mock('../api', () => ({ api: { readFile } }))

/** A stand-in Crepe: records the Markdown it was handed. */
vi.mock('../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: { root: HTMLElement; defaultValue?: string }) => {
    const inst = { defaultValue: opts.defaultValue, create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
    crepes.push(inst)
    return inst
  }),
}))

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  crepes.length = 0
  readFile.mockReset()
  document.body.replaceChildren()
})

/** The panel as the host mounts it, beside a sidebar. */
async function show(path = '/v/notes/Plan.md', textVars: CSSProperties = {}) {
  const aside = document.createElement('aside')
  document.body.appendChild(aside)
  const anchor = createRef<HTMLElement>() as { current: HTMLElement | null }
  anchor.current = aside
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<NotePreview root="/v" node={{ path }} wikilinks={createWikilinkResolveSource()} textVars={textVars} anchor={anchor} />))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  return document.querySelector<HTMLElement>('.note-preview')!
}

const file = (content: string) => async (path: string) => ({ path, content, mtime: 1, size: content.length })

describe('cutAtLineEnd (C17)', () => {
  it('cuts at the last line end before the limit, at the limit with no line end, and not at all under it', () => {
    expect(cutAtLineEnd('one\ntwo\nthree', 9)).toBe('one\ntwo')
    expect(cutAtLineEnd('abcdefghij', 4)).toBe('abcd')
    expect(cutAtLineEnd('short\n', 100)).toBe('short\n')
    expect(cutAtLineEnd('no limit at all', undefined)).toBe('no limit at all')
  })
})

describe('NotePreview', () => {
  it('C15, C16, C20: the board frame and header, the body below the frontmatter, in the vault`s text formatting', async () => {
    readFile.mockImplementation(file('---\ntitle: Plan\n---\n\n# Hello\n\nthe body\n'))
    const panel = await show('/v/notes/Plan.md', { '--text-size': '18px' } as CSSProperties)
    expect(panel.classList.contains('board-preview')).toBe(true)
    expect(panel.querySelector('.board-preview__name')?.textContent).toBe('Plan.md')
    expect(panel.querySelector('.board-preview__folder')?.textContent).toBe('notes')
    expect(panel.style.getPropertyValue('--text-size')).toBe('18px')
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/v/notes/Plan.md')
    expect(crepes).toHaveLength(1)
    expect(crepes[0].defaultValue).toBe('\n# Hello\n\nthe body\n')
    expect(panel.querySelector('.note-preview__body .editor-instance')).not.toBeNull()
    // C28: the panel closing destroys its Crepe — nothing grows between hovers.
    act(() => root?.unmount())
    root = null
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(crepes[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('C17: a long body is drawn only up to the last line end before NOTE_PREVIEW_CHARS', async () => {
    const line = `${'x'.repeat(99)}\n` // 100 characters a line
    readFile.mockImplementation(file(line.repeat(100))) // 10,000 characters
    await show()
    const drawn = crepes[0].defaultValue ?? ''
    expect(drawn.length).toBeLessThan(NOTE_PREVIEW_CHARS)
    expect(drawn).toBe(line.repeat(NOTE_PREVIEW_CHARS / 100 - 1) + 'x'.repeat(99))
  })

  it('C18: an empty body, or one of only spaces, says "Empty page" and draws no Crepe', async () => {
    readFile.mockImplementation(file('---\ntitle: Plan\n---\n  \n\n'))
    const panel = await show()
    expect(panel.querySelector('.note-preview__body')?.textContent).toBe('Empty page')
    expect(crepes).toHaveLength(0)
  })

  it('C19: a note that cannot be read says "Preview unavailable"', async () => {
    readFile.mockRejectedValue({ code: 'TOO_LARGE', message: 'over 10 MB' })
    const panel = await show()
    expect(panel.querySelector('.note-preview__body')?.textContent).toBe('Preview unavailable')
    expect(crepes).toHaveLength(0)
  })
})
