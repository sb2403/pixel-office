import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register, TurnUsage } from 'claude-code'

import type { JobRecord, OfficeEvent, PeerSession, PeerStatus, Usage } from '../types'
import { debugOn, logText, note, takeDirty } from './debuglog'
import { MAIN, emptyScene, needsSweep, reduceAt, restore } from './model'
import { registerPane } from './pane'
import {
  BEAT_MS,
  CALM_MS,
  PEER_FILE_MAX,
  POLL_MS,
  STALE_MS,
  baseName,
  contentOf,
  freeSlots,
  isTakenFrom,
  livePeers,
  lookedOf,
  parsePeer,
  peerKey,
  peerDirOf,
  peerStatusOf,
  shownOf,
  slotName,
  slotOf,
  snapshotOf,
  tombstoneOf,
  urgentOf,
} from './peers'
import type { Self, SlotSeen } from './peers'
import { HISTORY_MAX, SESSION_MAX, isRecord, jobRecord, recapOf, withRecord } from './recap'
import { LEAD_MS, nowOf } from './render'
import { PANE, PANE_TITLE, PROBE_BOTTOM, PROBE_TOP } from './state'
import { WAITING_TOOLS, detailOf, fullText, gist, stationFor, targetOf, todoCounts } from './stations'

export const FLUSH_MS = 350
// How much of a helper's brief and of its report the office keeps, to be read in full from its details box.
export const TEXT_MAX = 2000
// How much of your message names the job in its recap.
export const TASK_MAX = 120
const SWEEP_EVERY = 15
const CLOCK_EVERY = 3
const QUEUE_MAX = 500
// With reminders on: how long an agent waits on you before the office says so, once per wait.
export const REMIND_AFTER_MS = 30_000
export const REMIND_TITLE = 'Pixel Office'
// The debug log is written at most this often.
const DEBUG_WRITE_MS = 1000

// The history, when it is switched on, lives under one key of the mod's store.
export const HISTORY_KEY = 'jobs'
const UNTRACKED = new Set(['Agent', 'Task'])
// These wake Main about work already under way, so they continue the job; a scheduled trigger, the composer,
// the bridge and the SDK are a person's or a host's own new message.
const NOT_A_NEW_JOB = new Set(['task-notification', 'peer', 'peer-send-message'])

// Atoms cannot be imported across files, so each file that reads one declares it again; pane.tsx has the same three.
const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())
const selectedAtom = atom({ plugin: 'pixel-office', key: 'selected' } as const, null as string | null)
const clockAtom = atom({ plugin: 'pixel-office', key: 'clock' } as const, 0)
const expandedAtom = atom({ plugin: 'pixel-office', key: 'expanded' } as const, null as 'brief' | 'report' | null)
const jobOpenAtom = atom({ plugin: 'pixel-office', key: 'jobOpen' } as const, false)
const historyAtom = atom({ plugin: 'pixel-office', key: 'history' } as const, [] as JobRecord[])
const sessionAtom = atom({ plugin: 'pixel-office', key: 'session' } as const, [] as JobRecord[])
const othersAtom = atom({ plugin: 'pixel-office', key: 'others' } as const, [] as PeerSession[])
const lookingAtom = atom({ plugin: 'pixel-office', key: 'looking' } as const, null as string | null)
const lookedAtom = atom({ plugin: 'pixel-office', key: 'looked' } as const, null as PeerSession | null)


// A turn's token counts, summed over its requests (absent when nothing counted: an interrupt, an API error).
const usageOf = (u: TurnUsage | undefined): Usage | null =>
  u === undefined
    ? null
    : {
        tokens: u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        reused: u.cache_read_input_tokens,
        model: u.model,
      }

const quietly = async (work: () => Promise<void> | void): Promise<void> => {
  try {
    await work()
  } catch {
    // The office is best effort: it never disturbs the session it watches.
  }
}

