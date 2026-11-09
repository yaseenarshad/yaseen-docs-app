/** The day `--date` names, on this Mac's own calendar: today, tomorrow, yesterday or `YYYY-MM-DD` (D9); today when it is not given. */
export function dayOf(text: string | undefined, now = new Date()): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const shift = { today: 0, tomorrow: 1, yesterday: -1 }[text ?? 'today']
  if (shift !== undefined) return new Date(today.getFullYear(), today.getMonth(), today.getDate() + shift)
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '') ?? []
  const day = new Date(Number(y), Number(m) - 1, Number(d))
  if (y === undefined || day.getFullYear() !== Number(y) || day.getMonth() !== Number(m) - 1 || day.getDate() !== Number(d)) throw new Error('--date takes today, tomorrow, yesterday or a day as YYYY-MM-DD')
  return day
}
