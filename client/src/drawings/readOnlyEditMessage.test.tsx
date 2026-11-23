/**
 * A Read only board tells its pane of an edit attempt (YAZ-4446, D33 of YAZ-4278), and the pane's "Read only" chip shows
 * its message. The engine is a stand-in with the engine's own shape: its focusable container (where the keys, the paste
 * and the cut land in view mode), its canvas, and the top right slot where the tab draws its chips. A view key the
 * engine takes stops there, as the engine's action manager stops it (`stopPropagation`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('./engine', () => {
  const Excalidraw = (props: { renderTopRightUI?: () => ReactNode }) => (
    <div
      className="excalidraw excalidraw-container"
      tabIndex={0}
      // The engine's own view key: ⇧1 (zoom to fit) is taken and stops here.
      onKeyDown={(event: ReactKeyboardEvent) => {
        if (event.key === '!') event.stopPropagation()
      }}
    >
      {props.renderTopRightUI?.()}
      <canvas className="interactive" />
    </div>
  )
  const mod = {
    Excalidraw,
    restoreElements: (elements: unknown) => elements,
    Fonts: { loadElementsFonts: async () => [] },
    restoreAppState: () => ({}),
    getSceneVersion: () => 0,
    serializeAsJSON: (elements: unknown) => JSON.stringify({ elements, appState: {} }),
    withFoldsPutBack: (elements: unknown) => elements,
  }
  const textEditor = { mount: () => ({ setSelection: () => undefined, focus: () => undefined, destroy: () => undefined }) }
  return {
    loadExcalidraw: async () => mod,
    loadTextBoxEditor: async () => ({ createTextBoxEditor: () => textEditor }),
    applyToolbarMode: () => undefined,
  }
})
vi.mock('katex/dist/katex.min.css', () => ({}))

import { ExcalidrawSurface } from './ExcalidrawSurface'
import { ReadOnlyChip } from '../editor/ReadOnlyChip'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const SCENE = { elements: [], appState: {}, files: {} }
const chips = () => <ReadOnlyChip asking={false} onAsk={() => undefined} onAllow={() => undefined} onCancel={() => undefined} />

/** A board tab as `DrawingEditor` draws it: its pane (`section.editor`), the surface, the chip in the top right slot. */
async function board(readOnly: boolean): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <section className="editor editor--drawing">
        <ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} readOnly={readOnly} renderTopRight={chips} />
      </section>,
    )
  })
  return container
}

const engineBox = () => container!.querySelector<HTMLElement>('.excalidraw-container')!
const message = () => container!.querySelector<HTMLElement>('.read-only-message__card')
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void engineBox().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
const fire = (target: Element, type: string) => act(() => void target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))

describe('a Read only board tells its pane of an edit attempt (YAZ-4446)', () => {
  for (const [name, key] of [['a letter', 'r'], ['a digit', '3'], ['Enter', 'Enter'], ['Backspace', 'Backspace'], ['Delete', 'Delete']] as const) {
    it(`${name} shows "This drawing is Read only." under the chip`, async () => {
      await board(true)
      press(key)
      expect(message()?.querySelector('strong')?.textContent).toBe('This drawing is Read only.')
    })
  }

  it('a paste, a cut and a drop show it', async () => {
    for (const type of ['paste', 'cut', 'drop']) {
      await board(true)
      fire(engineBox(), type)
      expect(message(), type).not.toBeNull()
      act(() => root?.unmount())
      root = null
      container?.remove()
    }
  })

  it('a double-click on the canvas shows it', async () => {
    await board(true)
    act(() => void container!.querySelector('canvas')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
    expect(message()).not.toBeNull()
  })

  it('the view keys show nothing: arrows, space, Esc, Tab, ⌘ chords, and a key the engine takes', async () => {
    await board(true)
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Escape', 'Tab', 'Shift', 'Meta', 'PageDown']) press(key)
    press('c', { metaKey: true })
    press('a', { metaKey: true })
    press('=', { ctrlKey: true })
    press('!', { shiftKey: true })
    expect(message()).toBeNull()
  })

  it('a key on the chips (Enter on the "Read only" chip) is not an edit of the board', async () => {
    await board(true)
    act(() => void container!.querySelector('.read-only-chip__button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(message()).toBeNull()
  })

  it('an editable board shows nothing', async () => {
    await board(false)
    press('r')
    fire(engineBox(), 'paste')
    expect(message()).toBeNull()
  })
})