// The other sessions on this computer (option `otherSessions`), looked at on a schedule of its own beside the flush,
// so a slow or stuck disk never holds up this session's own office.
type Peers = {
  // The shared folder: undefined until looked up, null when there is none.
  dir: string | null | undefined
  // This load of the module: a hot reload or a second process on the same session is another instance.
  instance: string
  startedAt: number
  slot: number | null
  hasClaimed: boolean
  // When the slot was last read back holding this instance (or claimed): the tombstone is written only then.
  verifiedAt: number
  lastPoll: number
  lastBeat: number
  lastContent: string
  status: PeerStatus | null
  since: number
  isBusy: boolean
  // Counts the looks. A look that overran LOOK_MAX_MS is let go: the next one starts, and the old one, if its disk
  // call ever comes back, finds the count moved on and changes nothing.
  looks: number
  // The file a look is reading now, and the files a look was let go on: those are left alone from then on, as
  // odd slots are, so one file that never answers cannot stop every later look.
  reading: string | null
  stuck: Set<string>
  isEnded: boolean
  run: Promise<void> | null
  // Each slot file last read as a snapshot, by name, with the size and time it had then. A file that did not
  // parse is never kept, so it is read again next time.
  cache: Map<string, { mtimeMs: number; size: number; readAt: number; peer: PeerSession }>
  urgent: string
  shown: string
  shownAt: number
  reminded: Set<string>
}

// `epoch` counts the /clears: a flush notes it when it takes the queue, so it can tell its batch has gone stale.
type Office = {
  queue: OfficeEvent[]
  isFlushing: boolean
  flushes: number
  isOpened: boolean
  wantsOpen: boolean
  epoch: number
  keepsHistory: boolean
  hasJobToSave: boolean
  reminds: boolean
  // When each agent now waiting on you started to, and which of them were reminded about this wait.
  waitingSince: Map<string, number>
  reminded: Set<string>
  // The opt-in debug log: whether it is on, and when it was last written.
  isDebug: boolean
  lastDebugWrite: number
  // Where the latest prompt came from (its origin kind); the turn it starts reads and clears it.
  lastOrigin: string | null
  // Null while `otherSessions` is off: then nothing is written or read.
  peers: Peers | null
}

// The engine only lets `$` travel into functions declared at the top of this file, so the helpers that
// take it live here and share the mutable bits through one plain object.
async function openPane($: EngineInterface, office: Office): Promise<void> {
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  office.isOpened = true
}

async function loadHistory($: EngineInterface): Promise<void> {
  const saved = await $.store.get(HISTORY_KEY)
  const list = Array.isArray(saved) ? saved.filter(isRecord).slice(-HISTORY_MAX) : []
  await update($, historyAtom, () => list)
}

async function saveJob($: EngineInterface): Promise<void> {
  const recap = recapOf(restore(await read($, sceneAtom)), await $.clock.now())
  if (recap === null) return
  const list = withRecord(await read($, historyAtom), jobRecord(recap))
  await $.store.set(HISTORY_KEY, list)
  await update($, historyAtom, () => list)
}

// The session total is kept in memory whatever the history option says.
async function recordJob($: EngineInterface): Promise<void> {
  const recap = recapOf(restore(await read($, sceneAtom)), await $.clock.now())
  if (recap === null) return
  await update($, sessionAtom, list => withRecord(list, jobRecord(recap), SESSION_MAX))
}

// An agent that has waited on you for a while is said once: a toast, which shows over the transcript wherever the
// session is drawn, and a native notification, which the person's channel raises in a terminal (in the desktop
// app only their own notification hooks run). A wait that ends and begins again is a new wait.
async function remind($: EngineInterface, office: Office): Promise<void> {
  const scene = restore(await read($, sceneAtom))
  const now = await $.clock.now()
  const waiting = Object.values(scene.agents).filter(a => a.phase === 'waiting')
  for (const id of [...office.waitingSince.keys()]) {
    if (waiting.some(a => a.id === id)) continue
    office.waitingSince.delete(id)
    office.reminded.delete(id)
  }
  for (const agent of waiting) {
    const since = office.waitingSince.get(agent.id) ?? now
    office.waitingSince.set(agent.id, since)
    if (now - since < REMIND_AFTER_MS || office.reminded.has(agent.id)) continue
    office.reminded.add(agent.id)
    const text = `${agent.label} is ${nowOf(scene, agent)}`
    $.ui.toast(text, { timeoutMs: 10_000 })
    await $.ui.notify(text, { title: REMIND_TITLE })
  }
}

