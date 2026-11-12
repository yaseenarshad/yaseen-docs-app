/**
 * The board document's state machine (Draw's YAZ-2073 D16, ported by YAZ-3028) with no engine at all: a bare host plays the
 * engine — it `start`s the baseline, feeds autosave its counter, and answers `write` / `reload` with
 * mocks — so every shared rule (debounce, echo / reload / conflict, flush, retire, the chips, the
 * menu, the reveal focus, the export notice) runs through the real `Autosave` once, for both kinds.
 * `DrawingEditor.test.tsx` and `DrawioEditor.test.tsx` pin only what their engine adds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GithubSyncStatus } from '@shared/types'

import { BridgeRequestError } from '../api'
import { noteBoardSaved } from '../share/liveShare'
import type { Autosave } from '../lib/autosave'
import { _resetRenameContinuity, flushRenamedPath, retireDeletedPath } from '../lib/renameContinuity'
import { BOARD_COMMAND_EVENT, requestBoardCommand } from './boardCommand'
import { fakeWatch, withRevealObserver } from './boardTestKit'
import { DocumentChips, exportWithNotice, useDocumentHost } from './useDocumentHost'
import { VaultReadOnly } from '../vault/readOnlyVault'

/**
 * The cog's open menu (YAZ-4776): a portal on the page, under its cog, so a test finds it by the open cog's
 * `aria-controls`, not inside the cog's pane. `null` while it is closed.
 */
function menuIn(scope: ParentNode): HTMLElement | null {
  const id = scope.querySelector('.page-settings > button[aria-expanded="true"]')?.getAttribute('aria-controls')
  return id == null ? null : document.getElementById(id)
}

vi.mock('../share/liveShare', () => ({ noteBoardSaved: vi.fn() }))

const ROOT = '/vault'
const PATH = '/vault/Board.excalidraw'

const write = vi.fn<(expectedMtime: number) => Promise<{ mtime: number }>>()
const reload = vi.fn<(a: Autosave<number>) => Promise<boolean | void>>()
const setBoardReadOnly = vi.fn<(req: { root: string; path: string; on: boolean; expectedMtime: number }) => Promise<{ path: string; mtime: number; size: number }>>()
const onNotice = vi.fn()
const onCommand = vi.fn()
const onShown = vi.fn()
const focus = vi.fn()

const { watch, watcherSaw } = fakeWatch()

let flushListener: (() => Promise<boolean | void> | boolean | void) | null = null
let board: ReturnType<typeof useDocumentHost>
let root: Root | null = null
let container: HTMLElement

/** The engine's stand-in: the hook, its bar and its chips in a board section. */
function Host({ path = PATH, sync, onSyncNow, readOnly = false, readOnlySwitch, vault = false }: { path?: string; sync?: GithubSyncStatus | null; onSyncNow?: () => void; readOnly?: boolean; readOnlySwitch?: boolean; vault?: boolean }) {
  board = useDocumentHost({ root: ROOT, path, watch, sync, onSyncNow, write, reload, onCommand, onShown, focus, readOnly, readOnlySwitch, onNotice })
  return (
    <section className="editor editor--drawing">
      <div ref={board.hostRef}>
        {board.conflictBar}
        <DocumentChips store={board.chips} className="chips" />
      </div>
    </section>
  )
}

/** The vault's Read only (YAZ-4939) reaches the host as `Editor` hands it: through the context. */
function Vault({ on, children }: { on: boolean; children: ReactNode }) {
  return <VaultReadOnly.Provider value={{ on, allowFileAction: () => Promise.resolve(true) }}>{children}</VaultReadOnly.Provider>
}

