/**
 * CSS read as text, for the tests that check a rule beats Crepe's reset by specificity (jsdom computes no imported
 * sheet): `boardWindow.css.test.ts`, `noteCard.css.test.ts`. Test code only; nothing in the app imports it.
 */

/** Every rule of `css` whose selector holds `part`, with its body (comments out). */
export function rules(css: string, part: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim()
    if (selector.includes(part)) out.push({ selector, body: m[2]! })
  }
  return out
}

/** The specificity of one simple selector of this file's kind: classes, pseudo-classes, elements; `:is()` its most specific argument. */
export function specificity(selector: string): [number, number, number] {
  let rest = selector
  const total: [number, number, number] = [0, 0, 0]
  const add = (s: [number, number, number]) => s.forEach((v, i) => (total[i] += v))
  // `:is(a, b)` and `:not(a)`: the most specific argument (no nesting in this file).
  rest = rest.replace(/:(?:is|not)\(([^()]*)\)/g, (_m, args: string) => {
    const best = args.split(',').map((a) => specificity(a.trim())).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]!
    add(best)
    return ' '
  })
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  total[2] += (rest.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+|#[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return total
}

export const beats = (a: [number, number, number], b: [number, number, number]) => a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))
