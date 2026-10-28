/**
 * The code Outline's kinds (YAZ-3486): a name for each in the "…" menu, and a type icon on each row.
 *
 * The icons are VS Code's families — a class is a box, a method a cube, a field a tag, a variable
 * a pair of brackets — in the app's stroke (the find bar's and the pin's 1.4 px line). The colour
 * of each family is `outline.css`'s, in light and dark.
 */
import { CODE_SYMBOL_KINDS } from '@shared/types'

/** The family of each kind: one icon and one colour for each. */
export type KindFamily = 'class' | 'method' | 'field' | 'variable' | 'constant' | 'interface' | 'enum' | 'module' | 'value'

/** By Monaco's `SymbolKind` number. */
const FAMILY: readonly KindFamily[] = [
  'module', // file
  'module', // module
  'module', // namespace
  'module', // package
  'class', // class
  'method', // method
  'field', // property
  'field', // field
  'method', // constructor
  'enum', // enum
  'interface', // interface
  'method', // function
  'variable', // variable
  'constant', // constant
  'value', // string
  'value', // number
  'value', // boolean
  'value', // array
  'class', // object
  'field', // key
  'value', // null
  'enum', // enumMember
  'class', // struct
  'field', // event
  'method', // operator
  'interface', // typeParameter
]

/** The rows of "…" › Show, as VS Code names them. */
const LABEL: readonly string[] = ['Files', 'Modules', 'Namespaces', 'Packages', 'Classes', 'Methods', 'Properties', 'Fields', 'Constructors', 'Enums', 'Interfaces', 'Functions', 'Variables', 'Constants', 'Strings', 'Numbers', 'Booleans', 'Arrays', 'Objects', 'Keys', 'Null', 'Enum members', 'Structs', 'Events', 'Operators', 'Type parameters']

/** The singular, for a row's tooltip. */
const ONE: readonly string[] = ['File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'Enum member', 'Struct', 'Event', 'Operator', 'Type parameter']

export const kindLabel = (kind: number): string => LABEL[kind] ?? 'Variables'
export const kindName = (kind: number): string => ONE[kind] ?? 'Variable'
export const kindFamily = (kind: number): KindFamily => FAMILY[kind] ?? 'variable'
/** The settings' name of a kind (`codeOutlineHidden`). */
export const kindId = (kind: number) => CODE_SYMBOL_KINDS[kind] ?? 'variable'

const PATHS: Record<KindFamily, string> = {
  class: 'M3 4.5h10v7.5H3zM3 7.5h10M6.5 7.5v4.5',
  method: 'M8 2.5l5 2.75v5.5L8 13.5l-5-2.75v-5.5zM3 5.25 8 8l5-2.75M8 8v5.5',
  field: 'M2.75 8.75 8.5 3h4.5v4.5l-5.75 5.75zM10.75 5.25h.01',
  variable: 'M5.5 4H3.5v8h2M10.5 4h2v8h-2M6.5 8h3',
  constant: 'M3 4.5h10v7H3zM5.75 7h4.5M5.75 9.5h4.5',
  interface: 'M5 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7.5 8h6',
  enum: 'M3 4.5h4M3 8h4M3 11.5h4M9.5 4.5h3.5v7H9.5z',
  module: 'M6 3c-1.5 0-1.5 1-1.5 2.5S4 8 3 8c1 0 1.5 1 1.5 2.5S4.5 13 6 13M10 3c1.5 0 1.5 1 1.5 2.5S12 8 13 8c-1 0-1.5 1-1.5 2.5S11.5 13 10 13',
  value: 'M4 5.5h8M4 8h8M4 10.5h5',
}

/** A row's type icon: 14 px, the family's colour (`outline.css`, `data-family`). */
export function OutlineIcon({ kind }: { kind: number }) {
  const family = kindFamily(kind)
  return (
    <svg className="outline__icon" data-family={family} width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[family]} />
    </svg>
  )
}
