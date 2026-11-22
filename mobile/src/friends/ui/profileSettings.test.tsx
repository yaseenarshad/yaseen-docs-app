// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { saveVaultList, vaultId } from '../../store'
import { demoBoard, fakeService, fakeServices, type FakeService } from './demo'
import { createFriendsService, type Board } from './service'

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0)

let h: Harness | null = null
const origCreateImageBitmap = globalThis.createImageBitmap
const origGetContext = HTMLCanvasElement.prototype.getContext
const origToDataURL = HTMLCanvasElement.prototype.toDataURL

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/avatar-test')
  URL.revokeObjectURL = vi.fn()
  globalThis.createImageBitmap = vi.fn(async () => ({
    width: 400,
    height: 300,
    close: vi.fn(),
  })) as unknown as typeof createImageBitmap
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toDataURL = vi.fn((mime?: string) => {
    const type = mime === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
    return `data:${type};base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=`
  })
})

afterEach(() => {
  h?.unmount()
  h = null
  globalThis.createImageBitmap = origCreateImageBitmap
  HTMLCanvasElement.prototype.getContext = origGetContext
  HTMLCanvasElement.prototype.toDataURL = origToDataURL
  window.history.replaceState({}, '', '/')
})

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('Timed out waiting for condition')
    await act(async () => void (await new Promise((r) => setTimeout(r, 15))))
  }
}

async function openSettings(board: Board, patchService?: (s: FakeService) => void) {
  const p = await newPhone()
  const v = { repo: 'Yaseen/Med-Notes', branch: 'main', addedAt: 0 }
  const id = vaultId(v)
  await saveVaultList(p.store, { vaults: [v], open: id })
  await p.tokens.write(id, 'ghp_test_token')
  await saveAccount(p.store, id, {
    login: 'yaseen',
    name: 'Yaseen Arshad',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    gists: 'yes',
    checkedAt: NOW,
    expiresAt: null,
  })
  const s = fakeService(board)
  patchService?.(s)
  const mounted = await mount({
    phone: p,
    services: { now: () => NOW },
    friends: (store) => fakeServices(store, s, true),
  })
  h = mounted
  await waitFor(() => mounted.host.querySelector('button[aria-label="Settings"]') !== null)
  await mounted.click('Settings')
  await waitFor(() => mounted.text().includes('Profile picture'))
  return { h: mounted, s, p }
}

