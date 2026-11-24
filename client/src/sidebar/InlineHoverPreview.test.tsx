import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createRef, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  clearInlineDrawingPreviewCache,
  InlineCardHoverPreview,
  InlineDrawingHoverPreview,
  InlineRefPreview,
} from './InlineHoverPreview'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { readFile, readInlineDrawingForPicture, createScenePreviewPng } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
  readInlineDrawingForPicture: vi.fn(),
  createScenePreviewPng: vi.fn(),
}))

vi.mock('../api', () => ({ api: { readFile } }))
vi.mock('../drawings/drawingScene', () => ({ readInlineDrawingForPicture }))
vi.mock('../lib/scenePreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/scenePreview')>()
  return { ...actual, createScenePreviewPng }
})

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  readFile.mockReset()
  readInlineDrawingForPicture.mockReset()
  createScenePreviewPng.mockReset()
  clearInlineDrawingPreviewCache()
  document.body.replaceChildren()
  delete document.documentElement.dataset.theme
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function mount(element: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return container
}

const CARD_PAGE = [
  '---',
  'title: Biology',
  '---',
  '',
  '```card',
  'What is the powerhouse of the cell?',
  '---',
  '**Mitochondria**',
  '```',
  '<!-- card: BIO-12, title "Cell biology" -->',
  '',
  '```card',
  'Archived question',
  '```',
  '<!-- card: BIO-13, off -->',
  '',
  '```card',
  '',
  '```',
  '<!-- card: BIO-14 -->',
].join('\n')

const DRAWING_PAGE = [
  '---',
  'title: Systems',
  '---',
  '',
  '```excalidraw',
  '{"type":"excalidraw","version":2,"elements":[{"id":"r1","type":"rectangle","isDeleted":false}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}',
  '```',
  '<!-- drawing: title "Architecture", locked -->',
  '',
  '```excalidraw',
  '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}',
  '```',
].join('\n')

