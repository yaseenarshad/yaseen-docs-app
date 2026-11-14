import { describe, expect, it } from 'vitest'
import { cardFilePropertiesMoved } from '@shared/cardPropertySweep'
import { cardFileCard } from '@shared/cardFileFormat'
import { cardPropertiesOf } from '@shared/cardLine'

/** YAZ-5384: a card file's own front matter properties move onto its card line, one time; `kind: card` and file switches stay. */

const file = (frontmatter: string, line = '<!-- card: GEO-204, title "Rivers of Seville" -->') => `---\n${frontmatter}---\n\`\`\`card\nWhich river runs through Seville?\n---\nThe Guadalquivir.\n\`\`\`\n${line}\n`

describe('cardFilePropertiesMoved (YAZ-5384)', () => {
  it('moves the person`s properties onto the card line, in their order; `kind: card`, Read only and the page switches stay', () => {
    const before = file('kind: card\nreadonly: true\ntoc: false\ntags: [europe, rivers]\nlevel: A2\ncount: 3\ndone: true\nempty:\n')
    const after = cardFilePropertiesMoved(before)!
    expect(after).toBe(file('kind: card\nreadonly: true\ntoc: false\n', '<!-- card: GEO-204, title "Rivers of Seville", tags "europe" "rivers", level "A2", count 3, done true, empty "" -->'))
    expect(cardPropertiesOf(cardFileCard(after)!.line)).toEqual({ tags: ['europe', 'rivers'], level: 'A2', count: 3, done: true, empty: '' })
    // One time: nothing left to move.
    expect(cardFilePropertiesMoved(after)).toBeNull()
  })

  it('a one-value list stays a list; the reviews and the other parts of the line stay where they are', () => {
    const after = cardFilePropertiesMoved(file('kind: card\ntags: [europe]\n', '<!-- card: GEO-204, title "T", off, 2026-11-12T14:05Z good -->'))!
    expect(after).toContain('<!-- card: GEO-204, title "T", tags ["europe"], off, 2026-11-12T14:05Z good -->')
  })

  it('keeps in front matter what the line cannot or must not take: a map, a card line word, a key the line holds already, the app`s keys', () => {
    const before = file('kind: card\nid: GEO-204\naliases: [Seville river]\nmeta:\n  a: 1\nnext: soon\nlevel: B1\nsource: Atlas\n', '<!-- card: GEO-204, title "T", level "A2" -->')
    const after = cardFilePropertiesMoved(before)!
    expect(after).toBe(file('kind: card\nid: GEO-204\naliases: [Seville river]\nmeta:\n  a: 1\nnext: soon\nlevel: B1\n', '<!-- card: GEO-204, title "T", level "A2", source "Atlas" -->'))
  })

  it('a page, a card file with nothing to move, a card file with no card: no change', () => {
    expect(cardFilePropertiesMoved(`---\ntags: [a]\n---\n# Page\n\n\`\`\`card\nQ\n\`\`\`\n<!-- card: GEO-1 -->\n`)).toBeNull()
    expect(cardFilePropertiesMoved(file('kind: card\nreadonly: true\n'))).toBeNull()
    expect(cardFilePropertiesMoved('---\nkind: card\ntags: [a]\n---\nNo card here.\n')).toBeNull()
  })

  it('keeps a Windows file`s line ends', () => {
    const before = file('kind: card\nlevel: A2\n').replace(/\n/g, '\r\n')
    const after = cardFilePropertiesMoved(before)!
    expect(after).toBe(file('kind: card\n', '<!-- card: GEO-204, title "Rivers of Seville", level "A2" -->').replace(/\n/g, '\r\n'))
  })
})
