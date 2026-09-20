import type { NoticeIcon as NoticeIconKind } from '../lib/notice'

/**
 * The notice toast's glyphs (D10 amended, YAZ-1674): one 16px stroke icon per kind, `currentColor`,
 * 1.75 stroke, round caps — the tab-bar/sidebar icons' language. `aria-hidden` and path-only, so
 * the toast's `textContent` and its `role="status"` announcement stay the bare text.
 */
const PATHS: Record<NoticeIconKind, string> = {
  // two overlapping rounded rects
  copy: 'M9 9h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 21H9a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 9 9Zm-2.5 6H6a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 6 3h9a1.5 1.5 0 0 1 1.5 1.5V6',
  // scissors
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14-17L8.2 8.7M8.2 15.3 20 20M14.5 12l-6.3-3.3',
  // clipboard
  paste: 'M9 4h6M9 4a1.5 1.5 0 0 0-1.5 1.5V6h9v-.5A1.5 1.5 0 0 0 15 4M9 4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4M7.5 6H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5',
  // exclamation in a circle
  error: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5m0 3.5v.01',
  // an "i" dot
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3.5v-.01',
}

export function NoticeIcon({ icon }: { icon: NoticeIconKind }) {
  return (
    <svg className="link-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[icon]} />
    </svg>
  )
}
