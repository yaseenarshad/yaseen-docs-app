import { describe, expect, it } from 'vitest'
import { parsedValue } from './automation'

describe('flag values (YAZ-4575, YAZ-4569)', () => {
  const textOrNull = { type: ['string', 'null'] as const, maxLength: 4096 }
  it('takes a text-or-null field as plain text, null as null, and a quoted string as its text', () => {
    expect(parsedValue({ ...textOrNull, type: ['string', 'null'] }, '1731000000000:abc', '--revision')).toBe('1731000000000:abc')
    expect(parsedValue({ ...textOrNull, type: ['string', 'null'] }, '12345', '--revision')).toBe('12345')
    expect(parsedValue({ ...textOrNull, type: ['string', 'null'] }, 'null', '--revision')).toBeNull()
    expect(parsedValue({ ...textOrNull, type: ['string', 'null'] }, '"Board"', '--view')).toBe('Board')
  })
  it('parses JSON for other fields, falls back to text where text is allowed, and names the flag otherwise', () => {
    expect(parsedValue({ type: 'boolean' }, 'true', '--reveal')).toBe(true)
    expect(parsedValue({ type: ['number', 'string'] }, '240', '--card-size')).toBe(240)
    expect(parsedValue({ type: ['number', 'string'] }, 'large', '--card-size')).toBe('large')
    expect(() => parsedValue({ type: 'integer' }, 'ten', '--limit')).toThrow('--limit expects JSON (integer).')
    expect(parsedValue({ type: 'string' }, 'null', '--name')).toBe('null')
  })
})

describe('settings.patch input (YAZ-4518 nit)', () => {
  it('refuses an unknown setting name before sending, and names it', async () => {
    const { commandDefinition, validateInput } = await import('@shared/automationCommands')
    expect(() => validateInput(commandDefinition('settings.patch').input, { changes: { notASetting: true } })).toThrow('input.changes: unknown field notASetting')
    expect(() => validateInput(commandDefinition('settings.patch').input, { changes: {} })).not.toThrow()
  })
})