function render(props: Parameters<typeof Host>[0] = {}): void {
  act(() => root?.render(<Vault on={props.vault === true}><Host {...props} /></Vault>))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Mounted, with the engine's baseline (content 0 at mtime 100) handed over. */
function opened(props: Parameters<typeof Host>[0] = {}): void {
  render(props)
  act(() => board.start(0, 100))
}

function edit(content: number): void {
  act(() => board.autosave.current?.update(content))
}

async function after(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

const text = (): string => container.textContent ?? ''
const button = (name: string): HTMLButtonElement => [...container.querySelectorAll('button')].find((b) => b.textContent === name)!

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  flushListener = null
  Object.defineProperty(window, 'yaseenDocs', {
    configurable: true,
    writable: true,
    value: {
      setBoardReadOnly,
      window: {
        onFlush: (listener: () => Promise<boolean | void> | boolean | void) => {
          flushListener = listener
          return () => {
            flushListener = null
          }
        },
      },
    },
  })
  write.mockResolvedValue({ mtime: 200 })
  reload.mockResolvedValue()
  setBoardReadOnly.mockImplementation(async (req) => ({ path: req.path, mtime: req.expectedMtime + 1000, size: 1 }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  _resetRenameContinuity()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('autosave', () => {
  it('saves 500 ms after an edit under the baseline mtime, then under the mtime that write returned', async () => {
    opened()
    edit(1)
    expect(text()).toContain('Unsaved')
    await after(499)
    expect(write).not.toHaveBeenCalled()
    await after(1)
    expect(write).toHaveBeenCalledExactlyOnceWith(100)
    expect(text()).toContain('Saved')
    edit(2)
    await after(500)
    expect(write).toHaveBeenLastCalledWith(200)
  })

  it('a failed write is the error chip, and the edit stays pending', async () => {
    opened()
    write.mockRejectedValue(new Error('disk full'))
    edit(1)
    await after(500)
    expect(text()).toContain('Save failed')
    expect(board.autosave.current?.dirty).toBe(true)
  })

  it('⌘S, the quit handshake, the pre-rename flush and closing the tab each write a pending edit at once', async () => {
    opened()
    edit(1)
    await act(async () => board.flush())
    expect(write).toHaveBeenCalledTimes(1)
    edit(2)
    await act(async () => {
      await flushListener?.()
    })
    expect(write).toHaveBeenCalledTimes(2)
    edit(3)
    await act(async () => {
      await flushRenamedPath(PATH)
    })
    expect(write).toHaveBeenCalledTimes(3)
    edit(4)
    act(() => root?.unmount())
    root = null
    await settle()
    expect(write).toHaveBeenCalledTimes(4)
  })

  it('a retired host (deleted, renamed away) never writes again, not even on unmount', async () => {
    opened()
    edit(1)
    act(() => retireDeletedPath(PATH))
    await after(1000)
    await act(async () => {
      board.flush()
      await flushListener?.()
    })
    act(() => root?.unmount())
    root = null
    await settle()
    expect(write).not.toHaveBeenCalled()
  })
})

describe('changes on disk', () => {
  it('our own save’s echo is ignored — even when it arrives before the save has answered', async () => {
    let answer: (res: { mtime: number }) => void = () => {}
    write.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    opened()
    edit(1)
    await after(500)
    watcherSaw({ type: 'change', path: PATH, mtime: 200 })
    await act(async () => answer({ mtime: 200 }))
    await settle()
    expect(reload).not.toHaveBeenCalled()
    expect(text()).not.toContain('File changed on disk.')
  })

  it('ignores other files, and a host whose engine has not handed its baseline over', async () => {
    render()
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    act(() => board.start(0, 100))
    watcherSaw({ type: 'change', path: '/vault/Other.excalidraw', mtime: 400 })
    await settle()
    expect(reload).not.toHaveBeenCalled()
  })

  it('a CLEAN tab reloads from disk, with no bar', async () => {
    opened()
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    expect(reload).toHaveBeenCalledExactlyOnceWith(board.autosave.current)
    expect(text()).not.toContain('File changed on disk.')
  })

  it('an edit straight after a reload is guarded by the reloaded mtime, and its echo is ours — never a bar (YAZ-2073 2F)', async () => {
    reload.mockImplementation(async (a) => a.reset(0, 400))
    opened()
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    edit(1)
    await after(500)
    expect(write).toHaveBeenCalledExactlyOnceWith(400)
    watcherSaw({ type: 'change', path: PATH, mtime: 200 })
    await settle()
    expect(reload).toHaveBeenCalledOnce()
    expect(text()).not.toContain('File changed on disk.')
  })

  it('a DIRTY tab gets the bar and is never reloaded under the user; Reload takes disk and clears it', async () => {
    opened()
    edit(1)
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    expect(text()).toContain('File changed on disk.')
    expect(reload).not.toHaveBeenCalled()
    await act(async () => button('Reload').click())
    expect(reload).toHaveBeenCalledOnce()
    expect(text()).not.toContain('File changed on disk.')
  })

  it('a reload that cannot read keeps the bar and what is on screen', async () => {
    opened()
    edit(1)
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    reload.mockRejectedValue(new Error('gone'))
    await act(async () => button('Reload').click())
    expect(text()).toContain('File changed on disk.')
  })

  it('Keep mine overwrites under the disk’s mtime', async () => {
    opened()
    edit(1)
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    await act(async () => button('Keep mine').click())
    expect(write).toHaveBeenCalledExactlyOnceWith(400)
    expect(text()).not.toContain('File changed on disk.')
  })

  it('a CONFLICT from the save door raises the same bar and blocks every write until it is answered', async () => {
    opened()
    write.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'changed on disk since last read', 900))
    edit(1)
    await after(500)
    expect(text()).toContain('File changed on disk.')
    expect(text()).not.toContain('Save failed')
    edit(2)
    await after(2000)
    await act(async () => board.flush())
    expect(write).toHaveBeenCalledTimes(1)
    // The window's flush says not clean while the conflict holds the edit (YAZ-3737 D2): a reload must wait.
    expect(await act(async () => flushListener?.())).toBe(false)
    await act(async () => button('Keep mine').click())
    expect(write).toHaveBeenLastCalledWith(900)
    expect(await act(async () => flushListener?.())).toBe(true)
  })
})

describe('the chips', () => {
  it('always the save chip; the sync chip only when the vault has one, repainted when it moves', async () => {
    opened()
    expect(text()).toBe('Saved')
    const onSyncNow = vi.fn()
    render({ sync: { state: 'pending', enabled: true } as GithubSyncStatus, onSyncNow })
    expect(text()).toContain('Pending')
    render({ sync: { state: 'synced', enabled: true } as GithubSyncStatus, onSyncNow })
    expect(text()).not.toContain('Pending')
    render({ sync: { state: 'synced', enabled: true } as GithubSyncStatus })
    expect(text()).toBe('Saved')
  })
})

describe('the menu and the tab reveal', () => {
  it('claims a board command on its own section, and not once it is gone', () => {
    container.className = 'tabstack__layer'
    opened()
    expect(requestBoardCommand({ kind: 'export-image' }, document.body)).toBe(true)
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ kind: 'export-image' })
    const section = container.querySelector('.editor') as Element
    act(() => root?.render(null))
    section.dispatchEvent(new CustomEvent(BOARD_COMMAND_EVENT, { detail: { kind: 'export-image' } }))
    expect(onCommand).toHaveBeenCalledOnce()
  })

  it('a revealed tab takes the keyboard when nothing else holds it, or from the tab being LEFT', async () => {
    await withRevealObserver((reveal) => {
      container.className = 'tabstack'
      opened()
      reveal()
      expect(onShown).toHaveBeenCalledTimes(1)
      expect(focus).toHaveBeenCalledTimes(1)
      const inLayer = document.createElement('input')
      container.appendChild(inLayer)
      inLayer.focus()
      reveal()
      expect(focus).toHaveBeenCalledTimes(2)
    })
  })

  it('NEVER takes it from the sidebar search bar, the vault switcher or a dialog — but is told it is shown', async () => {
    await withRevealObserver((reveal) => {
      opened()
      const chrome = document.createElement('input')
      document.body.appendChild(chrome)
      chrome.focus()
      reveal()
      expect(focus).not.toHaveBeenCalled()
      expect(onShown).toHaveBeenCalledTimes(1)
      chrome.remove()
    })
  })
})

