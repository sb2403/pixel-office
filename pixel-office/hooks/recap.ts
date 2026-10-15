import type { Agent, JobRecord, Outcome, Scene } from '../types'
import { MAIN } from './model'
import { escapeXml } from './render'
import { tokenCount } from './roles'
import { clip } from './stations'

// How each agent worked with Main in this job: Main itself, a helper Main waited for, or one working alongside
// (in the background, or a teammate). The recap colors its bars by this, not by role: the role is the row's name
// already, and these three are the colors that stay apart for every reader, with any two of them side by side.
export type LaneKind = 'main' | 'waited' | 'alongside'

export type Lane = {
  id: string
  label: string
  depth: number
  kind: LaneKind
  start: number
  end: number
  isOpen: boolean
  outcome: Outcome | null
  tokens: number | null
}

export type Recap = {
  task: string
  startedAt: number
  endedAt: number
  isOpen: boolean
  lanes: Lane[]
  helpers: number
  // Every helper's time added up, and the time during which at least one helper was at work.
  helperMs: number
  togetherMs: number
  peak: number
  tokens: number | null
}

// A helper belongs to the job it was hired (or called back) in. A called-back helper's tokens are all its work,
// earlier stints included: the engine reports them per turn, and the office adds them up.
export function recapOf(scene: Scene, now: number): Recap | null {
  const job = scene.job
  if (job === null) return null
  const isInJob = (a: Agent): boolean => a.id !== MAIN && a.arrivedAt >= job.startedAt
  const children = new Map<string, string[]>()
  for (const id of scene.order) {
    const a = scene.agents[id]
    if (a === undefined || !isInJob(a)) continue
    const parent = a.parentId !== null && scene.agents[a.parentId] !== undefined && (a.parentId === MAIN || isInJob(scene.agents[a.parentId] as Agent)) ? a.parentId : MAIN
    children.set(parent, [...(children.get(parent) ?? []), id])
  }
  const lanes: Lane[] = []
  const visit = (id: string, depth: number): void => {
    const a = scene.agents[id]
    if (a === undefined) return
    if (id === MAIN) {
      lanes.push({
        id,
        label: a.label,
        depth,
        kind: 'main',
        start: job.startedAt,
        end: job.endedAt ?? now,
        isOpen: job.endedAt === null,
        outcome: null,
        tokens: job.mainUsage?.tokens ?? null,
      })
    } else {
      const isOpen = a.doneAt === null && a.phase !== 'gone' && a.phase !== 'idle'
      lanes.push({
        id,
        label: a.label,
        depth,
        kind: a.isBackground || a.isTeammate ? 'alongside' : 'waited',
        start: a.arrivedAt,
        end: a.doneAt ?? (isOpen ? now : Math.max(a.arrivedAt, a.lastEventAt)),
        isOpen,
        outcome: a.outcome,
        tokens: a.usage?.tokens ?? null,
      })
    }
    for (const child of children.get(id) ?? []) visit(child, depth + 1)
  }
  visit(MAIN, 0)
  const helpers = lanes.filter(l => l.kind !== 'main')
  const counted = lanes.filter(l => l.tokens !== null)
  return {
    task: job.task,
    startedAt: job.startedAt,
    endedAt: Math.max(...lanes.map(l => l.end)),
    isOpen: lanes.some(l => l.isOpen),
    lanes,
    helpers: helpers.length,
    helperMs: helpers.reduce((sum, l) => sum + (l.end - l.start), 0),
    togetherMs: unionMs(helpers),
    peak: peakOf(helpers),
    tokens: counted.length === 0 ? null : counted.reduce((sum, l) => sum + (l.tokens ?? 0), 0),
  }
}

// How long at least one of them was at work: their spans merged where they overlap, then added up.
function unionMs(lanes: readonly Lane[]): number {
  const spans = lanes.map(l => [l.start, l.end] as const).sort((a, b) => a[0] - b[0])
  let total = 0
  let open: [number, number] | null = null
  for (const [s, e] of spans) {
    if (open === null || s > open[1]) {
      if (open !== null) total += open[1] - open[0]
      open = [s, e]
    } else open[1] = Math.max(open[1], e)
  }
  return open === null ? total : total + open[1] - open[0]
}

// The most helpers at work at the same moment. An end and a start at the same moment do not overlap.
function peakOf(lanes: readonly Lane[]): number {
  const marks = lanes.flatMap(l => [
    { at: l.start, step: 1 },
    { at: l.end, step: -1 },
  ])
  marks.sort((a, b) => a.at - b.at || a.step - b.step)
  let now = 0
  let peak = 0
  for (const m of marks) {
    now += m.step
    peak = Math.max(peak, now)
  }
  return peak
}

