import { describe, expect, it } from 'vitest'
import {
  renderBadgeSvgDataUrl,
  sanitizeBadgeSvgPaths,
  sanitizeBadgeSvgViewBox,
  sanitizeSyncedSidebarStart,
  sanitizeVaultAppsList,
  sanitizeVaultIconFile,
  sanitizeVaultLauncherBadge,
  sanitizeVaultLauncherPreset,
  VAULT_ICON_FILE,
  vaultIconFileFor,
  vaultInitials,
  workspaceLauncherKey,
} from './vaultIcon'

describe('vaultIcon (YAZ-6560)', () => {
  it('vaultInitials produces crisp 2-letter monograms from vault names', () => {
    expect(vaultInitials('yaseen-docs-vault')).toBe('YD')
    expect(vaultInitials('yaseen-knowledge')).toBe('YK')
    expect(vaultInitials('Business Wiki')).toBe('BW')
    expect(vaultInitials('Notes')).toBe('NO')
    expect(vaultInitials('a')).toBe('A')
    expect(vaultInitials('   ')).toBe('YD')
    expect(vaultInitials('grow_profit/eng')).toBe('GP')
    // Non-BMP emoji/code points must not split surrogate pairs.
    expect(vaultInitials('🚀 Rocket')).toBe('🚀R')
    expect(vaultInitials('🧠⚡')).toBe('🧠⚡')
  })

  it('workspaceLauncherKey normalizes case and whitespace', () => {
    expect(workspaceLauncherKey('  All Folders  ')).toBe('all folders')
    expect(workspaceLauncherKey('ALL FOLDERS')).toBe('all folders')
  })

  it('sanitizeVaultLauncherBadge validates emoji, letters, and material with safe svgPaths', () => {
    expect(sanitizeVaultLauncherBadge({ kind: 'emoji', value: '📅', color: '#007AFF' })).toEqual({
      kind: 'emoji',
      value: '📅',
      color: '#007AFF',
    })
    expect(
      sanitizeVaultLauncherBadge({
        kind: 'material',
        value: 'folder-docs',
        color: '#475569',
        svgPaths: ['M1 2h12v10H1z', 'M3 5h8v2H3z'],
        svgViewBox: '0 0 16 16',
      }),
    ).toEqual({
      kind: 'material',
      value: 'folder-docs',
      color: '#475569',
      svgPaths: ['M1 2h12v10H1z', 'M3 5h8v2H3z'],
    })
    // Non-default viewBox is preserved.
    expect(
      sanitizeVaultLauncherBadge({
        kind: 'material',
        value: 'custom',
        color: '#475569',
        svgPaths: ['M0 0h24v24H0z'],
        svgViewBox: '0 0 24 24',
      }),
    ).toEqual({
      kind: 'material',
      value: 'custom',
      color: '#475569',
      svgPaths: ['M0 0h24v24H0z'],
      svgViewBox: '0 0 24 24',
    })
    // Unsafe SVG path syntax is stripped while keeping the badge itself valid.
    expect(
      sanitizeVaultLauncherBadge({
        kind: 'material',
        value: 'folder-docs',
        color: '#475569',
        svgPaths: ['M0 0"><script>alert(1)</script>'],
      }),
    ).toEqual({
      kind: 'material',
      value: 'folder-docs',
      color: '#475569',
    })
    // Invalid badge rejected.
    expect(sanitizeVaultLauncherBadge({ kind: 'emoji', value: '', color: '#007AFF' })).toBeUndefined()
    expect(sanitizeVaultLauncherBadge({ kind: 'emoji', value: '📅', color: 'blue' })).toBeUndefined()
    expect(sanitizeBadgeSvgPaths([])).toBeUndefined()
    expect(sanitizeBadgeSvgViewBox('bad viewbox')).toBeUndefined()
  })

  it('sanitizeVaultLauncherPreset accepts badge presets and custom vault-icon.png presets, rejects empty/corrupt', () => {
    expect(
      sanitizeVaultLauncherPreset({
        name: 'Daily Note Vault',
        target: 'today',
        badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
      }),
    ).toEqual({
      name: 'Daily Note Vault',
      target: 'today',
      badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
    })

    expect(
      sanitizeVaultLauncherPreset({
        name: 'Trevor Yaseen Docs',
        iconFile: VAULT_ICON_FILE,
      }),
    ).toEqual({
      name: 'Trevor Yaseen Docs',
      iconFile: 'vault-icon.png',
    })

    // Rejects arbitrary iconFile paths (path traversal protection).
    expect(sanitizeVaultLauncherPreset({ name: 'Bad', iconFile: '../secret.png' })).toBeNull()
    // Rejects preset with neither badge nor iconFile.
    expect(sanitizeVaultLauncherPreset({ name: 'Empty' })).toBeNull()
    // Rejects empty name.
    expect(sanitizeVaultLauncherPreset({ name: '   ', iconFile: VAULT_ICON_FILE })).toBeNull()
  })

  it('renderBadgeSvgDataUrl produces valid SVG data URLs for emoji, letters, and material badges', () => {
    const emojiUrl = renderBadgeSvgDataUrl({ kind: 'emoji', value: '🧠', color: '#007AFF' })
    expect(emojiUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(emojiUrl)).toContain('🧠')

    const lettersUrl = renderBadgeSvgDataUrl({ kind: 'letters', value: 'ws', color: '#2563eb' })
    expect(decodeURIComponent(lettersUrl)).toContain('>WS<')

    const materialUrl = renderBadgeSvgDataUrl({
      kind: 'material',
      value: 'folder-docs',
      color: '#475569',
      svgPaths: ['M1 2h12v10H1z'],
    })
    expect(decodeURIComponent(materialUrl)).toContain('<path d="M1 2h12v10H1z" fill="#ffffff"/>')
  })

  it('YAZ-6743: sanitizes multi-app vaultApps list, per-app icon filenames, and portable sidebarStart', () => {
    expect(vaultIconFileFor()).toBe('vault-icon.png')
    expect(vaultIconFileFor('default')).toBe('vault-icon.png')
    expect(vaultIconFileFor('a1b2c3d4')).toBe('vault-icon-a1b2c3d4.png')
    expect(sanitizeVaultIconFile('vault-icon-a1b2c3d4.png')).toBe('vault-icon-a1b2c3d4.png')
    expect(sanitizeVaultIconFile('../vault-icon.png')).toBeUndefined()
    expect(sanitizeVaultIconFile('other.png')).toBeUndefined()

    expect(
      sanitizeSyncedSidebarStart({
        tab: 'focus',
        folderKind: 'disk',
        folderPath: 'Engineering/Specs',
        folderName: 'Specs',
        onlyFolder: true,
      }),
    ).toEqual({
      tab: 'focus',
      folderKind: 'disk',
      folderPath: 'Engineering/Specs',
      folderName: 'Specs',
      onlyFolder: true,
    })
    // Rejects path traversal in folderPath and unknown sidebar tabs.
    expect(sanitizeSyncedSidebarStart({ tab: 'files', folderPath: '../secret' })).toEqual({ tab: 'files' })
    expect(sanitizeSyncedSidebarStart({ tab: 'bogus' })).toBeUndefined()

    const list = sanitizeVaultAppsList([
      {
        name: 'Main Vault',
        badge: { kind: 'emoji', value: '📚', color: '#007AFF' },
      },
      {
        id: 'a1b2c3d4',
        name: 'Eng Focus',
        iconFile: 'vault-icon-a1b2c3d4.png',
        sidebarStart: { tab: 'focus', folderKind: 'collection', folderId: 'f1', onlyFolder: true },
      },
      // Duplicate id dropped
      {
        id: 'a1b2c3d4',
        name: 'Duplicate',
        badge: { kind: 'letters', value: 'DU', color: '#ff0000' },
      },
    ])
    expect(list).toHaveLength(2)
    expect(list[1]).toEqual({
      id: 'a1b2c3d4',
      name: 'Eng Focus',
      iconFile: 'vault-icon-a1b2c3d4.png',
      sidebarStart: { tab: 'focus', folderKind: 'collection', folderId: 'f1', onlyFolder: true },
    })
  })
})
