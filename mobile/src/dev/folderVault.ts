import { READER_FILES } from './readerVault'

/**
 * A MADE-UP VAULT WITH A FOLDER PAGE, for the tests and the screen fixtures: `Projects` has a `.folder.md`
 * with its own text and views (a table sorted by its due date, a table grouped by status with a filter, a board, the
 * cards and a calendar), its columns (a Select, a Date and a Number with the Mac's formats, a Text), a subfolder with a
 * column of its own, a page moved to Other files, a PDF beside its pages. No real vault, no network. Only tests and
 * the `--mode fixtures` build reach this file.
 */

const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`

/** The folder's settings, as the Mac writes them in `Projects/.folder.md`. */
export const PROJECTS_SETTINGS = `folder_settings:
  columns:
    Status:
      kind: select
      options: [Idea, Doing, Done]
    Due:
      kind: date
      format: { style: medium }
    Budget:
      kind: number
      format: { style: currency, currency: USD }
    Owner:
      kind: text
  defaultView: Table
  views:
    - type: page
      name: Page
    - type: table
      name: Table
      order: [file.name, note.Status, note.Due, note.Budget, note.Owner]
      sort:
        - { property: note.Due, direction: ASC }
      columnSize: { file.name: 220, note.Owner: 140 }
      columnAlign: { note.Budget: right }
    - type: table
      name: By status
      order: [file.name, note.Due, note.Owner]
      filters: 'Status != "Done"'
      groupBy: { property: note.Status }
      sort:
        - { property: file.name, direction: ASC }
    - type: board
      name: Board
      order: [file.name, note.Owner, note.Due]
      groupBy: { property: note.Status }
    - type: cards
      name: Cards
      order: [file.name, note.Status, note.Owner]
    - type: calendar
      name: Calendar
      dateProperty: note.Due
  other_files:
    - "[[Old plan]]"
`

const project = (title: string, id: string, status: string, due: string, budget: number, owner: string, body: string) =>
  page(`title: ${title}\nid: ${id}\nStatus: ${status}\nDue: ${due}\nBudget: ${budget}\nOwner: ${owner}\n`, body)

export const FOLDER_FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Projects/.folder.md': page(`title: Projects\nid: DEMO-90\n${PROJECTS_SETTINGS}`, '# Projects\n\nEvery project of the year, one page each. The **Table** shows them by due date; see [[Trip plan]] for the trip.'),
  'Projects/Garden shed.md': project('Garden shed', 'DEMO-91', 'Doing', '2026-11-20', 1200, 'Sam', 'Build the shed before winter.'),
  'Projects/Kitchen paint.md': project('Kitchen paint', 'DEMO-92', 'Idea', '2026-12-05', 300, 'Ana', 'Pick a soft green.'),
  'Projects/Bike repair.md': project('Bike repair', 'DEMO-93', 'Done', '2026-11-02', 85.5, 'Sam', 'New chain and brakes.'),
  'Projects/Photo album.md': project('Photo album', 'DEMO-94', 'Idea', '2026-11-28', 60, 'Lee', 'The summer pictures.'),
  'Projects/Old plan.md': project('Old plan', 'DEMO-95', 'Idea', '2026-10-01', 0, 'Ana', 'Moved to Other files.'),
  'Projects/Trips/.folder.md': page('title: Trips\nid: DEMO-96\n', ''),
  'Projects/Trips/Lisbon weekend.md': project('Lisbon weekend', 'DEMO-97', 'Doing', '2026-11-14', 640, 'Lee', 'Three days by the sea.'),
  'Projects/Budget sheet.pdf': new TextEncoder().encode('%PDF-1.4 made up'),
}

/**
 * YAZ-5597: a made-up `Events` folder for the calendar's Month / Week / Rolling: a calendar on Start with an End date,
 * pages around `today` (a few months back and on), one over several days across a week's start, two with no date.
 */
export function calendarFiles(today: string): Record<string, string | Uint8Array> {
  const day = (offset: number) => {
    const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const event = (title: string, start: number | null, place: string, end?: number) =>
    page(`title: ${title}\n${start === null ? '' : `Start: ${day(start)}\n`}${end === undefined ? '' : `End: ${day(end)}\n`}Place: ${place}\n`, `${title}.`)
  return {
    ...FOLDER_FILES,
    'Events/.folder.md': page(`title: Events\nfolder_settings:
  columns:
    Start:
      kind: date
      format: { style: medium }
    End:
      kind: date
      format: { style: medium }
    Place:
      kind: text
  views:
    - type: calendar
      name: Calendar
      dateProperty: note.Start
      endDateProperty: note.End
      order: [file.name, note.Place]
`, '# Events'),
    'Events/Winter fair.md': event('Winter fair', -70, 'Town hall'),
    'Events/Book club.md': event('Book club', -40, 'Library'),
    'Events/Choir night.md': event('Choir night', -12, 'Church hall'),
    'Events/Dentist.md': event('Dentist', -3, 'Main street'),
    'Events/Ski trip.md': event('Ski trip', -2, 'Alps', 3),
    'Events/Team lunch.md': event('Team lunch', 0, 'Cafe Nero'),
    'Events/Yoga class.md': event('Yoga class', 1, 'Studio 4'),
    'Events/Piano lesson.md': event('Piano lesson', 4, 'Music school'),
    'Events/Car service.md': event('Car service', 9, 'Garage'),
    'Events/Family dinner.md': event('Family dinner', 20, 'Home'),
    'Events/Concert.md': event('Concert', 33, 'Arena'),
    'Events/New year party.md': event('New year party', 47, 'Rooftop'),
    'Events/Gift ideas.md': event('Gift ideas', null, 'Anywhere'),
    'Events/Reading list.md': event('Reading list', null, 'Home'),
  }
}