async function flush($: EngineInterface, office: Office): Promise<void> {
  if (office.isFlushing) return
  office.isFlushing = true
  await quietly(async () => {
    office.flushes += 1
    const now = await $.clock.now()
    const batch = office.queue
    const epoch = office.epoch
    const began = office.isDebug ? now : 0
    office.queue = []
    const isSweepTurn = office.flushes % SWEEP_EVERY === 0
    // Saved from the batch being applied, so the record never misses the end of the turn it is about.
    if (batch.some(ev => ev.kind === 'turnEnded')) office.hasJobToSave = true
    if (batch.length === 0 && !(isSweepTurn && needsSweep(restore(await read($, sceneAtom)), now))) return
    // The pane draws the picture as of LEAD_MS ahead, right after this write: the walks these events start begin
    // there, so the picture shows each one from its first step.
    const shownAt = now + LEAD_MS
    await update($, sceneAtom, scene => {
      // A /clear since the queue was taken makes this batch (and sweep) belong to the old conversation. The
      // updater reruns when a write misses its version, so the check holds however the two interleave.
      if (office.epoch !== epoch) return scene
      const applied = batch.reduce((s, ev) => reduceAt(s, ev, shownAt), restore(scene))
      return isSweepTurn && needsSweep(applied, now) ? reduceAt(applied, { kind: 'tick', at: now }, shownAt) : applied
    })
    if (office.isDebug) note('flush', { batch: batch.length, ms: (await $.clock.now()) - began }, now)
  })
  // The "On the job" clock of a selected agent is the one thing that changes with no event behind it:
  // about once a second, while a row is open, write the time to state. The pane reads that atom, and a state
  // write is what makes the desktop pane redraw (a bare redraw request from this timer does not).
  // Only a helper still on the job has a clock to keep: not Main, not one that has left, not a pruned id.
  // The open recap of a job still running keeps time the same way.
  await quietly(async () => {
    if (office.flushes % CLOCK_EVERY !== 0) return
    const scene = restore(await read($, sceneAtom))
    const selected = await read($, selectedAtom)
    const agent = selected === null || selected === MAIN ? undefined : scene.agents[selected]
    const isClockShown = agent !== undefined && agent.phase !== 'gone'
    const isJobShown = (await read($, jobOpenAtom)) && scene.job !== null && scene.job.endedAt === null
    if (!isClockShown && !isJobShown) return
    const now = await $.clock.now()
    await update($, clockAtom, () => now)
  })
  // The history is written after the scene, so the record holds the turn that just ended.
  const isJobDue = office.hasJobToSave
  office.hasJobToSave = false
  await quietly(async () => {
    if (isJobDue) await recordJob($)
  })
  await quietly(async () => {
    if (office.keepsHistory && isJobDue) await saveJob($)
  })
  await quietly(async () => {
    if (office.reminds && office.flushes % CLOCK_EVERY === 0) await remind($, office)
  })
  // The debug log is a file the maintainer can read: rewritten as a whole, when it has changed, at most once a second.
  await quietly(async () => {
     if (!office.isDebug || !takeDirty()) return
    const at = await $.clock.now()
    if (at - office.lastDebugWrite < DEBUG_WRITE_MS) return
    office.lastDebugWrite = at
    await $.fs.write(`${$.plugin.root}/debug/log.jsonl`, logText())
  })
  // The session and spawn hooks only ask for the pane; it opens here, off their path, and a failed open tries again next flush.
  await quietly(async () => {
    if (office.wantsOpen && !office.isOpened) await openPane($, office)
  })
  office.isFlushing = false
}

// Whether `every` has passed since `at`. A clock set back makes it due at once, so the beat goes on rather than
// stopping until the clock catches up again.
// A look that takes longer than this is let go; each wait at the end of a session is shorter still.
const LOOK_MAX_MS = 5000
const END_WAIT_MS = 300
const MTIME_SLACK_MS = 2000

const isDue = (now: number, at: number, every: number): boolean => now < at || now - at >= every

async function peerDir($: EngineInterface): Promise<string | null> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const userProfile = await $.env.get('USERPROFILE')
  return peerDirOf({ configDir, home, userProfile })
}

