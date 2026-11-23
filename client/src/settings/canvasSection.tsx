/**
 * SETTINGS › CANVAS (YAZ-3037, YAZ-3028 D10; ported from Draw's 🔒 YAZ-1775 D9): one row per `CanvasPrefs`
 * key, writing the whole `SettingsState` with only `canvas` changed — the same store the rail's Writing /
 * Frames toggles and the engine's own read-back write, so the three can never disagree about a value.
 * Every drawing reads it: a drawing tab and the page embed's modal alike.
 *
 * Row ids are `canvas.<key>` — the registry's "the id names the field" rule, one level down, so a
 * spec that knows the field knows the row.
 *
 * WHICH CONTROL: the booleans are the settings' Off/On segmented pair; Select on, Sloppiness and
 * Text alignment are short vocabularies and stay segmented; Default font is a long list and so is
 * a `<select>` (the controls module's rule). The two pen widths are number fields that commit on
 * change and simply ignore anything that is not a width the engine could draw with.
 *
 * NOT HERE, ON PURPOSE: the toolbar mode is a constant (`YASEEN_FULL_TOOLBAR_MODE`), not a choice.
 * Canvas background is per BOARD, written into the file by the engine, so it lives in View › Canvas
 * Background. Theme is Appearance's row. Nor are the laser's trail, colour and size (Draw's 🔒 YAZ-1989
 * D1): they are `CanvasPrefs` so they are remembered and follow every window, but the laser's own
 * toolbar in the engine is the one place they are changed.
 */
import type { ReactNode } from 'react'
import { DEFAULT_CANVAS_PREFS, FOLD_ARROW_MIN_SIZE_MAX, FOLD_ARROW_MIN_SIZE_MIN, FOLD_ARROW_SIZE_MAX, FOLD_ARROW_SIZE_MIN, FONT_FAMILY_OPTIONS, NEW_TEXT_SCREEN_SIZE_MAX, NEW_TEXT_SCREEN_SIZE_MIN, NEW_TEXT_WRAP_MARGIN_MAX, SNAP_COLOR_PRESETS, type CanvasPrefs, type NewElementStyleMode, type FoldArrowMode, type FoldArrowThickness, type Roughness, type SelectOn, type SettingsState, type SnapGapStyle, type TextAlign, type TextEdgeDoubleClickMode } from '@shared/types'
import { Segmented, Select, Stepper } from './controls'
import { DIAGRAM_DARK_COLORS_OPTIONS, DRAWING_POSITION_OPTIONS, EMBED_REST_OPTIONS, newBoardFolderOptions, newPageDrawingOptions, ON_OFF_OPTIONS, type Option } from './options'
import { unit } from './unitLabel'
import type { SettingDef, SettingsSection } from './registry'

