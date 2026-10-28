/**
 * A code file's hover card (YAZ-3508): the top of the file, coloured by Monaco's `colorize` with the language a tab
 * would get, at most `TEXT_HEAD_LINES` lines, read only, in the note card's frame; a file that cannot be read shows
 * the hover's "Preview unavailable". `api` and Monaco are stand-ins; the real colours are checked in the real app
 * (`desktop/e2e/hoverPreview.spec.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TEXT_HEAD_LINES, type TextHead } from '@shared/types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { readTextHead, colorize, applyAppTheme } = vi.hoisted(() => ({
  readTextHead: vi.fn<(path: string) => Promise<TextHead>>(),
  /** Monaco's colorize, as it answers: escaped text, each word in a coloured span, lines joined by `<br/>`. */
  colorize: vi.fn(async (text: string, _language: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/(\w+)|(\W+)/g, (_m, word: string | undefined, other: string) => (word !== undefined ? `<span class="mtk5">${word}</span>` : other.replace(/&/g, '&amp;').replace(/</g, '&lt;'))))
      .join('<br/>'),
  ),
  applyAppTheme: vi.fn(),
}))

vi.mock('../api', () => ({ api: { readTextHead } }))
vi.mock('./monaco', () => ({
  applyAppTheme,
  monaco: {
    editor: { colorize },
    languages: { getLanguages: () => [{ id: 'typescript', extensions: ['.ts'] }, { id: 'dockerfile', filenames: ['Dockerfile'] }, { id: 'plaintext', extensions: ['.txt'] }] },
  },
}))

import CodeHoverPreview, { CODE_HOVER_UNREADABLE } from './CodeHoverPreview'

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
  document.body.replaceChildren()
})

const head = (text: string, cut = false) => async (path: string): Promise<TextHead> => ({ path, mtime: 1, size: text.length, text, cut })

/** The card as `PreviewPanel` mounts it, beside a sidebar. */
async function show(path = '/v/src/app.ts') {
  const aside = document.createElement('aside')
  document.body.appendChild(aside)
  const anchor = createRef<HTMLElement>() as { current: HTMLElement | null }
  anchor.current = aside
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<CodeHoverPreview root="/v" path={path} name={path.slice(path.lastIndexOf('/') + 1)} anchor={anchor} />))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  return document.querySelector<HTMLElement>('.code-hover')!
}

describe('CodeHoverPreview', () => {
  it('shows the top of the file in Monaco\'s colours, for the language a tab would get, in the app\'s theme', async () => {
    readTextHead.mockImplementation(head('export const a = 1 < 2\n'))
    const card = await show()
    expect(readTextHead).toHaveBeenCalledWith('/v/src/app.ts')
    expect(colorize).toHaveBeenCalledWith('export const a = 1 < 2\n', 'typescript', { tabSize: 4 })
    expect(card.querySelectorAll('.code-hover__body span.mtk5').length).toBeGreaterThan(3)
    // Monaco escapes the text: a `<` in the code is text, never markup.
    expect(card.querySelector('.code-hover__body')!.textContent).toContain('1 < 2')
    expect(applyAppTheme).toHaveBeenCalledWith('light')
    // The note card's header: the file's name and its folder.
    expect(card.querySelector('.board-preview__name')!.textContent).toBe('app.ts')
    expect(card.querySelector('.board-preview__folder')!.textContent).toBe('src')
  })

  it('defines and sets the theme only when the appearance changes, never for each card (the checker on YAZ-3458)', async () => {
    readTextHead.mockImplementation(head('const a = 1\n'))
    document.documentElement.dataset.theme = 'light'
    await show()
    act(() => root?.unmount())
    applyAppTheme.mockClear()
    await show('/v/src/other.ts')
    expect(applyAppTheme).not.toHaveBeenCalled()
    document.documentElement.dataset.theme = 'dark'
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(applyAppTheme).toHaveBeenCalledExactlyOnceWith('dark')
    act(() => root?.unmount())
    await show('/v/src/third.ts')
    expect(applyAppTheme).toHaveBeenCalledTimes(1)
    delete document.documentElement.dataset.theme
  })

  it('a Dockerfile is coloured as a Dockerfile; a file Monaco has no language for is plain text', async () => {
    readTextHead.mockImplementation(head('FROM node:22\n'))
    await show('/v/Dockerfile')
    expect(colorize).toHaveBeenLastCalledWith('FROM node:22\n', 'dockerfile', { tabSize: 4 })
    act(() => root?.unmount())
    root = null
    await show('/v/LICENSE')
    expect(colorize).toHaveBeenLastCalledWith('FROM node:22\n', 'plaintext', { tabSize: 4 })
  })

  it(`never colours more than ${TEXT_HEAD_LINES} lines`, async () => {
    readTextHead.mockImplementation(head(Array.from({ length: 90 }, (_, i) => `line${i}`).join('\n'), true))
    const card = await show()
    const coloured = colorize.mock.calls[0][0]
    expect(coloured.split('\n')).toHaveLength(TEXT_HEAD_LINES)
    expect(card.querySelector('.code-hover__body')!.textContent).toContain('line59')
    expect(card.querySelector('.code-hover__body')!.textContent).not.toContain('line60')
  })

  it('read only: a glance, with nothing to type in, click or focus', async () => {
    readTextHead.mockImplementation(head('const a = 1\n'))
    const card = await show()
    expect(card.classList.contains('board-preview')).toBe(true) // `pointer-events: none` (boardPreview.css)
    expect(card.getAttribute('role')).toBe('group')
    expect(card.getAttribute('aria-label')).toBe('Preview of app.ts')
    expect(card.querySelectorAll('textarea, input, button, [contenteditable], [tabindex]')).toHaveLength(0)
    // Portalled to the page's body, beside the sidebar.
    expect(card.parentElement).toBe(document.body)
  })

  it('a file that cannot be read (too big, not UTF-8, a NUL) shows the hover\'s unreadable line; no colours', async () => {
    readTextHead.mockRejectedValue(Object.assign(new Error('file exceeds 10485760 bytes'), { code: 'TOO_LARGE' }))
    const card = await show('/v/too-big.log')
    expect(card.querySelector('.editor-msg')!.textContent).toBe(CODE_HOVER_UNREADABLE)
    expect(CODE_HOVER_UNREADABLE).toBe('Preview unavailable')
    expect(colorize).not.toHaveBeenCalled()
  })

  it('an empty file says so', async () => {
    readTextHead.mockImplementation(head(''))
    const card = await show()
    expect(card.querySelector('.editor-msg')!.textContent).toBe('Empty file')
  })
})