// Reads the slots that changed since they were last read. A slot that is not a plain small file (a link, a folder,
// something big) is marked odd: never read, never written to, never free. Null when the folder is there but cannot
// be listed: every slot would look free, and this copy must not write into one another holds.
async function readSlots($: EngineInterface, peers: Peers, dir: string, now: number): Promise<Map<number, SlotSeen> | null> {
  const seen = new Map<number, SlotSeen>()
  const listed: FsEntry[] | null = await $.fs.list(dir).catch(() => null)
  if (listed === null && (await $.fs.exists(dir).catch(() => true))) return null
  const entries = listed ?? []
  for (const entry of entries) {
    const slot = slotOf(entry.name)
    if (slot === null) continue
    if (entry.kind !== 'file' || entry.isLink || entry.size > PEER_FILE_MAX || peers.stuck.has(entry.name)) {
      seen.set(slot, { peer: null, mtimeMs: entry.mtimeMs, isOdd: true })
      continue
    }
    // This copy's own slot is always read afresh: it is how a copy learns another took it. So is a file read within
    // MTIME_SLACK_MS of its last change: a rewrite of the same size in the same tick of a coarse file clock (FAT,
    // a network share) would keep its time, and the change would go unseen.
    const cached = peers.cache.get(entry.name)
    const isSettled = cached !== undefined && cached.readAt - cached.mtimeMs > MTIME_SLACK_MS
    if (slot !== peers.slot && isSettled && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size) {
      seen.set(slot, { peer: cached.peer, mtimeMs: entry.mtimeMs, isOdd: false })
      continue
    }
    peers.reading = entry.name
    const text: unknown = await $.fs.read(`${dir}/${entry.name}`).catch(() => null)
    peers.reading = null
    const peer = typeof text === 'string' ? parsePeer(text) : null
    // A file caught half written keeps its last good copy, which ages out as any other, and stays uncached so the
    // next look reads it again; a session does not drop out of the list for one bad read.
    if (peer !== null) peers.cache.set(entry.name, { mtimeMs: entry.mtimeMs, size: entry.size, readAt: now, peer })
    seen.set(slot, { peer: peer ?? cached?.peer ?? null, mtimeMs: entry.mtimeMs, isOdd: false })
  }
  return seen
}