describe('InlineCardHoverPreview', () => {
  it('shows loading state then renders card front/back, title band, ID, and page place', async () => {
    let resolveRead!: (v: { path: string; content: string; mtime: number; size: number }) => void
    readFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )

    const container = mount(
      <InlineCardHoverPreview page="/v/Biology.md" cardId="BIO-12" root="/v" place="Biology" />,
    )
    expect(container.querySelector('.board-preview__msg')?.textContent).toBe('Loading preview…')

    await act(async () => {
      resolveRead({ path: '/v/Biology.md', content: CARD_PAGE, mtime: 1, size: CARD_PAGE.length })
    })
    await flush()

    expect(container.querySelector('.board-preview__header > .card-file-icon')).not.toBeNull()
    expect(container.querySelector('.board-preview__name')?.textContent).toBe('Cell biology')
    expect(container.querySelector('.board-preview__folder')?.textContent).toBe('Biology')
    expect(container.querySelector('.card__id')?.textContent).toBe('BIO-12')
    expect(container.querySelector('.card-band')?.textContent).toBe('Cell biology')
    const sides = container.querySelectorAll('.card__sides > .card__side')
    expect(sides).toHaveLength(2)
    expect(sides[0]?.textContent).toContain('powerhouse of the cell')
    expect(sides[1]?.querySelector('strong')?.textContent).toBe('Mitochondria')
    expect(container.querySelector('.card__rule')).not.toBeNull()
  })

  it('supports archived cards, empty cards, missing card fallback, fallbackIndex, and read errors', async () => {
    readFile.mockResolvedValue({ path: '/v/Biology.md', content: CARD_PAGE, mtime: 1, size: CARD_PAGE.length })

    // Archived card
    let container = mount(<InlineCardHoverPreview page="/v/Biology.md" cardId="BIO-13" root="/v" />)
    await flush()
    expect(container.querySelector('.card--off')).not.toBeNull()
    expect(container.querySelector('.card__state')?.textContent).toBe('Archived')

    // Empty card
    act(() => root?.unmount())
    container = mount(<InlineCardHoverPreview page="/v/Biology.md" cardId="BIO-14" root="/v" />)
    await flush()
    expect(container.querySelector('.card__empty')?.textContent).toBe('Empty card')

    // Missing card with no fallbackIndex
    act(() => root?.unmount())
    container = mount(<InlineCardHoverPreview page="/v/Biology.md" cardId="NO-SUCH" root="/v" />)
    await flush()
    expect(container.querySelector('.board-preview__msg')?.textContent).toBe('Card not found')

    // Missing card with fallbackIndex falls back to card at index
    act(() => root?.unmount())
    container = mount(<InlineCardHoverPreview page="/v/Biology.md" cardId="NO-SUCH" fallbackIndex={0} root="/v" />)
    await flush()
    expect(container.querySelector('.card__id')?.textContent).toBe('BIO-12')

    // Unreadable file
    act(() => root?.unmount())
    readFile.mockRejectedValueOnce(new Error('EACCES'))
    container = mount(<InlineCardHoverPreview page="/v/Missing.md" cardId="BIO-12" root="/v" />)
    await flush()
    expect(container.querySelector('.board-preview__msg')?.textContent).toBe('Preview unavailable')
  })

  it('supports compact mode (QuickLook), dark theme override, and portalled hover popover mode', async () => {
    readFile.mockResolvedValue({ path: '/v/Biology.md', content: CARD_PAGE, mtime: 1, size: CARD_PAGE.length })

    // Compact inline mode omits outer header and sets explicit data-theme
    const container = mount(<InlineCardHoverPreview page="/v/Biology.md" cardId="BIO-12" root="/v" compact dark />)
    await flush()
    const preview = container.querySelector<HTMLElement>('.inline-card-preview')!
    expect(preview.dataset.theme).toBe('dark')
    expect(preview.classList.contains('inline-preview--compact')).toBe(true)
    expect(preview.querySelector('.board-preview__header')).toBeNull()
    expect(preview.querySelector('.card__sides')).not.toBeNull()

    // Anchored hover popover portals into document.body with .board-preview frame, hint, and textVars
    act(() => root?.unmount())
    document.body.replaceChildren()
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const anchor = createRef<HTMLElement>() as { current: HTMLElement | null }
    anchor.current = aside
    mount(
      <InlineCardHoverPreview
        page="/v/Biology.md"
        cardId="BIO-12"
        name="Custom Name"
        hint="⌘-click to open"
        textVars={{ '--text-size': '17px' } as CSSProperties}
        anchor={anchor}
        root="/v"
      />,
    )
    await flush()
    const popover = document.querySelector<HTMLElement>('.board-preview.inline-card-preview')!
    expect(popover).not.toBeNull()
    expect(popover.querySelector('.board-preview__name')?.textContent).toBe('Custom Name')
    expect(popover.querySelector('.board-preview__hint')?.textContent).toBe('⌘-click to open')
    expect(popover.style.getPropertyValue('--text-size')).toBe('17px')
  })

  it('cancels cleanly on unmount with no state updates after unmount', async () => {
    let resolveRead!: (v: { path: string; content: string; mtime: number; size: number }) => void
    readFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mount(<InlineCardHoverPreview page="/v/Biology.md" cardId="BIO-12" root="/v" />)
    act(() => root?.unmount())
    root = null
    await act(async () => {
      resolveRead({ path: '/v/Biology.md', content: CARD_PAGE, mtime: 1, size: CARD_PAGE.length })
    })
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('InlineDrawingHoverPreview', () => {
  it('renders PNG preview, extracts drawing title + parent page place, and passes theme', async () => {
    readFile.mockResolvedValue({ path: '/v/Systems.md', content: DRAWING_PAGE, mtime: 7, size: DRAWING_PAGE.length })
    readInlineDrawingForPicture.mockResolvedValue({
      engine: { exportToBlob: vi.fn() },
      appState: { viewBackgroundColor: '#ffffff' },
      elements: [{ id: 'r1', type: 'rectangle', isDeleted: false }],
      files: {},
    })
    createScenePreviewPng.mockResolvedValue('data:image/png;base64,AAA')

    const container = mount(<InlineDrawingHoverPreview page="/v/Systems.md" index={0} root="/v" dark />)
    await flush()

    expect(readInlineDrawingForPicture).toHaveBeenCalledTimes(1)
    expect(createScenePreviewPng).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ appState: expect.objectContaining({ theme: 'dark' }) }),
      expect.objectContaining({ maxWidth: 1200, maxHeight: 800 }),
    )
    expect(container.querySelector('.board-preview__name')?.textContent).toBe('Architecture')
    expect(container.querySelector('.board-preview__folder')?.textContent).toBe('Systems')
    const img = container.querySelector<HTMLImageElement>('img.board-preview__img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAA')
  })

  it('handles empty drawing, missing index, and unreadable file gracefully', async () => {
    readFile.mockResolvedValue({ path: '/v/Systems.md', content: DRAWING_PAGE, mtime: 7, size: DRAWING_PAGE.length })
    readInlineDrawingForPicture.mockResolvedValue({
      engine: { exportToBlob: vi.fn() },
      appState: {},
      elements: [{ id: 'd1', isDeleted: true }],
      files: {},
    })

    // Empty drawing (only deleted elements)
    let container = mount(<InlineDrawingHoverPreview page="/v/Systems.md" index={1} root="/v" />)
    await flush()
    expect(container.querySelector('.board-preview__name')?.textContent).toBe('Untitled drawing')
    expect(container.querySelector('.board-preview__msg')?.textContent).toBe('Empty drawing')
    expect(createScenePreviewPng).not.toHaveBeenCalled()

    // Out-of-bounds drawing index
    act(() => root?.unmount())
    container = mount(<InlineDrawingHoverPreview page="/v/Systems.md" index={5} root="/v" />)
    await flush()
    expect(container.querySelector('.board-preview__msg')?.textContent).toBe('Preview unavailable')

    // Read failure
    act(() => root?.unmount())
    readFile.mockRejectedValueOnce(new Error('ENOENT'))
    container = mount(<InlineDrawingHoverPreview page="/v/Missing.md" index={0} root="/v" />)
    await flush()
    expect(container.querySelector('.board-preview__msg')?.textContent).toBe('Preview unavailable')
  })

  it('caches rendered preview across mounts, supports compact QuickLook mode, and revokes blob URLs on cache clear', async () => {
    const origRevoke = URL.revokeObjectURL
    const revokeSpy = vi.fn()
    URL.revokeObjectURL = revokeSpy
    try {
      readFile.mockResolvedValue({ path: '/v/Systems.md', content: DRAWING_PAGE, mtime: 9, size: DRAWING_PAGE.length })
      readInlineDrawingForPicture.mockResolvedValue({
        engine: { exportToBlob: vi.fn() },
        appState: {},
        elements: [{ id: 'r1', isDeleted: false }],
        files: {},
      })
      createScenePreviewPng.mockResolvedValue('blob:inline-preview-1')

      const c1 = mount(<InlineDrawingHoverPreview page="/v/Systems.md" index={0} root="/v" compact />)
      await flush()
      expect(c1.querySelector('.board-preview__header')).toBeNull()
      expect(c1.querySelector<HTMLImageElement>('img.quicklook__board')?.getAttribute('src')).toBe('blob:inline-preview-1')
      expect(createScenePreviewPng).toHaveBeenCalledTimes(1)

      // Remount with identical page/content/theme hits cache without re-rendering PNG
      act(() => root?.unmount())
      mount(<InlineDrawingHoverPreview page="/v/Systems.md" index={0} root="/v" compact />)
      await flush()
      expect(createScenePreviewPng).toHaveBeenCalledTimes(1)

      clearInlineDrawingPreviewCache()
      expect(revokeSpy).toHaveBeenCalledWith('blob:inline-preview-1')
    } finally {
      URL.revokeObjectURL = origRevoke
    }
  })

  it('cancels cleanly on unmount', async () => {
    let resolveRead!: (v: { path: string; content: string; mtime: number; size: number }) => void
    readFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mount(<InlineDrawingHoverPreview page="/v/Systems.md" index={0} root="/v" />)
    act(() => root?.unmount())
    root = null
    await act(async () => {
      resolveRead({ path: '/v/Systems.md', content: DRAWING_PAGE, mtime: 1, size: DRAWING_PAGE.length })
    })
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('InlineRefPreview', () => {
  it('dispatches card and drawing InlineRefs to the right preview component', async () => {
    readFile.mockImplementation(async (p) => ({
      path: p,
      content: p.includes('Biology') ? CARD_PAGE : DRAWING_PAGE,
      mtime: 1,
      size: 100,
    }))
    readInlineDrawingForPicture.mockResolvedValue({
      engine: { exportToBlob: vi.fn() },
      appState: {},
      elements: [{ id: 'r1', isDeleted: false }],
      files: {},
    })
    createScenePreviewPng.mockResolvedValue('data:image/png;base64,BBB')

    let container = mount(
      <InlineRefPreview inlineRef={{ kind: 'card', page: '/v/Biology.md', id: 'BIO-12' }} root="/v" />,
    )
    await flush()
    expect(container.querySelector('.inline-card-preview')).not.toBeNull()
    expect(container.querySelector('.card__id')?.textContent).toBe('BIO-12')

    act(() => root?.unmount())
    container = mount(
      <InlineRefPreview inlineRef={{ kind: 'drawing', page: '/v/Systems.md', index: 0 }} root="/v" />,
    )
    await flush()
    expect(container.querySelector('.inline-drawing-preview')).not.toBeNull()
    expect(container.querySelector<HTMLImageElement>('img.board-preview__img')?.getAttribute('src')).toBe('data:image/png;base64,BBB')
  })
})
