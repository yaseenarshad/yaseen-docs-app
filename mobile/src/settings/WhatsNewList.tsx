import { Fragment } from 'react'
import { WHATS_NEW, entryDay } from './whatsNew'

/**
 * YAZ-5446: the list behind Settings › What's new, its own chunk (`lazyScreen`). Each version: a heading with its
 * version and day, its items as short bullets, and a line between versions.
 */
export default function WhatsNewList() {
  return (
    <>
      {WHATS_NEW.map((entry, i) => (
        <Fragment key={entry.version}>
          {i > 0 && <hr className="whats-new__line" />}
          <section className="whats-new__entry" aria-label={`Version ${entry.version}`}>
            <h3 className="whats-new__head">
              {entry.version} <span className="whats-new__day">· {entryDay(entry.date)}</span>
            </h3>
            <ul className="whats-new__items">
              {entry.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </Fragment>
      ))}
    </>
  )
}
