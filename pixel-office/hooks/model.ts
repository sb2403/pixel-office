import type { Agent, Carry, OfficeEvent, Outcome, Point, Scene, StationId, Usage, Walk } from '../types'
import { allBackLine, narrate } from './narrate'
import { COORDINATOR, asName, roleFor } from './roles'
import { lookFor } from './sprites'
import {
  EXCERPT,
  WAITING_TOOLS,
  WIDTH,
  clamp,
  doorOf,
  fullText,
  pathLength,
  pointAlong,
  route,
  slotPoint,
  stationFor,
} from './stations'

export const MAIN = 'main'
export const TICKER_MAX = 8
export const GONE_KEEP = 50
export const FULL_KEEP = 10
export const LINGER_MS = 8_000
export const IDLE_MS = 600_000
export const BRIEFING_MAX_MS = 60_000
export const WALK_SPEED = 120

type Ev<K extends OfficeEvent['kind']> = Extract<OfficeEvent, { kind: K }>
type Stop = { point: Point; door: Point }

export function emptyScene(): Scene {
  const main: Agent = {
    id: MAIN,
    parentId: null,
    type: 'main',
    role: COORDINATOR.title,
    name: null,
    label: 'Main',
    description: '',
    brief: '',
    report: '',
    outcome: null,
    usage: null,
    isTeammate: false,
    isBackground: false,
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
    carry: null,
    look: lookFor('main', MAIN),
  }
  return { agents: { [MAIN]: main }, order: [MAIN], ticker: [], todos: null, briefing: null }
}

// Fields added to an agent since the first release, with what an agent saved without them stands for. Session
// state outlives a hot reload of the mod, so a scene saved by an older version can meet this code.
const AGENT_DEFAULTS = (agent: Agent): Partial<Agent> => ({
  role: roleFor(agent.type).title,
  name: null,
  brief: '',
  report: '',
  outcome: null,
  // Nothing says its boss waits on it, so it never makes its boss look busy.
  isBackground: true,
  carry: null,
  usage: null,
})
const AGENT_KEYS = Object.keys(AGENT_DEFAULTS({ type: MAIN } as Agent)) as (keyof Agent)[]

// The scene as this version reads it. The same object comes back when nothing is missing, so a scene that is
// already whole is never rewritten (a write would redraw the pane).
export function restore(scene: Scene): Scene {
  const isWhole = (agent: Agent): boolean => AGENT_KEYS.every(key => key in agent)
  if (Object.values(scene.agents).every(isWhole)) return scene
  const agents: Record<string, Agent> = {}
  for (const [id, agent] of Object.entries(scene.agents)) {
    agents[id] = isWhole(agent) ? agent : ({ ...AGENT_DEFAULTS(agent), ...agent } as Agent)
  }
  return { ...scene, agents }
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

// A routine line replaces the same agent's last routine line, so a few busy helpers cannot push the story
// (who hired whom, who reported back, who needs you) out of the feed within seconds.
function withLine(scene: Scene, at: number, text: string | null, routineOf: string | null = null): Scene {
  if (text === null) return scene
  const kept = routineOf === null ? scene.ticker : scene.ticker.filter(line => line.routineOf !== routineOf)
  return { ...scene, ticker: [...kept, { at, text, routineOf }].slice(-TICKER_MAX) }
}

// Tool calls that are part of the story rather than routine work: a message to another agent, and a wait on you.
const isMilestone = (tool: string): boolean => tool === 'SendMessage' || WAITING_TOOLS.has(tool)

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

// Every walk drops whatever the agent was carrying, unless `item` says it carries something this time: it is
// handed over when the walk reaches the first stop in `via`, the agent it is walking to.
function moveTo(
  scene: Scene,
  agent: Agent,
  target: StationId,
  at: number,
  via: readonly Stop[] = [],
  item: Carry['item'] | null = null,
): Agent {
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
  let handover = 0
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as Stop
    const b = stops[i] as Stop
    points = points.concat(route(a.point, a.door, b.point, b.door).slice(1))
    if (i === 1) handover = pathLength(points)
  }
  const length = pathLength(points)
  const walk: Walk | null = length < 0.5 ? null : { points, startedAt: at, durationMs: walkMs(length) }
  const carry: Carry | null =
    item === null || walk === null || via.length === 0
      ? null
      : { item, until: at + Math.round((walk.durationMs * handover) / length) }
  return { ...agent, station, slot, pos: dest, walk, carry }
}