describe('exportWithNotice', () => {
  const notice = vi.fn()

  it('says where the file landed; a dismissed sheet, or nothing to export, says nothing', async () => {
    await exportWithNotice(async () => ({ path: '/Users/y/Desktop/Board.png' }), 'failed', notice)
    expect(notice).toHaveBeenCalledExactlyOnceWith('Exported to Board.png')
    await exportWithNotice(async () => ({ cancelled: true }), 'failed', notice)
    await exportWithNotice(async () => null, 'failed', notice)
    expect(notice).toHaveBeenCalledOnce()
  })

  it('a refusal says main’s reason when it has one, the caller’s words otherwise', async () => {
    await exportWithNotice(() => Promise.reject(new BridgeRequestError('IO_ERROR', 'disk is full')), 'failed', notice)
    expect(notice).toHaveBeenLastCalledWith('disk is full', 'error')
    await exportWithNotice(() => Promise.reject(new Error('timed out')), 'failed', notice)
    expect(notice).toHaveBeenLastCalledWith('failed', 'error')
  })
})

/** The two user doors of the switch (YAZ-3076 D3, D4): the cog's row turns it on; the chip's "Turn Read only off" turns it off. */
async function turnReadOnlyOn(): Promise<void> {
  act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
  const row = [...(menuIn(container)?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])].find((b) => b.textContent?.startsWith('Read only'))!
  await act(async () => row.click())
  await settle()
}

