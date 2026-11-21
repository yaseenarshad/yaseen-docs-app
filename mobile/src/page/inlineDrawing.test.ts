// @vitest-environment jsdom
/**
 * YAZ-5040 / YAZ-6122: inline Excalidraw drawings in `.md` on the phone (read only).
 * `pageRender` turns ```` ```excalidraw ```` into an inline drawing box and hides `<!-- drawing: … -->`;
 * `watchDrawings` draws it cleanly with dark-mode redraws, vault asset resolution, calm error lines,
 * tap-to-pinch-zoom, and full blob URL cleanup on `stop()`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DrawInput } from '../drawing/engine/drawPicture'
import { watchDrawings, type DrawingDeps } from '../drawing/watchDrawings'
import { renderPage, type PageLook } from './pageRender'

const urls = new Map<string, Blob>()
let revoked: string[] = []

beforeAll(() => {
  let n = 0
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:inline-test/${++n}`
    urls.set(url, blob)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (url: string) => void revoked.push(url)
})

afterEach(() => {
  document.body.replaceChildren()
  urls.clear()
  revoked = []
  vi.restoreAllMocks()
})

const look: PageLook = {
  link: (inner) => ({ label: inner, open: null }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: (text) => {
    const el = document.createElement('div')
    el.textContent = text
    return el
  },
}

const until = async (done: () => boolean, ms = 5_000) => {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10))
}

const SAMPLE_SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'yaseen-docs',
  elements: [{ id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, link: 'https://example.com' }],
  appState: {},
  files: {},
})

describe('inline Excalidraw drawings on mobile (YAZ-6122)', () => {
  it('pageRender turns ```excalidraw into an inline drawing box and hides <!-- drawing: ... -->', async () => {
    const host = document.createElement('div')
    const md = [
      'Before.',
      '',
      '```excalidraw',
      SAMPLE_SCENE,
      '```',
      '<!-- drawing: 640x360 view=0,0,1 locked -->',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      'After.',
    ].join('\n')

    await renderPage(md, look, host)

    const box = host.querySelector<HTMLElement>('figure[data-inline-drawing]')
    expect(box).not.toBeNull()
    expect(box?.className).toBe('page-drawing page-drawing--wait')
    expect(box?.getAttribute('role')).toBe('img')
    expect(box?.getAttribute('aria-label')).toBe('Drawing')
    expect(box?.dataset.inlineDrawing).toBe(SAMPLE_SCENE)
    expect(host.textContent).not.toContain('640x360')
    expect(host.textContent).not.toContain('<!-- drawing:')
    expect(host.querySelector('pre > code.language-ts')?.textContent).toBe('const a = 1\n')
    expect(host.textContent).toContain('Before.')
    expect(host.textContent).toContain('After.')
  })

  it('pageRender ignores forged data-inline-drawing attributes from untrusted HTML', async () => {
    const host = document.createElement('div')
    await renderPage('<div data-inline-drawing="{}">forged</div>', look, host)
    expect(host.querySelector('[data-inline-drawing]')).toBeNull()
  })

  it('watchDrawings draws an inline drawing, supports tap-to-zoom, dark mode redraws, and revokes blob URLs on stop', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await renderPage(`\`\`\`excalidraw\n${SAMPLE_SCENE}\n\`\`\`\n<!-- drawing: locked -->`, look, host)

    const inputs: DrawInput[] = []
    const read = vi.fn<DrawingDeps['read']>(async () => ({ bytes: new Uint8Array([1, 2, 3]) }))
    const load: DrawingDeps['load'] = async () => ({
      drawPicture: async (input) => {
        inputs.push(input)
        return {
          svg: `<svg xmlns="http://www.w3.org/2000/svg" data-theme="${input.theme}"></svg>`,
          width: 320,
          height: 180,
          ms: 1,
        }
      },
    })

    const listeners = new Set<() => void>()
    const dark = {
      matches: false,
      addEventListener: (_type: 'change', fn: () => void) => void listeners.add(fn),
      removeEventListener: (_type: 'change', fn: () => void) => void listeners.delete(fn),
    }

    const files = ['assets/img-1.png']
    const watch = watchDrawings(host, { read, files: () => files, load, dark })

    await until(() => host.querySelector('img.page-drawing__img') !== null)
    const img = host.querySelector<HTMLImageElement>('img.page-drawing__img')!
    const firstUrl = img.src
    expect(firstUrl).toMatch(/^blob:inline-test\//)
    expect(img.alt).toBe('Drawing')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].text).toBe(SAMPLE_SCENE)
    expect(inputs[0].theme).toBe('light')
    expect(inputs[0].files).toEqual(files)
    // Inline JSON comes directly from the block, never via deps.read for the scene itself.
    expect(read).not.toHaveBeenCalled()

    // Tap opens full-screen pinch-zoom dialog; ✕ closes it.
    img.click()
    const dialog = document.querySelector('.drawing-view')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.querySelector<HTMLImageElement>('.drawing-view__pane img')?.src).toBe(firstUrl)
    dialog?.querySelector<HTMLButtonElement>('.drawing-view__close')?.click()
    expect(document.querySelector('.drawing-view')).toBeNull()

    // Dark mode change redraws and revokes the previous blob URL.
    dark.matches = true
    for (const fn of listeners) fn()
    await until(() => inputs.length === 2)
    const secondImg = host.querySelector<HTMLImageElement>('img.page-drawing__img')!
    expect(inputs[1].theme).toBe('dark')
    expect(secondImg.src).not.toBe(firstUrl)
    expect(revoked).toEqual([firstUrl])

    // stop() revokes the current blob URL.
    watch.stop()
    expect(revoked).toEqual([firstUrl, secondImg.src])
  })

  it('watchDrawings shows calm lines for empty, broken, and offline inline drawings', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await renderPage(
      [
        '```excalidraw',
        '{"type":"excalidraw","elements":[]}',
        '```',
        '',
        '```excalidraw',
        '{ not valid json',
        '```',
      ].join('\n'),
      look,
      host,
    )

    const load: DrawingDeps['load'] = async () => ({
      drawPicture: async (input) => {
        const parsed = JSON.parse(input.text) as { elements?: unknown[] }
        if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) return 'empty'
        return { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 10, height: 10, ms: 1 }
      },
    })

    const watch = watchDrawings(host, { read: async () => ({ why: 'gone' }), files: () => [], load })
    const boxes = [...host.querySelectorAll<HTMLElement>('[data-inline-drawing]')]
    await until(() => boxes.every((b) => !b.classList.contains('page-drawing--wait')))

    expect(boxes.map((b) => b.textContent)).toEqual(['Empty drawing', "Can't show this drawing"])
    watch.stop()
  })
})
