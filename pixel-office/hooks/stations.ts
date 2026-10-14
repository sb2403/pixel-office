import type { Point, StationId } from '../types'

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

// Everything below space except tab, line feed and carriage return, plus delete: XML 1.0 refuses these.
const CONTROLS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

export const stripControls = (text: string): string => text.replace(CONTROLS, '')

export function clip(text: string, max = 24): string {
  const flat = stripControls(text.replace(/\s+/g, ' ')).trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
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

export function targetOf(tool: string, input: Record<string, unknown>): string {
  const str = (key: string): string => {
    const value = input[key]
    return typeof value === 'string' ? value : ''
  }
  if (str('file_path')) return clip(baseName(str('file_path')))
  if (str('notebook_path')) return clip(baseName(str('notebook_path')))
  if (str('command')) return clip(str('command'))
  if (str('pattern')) return clip(str('pattern'))
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
  if (tool.startsWith('mcp__')) return clip(tool.split('__')[1] ?? tool)
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
