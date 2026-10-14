import type { Agent, OfficeEvent, Point, Scene, StationId, Walk } from '../types'
import { narrate } from './narrate'
import { lookFor } from './sprites'
import {
  WAITING_TOOLS,
  WIDTH,
  clamp,
  doorOf,
  pathLength,
  pointAlong,
  route,
  slotPoint,
  stationFor,
} from './stations'

export const MAIN = 'main'
export const TICKER_MAX = 8
export const GONE_KEEP = 50
export const LINGER_MS = 8_000
export const IDLE_MS = 600_000
export const WALK_SPEED = 120

type Ev<K extends OfficeEvent['kind']> = Extract<OfficeEvent, { kind: K }>
type Stop = { point: Point; door: Point }

export function emptyScene(): Scene {
  const main: Agent = {
    id: MAIN,
    parentId: null,
    type: 'main',
    label: 'Main',
    description: 'Your main agent',
    isTeammate: false,
    phase: 'idle',
    station: 'office',
    slot: 0,
    desk: -1,
    pos: slotPoint('office', 0),
    walk: null,
    activity: null,
    lastErrorAt: null,
    lastEventAt: 0,
    arrivedAt: 0,
    goneAt: null,
    look: lookFor('main', MAIN),
  }
  return { agents: { [MAIN]: main }, order: [MAIN], ticker: [], todos: null, briefing: null }
}

export function isWalkingAt(agent: Agent, at: number): boolean {
  return agent.walk !== null && at < agent.walk.startedAt + agent.walk.durationMs
}

export function positionAt(agent: Agent, at: number): Point {
  if (agent.walk === null || !isWalkingAt(agent, at)) return agent.pos
  return pointAlong(agent.walk.points, (at - agent.walk.startedAt) / agent.walk.durationMs)
}

export function homeOf(agent: Agent): StationId {
  return agent.desk < 0 ? 'office' : 'desk'
}

const put = (scene: Scene, agent: Agent): Scene => ({ ...scene, agents: { ...scene.agents, [agent.id]: agent } })

const addAgent = (scene: Scene, agent: Agent): Scene => ({ ...put(scene, agent), order: [...scene.order, agent.id] })

function withLine(scene: Scene, at: number, text: string | null): Scene {
  if (text === null) return scene
  return { ...scene, ticker: [...scene.ticker, { at, text }].slice(-TICKER_MAX) }
}

function freeSlot(scene: Scene, station: StationId, selfId: string): number {
  const taken = new Set(
    Object.values(scene.agents)
      .filter(a => a.id !== selfId && a.phase !== 'gone' && a.station === station)
      .map(a => a.slot),
  )
  let slot = 0
  while (taken.has(slot)) slot += 1
  return slot
}

const walkMs = (length: number): number => clamp(Math.round((length / WALK_SPEED) * 1000), 400, 5000)

function moveTo(scene: Scene, agent: Agent, target: StationId, at: number, via: readonly Stop[] = []): Agent {
  const station: StationId = target === 'desk' && agent.desk < 0 ? 'office' : target
  if (via.length === 0 && station === agent.station) return agent
  const slot =
    station === agent.station
      ? agent.slot
      : station === 'desk'
        ? agent.desk
        : station === 'office'
          ? 0
          : freeSlot(scene, station, agent.id)
  const dest = slotPoint(station, slot)
  const walking = isWalkingAt(agent, at)
  const start = positionAt(agent, at)
  const stops: Stop[] = [
    { point: start, door: walking ? start : doorOf(agent.station, agent.slot) },
    ...via,
    { point: dest, door: doorOf(station, slot) },
  ]
  let points: Point[] = [start]
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as Stop
    const b = stops[i] as Stop
    points = points.concat(route(a.point, a.door, b.point, b.door).slice(1))
  }
  const length = pathLength(points)
  const walk: Walk | null = length < 0.5 ? null : { points, startedAt: at, durationMs: walkMs(length) }
  return { ...agent, station, slot, pos: dest, walk }
}

function beside(agent: Agent): Stop {
  return {
    point: { x: clamp(agent.pos.x + 9, 4, WIDTH - 4), y: agent.pos.y },
    door: doorOf(agent.station, agent.slot),
  }
}

function uniqueLabel(scene: Scene, base: string): string {
  const taken = Object.values(scene.agents).filter(a => a.label === base || a.label.startsWith(`${base} `)).length
  return taken === 0 ? base : `${base} ${taken + 1}`
}

function nextDesk(scene: Scene): number {
  const used = new Set(
    Object.values(scene.agents)
      .filter(a => a.phase !== 'gone' && a.desk >= 0)
      .map(a => a.desk),
  )
  let desk = 0
  while (used.has(desk)) desk += 1
  return desk
}