// One look at the other sessions, at most every POLL_MS: read the slots, keep (or claim) this copy's own, write its
// snapshot when it changed or a heartbeat is due, and hand the pane the others when what it shows has changed.
async function lookAround($: EngineInterface, office: Office, peers: Peers, look: number): Promise<void> {
  const now = await $.clock.now()
  if (!isDue(now, peers.lastPoll, POLL_MS)) return
  peers.lastPoll = now
  if (peers.startedAt === 0) peers.startedAt = now
  if (peers.dir === undefined) peers.dir = await peerDir($)
  const dir = peers.dir
  if (dir === null) return
  // Read every time: a /clear goes on under a new session id.
  const sessionId = await $.session.id()
  const self = { instance: peers.instance, sessionId }
  const seen = await readSlots($, peers, dir, now)
  if (seen === null || look !== peers.looks) return

  // Two copies that took one slot at once: the one that sees the other's snapshot there moves.
  const mine = peers.slot === null ? undefined : seen.get(peers.slot)
  if (peers.slot !== null && (mine?.isOdd === true || isTakenFrom(mine, peers.instance, now))) {
    peers.slot = null
    peers.lastContent = ''
  }
  if (peers.slot === null) {
    const { own, free } = freeSlots(seen, self, now)
    // Only a first claim takes back this session's slot from an older copy (a hot reload's): a copy that was moved
    // on must not take it back from the copy that moved it, or two processes on one session would swap for ever.
    const chosen = !peers.hasClaimed && own !== null ? own : free.length === 0 ? null : free[Math.floor(Math.random() * free.length)] ?? null
    peers.slot = chosen
    if (chosen !== null) {
      peers.hasClaimed = true
      peers.verifiedAt = now
      peers.lastContent = ''
    }
  } else {
    peers.verifiedAt = now
    // Anything but this copy's own snapshot in its slot (a stale one, a broken one) is put right at once.
    if (mine?.peer?.instance !== peers.instance) peers.lastContent = ''
  }

  const scene = restore(await read($, sceneAtom))
  const status = peerStatusOf(scene)
  if (status !== peers.status) {
    peers.status = status
    peers.since = now
  }
  if (peers.slot !== null) {
    const project = baseName(await $.session.root())
    const snapshot = snapshotOf(scene, { instance: peers.instance, sessionId, startedAt: peers.startedAt, project, since: peers.since }, now)
    const content = contentOf(snapshot)
    // Checked last thing before the write: once the session has ended its tombstone must be the slot's last word.
    if ((content !== peers.lastContent || isDue(now, peers.lastBeat, BEAT_MS)) && !peers.isEnded && look === peers.looks) {
      await $.fs.write(`${dir}/${slotName(peers.slot)}`, JSON.stringify(snapshot))
      peers.lastContent = content
      peers.lastBeat = now
    }
  }

  const others = livePeersOf(seen, self, now)
  const urgent = urgentOf(others)
  const shown = shownOf(others)
  if (look !== peers.looks) return
  if (urgent !== peers.urgent || (shown !== peers.shown && isDue(now, peers.shownAt, CALM_MS))) {
    peers.urgent = urgent
    peers.shown = shown
    peers.shownAt = now
    await update($, othersAtom, () => others)
  }

  // The office being looked in on is redrawn as soon as what it shows changes, without the list's calm window: while
  // it is on show, this session's own walks are not, so its redraws restart nothing anyone is watching. A session
  // that has gone takes the picture back to this office.
  const looking = await read($, lookingAtom)
  const shownNow = await read($, lookedAtom)
  if (look !== peers.looks) return
  const found = looking === null ? undefined : others.find(p => peerKey(p) === looking)
  if (looking !== null && found === undefined) {
    await update($, lookingAtom, current => (current === looking ? null : current))
    await update($, lookedAtom, () => null)
  } else if (found !== undefined && (shownNow === null || lookedOf(found) !== lookedOf(shownNow))) {
    await update($, lookedAtom, () => found)
  }

  // With reminders on, another session waiting on you for a while is said once, as a toast only: that session
  // raises its own notification, and one from every other session would repeat it.
  if (office.reminds) {
    const waits = new Set(others.filter(p => p.status === 'waiting').map(p => `${p.sessionId}:${p.instance}:${p.since}`))
    for (const key of [...peers.reminded]) if (!waits.has(key)) peers.reminded.delete(key)
    for (const peer of others) {
      const key = `${peer.sessionId}:${peer.instance}:${peer.since}`
      if (peer.status !== 'waiting' || now - peer.since < REMIND_AFTER_MS || peers.reminded.has(key)) continue
      peers.reminded.add(key)
      $.ui.toast(`In ${peer.project === '' ? 'another session' : peer.project}, an agent is waiting on you`, { timeoutMs: 10_000 })
    }
  }
}

const livePeersOf = (seen: ReadonlyMap<number, SlotSeen>, self: Self, now: number): PeerSession[] =>
  livePeers(
    [...seen.values()].flatMap(found => (found.peer === null ? [] : [found.peer])),
    self,
    now,
  )

function peerTick($: EngineInterface, office: Office): void {
  const peers = office.peers
  if (peers === null || peers.isBusy || peers.isEnded) return
  peers.isBusy = true
  peers.looks += 1
  const look = peers.looks
  const ran = quietly(() => lookAround($, office, peers, look))
  peers.run = Promise.race([ran, quietly(() => $.clock.sleep(LOOK_MAX_MS))]).finally(() => {
    if (peers.looks !== look) return
    peers.isBusy = false
    // Let go: whatever the overrun look does when it comes back, it changes nothing.
    peers.looks += 1
    if (peers.reading !== null) peers.stuck.add(peers.reading)
    peers.reading = null
  })
}

