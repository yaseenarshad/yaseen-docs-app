/**
 * YAZ-5086: what the Mac keeps between starts (`<userData>/friends-send.json`), and the `friends:status` door. No token,
 * no gist ID and no numbers in either.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { emptyBudget } from '@shared/friendSend'
import type { FriendsSendView } from '@shared/types'
import { registerFriendsIpc } from '../ipc/friends'
import { registered } from '../ipc/ipcFixture'
import { sendStateFile } from './index'
import type { MacSendSaved } from './macSender'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
vi.mock('../vaultIndex', () => ({ getIndex: vi.fn() }))

let dir: string
beforeEach(async () => void (dir = await mkdtemp(path.join(tmpdir(), 'yd-friends-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))

const SAVED: MacSendSaved = { lastSentAt: 5, lastKey: 'ab'.repeat(32), budget: { ...emptyBudget(), updates: [5] }, friends: 2, groups: 1, refused: false }

describe('the Mac\'s stored send state (YAZ-5086)', () => {
  it('survives a restart; no file reads as none', async () => {
    const file = path.join(dir, 'friends-send.json')
    expect(await sendStateFile(file).load()).toBeNull()
    await sendStateFile(file).save(SAVED)
    expect(await sendStateFile(file).load()).toEqual(SAVED)
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8'))).sort()).toEqual(['budget', 'friends', 'groups', 'lastKey', 'lastSentAt', 'refused'])
  })

  it('a broken file is moved aside, and the state starts empty', async () => {
    const file = path.join(dir, 'friends-send.json')
    await writeFile(file, '{ not json')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await sendStateFile(file).load()).toBeNull()
    vi.restoreAllMocks()
  })
})

describe('friends:status (YAZ-5086)', () => {
  it('answers the view as it is: numbers and a status word', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    const view: FriendsSendView = { status: 'sent', lastSentAt: 1, retryAt: null, friends: 3, groups: 1, missing: 0 }
    registerFriendsIpc(async () => view)
    expect(await registered(CONTRACT.friends.status)({ sender: { id: 1 } })).toEqual({ ok: true, value: view })
  })
})
