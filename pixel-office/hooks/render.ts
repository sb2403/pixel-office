import type { Agent, Scene, StationId } from '../types'
import { etaDetail, etaOf, etaWords } from './eta'
import { MAIN, isCoordinating, isWalkingAt, positionAt, waitingOn } from './model'
import { doing } from './narrate'
import { OFFICE_DEFS, officeBase, officeDecor, rect } from './office'
import { petSvg } from './pet'
import { modelName, roleFor, tokenCount } from './roles'
import { iconSvg, itemSvg, personSvg } from './sprites'
import type { Variant } from './sprites'
import { EXCERPT, HEIGHT, STATIONS, WAITING_TOOLS, WIDTH, clamp, clip, gist, splitAt, stripControls } from './stations'

export const SVG_BUDGET = 120_000
export const PUFF_MS = 2500

const PUFF = '#e8453c'
const BOB: Partial<Record<StationId, number>> = {
  office: 0.8,
  desk: 0.4,
  library: 0.7,
  server: 0.35,
  mailroom: 0.6,
  phone: 1,
  taskboard: 0.6,
  meeting: 0.9,
}

const XML: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export const escapeXml = (text: string): string => stripControls(text).replace(/[&<>"']/g, ch => XML[ch] ?? ch)

const n = (v: number): number => Math.round(v * 100) / 100

export function isNight(now: number): boolean {
  const hour = new Date(now).getHours()
  return hour < 7 || hour >= 19
}

// `now` says in plain words what the agent is doing at this moment, or how its job ended.
export type OrgRow = {
  id: string
  depth: number
  label: string
  status: 'working' | 'coordinating' | 'waiting' | 'idle' | 'done'
  now: string
}

// What each status reads as in the panel. `waiting` is always waiting on you; waiting on helpers is coordinating.
export const STATUS_WORDS: Readonly<Record<OrgRow['status'], string>> = {
  working: 'working',
  coordinating: 'coordinating',
  waiting: 'needs you',
  idle: 'idle',
  done: 'done',
}

export function statusOf(scene: Scene, agent: Agent): OrgRow['status'] {
  if (isCoordinating(scene, agent)) return 'coordinating'
  switch (agent.phase) {
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    case 'gone':
      return 'done'
    default:
      return 'working'
  }
}

export function orgRows(scene: Scene, now: number | null = null): OrgRow[] {
  const children = new Map<string, string[]>()
  for (const id of scene.order) {
    const agent = scene.agents[id]
    if (agent === undefined || agent.parentId === null) continue
    const parent = scene.agents[agent.parentId] !== undefined ? agent.parentId : MAIN
    children.set(parent, [...(children.get(parent) ?? []), id])
  }
  // Live agents come first among siblings so a trimmed chart keeps them; arrival order holds inside each group.
  const isGone = (id: string): boolean => scene.agents[id]?.phase === 'gone'
  for (const siblings of children.values()) siblings.sort((a, b) => Number(isGone(a)) - Number(isGone(b)))
  const rows: OrgRow[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number): void => {
    if (seen.has(id)) return
    seen.add(id)
    const agent = scene.agents[id]
    if (agent === undefined) return
    const eta = now === null ? null : etaOf(scene, agent, now)
    const activity = nowOf(scene, agent)
    rows.push({ id, depth, label: agent.label, status: statusOf(scene, agent), now: eta === null ? activity : `${activity}, ${etaWords(eta)}` })
    for (const child of children.get(id) ?? []) visit(child, depth + 1)
  }
  visit(MAIN, 0)
  for (const id of scene.order) visit(id, 1)
  return rows
}

// "Researcher", "Researcher and Planner", "Researcher, Planner and Assistant", "4 helpers".
function names(agents: readonly Agent[]): string {
  const labels = agents.map(a => a.label)
  if (labels.length > 3) return `${labels.length} helpers`
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`
}

const ENDINGS = { reported: 'handed in its report', stopped: 'was stopped', failed: 'ran into a problem' } as const

// What an agent is up to right now, in the words the feed uses: "reading auth.ts", "waiting on Researcher".
export function nowOf(scene: Scene, agent: Agent): string {
  if (agent.phase === 'gone') return agent.outcome === null ? 'left' : ENDINGS[agent.outcome]
  if (isCoordinating(scene, agent)) return `waiting on ${names(waitingOn(scene, agent.id))}`
  // A tool held at a permission prompt has not run yet: what the agent does now is wait for you.
  if (agent.phase === 'waiting' && (agent.activity === null || !WAITING_TOOLS.has(agent.activity.tool))) {
    return 'waiting for your permission'
  }
  if (agent.activity !== null) return doing(agent.activity)
  switch (agent.phase) {
    case 'arriving':
      return 'arriving'
    case 'briefing':
      return 'being briefed'
    case 'idle':
      if (agent.station === 'breakroom') return 'on a break'
      return agent.id === MAIN ? 'ready for your next message' : 'free for the next job'
    default:
      return 'thinking'
  }
}

// The second line under a helper in the org chart: what it was hired to do, fitted to a column `width` wide.
export function objectiveLine(scene: Scene, id: string, depth: number, width: number): string {
  const agent = scene.agents[id]
  if (agent === undefined || agent.id === MAIN) return ''
  const objective = clip(agent.description, Math.max(1, width - depth * 2 - 2))
  return objective === '' ? '' : `${'  '.repeat(depth)}↳ ${objective}`
}

const pad = (v: number): string => String(v).padStart(2, '0')

export function clockLabel(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function altText(scene: Scene): string {
  const here = Object.values(scene.agents).filter(a => a.phase !== 'gone')
  const noun = here.length === 1 ? 'agent' : 'agents'
  return `Pixel office with ${here.length} ${noun}: ${here.map(a => `${a.label} at ${STATIONS[a.station].name}`).join(', ')}`
}

// The details box shows a brief or a report as one line; the whole text is a press away.
export const excerptOf = (text: string): string => gist(text, EXCERPT)
// Whether the one line leaves something out, so the whole text is worth offering.
export const isCut = (text: string): boolean => excerptOf(text).endsWith('…')

// Lines that only belong in the panel: the brief and the report are long, and the job clock ticks every second.
const PANEL_ONLY = ['Brief:', 'Report:', 'On the job:', 'Expected:', 'Used']

// The details box: who this is, what its kind of agent does, the job it was given, what it is doing, who it
// works for and how that boss works with it, and what it handed back.
export function agentDetails(scene: Scene, id: string, now: number): string[] {
  const agent = scene.agents[id]
  if (agent === undefined) return []
  const role = roleFor(agent.type)
  const boss = agent.parentId === null ? undefined : scene.agents[agent.parentId]?.label
  const used =
    agent.usage === null
      ? []
      : [`${agent.id === MAIN ? 'Used so far' : 'Used'}: ${tokenCount(agent.usage.tokens)} tokens (${tokenCount(agent.usage.reused)} reused) on ${modelName(agent.usage.model)}`]
  if (agent.id === MAIN) return [`Main · ${role.title}`, role.blurb, `Now: ${nowOf(scene, agent)}`, ...used]
  // "Researcher 2 · Explore agent" ties the office's name to the one Claude Code shows; a named agent also gets its role.
  const isRoleName = agent.label === role.title || agent.label.startsWith(`${role.title} `)
  const title =
    agent.type === 'contractor'
      ? agent.label
      : isRoleName
        ? `${agent.label} · ${agent.type} agent`
        : `${agent.label} · ${role.title} (${agent.type} agent)`
  const lines = [title, role.blurb]
  if (agent.description !== '') lines.push(`Job: ${agent.description}`)
  if (agent.brief !== '') lines.push(`Brief: ${excerptOf(agent.brief)}`)
  lines.push(`Now: ${nowOf(scene, agent)}`)
  if (boss !== undefined) {
    const how = agent.isTeammate ? 'leads the team' : agent.isBackground ? 'keeps working meanwhile' : 'waits for its report'
    lines.push(`Reports to: ${boss}, who ${how}`)
  }
  if (agent.report !== '') lines.push(`Report: ${excerptOf(agent.report)}`)
  lines.push(...used)
  if (agent.id !== MAIN) {
    // A helper that has left stops the clock where it left.
    const until = agent.phase === 'gone' && agent.goneAt !== null ? Math.min(now, agent.goneAt) : now
    const secs = Math.max(0, Math.round((until - agent.arrivedAt) / 1000))
    lines.push(`On the job: ${Math.floor(secs / 60)}m ${secs % 60}s`)
    const eta = etaOf(scene, agent, now)
    if (eta !== null) lines.push(etaDetail(eta))
  }
  return lines
}

// A boss waiting on its helpers shows who it is waiting on, with the meeting-room icon.
type BubbleBox = { text: string; station: StationId; isWaiting: boolean; width: number; left: number; top: number }

// What a speech bubble says and where it would sit over its agent, or null when the agent has nothing to say.
function bubbleBox(agent: Agent, scene: Scene): BubbleBox | null {
  const isWaiting = agent.phase === 'waiting'
  const team = isCoordinating(scene, agent) ? waitingOn(scene, agent.id) : []
  if (agent.activity === null && !isWaiting && team.length === 0) return null
  const station: StationId = isWaiting ? 'reception' : team.length > 0 ? 'meeting' : agent.station
  const text =
    team.length === 1 ? clip(`waiting on ${team[0]?.label ?? ''}`) : team.length > 1 ? `waiting on ${team.length}` : (agent.activity?.target ?? '')
  const width = 9 + Math.ceil(text.length * 2.4)
  const left = clamp(-Math.round(width / 2), 2 - agent.pos.x, WIDTH - 2 - agent.pos.x - width)
  const top = Math.max(-27, 1 - agent.pos.y)
  return { text, station, isWaiting, width, left, top }
}

// Bubbles of agents standing close together would cover each other, so each takes the lowest lane (one bubble
// higher than the last) that is free, and a thin stem joins a raised bubble to its agent. Near the top of the floor
// there is no room to go higher: a bubble with no free lane is left out (-1) rather than hidden under another, and
// the panel still says what that agent is doing.
const BUBBLE_HEIGHT = 10
const BUBBLE_STEP = 11
const BUBBLE_LANES = 3

function bubbleLanes(
  agents: readonly Agent[],
  scene: Scene,
  now: number,
  positionOf = (a: Agent) => positionAt(a, now),
): Map<string, number> {
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = []
  const lanes = new Map<string, number>()
  for (const agent of agents) {
    const box = bubbleBox(agent, scene)
    if (box === null) continue
    const at = positionOf(agent)
    const x0 = at.x + box.left
    const x1 = x0 + box.width
    let found = -1
    let highest = Infinity
    for (let lane = 0; lane <= BUBBLE_LANES; lane++) {
      const y0 = at.y + Math.max(1 - agent.pos.y, box.top - lane * BUBBLE_STEP)
      // A lane that is no higher than the last, because the floor's top edge stops it, is no new lane.
      if (y0 >= highest) break
      highest = y0
      const rect = { x0, x1, y0, y1: y0 + BUBBLE_HEIGHT }
      if (!placed.some(r => r.x0 < rect.x1 && rect.x0 < r.x1 && r.y0 < rect.y1 && rect.y0 < r.y1)) {
        placed.push(rect)
        found = lane
        break
      }
    }
    lanes.set(agent.id, found)
  }
  return lanes
}

function bubble(agent: Agent, scene: Scene, lane = 0): string {
  const box = bubbleBox(agent, scene)
  if (box === null || lane < 0) return ''
  const { text, station, isWaiting, width, left } = box
  const top = Math.max(1 - agent.pos.y, box.top - lane * BUBBLE_STEP)
  const blink = isWaiting ? '<animate attributeName="opacity" values="1;0.35;1" dur="0.8s" repeatCount="indefinite"/>' : ''
  const words = text === '' ? '' : `<text x="8.5" y="6" font-size="4" fill="#2c2c2a">${escapeXml(text)}</text>`
  const stem = box.top - top > 0 ? rect(-left - 0.5, BUBBLE_HEIGHT, 1, box.top - top, '#2c2c2a') : ''
  return (
    `<g transform="translate(${n(left)},${n(top)})">${blink}` +
    rect(0, 0, width, 8, '#ffffff', ' stroke="#2c2c2a" stroke-width="0.5"') +
    rect(-left - 1, 8, 2, 2, '#ffffff') +
    stem +
    iconSvg(station, 2, 1.5, STATIONS[station].color) +
    `${words}</g>`
  )
}

function errorPuff(ms: number): string {
  return (
    `<g transform="translate(5,-16)">${rect(-2, -2, 4, 4, PUFF)}${rect(-1, -4, 2, 2, '#f09595')}${rect(2, -1, 2, 2, '#f09595')}` +
    `<animate attributeName="opacity" values="1;0" dur="${Math.round(ms)}ms" fill="freeze"/></g>`
  )
}

function leaveAt(agent: Agent, now: number): string {
  if (agent.phase !== 'gone' || agent.goneAt === null) return ''
  return `<set attributeName="visibility" to="hidden" begin="${Math.max(0, Math.round(agent.goneAt - now))}ms"/>`
}

// The folder or envelope an agent carries to another agent, hidden at the moment it is handed over.
function carried(agent: Agent, now: number): string {
  if (agent.carry === null || now >= agent.carry.until) return ''
  return `<g>${itemSvg(agent.carry.item, -1, -5)}<set attributeName="visibility" to="hidden" begin="${Math.round(agent.carry.until - now)}ms"/></g>`
}

// Name tags sit over heads, or under the feet when a neighbour's tag already takes the space over a head:
// a boss briefing a new helper sits right beside it, and both names must stay readable.
const TAG_ABOVE = -14
const TAG_BELOW = 5.5
const TAG_CHAR = 2.1

type TagSpot = { x0: number; x1: number; y: number; isBelow: boolean }

export function tagsBelow(agents: readonly Agent[], now: number, positionOf = (a: Agent) => positionAt(a, now)): Set<string> {
  const placed: TagSpot[] = []
  const below = new Set<string>()
  for (const agent of agents) {
    const pos = positionOf(agent)
    const half = (Array.from(agent.label).length * TAG_CHAR) / 2 + 0.5
    const spot = { x0: pos.x - half, x1: pos.x + half, y: pos.y }
    const overlap = (isBelow: boolean): number =>
      placed.reduce(
        (sum, t) =>
          t.isBelow === isBelow && Math.abs(t.y - spot.y) < 6
            ? sum + Math.max(0, Math.min(t.x1, spot.x1) - Math.max(t.x0, spot.x0))
            : sum,
        0,
      )
    const above = overlap(false)
    const isBelow = above > 0 && overlap(true) < above
    placed.push({ ...spot, isBelow })
    if (isBelow) below.add(agent.id)
  }
  return below
}

// A thin bar under a helper's feet that fills over the time its predecessors took. It is animated inside the
// picture, so it needs no redraw as it fills; one past what is usual stays full and pulses amber instead.
const BAR_WIDTH = 9
export function etaBar(scene: Scene, agent: Agent, now: number): string {
  const eta = etaOf(scene, agent, now)
  if (eta === null) return ''
  const x = -BAR_WIDTH / 2
  const track = rect(x, 1.8, BAR_WIDTH, 1, '#000000', ' fill-opacity="0.45"')
  if (eta.leftMs <= 1000) {
    return `${track}<rect x="${x}" y="1.8" width="${BAR_WIDTH}" height="1" fill="#fac775"><animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite"/></rect>`
  }
  const start = n(BAR_WIDTH * clamp((now - agent.arrivedAt) / eta.typicalMs, 0, 1))
  return `${track}<rect x="${x}" y="1.8" width="${start}" height="1" fill="#97c459"><animate attributeName="width" from="${start}" to="${BAR_WIDTH}" dur="${Math.round(eta.leftMs)}ms" fill="freeze"/></rect>`
}

function drawAgent(agent: Agent, scene: Scene, now: number, isTagBelow = false, lane = 0): string {
  const variant: Variant = agent.id === MAIN ? 'main' : agent.isTeammate ? 'teammate' : 'plain'
  // The clock line ticks every second; keeping it out of the drawing keeps an idle office's source unchanged.
  const facts = agentDetails(scene, agent.id, now).filter(line => !PANEL_ONLY.some(start => line.startsWith(start)))
  const head = `<title>${escapeXml(facts.join('\n'))}</title>${leaveAt(agent, now)}`
  const tag =
    `<text x="0" y="${isTagBelow ? TAG_BELOW : TAG_ABOVE}" font-size="3.5" text-anchor="middle" fill="#ffffff" stroke="#2c2c2a" ` +
    `stroke-width="0.8" paint-order="stroke">${escapeXml(agent.label)}</text>`
  const puff = agent.lastErrorAt !== null && now - agent.lastErrorAt < PUFF_MS ? errorPuff(PUFF_MS - (now - agent.lastErrorAt)) : ''
  const id = `agent-${escapeXml(agent.id)}`
  if (agent.walk !== null && isWalkingAt(agent, now)) {
    const rest = splitAt(agent.walk.points, (now - agent.walk.startedAt) / agent.walk.durationMs)
    // A walk drawn before its first step plays from that step at its own pace.
    const ms = Math.max(1, Math.round(Math.min(agent.walk.durationMs, agent.walk.startedAt + agent.walk.durationMs - now)))
    const path = `M${rest.map(p => `${n(p.x)},${n(p.y)}`).join(' L')}`
    return `<g id="${id}">${head}<animateMotion dur="${ms}ms" fill="freeze" path="${path}"/>${personSvg(agent.look, variant, ms)}${carried(agent, now)}${etaBar(scene, agent, now)}${tag}${bubble(agent, scene, lane)}${puff}</g>`
  }
  const period = agent.activity !== null ? BOB[agent.station] : undefined
  const body = personSvg(agent.look, variant, 0)
  const working =
    period === undefined
      ? body
      : `<g>${body}<animateTransform attributeName="transform" type="translate" values="0,0;0,-0.6;0,0" dur="${period}s" repeatCount="indefinite"/></g>`
  return `<g id="${id}" transform="translate(${n(agent.pos.x)},${n(agent.pos.y)})">${head}${working}${etaBar(scene, agent, now)}${tag}${bubble(agent, scene, lane)}${puff}</g>`
}

// The furniture an agent at work is using, outlined in its station's colour: where on the floor each station's
// things stand. A desk and a phone booth belong to one agent, so each has its own; the rest are shared.
type Box = { x: number; y: number; w: number; h: number }
const IN_USE: Partial<Record<StationId, (slot: number) => Box>> = {
  desk: slot => ({ x: 77 + 22 * (slot % 4), y: 20 + 30 * Math.floor(slot / 4), w: 18, h: 19 }),
  library: () => ({ x: 177, y: 11, w: 63, h: 24 }),
  mailroom: () => ({ x: 177, y: 51, w: 30, h: 19 }),
  phone: slot => ({ x: 213 + 14 * Math.min(slot, 1), y: 51, w: 14, h: 30 }),
  server: () => ({ x: 185, y: 101, w: 46, h: 28 }),
  meeting: () => ({ x: 91, y: 115, w: 44, h: 14 }),
  taskboard: () => ({ x: 71, y: 0, w: 34, h: 10 }),
  reception: () => ({ x: 35, y: 122, w: 28, h: 11 }),
}

function inUse(here: readonly Agent[]): string {
  const seen = new Set<string>()
  let out = ''
  for (const agent of here) {
    const place = IN_USE[agent.station]
    if (place === undefined || agent.activity === null) continue
    const box = place(agent.slot)
    const key = `${agent.station}:${box.x}:${box.y}`
    if (seen.has(key)) continue
    seen.add(key)
    const color = STATIONS[agent.station].color
    out +=
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="0.8">` +
      '<animate attributeName="stroke-opacity" values="0.95;0.35;0.95" dur="1.6s" repeatCount="indefinite"/></rect>'
  }
  return out
}

function overlays(scene: Scene, now: number): string {
  const all = Object.values(scene.agents)
  const here = all.filter(a => a.phase !== 'gone')
  const busy = (station: StationId): Agent[] =>
    here.filter(a => a.station === station && a.activity !== null && !isWalkingAt(a, now))
  let out = inUse(here)
  if (scene.briefing !== null) {
    out += `<text x="116" y="99" font-size="3.5" text-anchor="middle" fill="#2c2c2a">${escapeXml(clip(scene.briefing, 18))}</text>`
  }
  if (scene.todos !== null) {
    const notes = [
      ...Array<string>(Math.min(scene.todos.done, 6)).fill('#97c459'),
      ...Array<string>(Math.min(scene.todos.open, 6)).fill('#fac775'),
    ]
    notes.forEach((fill, i) => {
      out += rect(74 + (i % 6) * 5, 2.5 + Math.floor(i / 6) * 3, 4, 2.5, fill)
    })
  }
  if (busy('server').length > 0) {
    for (const x of [188, 204, 220]) {
      out +=
        `<rect x="${x}" y="124" width="6" height="1" fill="#ef9f27">` +
        '<animate attributeName="opacity" values="1;0.2;1" dur="0.25s" repeatCount="indefinite"/></rect>'
    }
  }
  for (const agent of busy('phone')) out += rect(agent.slot === 0 ? 219 : 233, 53, 2, 1, '#fac775')
  if (busy('mailroom').length > 0) out += rect(196, 57, 5, 4, '#d3a36b') + rect(198, 57, 1, 4, '#854f0b')
  if (here.some(a => a.activity?.tool === 'Write')) {
    out +=
      '<rect x="166" y="34" width="5" height="1" fill="#ffffff">' +
      '<animate attributeName="height" values="1;5;1" dur="1s" repeatCount="indefinite"/></rect>'
  }
  const isElevatorBusy = all.some(
    a =>
      (a.id !== MAIN && now - a.arrivedAt < 2000) ||
      (a.phase === 'gone' && a.goneAt !== null && now < a.goneAt + 1500),
  )
  if (isElevatorBusy) out += rect(9, 112, 14, 24, '#2c2c2a')
  if (here.some(a => a.phase === 'waiting')) {
    out +=
      '<rect x="45" y="117" width="6" height="1" fill="#fac775">' +
      '<animate attributeName="opacity" values="1;0;1" dur="0.5s" repeatCount="indefinite"/></rect>'
  }
  return out
}

function badge(extra: number): string {
  return `<g>${rect(196, 1, 42, 7, '#2c2c2a')}<text x="217" y="6.3" font-size="4.5" text-anchor="middle" fill="#ffffff">+${extra} more</text></g>`
}

// The moment the scene last changed: an event, the start of a walk, an error. It tells the pane when the picture
// has to be drawn again.
export function sceneTimeOf(scene: Scene): number {
  let latest = scene.ticker[scene.ticker.length - 1]?.at ?? 0
  for (const a of Object.values(scene.agents)) {
    latest = Math.max(latest, a.lastEventAt, a.arrivedAt, a.lastErrorAt ?? 0, a.walk?.startedAt ?? 0)
  }
  return latest
}

// The desktop draws about 7.9 px per cell column, and a little under is used so the picture never overflows the pane.
export const CELL_PX = 7.5

// The size the picture takes in a pane of this many columns, keeping its shape.
export function fitSize(size: { width: number; height: number } | undefined, columns: number): { width: number; height: number } | undefined {
  if (size === undefined || !Number.isFinite(columns) || columns <= 0) return undefined
  const width = Math.min(2400, Math.max(320, Math.round(columns * CELL_PX)))
  return { width, height: Math.round((width * size.height) / size.width) }
}

// A picture whose box is not sized collapses while the host swaps it, which scrolls the pane back to the top, so
// each picture is given the size its markup declares: the root element's width and height, never a nested one's.
export function svgSize(source: string): { width: number; height: number } | undefined {
  const tag = /<svg\b[^>]*>/.exec(source)?.[0]
  if (tag === undefined) return undefined
  const read = (name: string): number => {
    const value = new RegExp(`\\s${name}="(\\d+(?:\\.\\d+)?|\\.\\d+)"`).exec(tag)?.[1]
    return value === undefined ? NaN : Number(value)
  }
  const width = read('width')
  const height = read('height')
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined
}

// Pictures are drawn as of this far ahead of the clock, about when they appear. Each picture is shown late by the
// desktop's delay less this, and so was the one before it, so the value moves no one: what moves a walker at a redraw
// is how much that delay changes from one picture to the next.
export const LEAD_MS = 250

// The picture the pane shows, drawn as of the moment it will appear. The desktop starts a picture's animations over
// whenever the pane is drawn, even when the picture is the very same text: in a recording, a walker went back to the
// first step of its walk at every draw while nothing about it had changed. A picture kept from an earlier draw would
// replay what happened then, so each draw is fresh, and a restart carries on from where everyone is.
export function officeSource(scene: Scene, now: number): string {
  return renderOffice(scene, now + LEAD_MS)
}

const ROOT =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * 4}" height="${HEIGHT * 4}" ` +
  'shape-rendering="crispEdges" font-family="monospace">'

function rankedAgents(scene: Scene, now: number): Agent[] {
  return Object.values(scene.agents)
    .filter(a => !(a.phase === 'gone' && a.goneAt !== null && now >= a.goneAt))
    .sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : b.lastEventAt - a.lastEventAt))
}

// The picture as layers: the scenery, the cat and each agent as its own transparent picture stacked over it. The
// desktop starts every picture over whenever the pane is drawn, so each is drawn afresh as of then, as the single
// picture is; stacking them keeps no agent's walk apart from another's on today's desktop.
export const MAX_LAYERS = 24
export type Layer = { key: string; source: string }

export function officeLayers(scene: Scene, now: number): { base: Layer; pet: Layer; agents: Layer[] } {
  const at = now + LEAD_MS
  const visible = rankedAgents(scene, at)
  const ids = new Set(visible.slice(0, MAX_LAYERS).map(a => a.id))
  const drawn = scene.order.filter(id => ids.has(id)).flatMap(id => (scene.agents[id] === undefined ? [] : [scene.agents[id]!]))
  const extra = visible.length - drawn.length
  const below = tagsBelow(drawn, at)
  const lanes = bubbleLanes(drawn, scene, at)
  return {
    base: { key: 'base', source: `${ROOT}${OFFICE_DEFS}${officeBase(isNight(at))}${officeDecor()}${overlays(scene, at)}${extra > 0 ? badge(extra) : ''}</svg>` },
    pet: { key: 'pet', source: `${ROOT}${petSvg(at)}</svg>` },
    agents: drawn.map(a => ({ key: `agent-${a.id}`, source: `${ROOT}${drawAgent(a, scene, at, below.has(a.id), lanes.get(a.id) ?? 0)}</svg>` })),
  }
}

export function renderOffice(scene: Scene, now: number, budget = SVG_BUDGET): string {
  const ranked = rankedAgents(scene, now)
  const head = `${ROOT}${OFFICE_DEFS}${officeBase(isNight(now))}`
  const props = overlays(scene, now)
  const build = (withDecor: boolean, count: number): string => {
    const drawn = ranked
      .slice(0, count)
      .map(a => ({ a, y: positionAt(a, now).y }))
      .sort((p, q) => p.y - q.y)
      .map(p => p.a)
    const below = tagsBelow(drawn, now)
    const lanes = bubbleLanes(drawn, scene, now)
    const people = drawn.map(a => drawAgent(a, scene, now, below.has(a.id), lanes.get(a.id) ?? 0)).join('')
    const extra = ranked.length - count
    return `${head}${withDecor ? officeDecor() + petSvg(now) : ''}${props}${people}${extra > 0 ? badge(extra) : ''}</svg>`
  }
  let svg = build(true, ranked.length)
  if (svg.length <= budget) return svg
  let count = ranked.length
  svg = build(false, count)
  while (svg.length > budget && count > 1) {
    count -= 1
    svg = build(false, count)
  }
  return svg
}