describe('YAZ-6300 Mobile Settings 2-Click Name & Profile Picture + First-Name Display', () => {
  it('displays clipped GitHub first name by default, updates helper text, and syncs nickname to both local settings and D1 updatePrefs', async () => {
    const updatePrefs = vi.fn(async (prefs: { nickname?: string | null }) => ({
      ok: true as const,
      nickname: prefs.nickname ?? null,
    }))
    const board = demoBoard(NOW)
    if (board.kind === 'ok') {
      board.me.nickname = null
    }
    const { h: mounted } = await openSettings(board, (s) => {
      s.updatePrefs = updatePrefs
    })

    // Clipped GitHub first name ("Yaseen", NOT "Yaseen Arshad")
    expect(mounted.text()).toMatch(/Name\s*Yaseen/)
    expect(mounted.text()).not.toContain('Yaseen Arshad')

    await mounted.click('Name')
    expect(mounted.text()).toContain('The name your friends see. Leave empty to use your GitHub first name.')

    await mounted.type('The name your friends see. Leave empty to use your GitHub first name.', '  Yas  ')
    await mounted.click('Save name')
    await waitFor(() => updatePrefs.mock.calls.length === 1)

    expect(updatePrefs).toHaveBeenCalledWith({ nickname: 'Yas' })
    expect((await mounted.services.friends.settings()).nickname).toBe('Yas')
    expect(mounted.text()).toMatch(/Name\s*Yas/)

    // Clear nickname -> reverts to clipped GitHub first name
    await mounted.click('Name')
    await mounted.type('The name your friends see. Leave empty to use your GitHub first name.', '   ')
    await mounted.click('Save name')
    await waitFor(() => updatePrefs.mock.calls.length === 2)

    expect(updatePrefs).toHaveBeenCalledWith({ nickname: null })
    expect((await mounted.services.friends.settings()).nickname).toBeNull()
    expect(mounted.text()).toMatch(/Name\s*Yaseen/)
  })

  it('hydrates nickname and custom avatar state from service.board() on mount', async () => {
    const board = demoBoard(NOW)
    if (board.kind === 'ok') {
      board.me.nickname = 'DocYas'
      board.me.avatar = 'https://docs.yaseenarshad.com/api/friends/avatar/1?v=99'
      board.me.hasCustomAvatar = true
    }
    const { h: mounted } = await openSettings(board)
    await waitFor(() => mounted.text().includes('DocYas') && mounted.text().includes('Custom'))
    expect(mounted.text()).toMatch(/Name\s*DocYas/)
    expect(mounted.text()).toMatch(/Profile picture\s*Custom/)
  })

  it('supports 2-click Profile picture upload via canvas encoder and reset to GitHub photo', async () => {
    const uploadAvatar = vi.fn(async (payload: { contentType: string; dataBase64: string }) => ({
      ok: true as const,
      avatarUrl: `data:${payload.contentType};base64,${payload.dataBase64}`,
      hasCustomAvatar: true as const,
    }))
    const deleteAvatar = vi.fn(async () => ({
      ok: true as const,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      hasCustomAvatar: false as const,
    }))
    const board = demoBoard(NOW)
    const { h: mounted } = await openSettings(board, (s) => {
      s.uploadAvatar = uploadAvatar
      s.deleteAvatar = deleteAvatar
    })

    expect(mounted.text()).toMatch(/Profile picture\s*From GitHub/)
    await mounted.click('Profile picture')
    expect(mounted.text()).toContain('Choose photo')
    expect(mounted.text()).not.toContain('Reset to GitHub photo')

    const input = mounted.host.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'me.png', { type: 'image/png' })
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => uploadAvatar.mock.calls.length === 1)

    expect(uploadAvatar).toHaveBeenCalledWith({
      contentType: 'image/webp',
      dataBase64: 'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    })
    await waitFor(() => mounted.text().includes('Saved') && mounted.text().includes('Reset to GitHub photo'))
    expect(mounted.text()).toMatch(/Profile picture\s*Custom/)

    await mounted.click('Reset to GitHub photo')
    await waitFor(() => deleteAvatar.mock.calls.length === 1)
    await waitFor(() => mounted.text().includes('From GitHub'))
    const resetButtons = [...mounted.host.querySelectorAll('button')].filter((b) => b.textContent?.includes('Reset to GitHub photo'))
    expect(resetButtons).toHaveLength(0)
  })

  it('wires ?friendsDemo=1 demo service for first-name defaults, uploadAvatar, deleteAvatar, and updatePrefs', async () => {
    window.history.replaceState({}, '', '/?friendsDemo=1')
    const p = await newPhone()
    const svc = createFriendsService({ store: p.store, tokens: p.tokens, now: () => NOW })

    const initial = await svc.board()
    expect(initial.kind).toBe('ok')
    if (initial.kind !== 'ok') return
    expect(initial.me.name).toContain('Yaseen')
    expect(initial.me.nickname).toBeNull()
    expect(initial.me.hasCustomAvatar).toBe(false)
    const names = initial.friends.map((f) => f.name.replace(/[\u2068\u2069]/g, ''))
    expect(names).toEqual(expect.arrayContaining(['Maya', 'Samir', 'Elena']))

    const up = await svc.uploadAvatar!({ contentType: 'image/webp', dataBase64: 'AAAA' })
    expect(up).toEqual({ ok: true, avatarUrl: 'data:image/webp;base64,AAAA', hasCustomAvatar: true })

    const afterUpload = await svc.board()
    expect(afterUpload.kind).toBe('ok')
    if (afterUpload.kind === 'ok') {
      expect(afterUpload.me.avatar).toBe('data:image/webp;base64,AAAA')
      expect(afterUpload.me.hasCustomAvatar).toBe(true)
    }

    const del = await svc.deleteAvatar!()
    expect(del.ok).toBe(true)
    if (del.ok) {
      expect(del.hasCustomAvatar).toBe(false)
      expect(del.avatarUrl).toMatch(/^data:image\/svg\+xml/)
    }

    const prefSet = await svc.updatePrefs!({ nickname: 'Doc' })
    expect(prefSet).toEqual({ ok: true, nickname: 'Doc' })
    const afterNick = await svc.board()
    if (afterNick.kind === 'ok') {
      expect(afterNick.me.name.replace(/[\u2068\u2069]/g, '')).toBe('Doc')
      expect(afterNick.me.nickname).toBe('Doc')
    }

    const prefClear = await svc.updatePrefs!({ nickname: null })
    expect(prefClear).toEqual({ ok: true, nickname: null })
    const afterClear = await svc.board()
    if (afterClear.kind === 'ok') {
      expect(afterClear.me.name.replace(/[\u2068\u2069]/g, '')).toBe('Yaseen')
      expect(afterClear.me.nickname).toBeNull()
    }
  })

  it('wires real HTTP PUT/DELETE /api/friends/avatar calls and allows custom avatar URLs on board', async () => {
    const p = await newPhone()
    const v = { repo: 'Yaseen/Med-Notes', branch: 'main', addedAt: 0 }
    await saveVaultList(p.store, { vaults: [v], open: vaultId(v) })
    await p.tokens.write(vaultId(v), 'ghp_live_token')

    const calls: { url: string; method: string; body?: string }[] = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
      if (url.endsWith('/api/friends/session')) {
        return new Response(JSON.stringify({ token: 'sess_123', expiresAt: NOW + 3600_000 }), { status: 200 })
      }
      if (url.endsWith('/api/friends/avatar') && method === 'PUT') {
        return new Response(
          JSON.stringify({ ok: true, avatarUrl: 'https://docs.yaseenarshad.com/api/friends/avatar/1?v=42', hasCustomAvatar: true }),
          { status: 200 },
        )
      }
      if (url.endsWith('/api/friends/avatar') && method === 'DELETE') {
        return new Response(
          JSON.stringify({ ok: true, avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', hasCustomAvatar: false }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 })
    })

    const svc = createFriendsService({
      store: p.store,
      tokens: p.tokens,
      fetch: fakeFetch as unknown as typeof fetch,
      now: () => NOW,
      origin: 'https://docs.yaseenarshad.com',
    })

    const up = await svc.uploadAvatar!({ contentType: 'image/webp', dataBase64: 'BBBB' })
    expect(up).toEqual({
      ok: true,
      avatarUrl: 'https://docs.yaseenarshad.com/api/friends/avatar/1?v=42',
      hasCustomAvatar: true,
    })

    const del = await svc.deleteAvatar!()
    expect(del).toEqual({
      ok: true,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      hasCustomAvatar: false,
    })

    expect(calls.some((c) => c.method === 'PUT' && c.url === 'https://docs.yaseenarshad.com/api/friends/avatar')).toBe(true)
    expect(calls.some((c) => c.method === 'DELETE' && c.url === 'https://docs.yaseenarshad.com/api/friends/avatar')).toBe(true)
  })
})
