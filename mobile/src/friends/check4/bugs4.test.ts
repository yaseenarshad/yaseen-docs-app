import { expect, it } from 'vitest'
import { Model4, runPlan } from './model4.testing'

// CHECKER round 4 (YAZ-5083): named test of a round 4 finding, on the phone layer (createFriendsList, its queue).
// Shrunk from seed 7100293 of my attack (check4).
it('check4: a link that a kept friend just pasted, cancelled while a remove waits for the hour: the phone queues it, and the next rows remove that friend', async () => {
  const m = new Model4(1)
  await m.setup4(1, 1, 1, false, false) // Ali and Cem are paired
  for (const e of [
    { t: 'budget', who: 'A', arg: 1 }, // 1 gist update left in Ali's hour
    { t: 'share', who: 'A', arg: 2 }, // a link for Bea, not used yet
    { t: 'cancel', who: 'A' }, // Ali cancels it: the re-key waits in the list ("paused", budget)
    { t: 'share', who: 'A', arg: 1 }, // Ali sends Cem a new link
    { t: 'paste', who: 'C', arg: 0 }, // Cem pastes it: his app now reads Ali through it
    { t: 'cancel', who: 'A' }, // Ali cancels that link in "links shared"
    { t: 'rows', who: 'A' }, // Ali opens the Friends tab
  ] as const)
    await m.run({ ...e })
  const l = m.listOf('A')!
  const cem = l.index.friends.filter((f) => m.gist(f.theirs)?.owner === 'cem')
  console.log(m.log.join('\n'))
  expect(cem).toHaveLength(1) // fails: 0, Cem is removed (his row: "No longer shares with you")
})

// Shrunk from seed 7209526 of my attack (I6, I2): 5 events; the model's own seed fixes the interleaving.
it('check4: two of my devices end the same unused link at the same moment: both say done, and a kept friend reads a deleted numbers gist after every send', async () => {
  const m = await runPlan({
    seed: 7209526,
    setup: [3, 1, 2, false, false],
    events: [{ t: 'rows', who: 'B', dev: 2 }, { t: 'share', who: 'A', dev: 0 }, { t: 'crash', who: 'A', dev: 2, arg: 12 }, { t: 'crash', who: 'C', dev: 2, arg: 60 }, { t: 'both', who: 'A', dev: 1 }],
  })
  console.log(m.log.join('\n'))
  expect(m.st4.i6).toEqual([]) // fails: "after send A0, C (kept, paired) reads 4a6d4a via A's 500687; the send wrote e16e92"
})
