/**
 * A three-way LINE merge in which two edits on DIFFERENT lines never clash, even when the lines are next to each other
 * (YAZ-5515 X2). Pure, no imports: sync's page merge runs it after git's own merge (`git merge-file`) said no.
 *
 * Git calls two edits a conflict when no unchanged line stands between them. The phone's writes are one-line splices
 * (a task's box, a card line, the `comments` entry), so a tick next to a line the Mac typed in, or an answer on the
 * card line right above the Mac's next paragraph, stopped git, and the page went to D9: the Mac's own edit moved to a
 * `(conflict, …)` copy. Here each side's edits are runs of base lines replaced by new lines (a diff), and the runs of
 * the two sides apply together whenever they do not touch the SAME base line:
 *  - a run both sides made the same way is taken once;
 *  - runs that share a base line, or two different inserts at one place, are a clash: null (D9 keeps both);
 *  - an insert at the edge of the other side's run goes on its own side of it (before the run when at its start).
 * Every line keeps its own line end, so a CRLF line stays CRLF.
 */
export function mergeLinesApart(base: string, theirs: string, mine: string): string | null {
  if (theirs === mine || mine === base) return theirs
  if (theirs === base) return mine
  const b = linesOf(base)
  const t = hunks(b, linesOf(theirs))
  const m = hunks(b, linesOf(mine))
  if (t === null || m === null) return null
  const out: string[] = []
  let pos = 0
  let i = 0
  let j = 0
  while (i < t.length || j < m.length) {
    const x = t[i]
    const y = m[j]
    let h: Hunk
    if (x !== undefined && y !== undefined) {
      if (sameHunk(x, y)) {
        h = x
        i++
        j++
      } else if (clash(x, y)) return null
      else if (x.end <= y.start) {
        h = x
        i++
      } else {
        h = y
        j++
      }
    } else if (x !== undefined) {
      h = x
      i++
    } else {
      h = y
      j++
    }
    for (let k = pos; k < h.start; k++) out.push(b[k])
    out.push(...h.lines)
    pos = h.end
  }
  for (let k = pos; k < b.length; k++) out.push(b[k])
  return out.join('')
}

/** Base lines `[start, end)` replaced by `lines`; `start === end` is an insert before base line `start`. */
interface Hunk {
  start: number
  end: number
  lines: string[]
}

const sameHunk = (x: Hunk, y: Hunk): boolean => x.start === y.start && x.end === y.end && x.lines.length === y.lines.length && x.lines.every((l, k) => l === y.lines[k])

/** Two runs that touch one base line, or two inserts at one place, or an insert inside the other's run. */
const clash = (x: Hunk, y: Hunk): boolean => (x.start < y.end && y.start < x.end) || (x.start === x.end && y.start === y.end && x.start === y.start)

/** The text's lines, each with its own line end (the last may have none). */
function linesOf(text: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    const nl = text.indexOf('\n', at)
    const end = nl === -1 ? text.length : nl + 1
    out.push(text.slice(at, end))
    at = end
  }
  return out
}

/** A diff past which the merge gives up (null: D9 keeps both): far more edits than a sync between two machines makes. */
const MAX_EDITS = 4000

/** The runs that turn `a` into `b`: the shared start and end first, then Myers' shortest edit script on the middle. */
function hunks(a: readonly string[], b: readonly string[]): Hunk[] | null {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const n = a.length - head - tail
  const m = b.length - head - tail
  if (n === 0 && m === 0) return []
  if (n === 0 || m === 0) return [{ start: head, end: head + n, lines: b.slice(head, head + m) }]
  const A = (i: number) => a[head + i]
  const B = (j: number) => b[head + j]

  // Myers: trace[d] holds V (the furthest x on each diagonal k) after d edits, for k in [-d, d].
  const max = Math.min(n + m, MAX_EDITS)
  const trace: Int32Array[] = []
  let v = new Int32Array(3)
  let found = -1
  for (let d = 0; d <= max && found === -1; d++) {
    const next = new Int32Array(2 * d + 3)
    const get = (arr: Int32Array, dd: number, k: number) => arr[k + dd + 1]
    for (let k = -d; k <= d; k += 2) {
      const prevD = d - 1
      let x: number
      if (d === 0) x = 0
      else if (k === -d || (k !== d && get(v, prevD, k - 1) < get(v, prevD, k + 1))) x = get(v, prevD, k + 1)
      else x = get(v, prevD, k - 1) + 1
      let y = x - k
      while (x < n && y < m && A(x) === B(y)) {
        x++
        y++
      }
      next[k + d + 1] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    trace.push(next)
    v = next
  }
  if (found === -1) return null

  // Walk back from (n, m): each step of d is one edit, then a run of equal lines (the snake) skipped.
  const runs: Hunk[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]
    const at = (k: number) => prev[k + d] // trace[d - 1] holds k in [-(d - 1), d - 1] from index 1
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    if (down) add(runs, head + prevX, head + prevX, B(prevY)) // b's line prevY inserted before a's line prevX
    else add(runs, head + prevX, head + prevX + 1, null) // a's line prevX deleted
    x = prevX
    y = prevY
  }
  return runs.reverse().map((r) => ({ ...r, lines: r.lines.reverse() }))
}

/** One edit onto the runs (built back to front): next to the run before it, it joins that run. */
function add(runs: Hunk[], start: number, end: number, line: string | null): void {
  const last = runs.at(-1)
  if (last !== undefined && last.start === end) {
    last.start = start
    if (line !== null) last.lines.push(line)
    return
  }
  runs.push({ start, end, lines: line === null ? [] : [line] })
}
