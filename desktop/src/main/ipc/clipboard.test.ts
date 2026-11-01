import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { SPECIAL, type Envelope } from '@shared/ipc'
import { registerClipboardIpc, MAX_COPY_TEXT_LENGTH } from './clipboard'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const frame = { url: 'app://yaseen/index.html?win=w1' }
const sender = { id: 1, mainFrame: frame, isDestroyed: () => false }
const event = { sender, senderFrame: frame }
let target: { id: number } | undefined
let formats: Record<string, string>
const writeText = vi.fn((text: string) => { formats = { 'text/plain': text } })
const write = vi.fn(({ text, html }: { text: string; html: string }) => { formats = { 'text/plain': text, 'text/html': html } })
const invoke = (event: unknown, ...args: unknown[]) => {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === SPECIAL.menuCopyText.channel)?.[1]
  return (handler as unknown as (event: unknown, ...args: unknown[]) => Promise<Envelope<void>>)(event, ...args)
}
const bad = { ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST' }) }
const revealImage = vi.fn(async (_src: string) => undefined)

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  writeText.mockClear()
  write.mockClear()
  revealImage.mockClear()
  target = sender
  formats = { 'text/plain': 'old', 'text/html': '<b>old</b>' }
  registerClipboardIpc({ idFor: (wc) => wc.id === 1 ? 'w1' : undefined }, {
    target: () => target,
    writeText,
    write,
    readText: () => 'clip',
    revealImage,
    rendererUrl: 'app://yaseen/index.html',
  })
})

