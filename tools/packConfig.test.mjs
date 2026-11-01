import { describe, expect, it } from 'vitest'
import { packConfig } from './lib/packConfig.mjs'

describe('packConfig', () => {
  it('keeps a two-number version as text: 2.10 stays 2.10, never the number 2.1 (v2.10)', () => {
    const { short, config } = packConfig('2.10.0')
    expect(short).toBe('2.10')
    expect(config.mac.bundleShortVersion).toBe('2.10')
    expect(config.extraMetadata.version).toBe('2.10.0')
    expect(config.dmg.artifactName).toBe('${productName}-2.10-arm64.dmg')
    expect(config.nsis.artifactName).toBe('${productName}-2.10-win-x64-setup.${ext}')
  })

  it('keeps all three numbers when the third is not 0', () => {
    expect(packConfig('2.10.1').short).toBe('2.10.1')
    expect(packConfig('2.9.0').short).toBe('2.9')
  })
})
