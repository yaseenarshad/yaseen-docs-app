/**
 * The window's one passive notice (E1, GRO-2171; restyled bottom-left in YAZ-1674). App owns the
 * toast; every surface reaches it through an `onNotice(text, icon?)` callback.
 */

/** A can't-open-link notice (E1, GRO-2171) dismisses itself after this long. */
export const LINK_NOTICE_MS = 4000

/**
 * The toast's glyph (D10 amended, YAZ-1674): what KIND of thing just happened, drawn before the
 * text. `'info'` is the default every existing caller gets for free — the argument is optional so
 * no caller had to change; the file clipboard's confirmations name their verb, its failures say
 * `'error'`.
 */
export type NoticeIcon = 'copy' | 'cut' | 'paste' | 'error' | 'info'

export interface Notice {
  text: string
  icon: NoticeIcon
}
