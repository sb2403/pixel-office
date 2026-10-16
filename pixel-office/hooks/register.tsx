import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { JobRecord, OfficeEvent, Usage } from '../types'
import { debugOn, logText, note, takeDirty } from './debuglog'
import { MAIN, emptyScene, needsSweep, reduceAt, restore } from './model'
import { registerPane } from './pane'
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

  registerPane(on, { isLayered: String(options.picture ?? 'single') === 'layered', isDebug: office.isDebug })
}
