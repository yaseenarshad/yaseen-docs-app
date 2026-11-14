/** While the app is open, ask GitHub this often whether the branch moved (October decision 6). */
export const POLL_MS = 15_000
/** Send the waiting answers this long after the last one; at once when the app goes to the background or the signal comes back. */
export const SEND_AFTER_MS = 5_000
