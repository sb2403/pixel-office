import type { Agent, Look, Phase, PeerAgent, PeerSession, PeerStatus, Scene, StationId } from '../types'
import { MAIN, waitingOn } from './model'
import { statusOf } from './render'
import { isBuiltIn, roleFor } from './roles'
import { HEIGHT, STATION_ORDER, WIDTH, gist, stationFor } from './stations'

// The other sessions on this computer. Each running copy of the office, with `otherSessions` on, claims one slot
// file in a shared folder, rewrites it with a small snapshot of its own office, and reads the other slots. A slot,
// not a file per session: the engine has no delete, so a file per session would pile up for ever.
export const PEER_SCHEMA = 1
export const SLOT_COUNT = 32
// A slot whose heartbeat is further than this from now, either way, is free, and its session is not shown.
export const STALE_MS = 20_000
// How often a session looks at the others, and how often it writes its heartbeat when nothing changed.
export const POLL_MS = 2000
export const BEAT_MS = 6000
// A change in what the list shows redraws the pane at once only when a session comes, goes or starts waiting on
// you; any other change waits this long, as each redraw restarts the walks in the picture.
export const CALM_MS = 10_000
// A file bigger than this is not a snapshot, and is not read.
export const PEER_FILE_MAX = 8192
// How much of the project's name and of the job's message a snapshot keeps.
export const PEER_TEXT_MAX = 60
export const PEERS_SHOWN = 6
// How many of a session's agents its snapshot carries: Main first, then the latest to do anything. As many as a busy
// session has at once, and few enough to keep the file (about 250 bytes an agent) well under PEER_FILE_MAX.
export const PEER_AGENTS_MAX = 20
const LABEL_MAX = 24

export const slotName = (slot: number): string => `slot-${String(slot).padStart(2, '0')}.json`
const SLOT_FILE = /^slot-(\d\d)\.json$/

// The slot a file name stands for, or null for any other file.
export function slotOf(name: string): number | null {
  const found = SLOT_FILE.exec(name)
  if (found === null) return null
  const slot = Number(found[1])
  return slot < SLOT_COUNT ? slot : null
}

// The folder all of this person's sessions share: under the same Claude config folder the mod's store lives in.
export function peerDirOf(env: { configDir?: string; home?: string; userProfile?: string }): string | null {
  const clean = (path: string | undefined): string | null => {
    const trimmed = path?.trim() ?? ''
    return trimmed === '' ? null : trimmed.replace(/[\\/]+$/, '')
  }
  const home = clean(env.home) ?? clean(env.userProfile)
  const config = clean(env.configDir) ?? (home === null ? null : `${home}/.claude`)
  return config === null ? null : `${config}/pixel-office/sessions`
}

// The last part of a path, Windows or not: what a session's project is called in the list.
export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(part => part !== '')
  return parts[parts.length - 1] ?? ''
}

// What Main is doing, in words that name a kind of work and never its object: no file, command, host or search.
const DOING: Readonly<Record<StationId, string>> = {
  office: 'thinking',
  desk: 'editing files',
  library: 'reading and searching',
  phone: 'on the web',
  mailroom: 'using a connected service',
  server: 'running a command',
  meeting: 'messaging',
  taskboard: 'updating its to-do list',
  reception: 'waiting on you',
  elevator: 'working',
  breakroom: 'resting',
}

export function doingOf(scene: Scene): string {
  if (Object.values(scene.agents).some(a => a.phase === 'waiting')) return 'waiting on you'
  const main = scene.agents[MAIN]
  if (main === undefined) return ''
  const awaited = waitingOn(scene, MAIN).length
  if (main.activity === null) {
    if (awaited > 0) return awaited === 1 ? 'waiting on 1 helper' : `waiting on ${awaited} helpers`
    return ''
  }
  return DOING[stationFor(main.activity.tool)]
}

// Main's status in the panel's words, or `waiting` when anyone in the session waits on you.
export function peerStatusOf(scene: Scene): PeerStatus {
  if (Object.values(scene.agents).some(a => a.phase === 'waiting')) return 'waiting'
  const main = scene.agents[MAIN]
  const status = main === undefined ? 'idle' : statusOf(scene, main)
  return status === 'working' || status === 'coordinating' ? status : 'idle'
}

export type PeerMeta = { instance: string; sessionId: string; startedAt: number; project: string; since: number }

// What this session tells the others. Nothing else of the session leaves it: no briefs, reports, commands, file
// names or helper names.
export function snapshotOf(scene: Scene, meta: PeerMeta, now: number): PeerSession {
  return {
    v: PEER_SCHEMA,
    instance: meta.instance,
    sessionId: meta.sessionId,
    beatAt: now,
    startedAt: meta.startedAt,
    endedAt: null,
    project: gist(meta.project, PEER_TEXT_MAX),
    status: peerStatusOf(scene),
    since: meta.since,
    doing: doingOf(scene),
    task: scene.job === null || scene.job.endedAt !== null ? '' : gist(scene.job.task, PEER_TEXT_MAX),
    needsYou: Object.values(scene.agents).filter(a => a.phase === 'waiting').length,
    agents: agentsOf(scene),
  }
}

