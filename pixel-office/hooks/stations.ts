import type { Point, StationId } from '../types'
import { commandIntent, explainCommand } from './commands'

export { explainCommand }

export const WIDTH = 240
export const HEIGHT = 150
export const CORRIDOR_Y = 88
export const DESK_COUNT = 8

export type StationDef = {
  name: string
  tools: string
  color: string
  slots: readonly Point[]
  door: Point | null
  slotDoors?: readonly Point[]
}

export const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi)

// What XML 1.0 refuses: everything below space except tab, line feed and carriage return, delete, the two
// non-characters U+FFFE and U+FFFF, and any UTF-16 surrogate that is not half of a proper pair. The first
// alternative is a proper pair, which is kept (`$1`); a surrogate it did not take is a lone one and goes.
const UNSAFE = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uD800-\uDFFF\uFFFE\uFFFF]/g

export const stripControls = (text: string): string => text.replace(UNSAFE, '$1')

// Fits `text` to `max` characters, counting and cutting by code point so an emoji is never split in half.
export function clip(text: string, max = 24): string {
  const chars = Array.from(stripControls(text.replace(/\s+/g, ' ')).trim())
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

const DESK_SEATS: Point[] = Array.from({ length: DESK_COUNT }, (_, i) => ({
  x: 86 + 22 * (i % 4),
  y: 42 + 30 * Math.floor(i / 4),
}))

const MEETING_SEATS: Point[] = [
  { x: 98, y: 140 },
  { x: 110, y: 140 },
  { x: 122, y: 140 },
  { x: 98, y: 114 },
  { x: 110, y: 114 },
  { x: 122, y: 114 },
  { x: 134, y: 140 },
]

export const STATIONS: Record<StationId, StationDef> = {
  office: {
    name: 'Corner office',
    tools: "Main's home base, thinking",
    color: '#d97757',
    slots: [{ x: 27, y: 50 }],
    door: { x: 55, y: 62 },
  },
  desk: {
    name: 'Desks',
    tools: 'Edit, Write, NotebookEdit',
    color: '#378add',
    slots: DESK_SEATS,
    door: null,
    slotDoors: DESK_SEATS.map(p => ({ x: p.x + 11, y: p.y })),
  },
  library: {
    name: 'Records library',
    tools: 'Read, Grep, Glob, LSP, Skill, ToolSearch',
    color: '#7f77dd',
    slots: [
      { x: 184, y: 44 },
      { x: 194, y: 44 },
      { x: 204, y: 44 },
      { x: 216, y: 44 },
      { x: 228, y: 44 },
    ],
    door: { x: 172, y: 44 },
  },
  phone: {
    name: 'Phone booths',
    tools: 'WebFetch, WebSearch',
    color: '#e24b4a',
    slots: [
      { x: 220, y: 78 },
      { x: 234, y: 78 },
    ],
    door: null,
  },
  mailroom: {
    name: 'Mailroom',
    tools: 'Outside services (mcp__ tools)',
    color: '#ba7517',
    slots: [
      { x: 186, y: 80 },
      { x: 198, y: 80 },
    ],
    door: null,
  },
  server: {
    name: 'Server room',
    tools: 'Bash, PowerShell, background shells',
    color: '#639922',
    slots: [
      { x: 191, y: 142 },
      { x: 207, y: 142 },
      { x: 223, y: 142 },
    ],
    door: { x: 184, y: 94 },
  },
  meeting: {
    name: 'Meeting room',
    tools: 'Briefings, SendMessage',
    color: '#1d9e75',
    slots: MEETING_SEATS,
    door: null,
    slotDoors: MEETING_SEATS.map(p => ({ x: 68, y: p.y })),
  },
  taskboard: {
    name: 'Task board',
    tools: 'TodoWrite, Task tools, plan updates',
    color: '#ef9f27',
    slots: [
      { x: 82, y: 20 },
      { x: 92, y: 20 },
    ],
    door: { x: 97, y: 20 },
  },
  reception: {
    name: 'Reception',
    tools: 'Waiting on you: questions, permissions, plan approval',
    color: '#d4537e',
    slots: [
      { x: 44, y: 144 },
      { x: 56, y: 144 },
    ],
    door: { x: 66, y: 144 },
  },
  elevator: {
    name: 'Elevator',
    tools: 'Agents arrive and leave',
    color: '#888780',
    slots: [{ x: 16, y: 138 }],
    door: { x: 32, y: 138 },
  },
  breakroom: {
    name: 'Break room',
    tools: 'Idle agents',
    color: '#5dcaa5',
    slots: [
      { x: 26, y: 82 },
      { x: 40, y: 84 },
      { x: 10, y: 102 },
      { x: 18, y: 102 },
      { x: 26, y: 102 },
    ],
    door: null,
  },
}

export const STATION_ORDER: readonly StationId[] = [
  'office',
  'desk',
  'library',
  'phone',
  'mailroom',
  'server',
  'meeting',
  'taskboard',
  'reception',
  'elevator',
  'breakroom',
]

const TOOL_STATIONS: Readonly<Record<string, StationId>> = {
  Edit: 'desk',
  MultiEdit: 'desk',
  Write: 'desk',
  NotebookEdit: 'desk',
  Read: 'library',
  Grep: 'library',
  Glob: 'library',
  LSP: 'library',
  Skill: 'library',
  ToolSearch: 'library',
  Bash: 'server',
  PowerShell: 'server',
  BashOutput: 'server',
  KillShell: 'server',
  Monitor: 'server',
  TaskStop: 'server',
  WebFetch: 'phone',
  WebSearch: 'phone',
  SendMessage: 'meeting',
  TodoWrite: 'taskboard',
  TaskCreate: 'taskboard',
  TaskUpdate: 'taskboard',
  TaskList: 'taskboard',
  TaskGet: 'taskboard',
  AskUserQuestion: 'reception',
  ExitPlanMode: 'reception',
}

export const WAITING_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

export function stationFor(tool: string): StationId {
  const known = TOOL_STATIONS[tool]
  if (known !== undefined) return known
  if (/^mcp__.+__(update_plan|wrap_up)$/.test(tool)) return 'taskboard'
  if (tool.startsWith('mcp__')) return 'mailroom'
  return 'desk'
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

// What the bubble over an agent says about a command. Claude's own description of it is the most particular, so it
// is used when it fits a bubble; else what the command is for, read from its first real step; else (a program the
// office does not know) that step as typed, past the `cd` and variables in front of it.
const BUBBLE_MAX = 28
function commandTarget(description: string, command: string): string {
  const said = description.trim()
  if (said !== '' && Array.from(said).length <= BUBBLE_MAX) return clip(said, BUBBLE_MAX)
  const intent = commandIntent(command)
  if (intent.phrase !== '') return clip(intent.phrase, BUBBLE_MAX)
  return clip(said !== '' ? said : intent.step, BUBBLE_MAX)
}

// The active item of a to-do list, said as the list says it: "Fixing the login bug".
function activeTodo(input: Record<string, unknown>): string {
  const todos = input.todos
  if (!Array.isArray(todos)) return ''
  const items = todos.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
  const active = items.find(t => t.status === 'in_progress') ?? items.find(t => t.status === 'pending')
  const words = active === undefined ? '' : (active.activeForm ?? active.content)
  return typeof words === 'string' ? words : ''
}

// What a call to an outside service (an MCP tool) is about: the first of the arguments that names a thing.
const SUBJECT_KEYS = ['title', 'subject', 'name', 'query', 'q', 'path', 'file', 'repo', 'url', 'id', 'text']

export function targetOf(tool: string, input: Record<string, unknown>): string {
  const str = (key: string): string => {
    const value = input[key]
    return typeof value === 'string' ? value : ''
  }
  if (str('file_path')) return clip(baseName(str('file_path')))
  if (str('notebook_path')) return clip(baseName(str('notebook_path')))
  if (tool === 'TodoWrite' && activeTodo(input) !== '') return clip(activeTodo(input), BUBBLE_MAX)
  if (str('command')) return commandTarget(str('description'), str('command'))
  if (str('pattern')) {
    // A search says where it looks when it was pointed somewhere: `login in src`.
    const where = str('path') || str('glob')
    return clip(where === '' ? str('pattern') : `${str('pattern')} in ${baseName(where)}`)
  }
  if (str('query')) return clip(str('query'))
  if (str('url')) {
    try {
      return clip(new URL(str('url')).host)
    } catch {
      return clip(str('url'))
    }
  }
  if (str('skill')) return clip(str('skill'))
  if (str('to')) return clip(str('to'))
  if (str('description')) return clip(str('description'))
  if (str('subject')) return clip(str('subject'))
  if (tool.startsWith('mcp__')) {
    const key = SUBJECT_KEYS.find(k => str(k) !== '')
    return clip(key === undefined ? (tool.split('__')[1] ?? tool) : str(key))
  }
  return ''
}

// A short, readable excerpt of free text (a brief, a report, a message): Markdown heading marks, bold and code
// ticks dropped, everything on one line, cut to `max` characters.
export function gist(text: string, max: number): string {
  return clip(text.replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*|__|`/g, ''), max)
}

// How long the one-line excerpt of a brief or a report is.
export const EXCERPT = 200

// Free text kept to be read in full (a brief, a report): line breaks stay, as Markdown needs them, and so do
// tabs; every other control character goes, Windows line ends become plain ones, runs of blank lines shrink
// to one, and it is cut to `max` characters by code point.
export function fullText(text: string, max: number): string {
  const lines = stripControls(text.replace(/\r\n?/g, '\n')).replace(/\n{3,}/g, '\n\n').trim()
  const chars = Array.from(lines)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : lines
}

// The plain-English gist of a call, from what Claude wrote into its input: the description it gives every
// command (falling back to what the command is commonly for), or the summary of a message. Empty otherwise.
export function detailOf(tool: string, input: Record<string, unknown>): string {
  const str = (key: string): string => {
    const value = input[key]
    return typeof value === 'string' ? value : ''
  }
  if (tool === 'Bash' || tool === 'PowerShell') return gist(str('description'), 60) || explainCommand(str('command'))
  if (tool === 'SendMessage') return gist(str('summary') || (str('message').split('\n')[0] ?? ''), 48)
  return ''
}

export function todoCounts(input: Record<string, unknown>): { done: number; open: number } | null {
  const list = Array.isArray(input.todos) ? input.todos : Array.isArray(input.items) ? input.items : null
  if (list === null) return null
  let done = 0
  let open = 0
  for (const item of list) {
    if ((item as { status?: unknown } | null)?.status === 'completed') done += 1
    else open += 1
  }
  return { done, open }
}

export function slotPoint(station: StationId, slot: number): Point {
  const { slots } = STATIONS[station]
  const exact = slots[slot]
  if (exact !== undefined) return exact
  const last = slots[slots.length - 1] as Point
  const k = slot - slots.length + 1
  return { x: clamp(last.x - 7 * k, 4, WIDTH - 4), y: clamp(last.y + 3 * k, 16, HEIGHT - 2) }
}

export function doorOf(station: StationId, slot: number): Point {
  const def = STATIONS[station]
  return def.slotDoors?.[slot] ?? def.door ?? slotPoint(station, slot)
}

function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last === undefined || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p)
  }
  return out
}

export function route(from: Point, fromDoor: Point, to: Point, toDoor: Point): Point[] {
  return dedupe([
    from,
    { x: fromDoor.x, y: from.y },
    fromDoor,
    { x: fromDoor.x, y: CORRIDOR_Y },
    { x: toDoor.x, y: CORRIDOR_Y },
    toDoor,
    { x: toDoor.x, y: to.y },
    to,
  ])
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

export function pathLength(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1] as Point, points[i] as Point)
  return total
}

export function splitAt(points: readonly Point[], fraction: number): Point[] {
  if (points.length === 0) return []
  let remaining = pathLength(points) * clamp(fraction, 0, 1)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    const seg = dist(a, b)
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg
      return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...points.slice(i)]
    }
    remaining -= seg
  }
  return [points[points.length - 1] as Point]
}

export function pointAlong(points: readonly Point[], fraction: number): Point {
  return splitAt(points, fraction)[0] ?? { x: 0, y: 0 }
}
