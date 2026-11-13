/** Keys in words (YAZ-5035): one helper, each key its own keycap, joined by "+". */
import { describe, expect, it } from 'vitest'
import { keyCapsDom, keyChoices, keyText, keyWords } from './keyWords'

describe('YAZ-5035: keyWords', () => {
  it('symbols become words, each its own key, joined by +', () => {
    expect(keyText('⌘⇧↵')).toBe('Cmd + Shift + Enter')
    expect(keyText('⌘↵')).toBe('Cmd + Enter')
    expect(keyText('⌥⌃⌫')).toBe('Option + Ctrl + Delete')
    expect(keyText('⌘Z')).toBe('Cmd + Z')
    expect(keyText('⌘l')).toBe('Cmd + L')
    expect(keyWords('esc')).toEqual(['Esc'])
    expect(keyWords('Space')).toEqual(['Space'])
    expect(keyWords('⇥')).toEqual(['Tab'])
    expect(keyWords('E')).toEqual(['E'])
  })

  it('CodeMirror bindings read the same', () => {
    expect(keyText('Mod-Shift-Enter')).toBe('Cmd + Shift + Enter')
    expect(keyText('Mod-l')).toBe('Cmd + L')
    expect(keyText('Escape')).toBe('Esc')
    expect(keyText('Alt-ArrowLeft')).toBe('Option + Left')
  })

  it('a choice of keys: Left / Right, Cmd + Enter / Esc', () => {
    expect(keyChoices('← →')).toEqual([['Left'], ['Right']])
    expect(keyChoices('⌘↵ / esc')).toEqual([['Cmd', 'Enter'], ['Esc']])
    const box = document.createElement('span')
    box.append(keyCapsDom('⌘↵ / esc'))
    expect(box.textContent).toBe('Cmd + Enter / Esc')
    expect([...box.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Cmd', 'Enter', 'Esc'])
  })
})
