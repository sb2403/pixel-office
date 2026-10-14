import type { Agent, Scene, StationId } from '../types'
import { MAIN, isWalkingAt, positionAt } from './model'
import { OFFICE_DEFS, officeBase, officeDecor, rect } from './office'
import { iconSvg, personSvg } from './sprites'
import type { Variant } from './sprites'
import { HEIGHT, STATIONS, WIDTH, clamp, clip, splitAt, stripControls } from './stations'

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

export type OrgRow = {
  id: string
  depth: number
  label: string
  status: 'working' | 'waiting' | 'idle' | 'done'
  place: string
}

export function statusOf(agent: Agent): OrgRow['status'] {
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

export function orgRows(scene: Scene): OrgRow[] {
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
    rows.push({
      id,
      depth,
      label: agent.label,
      status: statusOf(agent),
      place: agent.phase === 'gone' ? 'left' : STATIONS[agent.station].name,
    })
    for (const child of children.get(id) ?? []) visit(child, depth + 1)
  }
  visit(MAIN, 0)
  for (const id of scene.order) visit(id, 1)
  return rows
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

export function agentDetails(scene: Scene, id: string, now: number): string[] {
  const agent = scene.agents[id]
  if (agent === undefined) return []
  const boss = agent.parentId === null ? undefined : scene.agents[agent.parentId]?.label
  const lines = [agent.id === MAIN ? 'Main (your main agent)' : `${agent.label} (${agent.type})`]
  if (agent.description !== '') lines.push(`Task: ${agent.description}`)
  lines.push(
    agent.activity !== null
      ? `Doing: ${agent.activity.tool}${agent.activity.target === '' ? '' : ` ${agent.activity.target}`}`
      : `Status: ${statusOf(agent)}`,
  )
  if (boss !== undefined) lines.push(`Reports to: ${boss}`)
  if (agent.id !== MAIN) {
    const secs = Math.max(0, Math.round((now - agent.arrivedAt) / 1000))
    lines.push(`On the job: ${Math.floor(secs / 60)}m ${secs % 60}s`)
  }
  return lines
}

function bubble(agent: Agent): string {
  const isWaiting = agent.phase === 'waiting'
  if (agent.activity === null && !isWaiting) return ''
  const station: StationId = isWaiting ? 'reception' : agent.station
  const text = agent.activity?.target ?? ''
  const width = 9 + Math.ceil(text.length * 2.4)
  const left = clamp(-Math.round(width / 2), 2 - agent.pos.x, WIDTH - 2 - agent.pos.x - width)
  const top = Math.max(-27, 1 - agent.pos.y)
  const blink = isWaiting ? '<animate attributeName="opacity" values="1;0.35;1" dur="0.8s" repeatCount="indefinite"/>' : ''
  const words = text === '' ? '' : `<text x="8.5" y="6" font-size="4" fill="#2c2c2a">${escapeXml(text)}</text>`
  return (
    `<g transform="translate(${n(left)},${n(top)})">${blink}` +
    rect(0, 0, width, 8, '#ffffff', ' stroke="#2c2c2a" stroke-width="0.5"') +
    rect(-left - 1, 8, 2, 2, '#ffffff') +
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

function drawAgent(agent: Agent, scene: Scene, now: number): string {
  const variant: Variant = agent.id === MAIN ? 'main' : agent.isTeammate ? 'teammate' : 'plain'
  // The clock line ticks every second; keeping it out of the drawing keeps an idle office's source unchanged.
  const facts = agentDetails(scene, agent.id, now).filter(line => !line.startsWith('On the job'))
  const head = `<title>${escapeXml(facts.join('\n'))}</title>${leaveAt(agent, now)}`
  const tag =
    '<text x="0" y="-14" font-size="3.5" text-anchor="middle" fill="#ffffff" stroke="#2c2c2a" ' +
    `stroke-width="0.8" paint-order="stroke">${escapeXml(agent.label)}</text>`
  const puff = agent.lastErrorAt !== null && now - agent.lastErrorAt < PUFF_MS ? errorPuff(PUFF_MS - (now - agent.lastErrorAt)) : ''
  const id = `agent-${escapeXml(agent.id)}`
  if (agent.walk !== null && isWalkingAt(agent, now)) {
    const rest = splitAt(agent.walk.points, (now - agent.walk.startedAt) / agent.walk.durationMs)
    const ms = Math.max(1, Math.round(agent.walk.startedAt + agent.walk.durationMs - now))
    const path = `M${rest.map(p => `${n(p.x)},${n(p.y)}`).join(' L')}`
    return `<g id="${id}">${head}<animateMotion dur="${ms}ms" fill="freeze" path="${path}"/>${personSvg(agent.look, variant, ms)}${tag}${puff}</g>`
  }
  const period = agent.activity !== null ? BOB[agent.station] : undefined
  const body = personSvg(agent.look, variant, 0)
  const working =
    period === undefined
      ? body
      : `<g>${body}<animateTransform attributeName="transform" type="translate" values="0,0;0,-0.6;0,0" dur="${period}s" repeatCount="indefinite"/></g>`
  return `<g id="${id}" transform="translate(${n(agent.pos.x)},${n(agent.pos.y)})">${head}${working}${tag}${bubble(agent)}${puff}</g>`
}

function overlays(scene: Scene, now: number): string {
  const all = Object.values(scene.agents)
  const here = all.filter(a => a.phase !== 'gone')
  const busy = (station: StationId): Agent[] =>
    here.filter(a => a.station === station && a.activity !== null && !isWalkingAt(a, now))
  let out = ''
  if (scene.briefing !== null) {
    out += `<text x="113" y="103.5" font-size="3.5" text-anchor="middle" fill="#2c2c2a">${escapeXml(clip(scene.briefing, 18))}</text>`
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

export function renderOffice(scene: Scene, now: number, budget = SVG_BUDGET): string {
  const ranked = Object.values(scene.agents)
    .filter(a => !(a.phase === 'gone' && a.goneAt !== null && now >= a.goneAt))
    .sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : b.lastEventAt - a.lastEventAt))
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * 4}" height="${HEIGHT * 4}" ` +
    `shape-rendering="crispEdges" font-family="monospace">${OFFICE_DEFS}${officeBase(isNight(now))}`
  const props = overlays(scene, now)
  const build = (withDecor: boolean, count: number): string => {
    const people = ranked
      .slice(0, count)
      .map(a => ({ a, y: positionAt(a, now).y }))
      .sort((p, q) => p.y - q.y)
      .map(p => drawAgent(p.a, scene, now))
      .join('')
    const extra = ranked.length - count
    return `${head}${withDecor ? officeDecor() : ''}${props}${people}${extra > 0 ? badge(extra) : ''}</svg>`
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