function beside(agent: Agent): Stop {
  return {
    point: { x: clamp(agent.pos.x + 9, 4, WIDTH - 4), y: agent.pos.y },
    door: doorOf(agent.station, agent.slot),
  }
}

// The first of a kind is plain "Researcher", the next "Researcher 2". Numbering goes on from the highest number
// in the office, so a label is never handed out twice, even after old helpers are pruned from the model.
function uniqueLabel(scene: Scene, base: string): string {
  let highest = 0
  for (const a of Object.values(scene.agents)) {
    if (a.label === base) highest = Math.max(highest, 1)
    else if (a.label.startsWith(`${base} `)) {
      const n = Number(a.label.slice(base.length + 1))
      if (Number.isInteger(n) && n > 1) highest = Math.max(highest, n)
    }
  }
  return highest === 0 ? base : `${base} ${highest + 1}`
}

const labelFor = (scene: Scene, type: string, name: string | null): string =>
  uniqueLabel(scene, name === null || name === '' ? roleFor(type).title : asName(name))

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

// A contractor (an agent the office never saw hired) is taken to work in the background: nothing says its boss
// is waiting on it, so it never makes its boss look busy.
function arrive(scene: Scene, id: string, type: string, label: string, at: number): Agent {
  return {
    id,
    parentId: MAIN,
    type,
    role: roleFor(type).title,
    name: null,
    label,
    description: '',
    brief: '',
    report: '',
    outcome: null,
    usage: null,
    isTeammate: false,
    isBackground: true,
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
    carry: null,
    look: lookFor(type, id),
  }
}

const isOut = (agent: Agent): boolean =>
  agent.phase === 'arriving' || agent.phase === 'briefing' || agent.phase === 'working' || agent.phase === 'waiting'

// The helpers `bossId` is waiting on: hired in the foreground (the boss's call to hire them only returns with
// their report) and still out on the job, in the order they were hired. A teammate is a standing colleague
// rather than an errand, so its boss never waits on it.
export function waitingOn(scene: Scene, bossId: string): Agent[] {
  const out: Agent[] = []
  for (const id of scene.order) {
    const a = scene.agents[id]
    if (a !== undefined && a.parentId === bossId && !a.isBackground && !a.isTeammate && isOut(a)) out.push(a)
  }
  return out
}

