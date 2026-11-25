import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { DRAWING_LANGUAGE, EMPTY_INLINE_SCENE_JSON, NEW_INLINE_DRAWING_LINE } from '@shared/inlineDrawing'
import { useInlineDrawing, type InlineDrawingHost, type InlineDrawingModalState } from './useInlineDrawing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: { language: { default: '' }, drawingLine: { default: null } },
      toDOM: () => ['pre', ['code', 0]],
    },
    text: { group: 'inline' },
  },
})

interface Harness {
  view: EditorView
  createInline: () => void
  modalProps: () => InlineDrawingModalState | null
  inlineProps: () => ReturnType<typeof useInlineDrawing>['inlineProps']
  cleanup: () => void
}

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function mountHarness(pageTitle: string, extraHost: Partial<InlineDrawingHost> = {}): Harness {
  const editorDom = document.createElement('div')
  const reactDom = document.createElement('div')
  document.body.appendChild(editorDom)
  document.body.appendChild(reactDom)

  const state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph')]),
  })
  const view = new EditorView(editorDom, { state })

  let latestCreate: ((v: EditorView) => void) | null = null
  let latestModal: InlineDrawingModalState | null = null
  let latestInlineProps!: ReturnType<typeof useInlineDrawing>['inlineProps']

  const host: InlineDrawingHost = {
    root: '/v',
    path: 'Note.md',
    title: () => pageTitle,
    disk: () => '',
    getView: () => view,
    flushPage: () => undefined,
    allowFileAction: vi.fn(async () => true),
    ...extraHost,
  }

  function Probe() {
    const result = useInlineDrawing(host)
    latestCreate = result.createInline
    latestModal = result.modalProps
    latestInlineProps = result.inlineProps
    return null
  }

  const root: Root = createRoot(reactDom)
  act(() => {
    root.render(<Probe />)
  })

  const cleanup = () => {
    act(() => root.unmount())
    view.destroy()
    editorDom.remove()
    reactDom.remove()
  }
  cleanups.push(cleanup)

  return {
    view,
    createInline: () => {
      act(() => {
        latestCreate?.(view)
      })
    },
    modalProps: () => latestModal,
    inlineProps: () => latestInlineProps,
    cleanup,
  }
}

describe('useInlineDrawing createInline (YAZ-6351)', () => {
  it('defaults drawingLine title to the trimmed page title and opens modal with autoFocusTitle', () => {
    const h = mountHarness('  Auth Flow  ')
    h.createInline()

    const node = h.view.state.doc.child(0)
    expect(node.type.name).toBe('code_block')
    expect(node.attrs.language).toBe(DRAWING_LANGUAGE)
    expect(node.attrs.drawingLine).toBe('<!-- drawing: title "Auth Flow", locked -->')
    expect(node.textContent).toBe(EMPTY_INLINE_SCENE_JSON)

    expect(h.modalProps()?.inline.title).toBe('Auth Flow')
    expect(h.modalProps()?.inline.autoFocusTitle).toBe(true)
  })

  it('escapes quotes, backslashes, newlines, and HTML comment terminators in the page title', () => {
    const h = mountHarness('Q&A "Auth" \\ Flow\n--> end')
    h.createInline()

    const node = h.view.state.doc.child(0)
    expect(node.attrs.drawingLine).toBe('<!-- drawing: title "Q&A \\"Auth\\" \\\\ Flow  end", locked -->')
    expect(h.modalProps()?.inline.title).toBe('Q&A "Auth" \\ Flow  end')
    expect(h.modalProps()?.inline.autoFocusTitle).toBe(true)
  })

  it('falls back to NEW_INLINE_DRAWING_LINE when page title is empty or whitespace', () => {
    for (const emptyTitle of ['', '   ']) {
      const h = mountHarness(emptyTitle)
      h.createInline()

      const node = h.view.state.doc.child(0)
      expect(node.attrs.drawingLine).toBe(NEW_INLINE_DRAWING_LINE)
      expect(h.modalProps()?.inline.title).toBe('')
      expect(h.modalProps()?.inline.autoFocusTitle).toBe(true)
    }
  })

  it('keeps the same page title with no number suffix on repeat /drawing calls (D2 Option 1)', () => {
    const h = mountHarness('Auth Flow')
    h.createInline()

    // Insert an empty paragraph after the first drawing and place the cursor inside it.
    act(() => {
      const { tr, doc } = h.view.state
      const endPos = doc.content.size
      const next = tr.insert(endPos, schema.node('paragraph'))
      h.view.dispatch(next.setSelection(TextSelection.create(next.doc, endPos + 1)))
    })

    h.createInline()

    expect(h.view.state.doc.childCount).toBe(2)
    expect(h.view.state.doc.child(0).attrs.drawingLine).toBe('<!-- drawing: title "Auth Flow", locked -->')
    expect(h.view.state.doc.child(1).attrs.drawingLine).toBe('<!-- drawing: title "Auth Flow", locked -->')
    expect(h.modalProps()?.inline.title).toBe('Auth Flow')
  })

  it('YAZ-6548: inlineProps.onOpenExplore flushes the page before invoking host.onOpenExplore', async () => {
    const order: string[] = []
    const flushPage = vi.fn(async () => {
      order.push('flush')
    })
    const onOpenExplore = vi.fn((index: number, title?: string) => {
      order.push(`explore:${index}:${title ?? ''}`)
    })
    const h = mountHarness('Auth Flow', { flushPage, onOpenExplore })
    expect(h.inlineProps().onOpenExplore).toBeDefined()
    h.inlineProps().onOpenExplore!(1, 'Sequence')
    await vi.waitFor(() => expect(onOpenExplore).toHaveBeenCalledWith(1, 'Sequence'))
    expect(order).toEqual(['flush', 'explore:1:Sequence'])

    const withoutExplore = mountHarness('Auth Flow')
    expect(withoutExplore.inlineProps().onOpenExplore).toBeUndefined()
  })
})