async function allowEdits(): Promise<void> {
  act(() => container.querySelector<HTMLButtonElement>('.read-only-chip__button')!.click())
  const allow = [...container.querySelectorAll<HTMLButtonElement>('.read-only-chip__ask button')].find((b) => b.textContent === 'Turn Read only off')!
  await act(async () => allow.click())
  await settle()
}

describe('the read-only switch in the file (YAZ-3076 D1)', () => {
  it('starts as the loaded file says it', () => {
    opened({ readOnly: true })
    expect(board.readOnly).toBe(true)
  })

  it('S12: pending edits save first, then the switch is written under the NEW mtime; its echo does not reload', async () => {
    opened()
    edit(1)
    await turnReadOnlyOn()
    expect(write).toHaveBeenCalledExactlyOnceWith(100)
    expect(setBoardReadOnly).toHaveBeenCalledExactlyOnceWith({ root: ROOT, path: PATH, on: true, expectedMtime: 200 })
    expect(board.readOnly).toBe(true)
    expect(board.autosave.current?.mtime).toBe(1200)
    watcherSaw({ type: 'change', path: PATH, mtime: 1200 })
    await settle()
    expect(reload).not.toHaveBeenCalled()
    expect(text()).not.toContain('File changed on disk.')
    await allowEdits()
    expect(setBoardReadOnly).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, on: false, expectedMtime: 1200 })
    expect(board.readOnly).toBe(false)
  })

  it('S13: a file that changed on disk is refused; the board reloads, the switch stays, and one notice says why', async () => {
    opened()
    setBoardReadOnly.mockRejectedValue(new BridgeRequestError('CONFLICT', 'changed', 900))
    await turnReadOnlyOn()
    await settle()
    expect(board.readOnly).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('The file changed on disk. Try again.', 'error')
  })

  it('any other refusal is one notice, and the switch stays', async () => {
    opened()
    setBoardReadOnly.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'the file is cut short'))
    await turnReadOnlyOn()
    expect(board.readOnly).toBe(false)
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Read only could not change: the file is cut short', 'error')
  })

  it('S14 and S15: a change on disk (another window, an agent) reloads, and the switch follows what the reload read', async () => {
    opened()
    reload.mockResolvedValue(true)
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    expect(board.readOnly).toBe(true)
    reload.mockResolvedValue(false)
    watcherSaw({ type: 'change', path: PATH, mtime: 500 })
    await settle()
    expect(board.readOnly).toBe(false)
  })

  it('a retired host writes no switch', async () => {
    opened()
    act(() => retireDeletedPath(PATH))
    await turnReadOnlyOn()
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })
})