describe('private explicit copy IPC', () => {
  it('writes selected text only, replacing previous rich clipboard formats', async () => {
    expect(await invoke(event, '# literal\ntext')).toEqual({ ok: true, value: undefined })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('# literal\ntext')
    expect(formats).toEqual({ 'text/plain': '# literal\ntext' })
  })

  it('leaves the clipboard intact for an empty selection', async () => {
    expect(await invoke(event, '')).toEqual({ ok: true, value: undefined })
    expect(writeText).not.toHaveBeenCalled()
    expect(formats['text/html']).toBe('<b>old</b>')
  })

  it('rejects unknown, destroyed, or no longer targeted senders and subframes', async () => {
    expect(await invoke({ ...event, sender: { ...sender, id: 9 } }, 'text')).toEqual(bad)
    expect(await invoke({ ...event, sender: { ...sender, isDestroyed: () => true } }, 'text')).toEqual(bad)
    expect(await invoke({ ...event, senderFrame: { ...frame } }, 'text')).toEqual(bad)
    expect(await invoke({ ...event, senderFrame: null }, 'text')).toEqual(bad)
    target = { id: 2 }
    expect(await invoke(event, 'text')).toEqual(bad)
    target = undefined
    expect(await invoke(event, 'text')).toEqual(bad)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects a registered window navigated away from the configured renderer', async () => {
    for (const url of ['https://example.com/index.html', 'app://other/index.html', 'app://yaseen/untrusted.html', 'not a URL']) {
      const otherFrame = { url }
      expect(await invoke({ sender: { ...sender, mainFrame: otherFrame }, senderFrame: otherFrame }, 'text')).toEqual(bad)
    }
    expect(writeText).not.toHaveBeenCalled()
  })

  it('accepts the exact configured development renderer, including its window query', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerClipboardIpc({ idFor: () => 'w1' }, { target: () => sender, writeText, write, readText: () => 'clip', revealImage, rendererUrl: 'http://localhost:5173/' })
    const devFrame = { url: 'http://localhost:5173/?win=w1' }
    expect(await invoke({ sender: { ...sender, mainFrame: devFrame }, senderFrame: devFrame }, 'text')).toEqual({ ok: true, value: undefined })
  })

  it('rejects non-text and oversized payloads before writing', async () => {
    for (const value of [null, undefined, 123, { text: 'text', html: '<b>text</b>' }, 'x'.repeat(MAX_COPY_TEXT_LENGTH + 1)]) {
      expect(await invoke(event, value)).toEqual(bad)
    }
    expect(writeText).not.toHaveBeenCalled()
  })

  it('Without folded lines writes text and rich HTML together, as normal Copy does (YAZ-3653 D1)', async () => {
    expect(await invoke(event, '• Tasks', '<ul><li>Tasks</li></ul>')).toEqual({ ok: true, value: undefined })
    expect(write).toHaveBeenCalledExactlyOnceWith({ text: '• Tasks', html: '<ul><li>Tasks</li></ul>' })
    expect(writeText).not.toHaveBeenCalled()
    expect(formats).toEqual({ 'text/plain': '• Tasks', 'text/html': '<ul><li>Tasks</li></ul>' })
    expect(await invoke(event, '', '<p></p>')).toEqual({ ok: true, value: undefined })
    expect(write).toHaveBeenCalledOnce()
  })

  it('rejects non-text HTML and counts the HTML in the size limit', async () => {
    for (const html of [null, 123, { html: '<b>x</b>' }, 'x'.repeat(MAX_COPY_TEXT_LENGTH)]) {
      expect(await invoke(event, 'text', html)).toEqual(bad)
    }
    expect(write).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('the note menu runs its row on the window that sent it (YAZ-3653)', () => {
  const edit = (ev: unknown, ...args: unknown[]) => {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === SPECIAL.menuEdit.channel)?.[1]
    return (handler as unknown as (event: unknown, ...args: unknown[]) => Promise<Envelope<void>>)(ev, ...args)
  }
  const window = () => {
    const wc = { ...sender, cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), send: vi.fn(), copyImageAt: vi.fn(), getZoomFactor: () => 1.25, session: { addWordToSpellCheckerDictionary: vi.fn() } }
    return { wc, ev: { sender: wc, senderFrame: frame } }
  }

  it('Cut, Copy and Paste are the window\'s own commands; Copy as and Paste as go the menu bar\'s way', async () => {
    const { wc, ev } = window()
    for (const action of ['cut', 'copy', 'paste', 'copy-plain', 'copy-markdown', 'copy-visible', 'paste-plain', 'paste-markdown']) {
      expect(await edit(ev, action)).toEqual({ ok: true, value: undefined })
    }
    expect([wc.cut, wc.copy, wc.paste].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1])
    expect(wc.send.mock.calls).toEqual([
      [SPECIAL.menuCopyAs, 'plain'], [SPECIAL.menuCopyAs, 'markdown'], [SPECIAL.menuCopyAs, 'visible'],
      [SPECIAL.menuPasteAs, { mode: 'plain', text: 'clip' }], [SPECIAL.menuPasteAs, { mode: 'markdown', text: 'clip' }],
    ])
  })

  it('an image\'s rows (YAZ-3727 D22): Copy image at the point in the window\'s px; Reveal a vault image only', async () => {
    const { wc, ev } = window()
    expect(await edit(ev, 'copy-image', { x: 40, y: 50 })).toEqual({ ok: true, value: undefined })
    expect(wc.copyImageAt).toHaveBeenCalledExactlyOnceWith(50, 63)
    for (const point of [undefined, 'x', { x: 1 }, { x: Number.NaN, y: 2 }, { x: '1', y: 2 }]) expect(await edit(ev, 'copy-image', point)).toEqual(bad)
    expect(await edit(ev, 'reveal-image', 'app://vault/root/a.png?from=')).toEqual({ ok: true, value: undefined })
    expect(revealImage).toHaveBeenCalledExactlyOnceWith('app://vault/root/a.png?from=')
    for (const src of [undefined, 'https://example.com/a.png', 'file:///etc/hosts', `app://vault/${'x'.repeat(9000)}`]) expect(await edit(ev, 'reveal-image', src)).toEqual(bad)
    expect([wc.copyImageAt.mock.calls.length, revealImage.mock.calls.length]).toEqual([1, 1])
  })

  it('adds one word to the dictionary, and refuses anything else', async () => {
    const { wc, ev } = window()
    expect(await edit(ev, 'add-word', 'Yaseen')).toEqual({ ok: true, value: undefined })
    expect(wc.session.addWordToSpellCheckerDictionary).toHaveBeenCalledExactlyOnceWith('Yaseen')
    for (const word of [undefined, '', 'two words', 'x'.repeat(65), 7]) expect(await edit(ev, 'add-word', word)).toEqual(bad)
    for (const action of ['selectAll', 'copy-html', null, { action: 'cut' }]) expect(await edit(ev, action)).toEqual(bad)
    expect(wc.session.addWordToSpellCheckerDictionary).toHaveBeenCalledOnce()
  })

  it('refuses an unknown window, a subframe or another page', async () => {
    const { wc } = window()
    const other = { url: 'https://example.com/' }
    for (const ev of [{ sender: { ...wc, id: 9 }, senderFrame: frame }, { sender: wc, senderFrame: { ...frame } }, { sender: { ...wc, mainFrame: other }, senderFrame: other }]) {
      expect(await edit(ev, 'paste')).toEqual(bad)
    }
    expect(wc.paste).not.toHaveBeenCalled()
  })

  it('refuses a window that is not the target, as Copy as does', async () => {
    const { wc, ev } = window()
    target = { id: 2 }
    expect(await edit(ev, 'copy-visible')).toEqual(bad)
    expect(wc.send).not.toHaveBeenCalled()
  })
})
