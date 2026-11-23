import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addFolderToAutoSync, autoSyncAddUrl, detectAutoSync } from './autoSyncDetect'

const temps: string[] = []

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'autosync-detect-'))
  temps.push(dir)
  return dir
}

describe('detectAutoSync', () => {
  it('returns installed=false when neither app bundle nor config.json exists', async () => {
    const dir = await makeTemp()
    const res = await detectAutoSync(path.join(dir, 'vault'), {
      platform: 'darwin',
      appCandidates: [path.join(dir, 'Missing.app')],
      configPath: path.join(dir, 'missing.json'),
    })
    expect(res).toEqual({ installed: false, vaultSynced: false, supportsDeepLink: false })
  })

  it('detects installed app, deep link scheme, and whether the vault is synced', async () => {
    const dir = await makeTemp()
    const vault = path.join(dir, 'vault-a')
    const other = path.join(dir, 'vault-b')
    await mkdir(vault)
    await mkdir(other)

    const appDir = path.join(dir, 'GitHub AutoSync.app')
    await mkdir(path.join(appDir, 'Contents'), { recursive: true })
    await writeFile(path.join(appDir, 'Contents', 'Info.plist'), '<plist><array><string>github-autosync</string></array></plist>')

    const configPath = path.join(dir, 'config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        paused: false,
        folders: [{ id: '1', path: vault, enabled: true }],
      }),
    )

    expect(await detectAutoSync(vault, { platform: 'darwin', appCandidates: [appDir], configPath })).toEqual({
      installed: true,
      vaultSynced: true,
      supportsDeepLink: true,
    })
    expect(await detectAutoSync(other, { platform: 'darwin', appCandidates: [appDir], configPath })).toEqual({
      installed: true,
      vaultSynced: false,
      supportsDeepLink: true,
    })
  })

  it('treats paused AutoSync or disabled folder as vaultSynced=false', async () => {
    const dir = await makeTemp()
    const vault = path.join(dir, 'vault')
    await mkdir(vault)
    const configPath = path.join(dir, 'config.json')

    await writeFile(configPath, JSON.stringify({ version: 1, paused: true, folders: [{ id: '1', path: vault, enabled: true }] }))
    expect((await detectAutoSync(vault, { platform: 'darwin', appCandidates: [], configPath })).vaultSynced).toBe(false)

    await writeFile(configPath, JSON.stringify({ version: 1, paused: false, folders: [{ id: '1', path: vault, enabled: false }] }))
    expect((await detectAutoSync(vault, { platform: 'darwin', appCandidates: [], configPath })).vaultSynced).toBe(false)
  })
})

describe('addFolderToAutoSync', () => {
  it('uses deep link when Info.plist declares github-autosync, otherwise opens app', async () => {
    const dir = await makeTemp()
    const vault = path.join(dir, 'vault')
    await mkdir(vault)
    const appDir = path.join(dir, 'GitHub AutoSync.app')
    await mkdir(path.join(appDir, 'Contents'), { recursive: true })
    await writeFile(path.join(appDir, 'Contents', 'Info.plist'), '<plist><array><string>github-autosync</string></array></plist>')

    const openExternal = vi.fn()
    const openPath = vi.fn(() => '')
    const res1 = await addFolderToAutoSync(vault, { platform: 'darwin', appCandidates: [appDir], configPath: path.join(dir, 'none.json'), openExternal, openPath })
    expect(res1).toEqual({ ok: true, method: 'deep-link' })
    expect(openExternal).toHaveBeenCalledWith(autoSyncAddUrl(vault))

    await writeFile(path.join(appDir, 'Contents', 'Info.plist'), '<plist></plist>')
    const res2 = await addFolderToAutoSync(vault, { platform: 'darwin', appCandidates: [appDir], configPath: path.join(dir, 'none.json'), openExternal, openPath })
    expect(res2).toEqual({ ok: true, method: 'opened-app' })
    expect(openPath).toHaveBeenCalledWith(appDir)
  })
})
