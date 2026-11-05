/**
 * ⌘A and the selection toolbar in a note (YAZ-4440). The whole-note ⌘A is ProseMirror's `AllSelection` (the base
 * keymap's select all). Crepe's toolbar showed only on a `TextSelection`, so it hid when all the text was selected; the
 * patched `@milkdown/crepe` (`client/vendor/milkdown-crepe-7.22.1-yaz3550.*`) shows it on both. A text box shares it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { AllSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { mount, press, settle, unmountAll } from './toolbarTestKit'
import { getMarkdownForSave } from './createCrepe'

afterEach(unmountAll)

/** ⌘A as ProseMirror's keymap reads it here ("Mod" is ⌘ on a Mac, Ctrl elsewhere). */
function selectAll(view: EditorView): void {
  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
  const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
  expect(view.someProp('handleKeyDown', (handler) => handler(view, event))).toBe(true)
}

const shown = () => document.querySelector<HTMLElement>('.milkdown-toolbar')?.dataset.show

describe('⌘A shows the selection toolbar in a note (YAZ-4440)', () => {
  it('the whole-note select all shows it, and Bold acts on all the text', async () => {
    const { crepe, view } = await mount('First line\n\nSecond line\n')
    selectAll(view)
    expect(view.state.selection).toBeInstanceOf(AllSelection)
    await settle()
    expect(shown()).toBe('true')
    await press('bold')
    expect(getMarkdownForSave(crepe).trim()).toBe('**First line**\n\n**Second line**')
  })

  it('an empty note selected with ⌘A shows no toolbar: there is no text', async () => {
    const { view } = await mount('')
    selectAll(view)
    await settle()
    expect(shown()).not.toBe('true')
  })
})
