/**
 * The Python Outline read from the text (YAZ-3486 S10; YAZ-3439 "The Python Outline is read from the
 * text, with no helper"): classes, methods, functions, nested ones, `async def`, decorators,
 * docstrings and strings that say "def", constants, long signatures, and the time on 5 000 lines.
 */
import { describe, expect, it } from 'vitest'
import type { CodeSymbol } from './outline/outlineModel'
import { pythonSymbols } from './pythonSymbols'

/** Each row as `kind name start-end`, nested by two spaces. */
function outline(symbols: readonly CodeSymbol[], depth = 0): string[] {
  return symbols.flatMap((s) => [`${'  '.repeat(depth)}${s.kind} ${s.name} ${s.range.startLineNumber}-${s.range.endLineNumber}`, ...outline(s.children ?? [], depth + 1)])
}

const CLASS = 4
const METHOD = 5
const FUNCTION = 11
const CONSTANT = 13

describe('pythonSymbols', () => {
  it('classes, methods, functions, nested classes and functions, async def; each row ends at its last line of code', () => {
    const text = [
      'class Greeter:', // 1
      '    """A greeter."""', // 2
      '    def hello(self, name):', // 3
      '        return "hi " + name', // 4
      '', // 5
      '    class Inner:', // 6
      '        async def ping(self):', // 7
      '            def local():', // 8
      '                pass', // 9
      '            return local', // 10
      '    # a comment after the method', // 11
      '', // 12
      'async def main():', // 13
      '    await Greeter().Inner().ping()', // 14
      '', // 15
    ].join('\n')
    expect(outline(pythonSymbols(text))).toEqual([`${CLASS} Greeter 1-10`, `  ${METHOD} hello 3-4`, `  ${CLASS} Inner 6-10`, `    ${METHOD} ping 7-10`, `      ${FUNCTION} local 8-9`, `${FUNCTION} main 13-14`])
    const [greeter] = pythonSymbols(text)
    // The cursor goes to the name: line 3, column 9.
    expect(greeter.children![0].selectionRange).toEqual({ startLineNumber: 3, startColumn: 9, endLineNumber: 3, endColumn: 14 })
    expect(pythonSymbols(text)[1].selectionRange.startColumn).toBe(11)
  })

  it('a decorator belongs to the next def or class: the row starts on it', () => {
    const text = ['@dataclass', '@other(', '    flag=True,', ')', 'class Point:', '    x: int = 0', '', '    @property', '    def norm(self):', '        return 1'].join('\n')
    expect(outline(pythonSymbols(text))).toEqual([`${CLASS} Point 1-10`, `  ${METHOD} norm 8-10`])
    // The name is still where the cursor goes.
    expect(pythonSymbols(text)[0].selectionRange.startLineNumber).toBe(5)
  })

  it('a tab-indented decorated row starts at its decorator\'s first character: one column per tab, not 8 (YAZ-3486 checker nit)', () => {
    const [cls] = pythonSymbols('class A:\n\t@property\n\tdef size(self):\n\t\treturn 1\n\t@staticmethod\n\tdef make():\n\t\treturn A()\n')
    expect(cls.children!.map((s) => [s.name, s.range.startLineNumber, s.range.startColumn])).toEqual([
      ['size', 2, 2],
      ['make', 5, 2],
    ])
    // Spaces as before: 4 spaces, column 5.
    const [spaced] = pythonSymbols('class A:\n    @property\n    def size(self):\n        return 1\n')
    expect(spaced.children![0].range.startColumn).toBe(5)
  })

  it('a docstring or a string that says "def" or "class" makes no row', () => {
    const text = [
      'def real():', // 1
      '    """', // 2
      'def fake():', // 3
      "    class Fake: '''", // 4
      '    """', // 5
      "    s = 'def nope(): pass'", // 6
      '    t = """class Nope: \\""" still"""', // 7
      "    u = '''", // 8
      'def also_fake(): ...', // 9
      "'''", // 10
      '', // 11
      'def after():  # def in a comment', // 12
      '    pass', // 13
    ].join('\n')
    expect(outline(pythonSymbols(text))).toEqual([`${FUNCTION} real 1-10`, `${FUNCTION} after 12-13`])
  })

  it('top-level UPPER_CASE assignments are constants; lower case, compares and nested ones are not', () => {
    const text = ['MAX_SIZE = 10', 'LIMIT: int = 40', 'VALUES = [', '    1,', '    2,', ']', 'name = "x"', 'FLAG == 2', 'class A:', '    INNER = 1', '_PRIVATE = 3'].join('\n')
    expect(outline(pythonSymbols(text))).toEqual([`${CONSTANT} MAX_SIZE 1-1`, `${CONSTANT} LIMIT 2-2`, `${CONSTANT} VALUES 3-6`, `${CLASS} A 9-10`, `${CONSTANT} _PRIVATE 11-11`])
  })

  it('a long def signature across lines, a `\\` continuation, and a body at a deeper indent all stay in one row', () => {
    const text = [
      'def long(', // 1
      '    a: int,', // 2
      'b: str = "x",', // 3: inside the brackets, the indent does not count
      ') -> None:', // 4
      '    total = a + \\', // 5
      'len(b)', // 6: after `\`, the indent does not count
      '    return None', // 7
      'def short(): return 1', // 8
    ].join('\n')
    expect(outline(pythonSymbols(text))).toEqual([`${FUNCTION} long 1-7`, `${FUNCTION} short 8-8`])
  })

  it('tabs count to the next multiple of 8, CRLF lines read the same, and an empty file has no rows', () => {
    expect(outline(pythonSymbols('class T:\r\n\tdef a(self):\r\n\t\tpass\r\n'))).toEqual([`${CLASS} T 1-3`, `  ${METHOD} a 2-3`])
    expect(pythonSymbols('')).toEqual([])
    expect(pythonSymbols('# only a comment\n\nprint(1)\n')).toEqual([])
  })

  it('5 000 lines in a few milliseconds', () => {
    const block = (i: number) => [`@decorator`, `class Model${i}:`, `    """Docs that mention def and class."""`, `    def method_a(self, x: int) -> int:`, `        return x + ${i}`, '', `    async def method_b(self):`, `        await thing(`, `            ${i},`, `        )`, '']
    const lines = [`LIMIT = 1`, ...Array.from({ length: 454 }, (_, i) => block(i)).flat()]
    expect(lines.length).toBeGreaterThanOrEqual(4995)
    const text = lines.join('\n')
    const t0 = performance.now()
    const symbols = pythonSymbols(text)
    const ms = performance.now() - t0
    expect(symbols).toHaveLength(1 + 454)
    expect(symbols[1].children!.map((c) => c.name)).toEqual(['method_a', 'method_b'])
    console.log(`[YAZ-3486 S10] pythonSymbols: ${lines.length} lines, ${1 + 454 * 3} rows in ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(100)
  })
})