// A boss with nothing in hand, waiting for the reports of the helpers it hired, is coordinating rather than
// thinking. A boss that is using a tool, waiting on you, resting or gone is doing that instead.
export function isCoordinating(scene: Scene, agent: Agent): boolean {
  if (agent.activity !== null || agent.phase === 'gone' || agent.phase === 'idle' || agent.phase === 'waiting') return false
  return waitingOn(scene, agent.id).length > 0
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

// The agent walks to the meeting room to be briefed, its boss joins it there unless busy, and the whiteboard
// shows the job.
function brief(scene: Scene, agent: Agent, ev: Ev<'spawned'>): Scene {
  let s = put(scene, { ...moveTo(scene, agent, 'meeting', ev.at), phase: 'briefing' })
  const parent = s.agents[ev.parentId]
  if (parent !== undefined && parent.activity === null && parent.phase !== 'gone') {
    s = put(s, { ...moveTo(s, parent, 'meeting', ev.at), phase: 'working', lastEventAt: ev.at })
  }
  return { ...s, briefing: ev.description }
}

// A called-back agent comes back by the elevator if it had left, starts a new stint and is briefed again. The
// message it is called back with is its new brief; with none, the old brief still stands.
function callBack(scene: Scene, agent: Agent, ev: Ev<'spawned'>): Scene {
  const isBack = agent.phase === 'gone'
  const returning: Agent = {
    ...agent,
    ...(isBack ? { station: 'elevator' as const, slot: 0, pos: slotPoint('elevator', 0), walk: null, desk: nextDesk(scene) } : {}),
    parentId: ev.parentId,
    description: ev.description,
    brief: ev.brief === '' ? agent.brief : ev.brief,
    isBackground: ev.isBackground,
    outcome: null,
    goneAt: null,
    carry: null,
    activity: null,
    arrivedAt: ev.at,
    lastEventAt: ev.at,
  }
  return brief(scene, returning, ev)
}

function spawned(scene: Scene, ev: Ev<'spawned'>): Scene {
  const existing = scene.agents[ev.id]
  let s = scene
  const hire = {
    parentId: ev.parentId,
    description: ev.description,
    brief: ev.brief,
    name: ev.name,
    isTeammate: ev.isTeammate,
    isBackground: ev.isBackground,
  }
  if (existing === undefined) {
    const fresh = { ...arrive(s, ev.id, ev.type, labelFor(s, ev.type, ev.name), ev.at), ...hire }
    s = brief(addAgent(s, fresh), fresh, ev)
  } else if (ev.isResume) {
    s = callBack(s, existing, ev)
  } else {
    const label = existing.type === 'contractor' ? labelFor(s, ev.type, ev.name) : existing.label
    s = put(s, {
      ...existing,
      ...hire,
      type: ev.type,
      role: roleFor(ev.type).title,
      label,
      look: lookFor(ev.type, ev.id),
      lastEventAt: ev.at,
    })
  }
  return withLine(s, ev.at, narrate(s, ev))
}

// Messages are addressed by the name the engine knows an agent by, by its id, or (for "main") by its label.
function findByName(scene: Scene, name: string, selfId: string): Agent | undefined {
  const wanted = name.toLowerCase()
  return Object.values(scene.agents).find(
    a =>
      a.id !== selfId &&
      a.phase !== 'gone' &&
      (a.name?.toLowerCase() === wanted || a.label.toLowerCase() === wanted || a.id === name),
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
      outcome: null,
      carry: null,
      desk: nextDesk(s),
      arrivedAt: ev.at,
    }
  }
  const wasBriefing = agent.phase === 'briefing'
  let moved: Agent
  if (ev.tool === 'SendMessage') {
    const recipient = findByName(s, ev.target, agent.id)
    moved =
      recipient !== undefined
        ? moveTo(s, agent, agent.station, ev.at, [beside(recipient)], 'message')
        : moveTo(s, agent, 'meeting', ev.at)
  } else {
    moved = moveTo(s, agent, stationFor(ev.tool), ev.at)
  }
  s = put(s, {
    ...moved,
    phase: WAITING_TOOLS.has(ev.tool) ? 'waiting' : 'working',
    activity: { tool: ev.tool, target: ev.target, detail: ev.detail, callId: ev.callId, since: ev.at },
    lastEventAt: ev.at,
  })
  if (wasBriefing) s = endBriefing(s, agent, ev.at)
  return withLine(s, ev.at, narrate(s, ev), isMilestone(ev.tool) ? null : agent.id)
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

// Main's turn is over: it rests where it stands until the next message. No walk; the sweep takes it
// home after a short while and to the break room after a long one.
// A teammate or a called-back helper works more than one turn, and Main works one per message: their costs add up.
export function addUsage(sum: Usage | null, more: Usage | null): Usage | null {
  if (more === null) return sum
  if (sum === null) return more
  return { tokens: sum.tokens + more.tokens, reused: sum.reused + more.reused, model: more.model }
}

function turnEnded(scene: Scene, ev: Ev<'turnEnded'>): Scene {
  const main = scene.agents[MAIN]
  if (main === undefined) return scene
  const s = put(scene, { ...main, phase: 'idle', activity: null, usage: addUsage(main.usage, ev.usage), lastEventAt: ev.at })
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

// Only the most recently finished helpers keep their whole brief and report; older ones keep as much as the
// one-line excerpt shows. That bounds the scene, which is written to state on every change.
function trimTexts(scene: Scene): Scene {
  const isLong = (a: Agent): boolean => a.brief.length > EXCERPT || a.report.length > EXCERPT
  const old = Object.values(scene.agents)
    .filter(a => a.phase === 'gone')
    .sort((a, b) => (b.goneAt ?? 0) - (a.goneAt ?? 0))
    .slice(FULL_KEEP)
    .filter(isLong)
  if (old.length === 0) return scene
  const agents = { ...scene.agents }
  for (const a of old) agents[a.id] = { ...a, brief: fullText(a.brief, EXCERPT), report: fullText(a.report, EXCERPT) }
  return { ...scene, agents }
}

const OUTCOMES: Readonly<Record<Ev<'handedBack'>['reason'], Outcome>> = {
  answer: 'reported',
  aborted: 'stopped',
  refusal: 'failed',
  error: 'failed',
}

// The helper carries its report to its boss, then leaves by the elevator (a teammate goes for a break instead).
// When it was the last report its boss was waiting for, the feed says so: that is when the boss takes over again.
function handedBack(scene: Scene, ev: Ev<'handedBack'>): Scene {
  const agent = scene.agents[ev.agentId]
  if (agent === undefined || agent.id === MAIN || agent.phase === 'gone') return scene
  const parent = agent.parentId === null ? undefined : scene.agents[agent.parentId]
  const isParentHere = parent !== undefined && parent.phase !== 'gone'
  const via = isParentHere ? [beside(parent)] : []
  const outcome = OUTCOMES[ev.reason]
  const item = outcome === 'stopped' ? null : 'report'
  let next: Agent
  if (agent.isTeammate) {
    next = { ...moveTo(scene, agent, 'breakroom', ev.at, via, item), phase: 'idle' }
  } else {
    const moved = moveTo(scene, agent, 'elevator', ev.at, via, item)
    next = { ...moved, phase: 'gone', goneAt: ev.at + (moved.walk?.durationMs ?? 0) }
  }
  const awaitedBy = isParentHere && waitingOn(scene, parent.id).some(a => a.id === agent.id) ? parent : undefined
  let s = put(scene, { ...next, activity: null, report: ev.report, outcome, usage: addUsage(agent.usage, ev.usage), lastEventAt: ev.at })
  if (agent.phase === 'briefing') s = endBriefing(s, agent, ev.at)
  s = trimTexts(prune(s))
  s = withLine(s, ev.at, narrate(s, ev))
  if (awaitedBy !== undefined && waitingOn(s, awaitedBy.id).length === 0) s = withLine(s, ev.at, allBackLine(awaitedBy.label))
  return s
}

// A boss waiting on its helpers is at work however long they take, so the sweep may walk it home but never
// sends it to the break room.
function sweepTarget(agent: Agent, now: number, isWaitingOnTeam: boolean): StationId | null {
  if (agent.activity !== null || agent.phase === 'gone') return null
  const quiet = now - agent.lastEventAt
  // A briefing normally ends with the agent's first tool; one that never comes must not hold the room forever.
  if (agent.phase === 'briefing') return quiet >= BRIEFING_MAX_MS ? homeOf(agent) : null
  if (agent.phase === 'idle') {
    // Resting in the break room is the end of the road, and an office where nothing has happened yet
    // (Main's clock still reads zero) has nobody to send for coffee.
    if (agent.station === 'breakroom' || agent.lastEventAt === 0) return null
    if (quiet >= IDLE_MS) return 'breakroom'
    return quiet >= LINGER_MS && agent.station !== homeOf(agent) ? homeOf(agent) : null
  }
  if (quiet >= IDLE_MS && !isWaitingOnTeam) return 'breakroom'
  if (quiet >= LINGER_MS && agent.station !== homeOf(agent)) return homeOf(agent)
  return null
}

export function needsSweep(scene: Scene, now: number): boolean {
  return Object.values(scene.agents).some(a => sweepTarget(a, now, isCoordinating(scene, a)) !== null)
}

function tick(scene: Scene, at: number): Scene {
  let s = scene
  for (const id of scene.order) {
    const agent = s.agents[id]
    if (agent === undefined) continue
    const target = sweepTarget(agent, at, isCoordinating(s, agent))
    if (target === null) continue
    s = put(s, { ...moveTo(s, agent, target, at), phase: target === 'breakroom' || agent.phase === 'idle' ? 'idle' : 'working' })
    if (agent.phase === 'briefing') s = endBriefing(s, agent, at)
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
    case 'turnEnded':
      return turnEnded(scene, ev)
    case 'handedBack':
      return handedBack(scene, ev)
    case 'todos':
      return { ...scene, todos: { done: ev.done, open: ev.open } }
    case 'tick':
      return tick(scene, ev.at)
  }
}
