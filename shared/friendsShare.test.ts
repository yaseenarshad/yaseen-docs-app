import { describe, expect, it } from 'vitest'
import { buildAcceptedCardFile, parseInviteInput, sanitizeSharedCard } from './friendsShare'
import { qrCodeSvg } from './qrSvg'

describe('shared/friendsShare and qrSvg (YAZ-6217)', () => {
  it('strips sender card ID and FSRS review history and adds shared_from attribution on accept', () => {
    const raw = `---\nkind: card\n---\nFront question\n---\nBack answer\n<!-- card: BIO-42, 2026-11-01 good 12s -->`
    const clean = sanitizeSharedCard('Krebs Cycle', raw, '  High yield  ')
    expect(clean.title).toBe('Krebs Cycle')
    expect(clean.markdown).toBe('Front question\n---\nBack answer')
    expect(clean.markdown).not.toContain('BIO-42')
    expect(clean.note).toBe('High yield')

    const file = buildAcceptedCardFile({
      title: clean.title,
      markdown: clean.markdown,
      senderLogin: 'alice',
      newId: 'STU-99',
      nowMs: Date.parse('2026-11-21T12:00:00Z'),
      upNext: true,
    })
    expect(file.filename).toContain('Krebs Cycle')
    expect(file.content).toContain('shared_from: "@alice"')
    expect(file.content).toContain('STU-99')
    expect(file.content).toContain('next')
    expect(file.content).not.toContain('BIO-42')
  })

  it('parses web and mac deep-link invite URLs and bare codes', () => {
    expect(parseInviteInput('https://docs.yaseenarshad.com/friend#abc12345')).toEqual({ kind: 'friend', code: 'abc12345' })
    expect(parseInviteInput('yaseendocs://group#grp98765')).toEqual({ kind: 'group', code: 'grp98765' })
    expect(parseInviteInput('k9x2m7p4')).toEqual({ kind: 'code', code: 'k9x2m7p4' })
    expect(parseInviteInput('not a link')).toBeNull()
  })

  it('renders a valid local SVG QR code for invite URLs', () => {
    const svg = qrCodeSvg('https://docs.yaseenarshad.com/friend#k9x2m7p4')
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<path d="M')
  })
})