// The session is over (not a /clear or a resume, which go on under a new id): mark the slot free for the others.
// One write, after any look already under way, and only into a slot this copy recently saw as its own, as the whole
// end of a session has a short bound and another copy may have taken a slot this one lost track of.
async function endPeers($: EngineInterface, office: Office): Promise<void> {
  const peers = office.peers
  if (peers === null || peers.isEnded) return
  peers.isEnded = true
  // Each wait is short, as the whole end of a session has a bound of its own and a stuck disk must not use it up.
  if (peers.run !== null) await Promise.race([peers.run, quietly(() => $.clock.sleep(END_WAIT_MS))])
  if (peers.slot === null || typeof peers.dir !== 'string') return
  const now = await $.clock.now()
  if (Math.abs(now - peers.verifiedAt) > STALE_MS) return
  // Only over this copy's own snapshot: another copy may have taken the slot since the last look.
  const path = `${peers.dir}/${slotName(peers.slot)}`
  const text: unknown = await Promise.race([$.fs.read(path).catch(() => null), quietly(() => $.clock.sleep(END_WAIT_MS)).then(() => null)])
  const held = typeof text === 'string' ? parsePeer(text) : null
  if (held?.instance !== peers.instance) return
  const meta = { instance: peers.instance, sessionId: await $.session.id(), startedAt: peers.startedAt, project: '', since: now }
  await $.fs.write(path, JSON.stringify(tombstoneOf(meta, now)))
}

