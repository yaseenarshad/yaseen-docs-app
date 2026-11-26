import { describe, expect, it } from 'vitest'
import { readVaultIcon, VAULT_ICON_PATH } from './readVaultIcon'
import { VAULT_SETTINGS_PATH, type VaultSettingsReader } from './readVaultSettings'

function makeReader(files: Record<string, string | Uint8Array>): VaultSettingsReader {
  return {
    async read(_vault, path) {
      const content = files[path]
      if (content === undefined) return null
      return {
        vault: 'v',
        path,
        kind: 'settings',
        size: typeof content === 'string' ? content.length : content.byteLength,
        viewedAt: 0,
        content,
      }
    },
  }
}

const VALID_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('readVaultIcon (YAZ-6560)', () => {
  it('returns null when settings.json or launcher section is missing', async () => {
    expect(await readVaultIcon(makeReader({}), 'v')).toBeNull()
    expect(await readVaultIcon(makeReader({ [VAULT_SETTINGS_PATH]: '{"version":1}' }), 'v')).toBeNull()
  })

  it('returns synced badge preset (emoji, letters, material with svgPaths)', async () => {
    const reader = makeReader({
      [VAULT_SETTINGS_PATH]: JSON.stringify({
        version: 1,
        launcher: {
          name: 'Daily Note Vault',
          target: 'today',
          badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
        },
      }),
    })
    expect(await readVaultIcon(reader, 'v')).toEqual({
      kind: 'badge',
      badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
    })

    const matReader = makeReader({
      [VAULT_SETTINGS_PATH]: JSON.stringify({
        version: 1,
        launcher: {
          name: 'Docs',
          badge: { kind: 'material', value: 'folder-docs', color: '#475569', svgPaths: ['M1 2h12v10H1z'] },
        },
      }),
    })
    expect(await readVaultIcon(matReader, 'v')).toEqual({
      kind: 'badge',
      badge: { kind: 'material', value: 'folder-docs', color: '#475569', svgPaths: ['M1 2h12v10H1z'] },
    })
  })

  it('reads .yaseendocs/vault-icon.png as data URL when iconFile is set, rejects invalid bytes', async () => {
    const reader = makeReader({
      [VAULT_SETTINGS_PATH]: JSON.stringify({
        version: 1,
        launcher: { name: 'Trevor Yaseen Docs', iconFile: 'vault-icon.png' },
      }),
      [VAULT_ICON_PATH]: VALID_PNG,
    })
    const icon = await readVaultIcon(reader, 'v')
    expect(icon?.kind).toBe('image')
    if (icon?.kind === 'image') {
      expect(icon.src).toMatch(/^data:image\/png;base64,/)
    }

    const badReader = makeReader({
      [VAULT_SETTINGS_PATH]: JSON.stringify({
        version: 1,
        launcher: { name: 'Bad', iconFile: 'vault-icon.png' },
      }),
      [VAULT_ICON_PATH]: new Uint8Array([1, 2, 3, 4]),
    })
    expect(await readVaultIcon(badReader, 'v')).toBeNull()
  })
})
