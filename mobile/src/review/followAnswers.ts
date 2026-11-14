import type { Answers } from '../answers/answers'

/**
 * Wires the answer list to the page, as `followPage` wires the engine (decision 4): the app to the background → the
 * waiting answers go at once; the connection back → they go at once. Without these two calls the list sends only
 * `SEND_AFTER_MS` after an answer (3C's result comment). The app shell calls it once, next to `followPage`
 * (`app/lazySync.ts`). Returns the undo.
 */
export function followAnswers(answers: Pick<Answers, 'setVisible' | 'online'>, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document, win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onVisibility = () => answers.setVisible(doc.visibilityState === 'visible')
  const onOnline = () => answers.online()
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('online', onOnline)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('online', onOnline)
  }
}
