import { describe, expect, it } from 'vitest'
import { requireRequest, strArray } from './validate'
import { failure } from './testFixture'

const refusal = async (fn: () => unknown) => {
  const f = await failure(Promise.resolve().then(fn))
  return [f.code, f.message]
}

describe('request shape checks (YAZ-2201)', () => {
  it("requireRequest refuses a non-object in the doors' one wording, and hands an object back as is", async () => {
    for (const bad of [undefined, null, 'x', 1]) expect(await refusal(() => requireRequest(bad))).toEqual(['BAD_REQUEST', 'request must be an object'])
    const req = { path: '/v/a.md' }
    expect(requireRequest(req)).toBe(req)
    // As every door checked before: an array is an object here; its missing fields refuse it next.
    expect(Array.isArray(requireRequest([]))).toBe(true)
  })

  it('strArray refuses anything but an array of strings, naming the field', async () => {
    expect(strArray(['a', ''], 'paths')).toEqual(['a', ''])
    for (const bad of [undefined, 'a', [1], ['a', null]]) expect(await refusal(() => strArray(bad, 'keys'))).toEqual(['BAD_REQUEST', "'keys' must be a string array"])
  })
})