describe('the cog, the "Read only" chip and the "Allow edits?" box on a board (YAZ-3076 D3, D4)', () => {
  const cog = () => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!
  const menuRows = () => [...(menuIn(container)?.querySelectorAll<HTMLButtonElement>(':scope > *') ?? [])]
  const chip = () => container.querySelector<HTMLButtonElement>('.read-only-chip__button')
  const ask = () => container.querySelector<HTMLElement>('.read-only-chip__ask')
  const chipOrder = () => [...container.querySelector('.chips')!.children].map((c) => c.className.split(' ')[0])

  it('S40, S41: the cog is the first chip, and its menu has only "Read only"', () => {
    opened()
    expect(chipOrder()[0]).toBe('page-settings')
    act(() => cog().click())
    expect(menuRows().map((r) => r.textContent)).toEqual(['Read only'])
  })

  it('S43, S44: the row turns it on at once; the chip shows after the cog (cog, chip, save)', async () => {
    opened()
    act(() => cog().click())
    await act(async () => menuRows()[0].click())
    await settle()
    expect(setBoardReadOnly).toHaveBeenCalledExactlyOnceWith({ root: ROOT, path: PATH, on: true, expectedMtime: 100 })
    expect(chipOrder()).toEqual(['page-settings', 'read-only-chip', 'save-indicator'])
    expect(menuRows()[0].getAttribute('aria-pressed')).toBe('true')
    expect(ask()).toBeNull()
  })

  it('S45-S48: the chip asks; the row while on opens the same box; "Turn Read only off" writes the switch off and the chip goes', async () => {
    opened({ readOnly: true })
    act(() => chip()!.click())
    expect(ask()?.textContent).toContain('Allow edits?')
    act(() => chip()!.click())
    expect(ask()).toBeNull()
    act(() => cog().click())
    act(() => menuRows()[0].click())
    expect(menuIn(container)).toBeNull()
    expect(ask()).not.toBeNull()
    expect(setBoardReadOnly).not.toHaveBeenCalled()
    // The focus is on the first time choice (YAZ-4939), so Enter unlocks for 15 minutes; the switch's off is the fourth button.
    expect(document.activeElement?.textContent).toBe('Allow edits for 15 minutes')
    const allow = [...ask()!.querySelectorAll('button')].find((b) => b.textContent === 'Turn Read only off')!
    await act(async () => allow.click())
    await settle()
    expect(setBoardReadOnly).toHaveBeenCalledExactlyOnceWith({ root: ROOT, path: PATH, on: false, expectedMtime: 100 })
    expect(chip()).toBeNull()
    expect(board.readOnly).toBe(false)
  })

  it('S49: the chip shows while read only, whatever else the row holds — no sync chip, an unsaved board', () => {
    opened({ readOnly: true })
    edit(1)
    expect(chip()).not.toBeNull()
    expect(text()).toContain('Unsaved')
  })
})

describe('a file with no read-only switch (YAZ-3448: a code file)', () => {
  it('has no cog and no chip, only the save chip; its saves never touch the switch', async () => {
    opened({ readOnlySwitch: false })
    expect([...container.querySelector('.chips')!.children].map((c) => c.className.split(' ')[0])).toEqual(['save-indicator'])
    expect(container.querySelector('.page-settings')).toBeNull()
    edit(1)
    await after(500)
    expect(write).toHaveBeenCalledExactlyOnceWith(100)
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })

  it('YAZ-3458: a code save never runs the share upload; a board save does', async () => {
    opened({ path: '/vault/app.ts', readOnlySwitch: false })
    edit(1)
    await after(500)
    expect(write).toHaveBeenCalledTimes(1)
    expect(noteBoardSaved).not.toHaveBeenCalled()
    act(() => root?.render(null))
    opened()
    edit(1)
    await after(500)
    expect(noteBoardSaved).toHaveBeenCalledExactlyOnceWith(ROOT, PATH)
  })

  it('a reload that answers nothing leaves it off', async () => {
    opened({ readOnlySwitch: false })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(board.readOnly).toBe(false)
    expect(container.querySelector('.read-only-chip')).toBeNull()
  })
})