export const register: Register = (on, options) => {
  const autoOpen = String(options.autoOpen ?? 'on-first-subagent')
  const office: Office = {
    queue: [],
    isFlushing: false,
    flushes: 0,
    isOpened: false,
    wantsOpen: false,
    epoch: 0,
    keepsHistory: String(options.history ?? 'off') === 'last-20',
    hasJobToSave: false,
    reminds: String(options.notify ?? 'off') === 'after-30s',
    waitingSince: new Map(),
    reminded: new Set(),
    isDebug: String(options.debug ?? 'off') === 'on',
    lastDebugWrite: 0,
    lastOrigin: null,
    peers:
      String(options.otherSessions ?? 'off') === 'on'
        ? {
            dir: undefined,
            instance: crypto.randomUUID(),
            startedAt: 0,
            slot: null,
            hasClaimed: false,
            verifiedAt: 0,
            lastPoll: 0,
            lastBeat: 0,
            lastContent: '',
            status: null,
            since: 0,
            isBusy: false,
            looks: 0,
            reading: null,
            stuck: new Set(),
            isEnded: false,
            run: null,
            cache: new Map(),
            urgent: '[]',
            shown: '[]',
            shownAt: 0,
            reminded: new Set(),
          }
        : null,
  }
  debugOn(office.isDebug)

  const push = (ev: OfficeEvent): void => {
    if (office.isDebug) {
      const r = ev as Record<string, unknown>
      const agent = typeof r.agentId === 'string' ? r.agentId : typeof r.id === 'string' ? r.id : null
      note('event', { ev: ev.kind, agent, tool: ev.kind === 'toolStarted' ? ev.tool : undefined }, ev.at)
    }
    office.queue.push(ev)
    if (office.queue.length > QUEUE_MAX) office.queue = office.queue.slice(-QUEUE_MAX)
  }

  on('session.start', async ($, e, next) => {
    // Each step stands alone: one that fails must not keep the others from running.
    await quietly(() => {
      $.clock.every(FLUSH_MS, () => {
        void flush($, office)
        peerTick($, office)
      })
    })
    await quietly(async () => {
      await $.command.register({ name: 'office', description: 'Show or hide the pixel office' })
    })
    await quietly(async () => {
      if (office.keepsHistory) await loadHistory($)
    })
    // The session start hook only asks for the pane, as the spawn hook does; the flush opens it.
    if (autoOpen === 'session-start') office.wantsOpen = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // A /clear ends the conversation but not the process, and no session.start follows it: the office starts
    // over, and the flush timer keeps running. Events still queued belong to the old conversation, and so does
    // a batch a flush has already taken off the queue: bumping the epoch makes that flush leave the new scene alone.
    if (e.reason !== 'clear' && e.reason !== 'resume') await quietly(() => endPeers($, office))
    if (e.reason === 'clear') {
      await quietly(() => {
        office.epoch += 1
        office.queue = []
      })
      await quietly(async () => {
        await update($, sceneAtom, () => emptyScene())
      })
      await quietly(async () => {
        await update($, selectedAtom, () => null)
      })
      await quietly(async () => {
        await update($, expandedAtom, () => null)
      })
      await quietly(async () => {
        await update($, sessionAtom, () => [])
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const agentId = e.agentId ?? MAIN
    const callId = e.tool_use_id
    const isTracked = !UNTRACKED.has(tool)
    if (isTracked) {
      await quietly(async () => {
        const input = e as Record<string, unknown>
        const at = await $.clock.now()
        push({ kind: 'toolStarted', agentId, tool, target: targetOf(tool, input), detail: detailOf(tool, input), callId, at })
        const counts = stationFor(tool) === 'taskboard' ? todoCounts(input) : null
        if (counts !== null) push({ kind: 'todos', ...counts, at })
      })
    }
    const ran = await next(e)
    if (isTracked) {
      await quietly(async () => {
        const isError = ran.deny === undefined && ran.isError === true
        push({ kind: 'toolEnded', agentId, callId, isError, at: await $.clock.now() })
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await quietly(async () => {
      if (spawned.deny !== undefined || spawned.agentId === undefined) return
      push({
        kind: 'spawned',
        id: spawned.agentId,
        parentId: e.parentAgentId ?? MAIN,
        type: e.subagentType,
        description: e.description,
        brief: fullText(e.prompt, TEXT_MAX),
        name: e.name ?? null,
        isTeammate: e.isTeammate === true,
        isBackground: e.background === true,
        isResume: e.resume !== undefined,
        at: await $.clock.now(),
      })
      if (autoOpen === 'on-first-subagent' && !office.isOpened) office.wantsOpen = true
    })
    return spawned
  }).catch(($, e, next) => next(e))

  // The engine settles a prompt before the main loop's turn starts; the turn reads where it came from.
  on('prompt.submit', async ($, e, next) => {
    office.lastOrigin = e.origin?.kind ?? null
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    // The engine fires this for a helper's run too; only the main loop's turn is the person's message.
    if (e.agentId !== undefined) {
      if (office.isDebug) note('turn-ignored', { agent: e.agentId })
      return next(e)
    }
    const origin = office.lastOrigin
    office.lastOrigin = null
    const isNotice = origin !== null ? NOT_A_NEW_JOB.has(origin) : e.text.trimStart().startsWith('<task-notification')
    // A turn started without typed text, or woken by a notice, carries on the job under way.
    const continues = e.text === '' || isNotice
    if (office.isDebug) note('turn-start', { origin: origin ?? 'none', continues })
    await quietly(async () =>
      push({
        kind: 'turnStarted',
        isContinuation: continues,
        task: isNotice ? '' : gist(e.text, TASK_MAX),
        at: await $.clock.now(),
      }),
    )
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      const at = await $.clock.now()
      const usage = usageOf(e.usage)
      if (e.agentId !== undefined) {
        push({ kind: 'handedBack', agentId: e.agentId, reason: e.reason, report: fullText(e.answer, TEXT_MAX), usage, at })
      } else push({ kind: 'turnEnded', usage, at })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await quietly(async () => {
      // A question or a plan approval already moved and narrated the agent when its tool call began.
      if (WAITING_TOOLS.has(e.tool_name)) return
      push({ kind: 'waiting', agentId: e.agent_id ?? null, tool: e.tool_name, at: await $.clock.now() })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'office' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Office closed.' }
    }
    await openPane($, office)
    return { text: 'Office opened.' }
  })

  // What this plugin's probes (a surface module inside the pane) post: only four plain fields are kept.
  on('ui.message', async ($, e, next) => {
    if (e.element !== PROBE_TOP && e.element !== PROBE_BOTTOM) return next(e)
    if (office.isDebug) {
      const d = typeof e.data === 'object' && e.data !== null ? (e.data as Record<string, unknown>) : {}
      note('probe', {
        element: e.element,
        ...(typeof d.kind === 'string' ? { msg: d.kind.slice(0, 32) } : {}), // not `kind`: that is the line's own
        ...(typeof d.where === 'string' ? { where: d.where.slice(0, 32) } : {}),
        ...(typeof d.columns === 'number' ? { columns: d.columns } : {}),
        ...(typeof d.rows === 'number' ? { rows: d.rows } : {}),
      })
    }
    return {}
  }).catch(($, e, next) => next(e))

  registerPane(on, { isDebug: office.isDebug })
}