const tenth = (v: number): number => Math.round(v * 10) / 10

// Who is in this office, for another session to look in on: kinds of agent, role words, where each stands and
// whether it is busy. A helper of a kind set up by its owner goes as `helper`, and a helper the office named after
// itself ("code-reviewer", a teammate's name) goes by its role words, so no name leaves the session.
export function agentsOf(scene: Scene): PeerAgent[] {
  const here = Object.values(scene.agents)
    .filter((a): a is Agent & { phase: PeerAgent['phase'] } => a.phase !== 'gone')
    .sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : b.lastEventAt - a.lastEventAt || (a.id < b.id ? -1 : 1)))
    .slice(0, PEER_AGENTS_MAX)
  const ids = new Map(here.map((a, i) => [a.id, a.id === MAIN ? MAIN : `a${i}`]))
  return here.map(a => {
    const type = a.id === MAIN ? 'main' : isBuiltIn(a.type) ? a.type : 'helper'
    const title = roleFor(type).title
    const isRoleName = a.label === title || new RegExp(`^${title} \\d{1,3}$`).test(a.label)
    return {
      id: ids.get(a.id) ?? MAIN,
      boss: a.parentId === null ? null : (ids.get(a.parentId) ?? MAIN),
      type,
      label: a.id === MAIN ? 'Main' : isRoleName ? a.label : title,
      phase: a.phase,
      station: a.station,
      slot: a.slot,
      x: tenth(a.pos.x),
      y: tenth(a.pos.y),
      look: a.look,
      isBusy: a.activity !== null,
      isTeammate: a.isTeammate,
      isBackground: a.isBackground,
    }
  })
}

// A session that has ended says so in its slot, with nothing else in it, so the others drop it at once.
export function tombstoneOf(meta: PeerMeta, now: number): PeerSession {
  return {
    v: PEER_SCHEMA,
    instance: meta.instance,
    sessionId: meta.sessionId,
    beatAt: now,
    startedAt: meta.startedAt,
    endedAt: now,
    project: '',
    status: 'idle',
    since: now,
    doing: '',
    task: '',
    needsYou: 0,
    agents: [],
  }
}

// Whatever another copy, an older version or anything else left in the folder is read as data and checked field by
// field, and its text is cleaned again: a file that is not a snapshot of this schema is no session.
const STATUSES: readonly PeerStatus[] = ['working', 'coordinating', 'waiting', 'idle']
const DOINGS = new Set(['', 'waiting on 1 helper', ...Object.values(DOING)])
const isText = (value: unknown): value is string => typeof value === 'string'
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
// Beyond what `gist` drops: the C1 controls and the marks that reorder text on screen.
const UNSEEN = /[\u0080-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g
// A whole terminal escape sequence goes, not only its escape character, which would leave "[31m" on show.
const ESCAPES = /\u001B(\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001B]*(\u0007|\u001B\\)?|[@-_])/g
const cleaned = (text: string, max: number): string => gist(text.slice(0, max * 4).replace(ESCAPES, '').replace(UNSEEN, ''), max)

const PHASES: readonly PeerAgent['phase'][] = ['arriving', 'briefing', 'working', 'waiting', 'idle']
const AGENT_ID = /^(main|a\d{1,2})$/
const COLOR = /^#[0-9a-fA-F]{6}$/
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean'
const isAt = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max

function parseLook(raw: unknown): Look | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { shirt, hair, skin } = raw as Record<string, unknown>
  return isText(shirt) && COLOR.test(shirt) && isText(hair) && COLOR.test(hair) && isText(skin) && COLOR.test(skin) ? { shirt, hair, skin } : null
}

function parseAgent(raw: unknown): PeerAgent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const { id, boss, type, label, phase, station, slot, x, y, isBusy, isTeammate, isBackground } = r
  if (!isText(id) || !AGENT_ID.test(id) || (boss !== null && (!isText(boss) || !AGENT_ID.test(boss)))) return null
  if (!isText(type) || !(type === 'helper' || isBuiltIn(type)) || !isText(label)) return null
  const knownPhase = PHASES.find(p => p === phase)
  const knownStation = STATION_ORDER.find(st => st === station)
  const look = parseLook(r.look)
  if (knownPhase === undefined || knownStation === undefined || look === null) return null
  if (!isAt(slot, 63) || !Number.isInteger(slot) || !isAt(x, WIDTH) || !isAt(y, HEIGHT)) return null
  if (!isFlag(isBusy) || !isFlag(isTeammate) || !isFlag(isBackground)) return null
  const name = cleaned(label, LABEL_MAX)
  return {
    id,
    boss,
    type,
    label: name === '' ? roleFor(type).title : name,
    phase: knownPhase,
    station: knownStation,
    slot,
    x,
    y,
    look,
    isBusy,
    isTeammate,
    isBackground,
  }
}

