import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OfficeEvent } from '../types'
import { MAIN, emptyScene, needsSweep, reduce } from './model'
import { registerPane } from './pane'
import { PANE, PANE_TITLE } from './state'
import { stationFor, targetOf, todoCounts } from './stations'

export const FLUSH_MS = 350
const SWEEP_EVERY = 15
const QUEUE_MAX = 500
const UNTRACKED = new Set(['Agent', 'Task'])

const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())

const quietly = async (work: () => Promise<void> | void): Promise<void> => {
  try {
    await work()
  } catch {
    // The office is best effort: it never disturbs the session it watches.
  }
}

type Office = { queue: OfficeEvent[]; isFlushing: boolean; flushes: number; isOpened: boolean; wantsOpen: boolean }

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
    office.queue = []
    const isSweepTurn = office.flushes % SWEEP_EVERY === 0
    if (batch.length === 0 && !(isSweepTurn && needsSweep(await read($, sceneAtom), now))) return
    await update($, sceneAtom, scene => {
      const applied = batch.reduce(reduce, scene)
      return isSweepTurn && needsSweep(applied, now) ? reduce(applied, { kind: 'tick', at: now }) : applied
    })
  })
  // The spawn hook only asks for the pane; it opens here, off the spawn path, and a failed open tries again next flush.
  await quietly(async () => {
    if (office.wantsOpen && !office.isOpened) await openPane($, office)
  })
  office.isFlushing = false
}

export const register: Register = (on, options) => {
  const autoOpen = String(options.autoOpen ?? 'on-first-subagent')
  const office: Office = { queue: [], isFlushing: false, flushes: 0, isOpened: false, wantsOpen: false }

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
    await quietly(async () => {
      if (autoOpen === 'session-start') await openPane($, office)
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const agentId = (e as unknown as { agentId?: string }).agentId ?? MAIN
    const callId = e.tool_use_id
    const isTracked = !UNTRACKED.has(tool)
    if (isTracked) {
      await quietly(async () => {
        const input = e as unknown as Record<string, unknown>
        const at = await $.clock.now()
        push({ kind: 'toolStarted', agentId, tool, target: targetOf(tool, input), callId, at })
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
        name: e.name ?? null,
        isTeammate: e.isTeammate === true,
        at: await $.clock.now(),
      })
      if (autoOpen === 'on-first-subagent' && !office.isOpened) office.wantsOpen = true
    })
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await quietly(async () => push({ kind: 'turnStarted', at: await $.clock.now() }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      if (e.agentId !== undefined) push({ kind: 'handedBack', agentId: e.agentId, at: await $.clock.now() })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await quietly(async () => {
      const agentId = (e as unknown as { agent_id?: string }).agent_id ?? null
      push({ kind: 'waiting', agentId, tool: e.tool_name, at: await $.clock.now() })
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
