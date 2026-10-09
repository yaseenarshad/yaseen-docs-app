import { vi } from 'vitest'

/**
 * The door for a test (YAZ-2677 D4): `api.mintNoteId` as the main process answers it in a vault
 * with the letters `letters` — its next number, 1 first. What a test hands to its mock of `api`.
 */
export function testDoor(letters = 'YAZ') {
  let last = 0
  return vi.fn(async (_path: string): Promise<string | null> => `${letters}-${++last}`)
}
