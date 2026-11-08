import { lstat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { AutomationFailure } from '@shared/automation'
import type { BoardExportOptions, BoardImage, BoardImageFormat } from '@shared/automationEditor'
import { createDurable, fsCall } from '../fs/fsUtils'
import type { printSvgToPdf } from '../drawings/printPdf'
import type { NavigationHost } from './navigation'
import { absolute } from './resources'

/**
 * A live board's GUI export with an explicit new output file (YAZ-4515): the renderer makes the export box's bytes
 * (or the PDF's SVG, which main prints with the export box's own printer). No dialog; the board file is untouched.
 */
export async function boardImageCommand(host: NavigationHost, command: string, args: Record<string, unknown>, print: typeof printSvgToPdf) {
  const kind = command.split('.')[0] as 'drawing' | 'diagram', window = args.window as string, tab = args.tab as string
  const format = args.format as BoardImageFormat, outputFile = absolute(args.outputFile as string)
  if (!host.windows().some(entry => entry.id === window)) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The requested window is not live.')
  if (extname(outputFile).toLowerCase() !== `.${format}`) throw new AutomationFailure('INVALID_INPUT', `The output file must end in .${format}.`)
  if (format === 'pdf' && (args.scale !== undefined || args.embedScene !== undefined)) throw new AutomationFailure('INVALID_INPUT', 'A PDF takes no scale or embedded scene, as in the export box.')
  // Refuse a taken name before rendering; the exclusive create below still decides a race.
  if (await lstat(outputFile).then(() => true, () => false)) throw new AutomationFailure('ALREADY_EXISTS', 'The output file exists. Choose a new path.')
  const options: BoardExportOptions = Object.fromEntries(['background', 'darkMode', 'scale', 'embedScene', 'selectionOnly'].filter(key => args[key] !== undefined).map(key => [key, args[key]]))
  const image = await host.operate(window, { command: 'board.export', tab, kind, format, options }) as BoardImage
  const bytes = image.format === 'pdf' ? await print(image.svg, { width: image.width, height: image.height }, basename(outputFile, extname(outputFile))) : Buffer.from(image.data)
  await fsCall(outputFile, () => createDurable(outputFile, bytes))
  return { window, tab, path: image.path, format, outputFile, size: bytes.length, dirty: image.dirty, source: 'live', diskSaved: true }
}
