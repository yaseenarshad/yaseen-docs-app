import { describe, expect, it } from 'vitest'
import { fileHash, hashFilePath } from './urlHash'

describe('fileHash / hashFilePath', () => {
  it('round-trips absolute paths, spaces included', () => {
    const p = '/Users/me/Notes/My Targeting.md'
    expect(hashFilePath(fileHash(p))).toBe(p)
    expect(fileHash(p)).toBe('#/Users/me/Notes/My%20Targeting.md')
  })

  it('null file → empty hash; empty/foreign hashes → null', () => {
    expect(fileHash(null)).toBe('')
    expect(hashFilePath('')).toBeNull()
    expect(hashFilePath('#')).toBeNull()
    expect(hashFilePath('#section-anchor')).toBeNull()
  })

  it('malformed percent-encoding → null instead of throwing', () => {
    expect(hashFilePath('#/bad%2')).toBeNull()
  })
})