// A copy from before the field sends no agents, and one that sends anything off is shown with none: an office with
// nobody in it says less than a wrong one would.
function parseAgents(raw: unknown): PeerAgent[] {
  if (!Array.isArray(raw)) return []
  const out: PeerAgent[] = []
  const ids = new Set<string>()
  for (const item of raw.slice(0, PEER_AGENTS_MAX)) {
    const agent = parseAgent(item)
    if (agent === null || ids.has(agent.id)) return []
    ids.add(agent.id)
    out.push(agent)
  }
  return out
}

export function parsePeer(text: string): PeerSession | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.v !== PEER_SCHEMA) return null
  const { instance, sessionId, beatAt, startedAt, endedAt, project, status, since, doing, task, needsYou } = r
  if (!isText(instance) || instance === '' || instance.length > 64 || !isText(sessionId) || sessionId.length > 128) return null
  if (!isTime(beatAt) || !isTime(startedAt) || !isTime(since) || (endedAt !== null && !isTime(endedAt))) return null
  if (!isText(project) || !isText(task) || !isText(doing) || !isTime(needsYou)) return null
  const known = STATUSES.find(s => s === status)
  if (known === undefined) return null
  const isWaitingOnHelpers = /^waiting on \d{1,3} helpers$/.test(doing)
  return {
    v: PEER_SCHEMA,
    instance,
    sessionId,
    beatAt,
    startedAt,
    endedAt,
    project: cleaned(project, PEER_TEXT_MAX),
    status: known,
    since,
    // Only the words this office itself writes: anything else in that field is dropped, not shown.
    doing: DOINGS.has(doing) || isWaitingOnHelpers ? doing : '',
    task: cleaned(task, PEER_TEXT_MAX),
    needsYou: Math.min(999, Math.floor(needsYou)),
    agents: parseAgents(r.agents),
  }
}

// What names one session's row in the list, and the office being looked in on.
export const peerKey = (peer: PeerSession): string => `${peer.sessionId}:${peer.instance}`

// Another session's office, as the picture draws it: its agents where they are headed, busy or not, with nothing
// in their bubbles but their station's sign. Times are set so nobody looks newly arrived or long gone.
export function officeOf(peer: PeerSession, now: number): Scene {
  const agents: Record<string, Agent> = {}
  peer.agents.forEach((p, i) => {
    const role = roleFor(p.type)
    agents[p.id] = {
      id: p.id,
      parentId: p.id === MAIN ? null : p.boss !== null && p.boss !== p.id ? p.boss : MAIN,
      type: p.type,
      role: role.title,
      name: null,
      label: p.label,
      description: '',
      brief: '',
      report: '',
      outcome: null,
      usage: null,
      isTeammate: p.isTeammate,
      isBackground: p.isBackground,
      phase: p.phase as Phase,
      station: p.station,
      slot: p.slot,
      desk: -1,
      pos: { x: p.x, y: p.y },
      walk: null,
      activity: p.isBusy ? { tool: '', target: '', detail: '', callId: '', since: now } : null,
      lastErrorAt: null,
      lastEventAt: now - i,
      arrivedAt: now - 60_000,
      doneAt: null,
      goneAt: null,
      carry: null,
      look: p.look,
    }
  })
  const order = peer.agents.filter(p => p.id !== MAIN).map(p => p.id)
  return { agents, order, ticker: [], todos: null, briefing: null, job: null }
}

// What a looked-in office shows: a change in any of it redraws the picture.
export const lookedOf = (peer: PeerSession): string => JSON.stringify([peerKey(peer), peer.project, peer.status, peer.agents])

// A heartbeat counts while it is near now: not older than the stale window, and not further ahead than it either,
// so a clock set back neither keeps a dead session on show nor keeps its slot taken.
export const isLive = (peer: PeerSession, now: number): boolean => peer.endedAt === null && Math.abs(now - peer.beatAt) <= STALE_MS

export type Self = { instance: string; sessionId: string }

const ORDER: Readonly<Record<PeerStatus, number>> = { waiting: 0, working: 1, coordinating: 2, idle: 3 }

// Of two live slots with one session id (a hot reload's old copy beside the new one), the later load.
const isLater = (a: PeerSession, b: PeerSession): boolean => a.startedAt !== b.startedAt ? a.startedAt > b.startedAt : a.instance > b.instance

