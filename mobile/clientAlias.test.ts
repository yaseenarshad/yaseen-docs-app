/** The `@client` alias reaches client/src, in the build config and so in these tests: later units reuse pure parts of it. */
import { describe, expect, it } from 'vitest'
import * as cardSteps from '@client/review/cardSteps'

describe('@client', () => {
  it('imports a pure module of client/src', () => {
    expect(Object.keys(cardSteps).length).toBeGreaterThan(0)
  })
})