function arrive(scene: Scene, id: string, type: string, label: string, at: number): Agent {
  return {
    id,
    parentId: MAIN,
    type,
    label,
    description: '',
    isTeammate: false,
    phase: 'arriving',
    station: 'elevator',
    slot: 0,
    desk: nextDesk(scene),
    pos: slotPoint('elevator', 0),
    walk: null,
    activity: null,
    lastErrorAt: null,
    lastEventAt: at,
    arrivedAt: at,
    goneAt: null,
    look: lookFor(type, id),
  }
}

function endBriefing(scene: Scene, agent: Agent, at: number): Scene {
  const stillBriefing = Object.values(scene.agents).some(a => a.phase === 'briefing')
  let out: Scene = stillBriefing ? scene : { ...scene, briefing: null }
  const parent = agent.parentId === null ? undefined : out.agents[agent.parentId]
  if (parent !== undefined && parent.station === 'meeting' && parent.activity === null && parent.phase !== 'gone') {
    out = put(out, { ...moveTo(out, parent, homeOf(parent), at), lastEventAt: at })
  }
  return out
}

function spawned(scene: Scene, ev: Ev<'spawned'>): Scene {
  const existing = scene.agents[ev.id]
  let s = scene
  if (existing === undefined) {
    const fresh = {
      ...arrive(s, ev.id, ev.type, uniqueLabel(s, ev.name ?? ev.type), ev.at),
      parentId: ev.parentId,
      description: ev.description,
      isTeammate: ev.isTeammate,
    }
    s = addAgent(s, { ...moveTo(s, fresh, 'meeting', ev.at), phase: 'briefing' })
    const parent = s.agents[ev.parentId]
    if (parent !== undefined && parent.activity === null && parent.phase !== 'gone') {
      s = put(s, { ...moveTo(s, parent, 'meeting', ev.at), phase: 'working', lastEventAt: ev.at })
    }
    s = { ...s, briefing: ev.description }
  } else {
    const label = existing.type === 'contractor' ? uniqueLabel(s, ev.name ?? ev.type) : existing.label
    s = put(s, {
      ...existing,
      type: ev.type,
      label,
      parentId: ev.parentId,
      description: ev.description,
      isTeammate: ev.isTeammate,
      look: lookFor(ev.type, ev.id),
      lastEventAt: ev.at,
    })
  }
  return withLine(s, ev.at, narrate(s, ev))
}

function findByName(scene: Scene, name: string, selfId: string): Agent | undefined {
  const wanted = name.toLowerCase()
  return Object.values(scene.agents).find(
    a => a.id !== selfId && a.phase !== 'gone' && (a.label.toLowerCase() === wanted || a.id === name),
  )
}

function toolStarted(scene: Scene, ev: Ev<'toolStarted'>): Scene {
  let s = scene
  let agent = s.agents[ev.agentId]
  if (agent === undefined) {
    agent = arrive(s, ev.agentId, 'contractor', uniqueLabel(s, 'Contractor'), ev.at)
    s = addAgent(s, agent)
  } else if (agent.phase === 'gone') {
    agent = {
      ...agent,
      phase: 'arriving',
      station: 'elevator',
      slot: 0,
      pos: slotPoint('elevator', 0),
      walk: null,
      goneAt: null,
      desk: nextDesk(s),
      arrivedAt: ev.at,
    }
  }
  const wasBriefing = agent.phase === 'briefing'
  let moved: Agent
  if (ev.tool === 'SendMessage') {
    const recipient = findByName(s, ev.target, agent.id)
    moved = recipient !== undefined ? moveTo(s, agent, agent.station, ev.at, [beside(recipient)]) : moveTo(s, agent, 'meeting', ev.at)
  } else {
    moved = moveTo(s, agent, stationFor(ev.tool), ev.at)
  }
  s = put(s, {
    ...moved,
    phase: WAITING_TOOLS.has(ev.tool) ? 'waiting' : 'working',
    activity: { tool: ev.tool, target: ev.target, callId: ev.callId, since: ev.at },
    lastEventAt: ev.at,
  })
  if (wasBriefing) s = endBriefing(s, agent, ev.at)
  return withLine(s, ev.at, narrate(s, ev))
}