const SELECT_ON_OPTIONS: readonly Option<SelectOn>[] = [
  { value: 'wrap', label: 'Wrap' },
  { value: 'overlap', label: 'Overlap' },
]
const FONT_OPTIONS: readonly Option<number>[] = FONT_FAMILY_OPTIONS.map(({ id, label }) => ({ value: id, label }))
/** The engine's `ROUGHNESS` presets, in its own order and with its own names. */
const ROUGHNESS_OPTIONS: readonly Option<Roughness>[] = [
  { value: 0, label: 'Architect' },
  { value: 1, label: 'Artist' },
  { value: 2, label: 'Cartoonist' },
]
const TEXT_ALIGN_OPTIONS: readonly Option<TextAlign>[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

/** YAZ-4277 D14: what a new shape or text starts with. */
const NEW_ELEMENT_STYLE_OPTIONS: readonly Option<NewElementStyleMode>[] = [
  { value: 'default', label: 'Start with the default style' },
  { value: 'keep', label: 'Keep the last style' },
]

/** YAZ-5771: what a double click on a text box's left or right edge does. */
const TEXT_EDGE_DOUBLE_CLICK_OPTIONS: readonly Option<TextEdgeDoubleClickMode>[] = [
  { value: 'shrink', label: 'Only shrink' },
  { value: 'fit', label: 'Fit the text' },
]

/** YAZ-5986 D5: how equal-spacing gaps and Option-hover distances render. */
const SNAP_GAP_STYLE_OPTIONS: readonly Option<SnapGapStyle>[] = [
  { value: 'pill', label: 'Bracket + pill' },
  { value: 'bracket', label: 'Bracket only' },
  { value: 'band', label: 'Shaded band' },
]

const SNAP_COLOR_NAMES: Record<string, string> = {
  '#e024a7': 'Magenta',
  '#3b82f6': 'Blue',
  '#10b981': 'Green',
  '#f97316': 'Orange',
  '#ef4444': 'Red',
  '#8b5cf6': 'Purple',
}

function snapPillTextColor(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255
  return lum > 0.6 ? '#111111' : '#ffffff'
}

function SnapGapStylePreview({ style, color }: { style: SnapGapStyle; color: string }): ReactNode {
  const pillText = snapPillTextColor(color)
  return (
    <svg
      viewBox="0 0 116 36"
      width={116}
      height={36}
      aria-hidden="true"
      style={{
        display: 'block',
        marginTop: 6,
        borderRadius: 6,
        border: '1px solid var(--border, rgba(128,128,128,0.25))',
        background: 'var(--bg-subtle, transparent)',
      }}
    >
      {style === 'band' && (
        <>
          <rect x="28" y="6" width="19" height="24" fill={color} fillOpacity="0.18" />
          <rect x="69" y="6" width="19" height="24" fill={color} fillOpacity="0.18" />
        </>
      )}
      {style !== 'band' && (
        <>
          <line x1="28" y1="18" x2="47" y2="18" stroke={color} strokeWidth="1.2" />
          <line x1="28" y1="13" x2="28" y2="23" stroke={color} strokeWidth="1.2" />
          <line x1="47" y1="13" x2="47" y2="23" stroke={color} strokeWidth="1.2" />
          <line x1="69" y1="18" x2="88" y2="18" stroke={color} strokeWidth="1.2" />
          <line x1="69" y1="13" x2="69" y2="23" stroke={color} strokeWidth="1.2" />
          <line x1="88" y1="13" x2="88" y2="23" stroke={color} strokeWidth="1.2" />
        </>
      )}
      <rect x="6" y="6" width="22" height="24" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
      <rect x="47" y="6" width="22" height="24" rx="2" fill="none" stroke="#6366f1" strokeWidth="1.2" strokeDasharray="3 2" />
      <rect x="88" y="6" width="22" height="24" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
      {(style === 'pill' || style === 'band') && (
        <>
          <rect x="30" y={style === 'band' ? 12.5 : 22} width="15" height="11" rx="2.5" fill={color} />
          <text x="37.5" y={style === 'band' ? 20.5 : 30} textAnchor="middle" fill={pillText} fontSize="7.5" fontWeight="600" fontFamily="system-ui">20</text>
          <rect x="71" y={style === 'band' ? 12.5 : 22} width="15" height="11" rx="2.5" fill={color} />
          <text x="78.5" y={style === 'band' ? 20.5 : 30} textAnchor="middle" fill={pillText} fontSize="7.5" fontWeight="600" fontFamily="system-ui">20</text>
        </>
      )}
    </svg>
  )
}

/** YAZ-4277 D5, D7: the fold arrows of text boxes. */
const FOLD_ARROW_MODE_OPTIONS: readonly Option<FoldArrowMode>[] = [
  { value: 'hover', label: 'On hover' },
  { value: 'always', label: 'Always' },
  { value: 'off', label: 'Off (no folding)' },
]
const FOLD_ARROW_THICKNESS_OPTIONS: readonly Option<FoldArrowThickness>[] = [
  { value: 'thin', label: 'Thin' },
  { value: 'normal', label: 'Normal' },
  { value: 'thick', label: 'Thick' },
]

type BoolKey = { [K in keyof CanvasPrefs]: CanvasPrefs[K] extends boolean ? K : never }[keyof CanvasPrefs]
type WidthKey = 'writingStrokeWidth' | 'vectorStrokeWidth'

const write = (settings: SettingsState, patch: Partial<CanvasPrefs>): SettingsState => ({ ...settings, canvas: { ...settings.canvas, ...patch } })

const toggle = (key: BoolKey, label: string, hint?: string, keywords?: readonly string[]): SettingDef => ({
  id: `canvas.${key}`,
  label,
  hint,
  keywords,
  render: ({ settings, onChange }) => <Segmented options={ON_OFF_OPTIONS} value={settings.canvas[key]} onChange={(value) => onChange(write(settings, { [key]: value }))} ariaLabel={label} />,
})

/**
 * A width field, keyed by its value so a change arriving from another window (or from the engine)
 * remounts it with the new number instead of fighting what is being typed.
 */
function WidthField({ value, label, onCommit }: { value: number; label: string; onCommit: (next: number) => void }): ReactNode {
  return (
    <input
      type="number"
      className="settings__input settings__input--number"
      aria-label={label}
      min={0.1}
      max={100}
      step={0.1}
      defaultValue={value}
      key={value}
      onChange={(e) => {
        const next = Number(e.target.value)
        if (Number.isFinite(next) && next > 0 && next <= 100 && next !== value) onCommit(next)
      }}
    />
  )
}

/** A px setting of new text (YAZ-4247): the stepper, and Reset when it is not the default. A % one too (YAZ-4277 D7). */
function PxStepper({ name, value, fallback, min, max, step, unit, onSet }: { name: string; value: number; fallback: number; min: number; max: number; step: number; unit?: 'px' | '%'; onSet: (next: number) => void }) {
  return (
    <>
      <Stepper name={name} size={value} min={min} max={max} unit={unit} onStep={(delta) => onSet(Math.min(max, Math.max(min, value + delta * step)))} />
      {value !== fallback && (
        <button type="button" className="settings__option" onClick={() => onSet(fallback)}>
          Reset
        </button>
      )}
    </>
  )
}

const width = (key: WidthKey, label: string, hint: string): SettingDef => ({
  id: `canvas.${key}`,
  label,
  hint,
  keywords: ['pen', 'stroke', 'width'],
  render: ({ settings, onChange }) => <WidthField value={settings.canvas[key]} label={label} onCommit={(next) => onChange(write(settings, { [key]: next }))} />,
})

export const CANVAS_SECTION: SettingsSection = {
  id: 'canvas',
  // Draw's 🔒 YAZ-1802 D12 / D13: the canvas preferences are Excalidraw's alone; a draw.io diagram has fixed defaults.
  // "Drawings", as the app names them (the YAZ-3818 demo), and draw.io diagrams beside them, with their one row at the
  // end (YAZ-4748 D11); the old words still find it.
  title: 'Drawings and diagrams',
  keywords: ['excalidraw', 'canvas', 'board', 'drawio', 'draw.io', 'diagram'],
  groups: [
    {
      title: 'Drawing aids',
      // Sub-headings (YAZ-5969).
      subheadings: [
        { title: 'Snapping', rows: ['canvas.gridModeEnabled', 'canvas.objectsSnapModeEnabled', 'canvas.snapGapStyle', 'canvas.snapColor', 'canvas.showResizeSizeBadge', 'canvas.measureDistancesInfo'] },
        { title: 'Arrows', rows: ['canvas.snapToMidpoints', 'canvas.arrowBinding'] },
        { title: 'Selecting', rows: ['canvas.selectOn', 'canvas.hoverOutline', 'canvas.textEdgeDoubleClick'] },
      ],
      hint: 'Applies to every Excalidraw drawing, in every window.',
      items: [
        toggle('gridModeEnabled', 'Grid', undefined, ['grid mode']),
        toggle('objectsSnapModeEnabled', 'Snap to objects', 'Aligns edges, centers, frame centers, and equal gaps while dragging. Hold Cmd while dragging to pause snapping.', ['snapping', 'cmd', 'canva']),
        {
          id: 'canvas.snapGapStyle',
          label: 'Snap gap style',
          hint: 'How equal spacing looks while dragging or measuring distances.',
          keywords: ['snap', 'gap', 'pill', 'bracket', 'band', 'spacing', 'preview'],
          render: ({ settings, onChange }) => {
            const value = settings.canvas.snapGapStyle ?? DEFAULT_CANVAS_PREFS.snapGapStyle
            const color = settings.canvas.snapColor ?? DEFAULT_CANVAS_PREFS.snapColor
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Segmented options={SNAP_GAP_STYLE_OPTIONS} value={value} onChange={(snapGapStyle) => onChange(write(settings, { snapGapStyle }))} ariaLabel="Snap gap style" />
                <SnapGapStylePreview style={value} color={color} />
              </div>
            )
          },
        },
        {
          id: 'canvas.snapColor',
          label: 'Snap guide color',
          hint: 'Color for snap guides, gap spacing, and distance measurements.',
          keywords: ['snap', 'guide', 'color', 'colour', 'magenta', 'custom', 'picker', 'swatch'],
          render: ({ settings, onChange }) => {
            const value = (settings.canvas.snapColor ?? DEFAULT_CANVAS_PREFS.snapColor).toLowerCase()
            const isDefault = value === DEFAULT_CANVAS_PREFS.snapColor
            return (
              <span className="settings__band-colours" role="radiogroup" aria-label="Snap guide color">
                {SNAP_COLOR_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    role="radio"
                    aria-checked={value === hex}
                    aria-label={SNAP_COLOR_NAMES[hex] ?? hex}
                    title={SNAP_COLOR_NAMES[hex] ?? hex}
                    className="settings__band-colour"
                    onClick={() => onChange(write(settings, { snapColor: hex }))}
                  >
                    <span className="settings__band-swatch" style={{ background: hex }} aria-hidden />
                  </button>
                ))}
                <input
                  type="color"
                  className="settings__color"
                  aria-label="Custom snap guide color"
                  title={`Custom color (${value})`}
                  value={value}
                  onChange={(e) => onChange(write(settings, { snapColor: e.target.value.toLowerCase() }))}
                />
                {!isDefault && (
                  <button
                    type="button"
                    className="settings__option"
                    onClick={() => onChange(write(settings, { snapColor: DEFAULT_CANVAS_PREFS.snapColor }))}
                  >
                    Reset
                  </button>
                )}
              </span>
            )
          },
        },
        toggle('showResizeSizeBadge', 'Show size while resizing', 'Shows a live W x H pixel badge beside a shape while you resize it.', ['resize', 'size', 'badge', 'dimensions', 'width', 'height', 'pixel']),
        {
          id: 'canvas.measureDistancesInfo',
          label: 'Measure distances & Tidy up',
          hint: 'Select one or more shapes, hold Option (Alt) without clicking or dragging, then move over another shape or frame edge to see pixel distances (Option + drag makes a copy). Select 3+ shapes and right-click (or press Option+T) for Tidy up.',
          keywords: ['measure', 'distance', 'option', 'alt', 'hover', 'tidy up', 'distribute', 'spacing'],
          render: () => <span className="settings__hint">Hold Option + hover</span>,
        },
        toggle('snapToMidpoints', 'Snap to midpoints', "Arrows snap to the midpoint of a shape's edge.", ['snapping', 'midpoint']),
        toggle('arrowBinding', 'Arrow binding', 'Arrows attach to the shapes they touch.', ['bind']),
        {
          id: 'canvas.selectOn',
          label: 'Select on',
          hint: 'Wrap selects only what the box fully encloses; Overlap selects anything it touches.',
          keywords: ['box selection', 'contain', 'overlap'],
          render: ({ settings, onChange }) => <Segmented options={SELECT_ON_OPTIONS} value={settings.canvas.selectOn} onChange={(selectOn) => onChange(write(settings, { selectOn }))} ariaLabel="Select on" />,
        },
        // YAZ-4469 demo: the faint outline of what a click would pick, while the selection tool hovers.
        toggle('hoverOutline', 'Hover outline', "A faint outline shows what a click will pick, while you hover. A board's cog can choose its own.", ['hover', 'outline', 'highlight', 'select', 'selection']),
        {
          // YAZ-5771: like a column edge in a spreadsheet. Drawings only, not draw.io diagrams.
          id: 'canvas.textEdgeDoubleClick',
          label: 'Double-click a text box edge',
          hint: 'Only shrink: the box keeps its lines and loses its empty space. Fit the text: each paragraph goes on one line.',
          keywords: ['text box', 'edge', 'double click', 'width', 'fit', 'shrink', 'wrap', 'auto resize', 'snap'],
          render: ({ settings, onChange }) => (
            <Segmented options={TEXT_EDGE_DOUBLE_CLICK_OPTIONS} value={settings.canvas.textEdgeDoubleClick ?? DEFAULT_CANVAS_PREFS.textEdgeDoubleClick} onChange={(textEdgeDoubleClick) => onChange(write(settings, { textEdgeDoubleClick }))} ariaLabel="Double-click a text box edge" />
          ),
        },
      ],
    },
    {
      title: 'Modes',
      items: [
        toggle('toolLock', 'Tool lock', 'Keep the chosen tool after drawing with it.', ['keep tool']),
        toggle('zenModeEnabled', 'Zen mode', undefined, ['zen']),
        toggle('writingMode', 'Writing mode', 'The Writing toggle on the canvas rail is this same setting.', ['handwriting', 'pen']),
        toggle('framesVisible', 'Show frames', 'The frame outline and its name; frames still clip their contents when hidden.', ['frame']),
      ],
    },
    {
      title: 'New elements',
      // Sub-headings (YAZ-5969).
      subheadings: [
        { title: 'Shapes and lines', rows: ['canvas.newElementStyle', 'canvas.newShapesMatchZoom', 'canvas.fillSetsTextColor', 'canvas.writingStrokeWidth', 'canvas.vectorStrokeWidth'] },
        { title: 'Text', rows: ['canvas.defaultFontFamily', 'canvas.newTextScreenSize', 'canvas.newTextWrapMargin'] },
        { title: 'Default look', rows: ['canvas.defaultRoughness', 'canvas.defaultTextAlign'] },
      ],
      hint: 'What a shape or a line is born with; the toolbar still changes anything you have selected.',
      items: [
        {
          // YAZ-4277 D14: a red fill on one box no longer leaks into every later box.
          id: 'canvas.newElementStyle',
          label: 'New shapes and text',
          hint: 'Default style: a style you change on a selected shape stays on it, and the rows below change only here. A style you pick for a tool lasts until you choose the selection tool.',
          keywords: ['default style', 'last style', 'reset', 'new shape', 'color', 'fill'],
          render: ({ settings, onChange }) => (
            <Segmented options={NEW_ELEMENT_STYLE_OPTIONS} value={settings.canvas.newElementStyle ?? DEFAULT_CANVAS_PREFS.newElementStyle} onChange={(newElementStyle) => onChange(write(settings, { newElementStyle }))} ariaLabel="New shapes and text" />
          ),
        },
        // YAZ-4277 demo: a shape drawn zoomed in looks as one drawn at 100% (`screenScale.ts`).
        toggle('newShapesMatchZoom', 'New shapes match the zoom', 'A shape, arrow or line you draw keeps its line width, corners and arrowheads at the same size on screen at any zoom. The width and corner pickers use screen px.', ['zoom', 'line width', 'stroke', 'thick', 'corner', 'radius', 'arrowhead', 'scale']),
        // YAZ-4277 demo: a black or red fill makes the text white, so it stays readable.
        toggle('fillSetsTextColor', 'Text color follows the fill', 'A dark fill turns dark text white; a light fill turns white text black. Any other text color stays.', ['fill', 'background', 'contrast', 'white text', 'readable']),
        width('writingStrokeWidth', 'Writing pen width', `Default ${DEFAULT_CANVAS_PREFS.writingStrokeWidth}.`),
        width('vectorStrokeWidth', 'Vector stroke width', `Default ${DEFAULT_CANVAS_PREFS.vectorStrokeWidth}.`),
        {
          id: 'canvas.defaultFontFamily',
          label: 'Default font',
          hint: 'The font new text is born with.',
          keywords: ['font family', 'assistant', 'excalifont'],
          render: ({ settings, onChange }) => <Select options={FONT_OPTIONS} value={settings.canvas.defaultFontFamily} onChange={(defaultFontFamily) => onChange(write(settings, { defaultFontFamily }))} ariaLabel="Default font" />,
        },
        {
          // YAZ-4247: the same size on screen at every zoom; old text keeps its size.
          id: 'canvas.newTextScreenSize',
          label: 'New text size',
          hint: 'How big new text looks on screen, at any zoom. 16 is the size of page text.',
          keywords: ['text size', 'font size', 'drawing', 'zoom', 'new text', 'big', 'small'],
          render: ({ settings, onChange }) => (
            <PxStepper name="New text size" value={settings.canvas.newTextScreenSize ?? DEFAULT_CANVAS_PREFS.newTextScreenSize} fallback={DEFAULT_CANVAS_PREFS.newTextScreenSize}
              min={NEW_TEXT_SCREEN_SIZE_MIN} max={NEW_TEXT_SCREEN_SIZE_MAX} step={1} onSet={(newTextScreenSize) => onChange(write(settings, { newTextScreenSize }))} />
          ),
        },
        {
          // YAZ-4247: how far before the right edge of the view a click-started text starts to wrap.
          id: 'canvas.newTextWrapMargin',
          label: 'Wrap new text before the edge',
          hint: 'How far from the right edge of the screen new text starts a new line. 0 wraps at the edge.',
          keywords: ['wrap', 'text', 'edge', 'margin', 'line', 'drawing', 'new text'],
          render: ({ settings, onChange }) => (
            <PxStepper name="Wrap new text before the edge" value={settings.canvas.newTextWrapMargin ?? DEFAULT_CANVAS_PREFS.newTextWrapMargin} fallback={DEFAULT_CANVAS_PREFS.newTextWrapMargin}
              min={0} max={NEW_TEXT_WRAP_MARGIN_MAX} step={20} onSet={(newTextWrapMargin) => onChange(write(settings, { newTextWrapMargin }))} />
          ),
        },
        {
          id: 'canvas.defaultRoughness',
          label: 'Default sloppiness',
          hint: 'How hand-drawn new shapes look.',
          keywords: ['roughness', 'architect', 'artist', 'cartoonist'],
          render: ({ settings, onChange }) => (
            <Segmented options={ROUGHNESS_OPTIONS} value={settings.canvas.defaultRoughness} onChange={(defaultRoughness) => onChange(write(settings, { defaultRoughness }))} ariaLabel="Default sloppiness" />
          ),
        },
        {
          id: 'canvas.defaultTextAlign',
          label: 'Default text alignment',
          keywords: ['text align', 'center'],
          render: ({ settings, onChange }) => (
            <Segmented options={TEXT_ALIGN_OPTIONS} value={settings.canvas.defaultTextAlign} onChange={(defaultTextAlign) => onChange(write(settings, { defaultTextAlign }))} ariaLabel="Default text alignment" />
          ),
        },
      ],
    },
    {
      // YAZ-4277 D5, D7: the arrows that fold the bullets of a text box. A folded bullet always shows ▸.
      title: 'Fold arrows',
      hint: 'The arrows left of a bullet in a text box. A folded bullet always shows its arrow.',
      items: [
        {
          id: 'canvas.foldArrowsOpen',
          label: 'Fold arrows on open bullets',
          hint: "When an open bullet shows its arrow. A board's cog can choose its own.",
          keywords: ['fold', 'chevron', 'arrow', 'bullet', 'collapse', 'text box'],
          render: ({ settings, onChange }) => (
            <Segmented options={FOLD_ARROW_MODE_OPTIONS} value={settings.canvas.foldArrowsOpen ?? DEFAULT_CANVAS_PREFS.foldArrowsOpen} onChange={(foldArrowsOpen) => onChange(write(settings, { foldArrowsOpen }))} ariaLabel="Fold arrows on open bullets" />
          ),
        },
        {
          id: 'canvas.foldArrowSize',
          label: 'Fold arrow size',
          hint: 'In % of the text size.',
          keywords: ['fold', 'chevron', 'arrow', 'size', 'bullet'],
          render: ({ settings, onChange }) => (
            <PxStepper name="Fold arrow size" value={settings.canvas.foldArrowSize ?? DEFAULT_CANVAS_PREFS.foldArrowSize} fallback={DEFAULT_CANVAS_PREFS.foldArrowSize}
              min={FOLD_ARROW_SIZE_MIN} max={FOLD_ARROW_SIZE_MAX} step={10} unit="%" onSet={(foldArrowSize) => onChange(write(settings, { foldArrowSize }))} />
          ),
        },
        {
          id: 'canvas.foldArrowThickness',
          label: 'Fold arrow thickness',
          keywords: ['fold', 'chevron', 'arrow', 'thick', 'thin', 'line', 'bullet'],
          render: ({ settings, onChange }) => (
            <Segmented options={FOLD_ARROW_THICKNESS_OPTIONS} value={settings.canvas.foldArrowThickness ?? DEFAULT_CANVAS_PREFS.foldArrowThickness} onChange={(foldArrowThickness) => onChange(write(settings, { foldArrowThickness }))} ariaLabel="Fold arrow thickness" />
          ),
        },
        {
          id: 'canvas.foldArrowMinSize',
          label: 'Smallest fold arrow on screen',
          hint: 'Zoomed out, an arrow stops getting smaller at this size, so you see folded bullets from afar. Exports use the size alone.',
          keywords: ['fold', 'chevron', 'arrow', 'zoom', 'minimum', 'smallest', 'bullet'],
          render: ({ settings, onChange }) => (
            <PxStepper name="Smallest fold arrow on screen" value={settings.canvas.foldArrowMinSize ?? DEFAULT_CANVAS_PREFS.foldArrowMinSize} fallback={DEFAULT_CANVAS_PREFS.foldArrowMinSize}
              min={FOLD_ARROW_MIN_SIZE_MIN} max={FOLD_ARROW_MIN_SIZE_MAX} step={1} onSet={(foldArrowMinSize) => onChange(write(settings, { foldArrowMinSize }))} />
          ),
        },
      ],
    },
    {
      // YAZ-4820: a drawing or a diagram shown in a page as a window (D9), and a new one made from a page (item 3).
      // Before the draw.io group, which stays last (YAZ-4748 D11).
      title: (ctx) => unit(ctx, 'Embeds in pages'),
      items: [
        {
          id: 'embedRestSeconds',
          label: 'Embeds stop moving after',
          hint: 'An embed that you do not move for this time rests. Then the wheel scrolls the page. A click on the embed makes it move again.',
          keywords: ['embed', 'window', 'rest', 'resting', 'idle', 'scroll', 'wheel', 'freeze', 'timeout', 'drawing', 'diagram'],
          render: ({ settings, onChange }) => (
            <Segmented options={EMBED_REST_OPTIONS} value={settings.embedRestSeconds} onChange={(embedRestSeconds) => onChange({ ...settings, embedRestSeconds })} ariaLabel="Embeds stop moving after" />
          ),
        },
        {
          id: 'newPageDrawing',
          label: (ctx) => unit(ctx, 'New page drawings'),
          hint: (ctx) => unit(ctx, 'Where /drawing puts a new Excalidraw drawing inside a page.'),
          keywords: ['embed', 'inline', 'new drawing', 'excalidraw', 'slash', 'location'],
          render: (ctx) => (
            <Segmented options={newPageDrawingOptions((text) => unit(ctx, text))} value={ctx.settings.newPageDrawing} onChange={(newPageDrawing) => ctx.onChange({ ...ctx.settings, newPageDrawing })} ariaLabel={unit(ctx, 'New page drawings')} />
          ),
        },
        {
          id: 'newBoardFolder',
          label: 'New drawings and diagrams go to',
          // YAZ-5486: the active tab's vault's (`new-places.json`).
          hint: "Where /drawing and /diagram put the new file. The file gets the page's name. Saved in this vault.",
          keywords: ['embed', 'new drawing', 'new diagram', 'folder', 'assets', 'slash', 'location'],
          render: (ctx) => (
            <Segmented options={newBoardFolderOptions((text) => unit(ctx, text))} value={ctx.settings.newBoardFolder} onChange={(newBoardFolder) => ctx.onChange({ ...ctx.settings, newBoardFolder })} ariaLabel="New drawings and diagrams go to" />
          ),
        },
        {
          id: 'drawingPosition',
          label: 'Drawing position',
          hint: "Where drawings and diagrams sit in a page. A drawing's own Position menu can override this.",
          keywords: ['embed', 'drawing', 'diagram', 'position', 'align', 'alignment', 'left', 'center', 'centre'],
          render: ({ settings, onChange }) => (
            <Segmented options={DRAWING_POSITION_OPTIONS} value={settings.drawingPosition ?? 'left'} onChange={(drawingPosition) => onChange({ ...settings, drawingPosition })} ariaLabel="Drawing position" />
          ),
        },
      ],
    },
    {
      // YAZ-3037 (Draw's 🔒 YAZ-1802 D16), here since YAZ-4748 D11 (before: Appearance): the default for every diagram; a file
      // that sets its own `adaptiveColors` keeps it.
      title: 'draw.io diagrams',
      items: [
        {
          id: 'diagramDarkColors',
          label: 'In dark mode',
          hint: 'Adapt re-colours diagrams so they stay readable in dark mode. A diagram that asks to keep its own colours always does.',
          keywords: ['drawio', 'draw.io', 'diagram', 'dark', 'colors', 'colours', 'adaptive'],
          render: ({ settings, onChange }) => (
            <Segmented options={DIAGRAM_DARK_COLORS_OPTIONS} value={settings.diagramDarkColors} onChange={(diagramDarkColors) => onChange({ ...settings, diagramDarkColors })} ariaLabel="draw.io diagrams in dark mode" />
          ),
        },
      ],
    },
  ],
}
