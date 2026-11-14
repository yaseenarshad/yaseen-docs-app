/** The `@client` alias reaches client/src, in the build config and so in these tests: later units reuse pure parts of it. */
import { describe, expect, it } from 'vitest'
import * as nextHidden from '@client/review/nextHidden'

describe('@client', () => {
  it('imports a pure module of client/src', () => {
    expect(Object.keys(nextHidden).length).toBeGreaterThan(0)
  })
})