function toolEnded(scene: Scene, ev: Ev<'toolEnded'>): Scene {
  const agent = scene.agents[ev.agentId]
  if (agent === undefined || agent.phase === 'gone') return scene
  const isCurrent = agent.activity?.callId === ev.callId
  let next: Agent = {
    ...agent,
    activity: isCurrent ? null : agent.activity,
    lastErrorAt: ev.isError ? ev.at : agent.lastErrorAt,
    lastEventAt: ev.at,
  }
  if (isCurrent && agent.phase === 'waiting') next = { ...moveTo(scene, next, homeOf(next), ev.at), phase: 'working' }
  return withLine(put(scene, next), ev.at, narrate(scene, ev))
}

function latestUser(scene: Scene, tool: string): string {
  let best: Agent | undefined
  for (const a of Object.values(scene.agents)) {
    if (a.phase === 'gone' || a.activity?.tool !== tool) continue
    if (best === undefined || a.activity.since > (best.activity?.since ?? -1)) best = a
  }
  return best?.id ?? MAIN
}

function waiting(scene: Scene, ev: Ev<'waiting'>): Scene {
  const id = ev.agentId !== null && scene.agents[ev.agentId] !== undefined ? ev.agentId : latestUser(scene, ev.tool)
  const agent = scene.agents[id]
  if (agent === undefined || agent.phase === 'gone') return scene
  const s = put(scene, { ...moveTo(scene, agent, 'reception', ev.at), phase: 'waiting', lastEventAt: ev.at })
  return withLine(s, ev.at, narrate(s, { ...ev, agentId: id }))
}

function turnStarted(scene: Scene, ev: Ev<'turnStarted'>): Scene {
  const main = scene.agents[MAIN]
  if (main === undefined) return scene
  const s = put(scene, { ...moveTo(scene, main, 'office', ev.at), phase: 'working', lastEventAt: ev.at })
  return withLine(s, ev.at, narrate(s, ev))
}

function prune(scene: Scene): Scene {
  const gone = scene.order.filter(id => scene.agents[id]?.phase === 'gone')
  if (gone.length <= GONE_KEEP) return scene
  const drop = new Set(gone.slice(0, gone.length - GONE_KEEP))
  const agents = { ...scene.agents }
  for (const id of drop) delete agents[id]
  return { ...scene, agents, order: scene.order.filter(id => !drop.has(id)) }
}

function handedBack(scene: Scene, ev: Ev<'handedBack'>): Scene {
  const agent = scene.agents[ev.agentId]
  if (agent === undefined || agent.id === MAIN || agent.phase === 'gone') return scene
  const parent = agent.parentId === null ? undefined : scene.agents[agent.parentId]
  const via = parent !== undefined && parent.phase !== 'gone' ? [beside(parent)] : []
  let next: Agent
  if (agent.isTeammate) {
    next = { ...moveTo(scene, agent, 'breakroom', ev.at, via), phase: 'idle' }
  } else {
    const moved = moveTo(scene, agent, 'elevator', ev.at, via)
    next = { ...moved, phase: 'gone', goneAt: ev.at + (moved.walk?.durationMs ?? 0) }
  }
  let s = put(scene, { ...next, activity: null, lastEventAt: ev.at })
  if (agent.phase === 'briefing') s = endBriefing(s, agent, ev.at)
  s = prune(s)
  return withLine(s, ev.at, narrate(s, ev))
}

function sweepTarget(agent: Agent, now: number): StationId | null {
  if (agent.activity !== null || agent.phase === 'gone' || agent.phase === 'idle' || agent.phase === 'briefing') return null
  const quiet = now - agent.lastEventAt
  if (quiet >= IDLE_MS) return 'breakroom'
  if (quiet >= LINGER_MS && agent.station !== homeOf(agent)) return homeOf(agent)
  return null
}

export function needsSweep(scene: Scene, now: number): boolean {
  return Object.values(scene.agents).some(a => sweepTarget(a, now) !== null)
}

function tick(scene: Scene, at: number): Scene {
  let s = scene
  for (const id of scene.order) {
    const agent = s.agents[id]
    if (agent === undefined) continue
    const target = sweepTarget(agent, at)
    if (target === null) continue
    s = put(s, { ...moveTo(s, agent, target, at), phase: target === 'breakroom' ? 'idle' : 'working' })
  }
  return s
}

export function reduce(scene: Scene, ev: OfficeEvent): Scene {
  switch (ev.kind) {
    case 'spawned':
      return spawned(scene, ev)
    case 'toolStarted':
      return toolStarted(scene, ev)
    case 'toolEnded':
      return toolEnded(scene, ev)
    case 'waiting':
      return waiting(scene, ev)
    case 'turnStarted':
      return turnStarted(scene, ev)
    case 'handedBack':
      return handedBack(scene, ev)
    case 'todos':
      return { ...scene, todos: { done: ev.done, open: ev.open } }
    case 'tick':
      return tick(scene, ev.at)
  }
}
