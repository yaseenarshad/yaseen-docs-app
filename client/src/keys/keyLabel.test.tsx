/** ONE hotkey label (YAZ-5332): the action first, its keys in words in brackets, the keys quieter. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { keyInWords, titleWithKey } from '@shared/hotkeyBindings'
import { DONE_KEYS, keyChoices, keysText, keyText, keyWords, labelWith, withKeys } from '@shared/keyLabel'
import { KeyLabel, keyLabelDom } from './KeyLabel'

describe('YAZ-5332: the hotkey label', () => {
  it('symbols become words, joined by + with no spaces, as Yaseen writes them (Cmd+Shift+Enter)', () => {
    expect(keyText('⌘⇧↵')).toBe('Cmd+Shift+Enter')
    expect(keyText('⌘↵')).toBe('Cmd+Enter')
    expect(keyText('⌥⌃⌫')).toBe('Option+Ctrl+Delete')
    expect(keyText('⌘l')).toBe('Cmd+L')
    expect(keyText('⌘−')).toBe('Cmd+Minus')
    expect(keyText('⌘+')).toBe('Cmd+Plus')
    expect(keyWords('esc')).toEqual(['Esc'])
    expect(keyWords('Space')).toEqual(['Space'])
    expect(keyWords('E')).toEqual(['E'])
  })

  it('CodeMirror bindings read the same', () => {
    expect(keyText('Mod-Shift-Enter')).toBe('Cmd+Shift+Enter')
    expect(keyText('Escape')).toBe('Esc')
    expect(keyText('Alt-ArrowLeft')).toBe('Option+Left')
  })

  it('a choice of keys, in the order given: Esc / Cmd+Enter', () => {
    expect(keyChoices('← →')).toEqual([['Left'], ['Right']])
    expect(keysText(DONE_KEYS)).toBe('Esc / Cmd+Enter')
    expect(keysText('← / ⌘⌥↑')).toBe('Left / Cmd+Option+Up')
  })

  it('the action first, its keys in brackets; no keys, the action alone', () => {
    expect(withKeys('Done', DONE_KEYS)).toBe('Done (Esc / Cmd+Enter)')
    expect(withKeys('Hide word', '⌘L')).toBe('Hide word (Cmd+L)')
    expect(withKeys('New side', '⌘⇧↵')).toBe('New side (Cmd+Shift+Enter)')
    expect(withKeys('Done', undefined)).toBe('Done')
    expect(labelWith('Collapse all', undefined)).toBe('Collapse all')
  })

  it('a user`s key (an Electron accelerator, a two-step key) in words; a tooltip`s key too', () => {
    expect(keyInWords('CmdOrCtrl+Shift+W')).toBe('Cmd+Shift+W')
    expect(keyInWords('CmdOrCtrl+K CmdOrCtrl+0')).toBe('Cmd+K Cmd+0')
    expect(keyInWords('CmdOrCtrl+/')).toBe('Cmd+/')
    expect(keyInWords(null)).toBe('')
    expect(titleWithKey('New tab', 'newTab', {})).toBe('New tab (Cmd+T)')
    expect(titleWithKey('New tab', 'newTab', { 'app.newTab': null, newTab: null })).toBe('New tab')
  })

  it('on screen: the keys in a quiet span after the action, in one inline box (React and a node view alike)', () => {
    const react = renderToStaticMarkup(<KeyLabel action="Done" keys={DONE_KEYS} />)
    const box = document.createElement('div')
    box.append(keyLabelDom('Done', DONE_KEYS))
    expect(box.innerHTML).toBe(react)
    expect(box.textContent).toBe('Done (Esc / Cmd+Enter)')
    expect(box.querySelector('.key-label')?.textContent).toBe('(Esc / Cmd+Enter)')
    expect(renderToStaticMarkup(<KeyLabel action="Duplicate" words="Option+Cmd+D" />)).toContain('(Option+Cmd+D)')
  })
})
