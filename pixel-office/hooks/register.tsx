import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { OfficeEvent, Usage } from '../types'
import { MAIN, emptyScene, needsSweep, reduce, restore } from './model'
import { registerPane } from './pane'
import { PANE, PANE_TITLE } from './state'
import { WAITING_TOOLS, detailOf, fullText, stationFor, targetOf, todoCounts } from './stations'

export const FLUSH_MS = 350
// How much of a helper's brief and of its report the office keeps, to be read in full from its details box.
export const TEXT_MAX = 2000
const SWEEP_EVERY = 15
const CLOCK_EVERY = 3
const QUEUE_MAX = 500
const UNTRACKED = new Set(['Agent', 'Task'])

// Atoms cannot be imported across files, so each file that reads one declares it again; pane.tsx has the same three.
const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())
const selectedAtom = atom({ plugin: 'pixel-office', key: 'selected' } as const, null as string | null)
const clockAtom = atom({ plugin: 'pixel-office', key: 'clock' } as const, 0)
const expandedAtom = atom({ plugin: 'pixel-office', key: 'expanded' } as const, null as 'brief' | 'report' | null)

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
}

// The engine only lets `$` travel into functions declared at the top of this file, so the helpers that
// take it live here and share the mutable bits through one plain object.
async function openPane($: EngineInterface, office: Office): Promise<void> {
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  office.isOpened = true
}

async function flush($: EngineInterface, office: Office): Promise<void> {
  if (office.isFlushing) return
  office.isFlushing = true
  await quietly(async () => {
    office.flushes += 1
    const now = await $.clock.now()
    const batch = office.queue
    const epoch = office.epoch
    office.queue = []
    const isSweepTurn = office.flushes % SWEEP_EVERY === 0
    if (batch.length === 0 && !(isSweepTurn && needsSweep(restore(await read($, sceneAtom)), now))) return
    await update($, sceneAtom, scene => {
      // A /clear since the queue was taken makes this batch (and sweep) belong to the old conversation. The
      // updater reruns when a write misses its version, so the check holds however the two interleave.
      if (office.epoch !== epoch) return scene
      const applied = batch.reduce(reduce, restore(scene))
      return isSweepTurn && needsSweep(applied, now) ? reduce(applied, { kind: 'tick', at: now }) : applied
    })
  })
  // The "On the job" clock of a selected agent is the one thing that changes with no event behind it:
  // about once a second, while a row is open, write the time to state. The pane reads that atom, and a state
  // write is what makes the desktop pane redraw (a bare redraw request from this timer does not).
  // Only a helper still on the job has a clock to keep: not Main, not one that has left, not a pruned id.
  await quietly(async () => {
    if (office.flushes % CLOCK_EVERY !== 0) return
    const selected = await read($, selectedAtom)
    if (selected === null || selected === MAIN) return
    const agent = (await read($, sceneAtom)).agents[selected]
    if (agent === undefined || agent.phase === 'gone') return
    const now = await $.clock.now()
    await update($, clockAtom, () => now)
  })
  // The session and spawn hooks only ask for the pane; it opens here, off their path, and a failed open tries again next flush.
  await quietly(async () => {
    if (office.wantsOpen && !office.isOpened) await openPane($, office)
  })
  office.isFlushing = false
}

export const register: Register = (on, options) => {
  const autoOpen = String(options.autoOpen ?? 'on-first-subagent')
  const office: Office = { queue: [], isFlushing: false, flushes: 0, isOpened: false, wantsOpen: false, epoch: 0 }

  const push = (ev: OfficeEvent): void => {
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

  on('turn.start', async ($, e, next) => {
    // A turn started without typed text carries on from the one before.
    await quietly(async () => push({ kind: 'turnStarted', isContinuation: e.text === '', at: await $.clock.now() }))
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

  registerPane(on)
}