// The sessions to show: live, not this copy, not this session under another copy (what a hot reload leaves behind
// for a moment), one row per session id; the ones waiting on you first, then the busy ones, oldest first in each.
export function livePeers(found: readonly PeerSession[], self: Self, now: number): PeerSession[] {
  const bySession = new Map<string, PeerSession>()
  for (const peer of found) {
    if (!isLive(peer, now) || peer.instance === self.instance || peer.sessionId === self.sessionId) continue
    const key = peer.sessionId === '' ? `instance:${peer.instance}` : peer.sessionId
    const held = bySession.get(key)
    if (held === undefined || isLater(peer, held)) bySession.set(key, peer)
  }
  return [...bySession.values()].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.startedAt - b.startedAt || (a.instance < b.instance ? -1 : 1),
  )
}

// What a slot was found to hold: its snapshot, or null when it could not be read as one, with the file's own time.
// `isOdd` is a slot that is not a plain small file (a link, a folder, something big): never read, written or free.
export type SlotSeen = { peer: PeerSession | null; mtimeMs: number; isOdd: boolean }

// The slots another copy can take: missing, ended, stale, or unreadable for longer than the stale window (a file
// caught half written is someone's, until it stays broken). `own` is a slot holding this session under an older
// copy, which a hot reload takes back first.
export function freeSlots(seen: ReadonlyMap<number, SlotSeen>, self: Self, now: number): { own: number | null; free: number[] } {
  const free: number[] = []
  let own: number | null = null
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const found = seen.get(slot)
    if (found === undefined) {
      free.push(slot)
      continue
    }
    const { peer } = found
    if (found.isOdd) continue
    if (peer === null) {
      if (Math.abs(now - found.mtimeMs) > STALE_MS) free.push(slot)
      continue
    }
    if (peer.instance === self.instance || !isLive(peer, now)) free.push(slot)
    else if (own === null && self.sessionId !== '' && peer.sessionId === self.sessionId) own = slot
  }
  return { own, free }
}

// Whether the slot this copy holds now holds someone else, alive: two copies took the same free slot at once, and
// the one that sees it moves.
export const isTakenFrom = (found: SlotSeen | undefined, instance: string, now: number): boolean =>
  found !== undefined && found.peer !== null && found.peer.instance !== instance && isLive(found.peer, now)

const STATUS_WORDS: Readonly<Record<PeerStatus, string>> = {
  working: 'working',
  coordinating: 'coordinating',
  waiting: 'needs you',
  idle: 'idle',
}

// "4m", "2h 5m": how long a session has been waiting on you, or idle. Nothing under a minute.
export function sinceWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

export type PeerRow = { key: string; status: PeerStatus; line: string; job: string }

// The list: "pixel-office · needs you 3m · waiting on you", and under it the job. Two projects with one name are
// told apart by a number, never by their paths.
export function peerRows(peers: readonly PeerSession[], now: number): PeerRow[] {
  const seen = new Map<string, number>()
  return peers.map(peer => {
    const name = peer.project === '' ? 'A session' : peer.project
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    const project = count === 1 ? name : `${name} (${count})`
    const waited = peer.status === 'waiting' || peer.status === 'idle' ? sinceWords(now - peer.since) : ''
    const status = waited === '' ? STATUS_WORDS[peer.status] : `${STATUS_WORDS[peer.status]} ${waited}`
    const line = [project, status, peer.doing === 'waiting on you' ? '' : peer.doing].filter(part => part !== '').join(' · ')
    return { key: peerKey(peer), status: peer.status, line, job: peer.task === '' ? '' : `→ ${peer.task}` }
  })
}

// "Your other sessions (3, 1 needs you)".
export function peersHeading(peers: readonly PeerSession[]): string {
  const waiting = peers.filter(p => p.status === 'waiting').length
  return waiting === 0 ? `Your other sessions (${peers.length})` : `Your other sessions (${peers.length}, ${waiting} need${waiting === 1 ? 's' : ''} you)`
}

// What would make the pane redraw at once (a session came or went, or started waiting on you), and everything the
// list shows: a change only in the second waits for the calm window.
// Sorted, so a change that only reorders the list (one session going from working to idle) is not urgent.
export const urgentOf = (peers: readonly PeerSession[]): string =>
  JSON.stringify(peers.map(p => `${p.sessionId}:${p.instance}:${p.status === 'waiting' ? 'w' : '-'}`).sort())
export const shownOf = (peers: readonly PeerSession[]): string =>
  JSON.stringify(peers.map(p => [p.sessionId, p.instance, p.project, p.status, p.since, p.doing, p.task]))

// What the snapshot says that the others can see: a beat that changes none of it need not be written early.
export const contentOf = (peer: PeerSession): string => JSON.stringify({ ...peer, beatAt: 0 })
