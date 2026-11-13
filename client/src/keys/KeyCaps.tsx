/** A hint's keys in words (YAZ-5035, `keyWords.ts`): a `<kbd>` per key, " + " between two, " / " between two choices. */
import { Fragment } from 'react'
import { keyChoices } from './keyWords'

export function KeyCaps({ keys }: { keys: string }) {
  return (
    <>
      {keyChoices(keys).map((caps, i) => (
        <Fragment key={i}>
          {i > 0 && ' / '}
          {caps.map((cap, j) => (
            <Fragment key={j}>
              {j > 0 && ' + '}
              <kbd>{cap}</kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  )
}
