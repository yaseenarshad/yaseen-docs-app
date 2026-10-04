import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeRequestError } from '../api'
import { agentPage, copyForAgent } from './copyForAgent'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { shell: { agentPrompt: vi.fn() } },
}))

const { api } = await import('../api')
const agentPrompt = vi.mocked(api.shell.agentPrompt)

let writeText: ReturnType<typeof vi.fn>
const hadClipboard = 'clipboard' in navigator
beforeEach(() => {
  agentPrompt.mockReset()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
})
afterEach(() => {
  if (!hadClipboard) delete (navigator as unknown as Record<string, unknown>).clipboard
})

describe('agentPage', () => {
  it("a folder's page is its settings file, whatever the folder is named (YAZ-2290 D9); a file is a page only when it is Markdown", () => {
    expect(agentPage('/vault/Projects', true)).toBe('/vault/Projects/.folder.md')
    expect(agentPage('/vault/Notes.md', true)).toBe('/vault/Notes.md/.folder.md')
    expect(agentPage('/vault/Note.md', false)).toBe('/vault/Note.md')
    expect(agentPage('/vault/book.epub', false)).toBeNull()
  })
})

describe('copyForAgent', () => {
  it('asks main for the handshake, writes it to the clipboard, and says so', async () => {
    agentPrompt.mockResolvedValue('three\nlines\nhere')
    const notice = vi.fn()
    await copyForAgent('/vault/Note.md', notice)
    expect(agentPrompt).toHaveBeenCalledExactlyOnceWith({ path: '/vault/Note.md' })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('three\nlines\nhere')
    expect(notice).toHaveBeenCalledExactlyOnceWith('Copied for agent')
  })

  it('a page that is gone is reported by name; any other failure by message; nothing reaches the clipboard', async () => {
    const notice = vi.fn()
    agentPrompt.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'no such file'))
    await copyForAgent('/vault/sub/Deep Note.md', notice)
    expect(notice).toHaveBeenLastCalledWith('Can\'t copy "Deep Note.md" for an agent — it is no longer there')
    // A folder's page is its hidden settings file: the notice names the FOLDER (YAZ-2290 D9).
    agentPrompt.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'no such file'))
    await copyForAgent('/vault/Projects/.folder.md', notice)
    expect(notice).toHaveBeenLastCalledWith('Can\'t copy "Projects" for an agent — it is no longer there')
    agentPrompt.mockResolvedValueOnce('text')
    writeText.mockRejectedValueOnce(new Error('denied'))
    await copyForAgent('/vault/Note.md', notice)
    expect(notice).toHaveBeenLastCalledWith("Can't copy for agent: denied")
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