/** Read only for the whole vault on a board (YAZ-4939): the lock without the file's switch, and the timed unlock of this tab. */
describe('Read only for the whole vault on a board (YAZ-4939)', () => {
  const chip = () => container.querySelector<HTMLButtonElement>('.read-only-chip__button')
  const lockNow = () => container.querySelector<HTMLButtonElement>('.read-only-chip__lock')
  const ask = () => container.querySelector<HTMLElement>('.read-only-chip__ask')
  const labels = () => [...(ask()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
  const cogRow = () => {
    act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())
    return [...(menuIn(container)?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])].find((b) => b.textContent?.startsWith('Read only'))!
  }

  it('the vault On: the board is read only with its own switch off, the chip shows, the box has no "Turn Read only off", and the switch is never written', () => {
    opened({ vault: true })
    expect(board.readOnly).toBe(true)
    expect(board.switchOn).toBe(false)
    expect(chip()?.textContent).toBe('Read only')
    act(() => chip()!.click())
    expect(labels()).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Cancel'])
    act(() => button('Cancel').click())
    expect(cogRow().getAttribute('aria-pressed')).toBe('true')
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })

  it('a time choice unlocks this tab, the chip reads "Editing"; at zero the board saves, then locks; the file keeps its switch', async () => {
    opened({ vault: true })
    act(() => chip()!.click())
    act(() => button('1 hour').click())
    expect(board.readOnly).toBe(false)
    expect(chip()?.textContent).toBe('Editing · 60:00')
    expect(lockNow()?.textContent).toBe('Lock now')
    await after(60 * 60_000 - 100)
    edit(1)
    expect(write).not.toHaveBeenCalled()
    await after(100)
    await settle()
    expect(write).toHaveBeenCalledTimes(1)
    expect(board.readOnly).toBe(true)
    expect(board.switchOn).toBe(false)
    expect(chip()?.textContent).toBe('Read only')
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })

  it('"Lock now" saves and locks at once', async () => {
    opened({ vault: true })
    act(() => chip()!.click())
    act(() => button('Allow edits for 15 minutes').click())
    edit(1)
    await act(async () => lockNow()!.click())
    await settle()
    expect(write).toHaveBeenCalledTimes(1)
    expect(board.readOnly).toBe(true)
    expect(chip()?.textContent).toBe('Read only')
  })

  it('the cog’s row reads On while an unlock runs, and a click on it then locks now', async () => {
    opened({ vault: true })
    act(() => chip()!.click())
    act(() => button('Until I close this tab').click())
    expect(board.readOnly).toBe(false)
    const row = cogRow()
    expect(row.getAttribute('aria-pressed')).toBe('true')
    await act(async () => row.click())
    await settle()
    expect(board.readOnly).toBe(true)
    expect(setBoardReadOnly).not.toHaveBeenCalled()
  })

  it('precedence: the vault On wins — a board with its own switch on has no "Turn Read only off"; with the vault Off it has', () => {
    opened({ vault: true, readOnly: true })
    expect(board.readOnly).toBe(true)
    expect(board.switchOn).toBe(true)
    act(() => chip()!.click())
    expect(labels()).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Cancel'])
    act(() => root?.unmount())
    root = createRoot(container)
    opened({ vault: false, readOnly: true })
    act(() => chip()!.click())
    expect(labels()).toEqual(['Allow edits for 15 minutes', '1 hour', 'Until I close this tab', 'Turn Read only off', 'Cancel'])
  })

  it('a code file (no switch of its own) takes no chip from the host: the code tab draws its own', () => {
    opened({ vault: true, readOnlySwitch: false })
    expect(board.readOnly).toBe(false)
    expect(chip()).toBeNull()
  })
})