// 45s, 4m 10s, 1h 2m.
export function span(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const ENDINGS: Record<Outcome, string> = { reported: 'handed in its report', stopped: 'was stopped', failed: 'ran into a problem' }

function endingOf(lane: Lane): string {
  if (lane.isOpen) return 'still working'
  if (lane.kind === 'main') return 'finished'
  return lane.outcome === null ? 'went quiet' : ENDINGS[lane.outcome]
}

// Doing the helpers' work one after another would take all their time added up; together it took less. Said
// only when it is a real saving, with two or more helpers.
export function speedUp(recap: Recap): number | null {
  if (recap.helpers < 2 || recap.togetherMs <= 0) return null
  const ratio = recap.helperMs / recap.togetherMs
  return ratio >= 1.2 ? ratio : null
}

// The recap in words: what the job was, how long it took, how many helpers and how much at once, what it cost,
// and what working in parallel bought. These lines stand on their own without the picture.
export function recapSummary(recap: Recap): string[] {
  const took = `${recap.isOpen ? 'Running for' : 'Took'} ${span(recap.endedAt - recap.startedAt)}`
  const crew =
    recap.helpers === 0
      ? 'no helpers'
      : `${recap.helpers} helper${recap.helpers === 1 ? '' : 's'}, up to ${recap.peak} at once`
  const cost = recap.tokens === null ? '' : ` · ${tokenCount(recap.tokens)} tokens`
  const lines = [recap.task === '' ? 'This job' : `This job: ${recap.task}`, `${took} · ${crew}${cost}`]
  const ratio = speedUp(recap)
  if (ratio !== null) {
    lines.push(
      `Helpers did ${span(recap.helperMs)} of work in ${span(recap.togetherMs)}: about ${ratio.toFixed(1)}× faster than one after another`,
    )
  }
  return lines
}

// One line per agent, indented by who hired whom: the table the picture is drawn from.
export function recapRows(recap: Recap): string[] {
  return recap.lanes.map(l => {
    const tokens = l.tokens === null ? '' : `, ${tokenCount(l.tokens)} tokens`
    return `${'  '.repeat(l.depth)}${l.label}: ${span(l.end - l.start)}${tokens}, ${endingOf(l)}`
  })
}

const pad = (v: number): string => String(v).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "15 Oct 14:05 fix the login bug: took 4m 10s, 3 helpers, 182k tokens", in local time.
export function historyLine(record: JobRecord): string {
  const d = new Date(record.startedAt)
  const when = `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const crew = record.helpers === 0 ? 'no helpers' : `${record.helpers} helper${record.helpers === 1 ? '' : 's'}`
  const tokens = record.tokens === null ? '' : `, ${tokenCount(record.tokens)} tokens`
  return `${when} ${record.task === '' ? 'a job' : record.task}: took ${span(record.tookMs)}, ${crew}${tokens}`
}

// The history keeps the newest 20 jobs.
export const HISTORY_MAX = 20

// What the store holds is read back from disk: anything that is not a well-formed record is left out.
export function isRecord(value: unknown): value is JobRecord {
  const r = value as Partial<JobRecord> | null
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.startedAt === 'number' &&
    typeof r.task === 'string' &&
    typeof r.tookMs === 'number' &&
    typeof r.helpers === 'number' &&
    typeof r.peak === 'number' &&
    (r.tokens === null || typeof r.tokens === 'number')
  )
}

// A job is saved each time Main's turn ends, so a turn that carries on later updates the same record.
export function withRecord(list: readonly JobRecord[], record: JobRecord): JobRecord[] {
  return [...list.filter(r => r.startedAt !== record.startedAt), record]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-HISTORY_MAX)
}

export function jobRecord(recap: Recap): JobRecord {
  return {
    startedAt: recap.startedAt,
    task: recap.task,
    tookMs: recap.endedAt - recap.startedAt,
    helpers: recap.helpers,
    peak: recap.peak,
    tokens: recap.tokens,
  }
}

// ---------------------------------------------------------------------------------------------------
// The swimlane: one row per agent, a bar from when it started to when it finished, on one time axis.
// Colors were checked with the data-viz palette validator, all pairs, light and dark surfaces. Light values
// are presentation attributes, so the picture stays readable where a stylesheet is not applied; the dark
// steps come in through prefers-color-scheme. Text uses the ink colors, never a bar's.
// ---------------------------------------------------------------------------------------------------

const LIGHT = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  muted: '#52514e',
  grid: '#e4e2dc',
  main: '#eb6834',
  waited: '#2a78d6',
  alongside: '#1baf7a',
} as const
const DARK = {
  surface: '#1a1a19',
  ink: '#f0efec',
  muted: '#c3c2b7',
  grid: '#383835',
  main: '#d95926',
  waited: '#3987e5',
  alongside: '#199e70',
} as const
// Status colors stand for how a helper's job ended, never for a kind of helper, and always with a shape.
const STATUS = { reported: { glyph: '✓', fill: '#0ca30c' }, stopped: { glyph: '■', fill: '#fab219' }, failed: { glyph: '✕', fill: '#d03b3b' } } as const

export const KIND_WORDS: Record<LaneKind, string> = {
  main: 'Main',
  waited: 'A helper Main waited for',
  alongside: 'A helper working alongside',
}

const W = 640
const PAD = 12
const LABEL_W = 136
const END_W = 74
const X0 = PAD + LABEL_W
const X1 = W - PAD - END_W
const TOP = 34
const ROW_H = 22
const BAR_H = 10
const STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map(s => s * 1000)

const r1 = (v: number): number => Math.round(v * 10) / 10

function tickLabel(ms: number): string {
  if (ms === 0) return '0'
  return ms < 60_000 ? `${ms / 1000}s` : ms < 3_600_000 ? `${ms / 60_000}m` : `${ms / 3_600_000}h`
}

export function recapSvg(recap: Recap): string {
  const total = Math.max(1000, recap.endedAt - recap.startedAt)
  const x = (t: number): number => X0 + ((t - recap.startedAt) / total) * (X1 - X0)
  const step = STEPS.find(s => total / s <= 6) ?? (STEPS[STEPS.length - 1] as number)
  const axisY = TOP + recap.lanes.length * ROW_H + 4
  const height = axisY + 24
  const css =
    `<style>@media (prefers-color-scheme: dark){` +
    `.s{fill:${DARK.surface}}.i{fill:${DARK.ink}}.m{fill:${DARK.muted}}.g{stroke:${DARK.grid}}` +
    `.k-main{fill:${DARK.main}}.k-waited{fill:${DARK.waited}}.k-alongside{fill:${DARK.alongside}}}</style>`
  let out = `<rect class="s" x="0" y="0" width="${W}" height="${height}" rx="8" fill="${LIGHT.surface}"/>`
  // Legend: the kinds this job has, in a fixed order, so a color always means the same kind.
  let lx = PAD
  for (const kind of (['main', 'waited', 'alongside'] as const).filter(k => recap.lanes.some(l => l.kind === k))) {
    out += `<rect class="k-${kind}" x="${lx}" y="9" width="10" height="10" rx="2" fill="${LIGHT[kind]}"/>`
    out += `<text class="m" x="${lx + 15}" y="18" font-size="11" fill="${LIGHT.muted}">${escapeXml(KIND_WORDS[kind])}</text>`
    lx += r1(15 + KIND_WORDS[kind].length * 5.6 + 16)
  }
  // Time axis: a few clean ticks, faint solid lines behind the bars.
  for (let t = 0; t <= total; t += step) {
    const tx = r1(x(recap.startedAt + t))
    out += `<line class="g" x1="${tx}" y1="${TOP - 4}" x2="${tx}" y2="${axisY}" stroke="${LIGHT.grid}" stroke-width="1"/>`
    out += `<text class="m" x="${tx}" y="${axisY + 15}" font-size="10" text-anchor="middle" fill="${LIGHT.muted}">${tickLabel(t)}</text>`
  }
  recap.lanes.forEach((lane, i) => {
    const mid = TOP + i * ROW_H + ROW_H / 2
    const name = clip(lane.label, 20 - lane.depth * 2)
    out += `<text class="i" x="${PAD + lane.depth * 10}" y="${r1(mid + 4)}" font-size="12" fill="${LIGHT.ink}">${escapeXml(name)}</text>`
    const bx = r1(x(lane.start))
    const bw = r1(Math.max(4, x(lane.end) - x(lane.start)))
    out += `<rect class="k-${lane.kind}" x="${bx}" y="${r1(mid - BAR_H / 2)}" width="${bw}" height="${BAR_H}" rx="4" fill="${LIGHT[lane.kind]}"/>`
    // At the bar's end: how it ended (a shape and a color) and how long it took, in ink.
    const status = lane.kind === 'main' || lane.isOpen || lane.outcome === null ? null : STATUS[lane.outcome]
    const ex = r1(bx + bw + 6)
    const glyph = status === null ? '' : `<tspan fill="${status.fill}">${status.glyph}</tspan> `
    const words = lane.isOpen ? `${span(lane.end - lane.start)}…` : span(lane.end - lane.start)
    out += `<text class="i" x="${ex}" y="${r1(mid + 4)}" font-size="11" fill="${LIGHT.ink}">${glyph}${escapeXml(words)}</text>`
  })
  const title = `Timeline of this job: ${recap.lanes.length} agents`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" ` +
    `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"><title>${escapeXml(title)}</title>${css}${out}</svg>`
  )
}

// What the picture shows, for anyone who cannot see it.
export function recapAlt(recap: Recap): string {
  return `Timeline of this job. ${recapRows(recap).map(line => line.trim()).join('. ')}.`
}
