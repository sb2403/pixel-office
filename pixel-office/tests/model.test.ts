import { describe, expect, test } from 'claude-code/testing'

import { BRIEFING_MAX_MS, GONE_KEEP, IDLE_MS, LINGER_MS, MAIN, emptyScene, needsSweep, positionAt, reduce } from '../hooks/model'
import { slotPoint } from '../hooks/stations'
import type { OfficeEvent, Scene } from '../types'

const spawn = (id: string, at: number, extra: Partial<Extract<OfficeEvent, { kind: 'spawned' }>> = {}): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type: 'Explore',
  description: 'find auth code',
  name: null,
  isTeammate: false,
  at,
  ...extra,
})
const start = (agentId: string, tool: string, target: string, callId: string, at: number): OfficeEvent => ({
  kind: 'toolStarted',
  agentId,
  tool,
  target,
  callId,
  at,
})
const end = (agentId: string, callId: string, at: number, isError = false): OfficeEvent => ({
  kind: 'toolEnded',
  agentId,
  callId,
  isError,
  at,
})
const run = (events: OfficeEvent[], from: Scene = emptyScene()): Scene => events.reduce(reduce, from)
const lastLine = (s: Scene): string | undefined => s.ticker[s.ticker.length - 1]?.text

describe('arrivals and briefings', () => {
  test('the office starts with Main idle in the corner office', async () => {
    const main = emptyScene().agents[MAIN]!
    expect(main.station).toBe('office')
    expect(main.phase).toBe('idle')
    expect(main.label).toBe('Main')
  })

  test('a new subagent arrives by elevator and is briefed in the meeting room', async () => {
    const s = run([spawn('a1', 1000)])
    const a1 = s.agents.a1!
    expect(a1.label).toBe('Explore')
    expect(a1.phase).toBe('briefing')
    expect(a1.station).toBe('meeting')
    expect(a1.walk?.points[0]).toEqual(slotPoint('elevator', 0))
    expect(a1.walk?.startedAt).toBe(1000)
    expect(s.briefing).toBe('find auth code')
    expect(s.agents[MAIN]!.station).toBe('meeting')
    expect(lastLine(s)).toBe('Main hired Explore: find auth code')
  })

  test('a second agent of the same type gets a numbered label and its own desk', async () => {
    const s = run([spawn('a1', 1000), spawn('a2', 1000)])
    expect(s.agents.a2!.label).toBe('Explore 2')
    expect(s.agents.a2!.desk).not.toBe(s.agents.a1!.desk)
  })

  test('the first tool ends the briefing and sends the parent home', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000)])
    expect(s.agents.a1!.phase).toBe('working')
    expect(s.agents.a1!.station).toBe('library')
    expect(s.agents.a1!.activity?.tool).toBe('Read')
    expect(s.briefing).toBeNull()
    expect(s.agents[MAIN]!.station).toBe('office')
    expect(lastLine(s)).toBe('Explore is reading auth.ts')
  })

  test('a walk that changes course starts where the agent is now', async () => {
    const before = run([spawn('a1', 1000)])
    const after = reduce(before, start('a1', 'Read', 'auth.ts', 'c1', 1200))
    expect(after.agents.a1!.walk?.points[0]).toEqual(positionAt(before.agents.a1!, 1200))
    expect(after.agents.a1!.walk?.points[0]).not.toEqual(slotPoint('elevator', 0))
  })
})

describe('work, errors and waiting', () => {
  test('an error marks the agent and clears its activity', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Bash', 'npm test', 'c1', 3000), end('a1', 'c1', 4000, true)])
    expect(s.agents.a1!.lastErrorAt).toBe(4000)
    expect(s.agents.a1!.activity).toBeNull()
    expect(lastLine(s)).toBe('Explore hit an error')
  })

  test('ending an older call keeps the newer activity', async () => {
    const s = run([
      spawn('a1', 1000),
      start('a1', 'Read', 'a.ts', 'c1', 3000),
      start('a1', 'Read', 'b.ts', 'c2', 3100),
      end('a1', 'c1', 3200),
    ])
    expect(s.agents.a1!.activity?.callId).toBe('c2')
  })

  test('a question sends the agent to reception until it is answered', async () => {
    const waiting = run([start(MAIN, 'AskUserQuestion', '', 'q1', 5000)])
    expect(waiting.agents[MAIN]!.phase).toBe('waiting')
    expect(waiting.agents[MAIN]!.station).toBe('reception')
    const answered = reduce(waiting, end(MAIN, 'q1', 9000))
    expect(answered.agents[MAIN]!.phase).toBe('working')
    expect(answered.agents[MAIN]!.station).toBe('office')
  })

  test('a permission prompt finds the agent using that tool, else Main', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Bash', 'rm -rf build', 'c1', 3000)])
    const asked = reduce(s, { kind: 'waiting', agentId: null, tool: 'Bash', at: 3100 })
    expect(asked.agents.a1!.phase).toBe('waiting')
    expect(asked.agents.a1!.station).toBe('reception')
    expect(lastLine(asked)).toBe('Explore needs your permission to use Bash')
    const other = reduce(s, { kind: 'waiting', agentId: null, tool: 'Edit', at: 3100 })
    expect(other.agents[MAIN]!.station).toBe('reception')
  })

  test('SendMessage walks to the recipient and back', async () => {
    const s = run([spawn('a1', 1000), spawn('a2', 1000, { type: 'Plan' })])
    const plan = s.agents.a2!
    const sent = reduce(s, start('a1', 'SendMessage', 'Plan', 'm1', 5000))
    const walk = sent.agents.a1!.walk!
    expect(walk.points).toContainEqual({ x: plan.pos.x + 9, y: plan.pos.y })
    expect(walk.points[walk.points.length - 1]).toEqual(sent.agents.a1!.pos)
    expect(sent.agents.a1!.station).toBe(s.agents.a1!.station)
  })

  test('todos update the task board counts', async () => {
    const s = reduce(emptyScene(), { kind: 'todos', done: 2, open: 3, at: 1 })
    expect(s.todos).toEqual({ done: 2, open: 3 })
    expect(s.ticker).toHaveLength(0)
  })

  test('a new task puts Main to work in the corner office', async () => {
    const s = reduce(emptyScene(), { kind: 'turnStarted', isContinuation: false, at: 1 })
    expect(s.agents[MAIN]!.phase).toBe('working')
    expect(s.agents[MAIN]!.station).toBe('office')
    expect(lastLine(s)).toBe('You gave Main a new task')
  })
})

describe('the end of a turn', () => {
  const turnEnded = (at: number): OfficeEvent => ({ kind: 'turnEnded', at })
  const turnStarted = (at: number): OfficeEvent => ({ kind: 'turnStarted', isContinuation: false, at })

  test('Main goes idle at the corner office when its turn ends', async () => {
    const s = run([turnStarted(1000), start(MAIN, 'Bash', 'npm test', 'c1', 1100), end(MAIN, 'c1', 1200)])
    const before = s.agents[MAIN]!
    const done = reduce(s, turnEnded(5000))
    const main = done.agents[MAIN]!
    expect(main.phase).toBe('idle')
    expect(main.lastEventAt).toBe(5000)
    expect(main.activity).toBeNull()
    expect(main.station).toBe(before.station)
    expect(main.walk).toBe(before.walk)
    const home = run([turnStarted(1000), turnEnded(5000)])
    expect(home.agents[MAIN]!.phase).toBe('idle')
    expect(home.agents[MAIN]!.station).toBe('office')
  })

  test('a quiet idle Main goes to the break room, a new task brings it back', async () => {
    const s = run([turnStarted(1000), turnEnded(5000)])
    expect(needsSweep(s, 5000 + IDLE_MS - 1)).toBe(false)
    expect(needsSweep(s, 5000 + IDLE_MS)).toBe(true)
    const coffee = reduce(s, { kind: 'tick', at: 5000 + IDLE_MS })
    expect(coffee.agents[MAIN]!.station).toBe('breakroom')
    expect(coffee.agents[MAIN]!.phase).toBe('idle')
    expect(needsSweep(coffee, 5000 + 3 * IDLE_MS)).toBe(false)
    const back = reduce(coffee, turnStarted(5000 + IDLE_MS + 60_000))
    expect(back.agents[MAIN]!.station).toBe('office')
    expect(back.agents[MAIN]!.phase).toBe('working')
  })

  test('a fresh office never sends Main for coffee before anything happened', async () => {
    const s = emptyScene()
    expect(needsSweep(s, 100 * IDLE_MS)).toBe(false)
    expect(reduce(s, { kind: 'tick', at: 100 * IDLE_MS })).toBe(s)
  })

  test('an idle Main away from the corner office walks back and stays idle', async () => {
    const s = run([turnStarted(1000), start(MAIN, 'Read', 'a.ts', 'c1', 1100), end(MAIN, 'c1', 1200), turnEnded(1300)])
    expect(s.agents[MAIN]!.station).toBe('library')
    expect(needsSweep(s, 1300 + LINGER_MS - 1)).toBe(false)
    expect(needsSweep(s, 1300 + LINGER_MS)).toBe(true)
    const home = reduce(s, { kind: 'tick', at: 1300 + LINGER_MS })
    expect(home.agents[MAIN]!.station).toBe('office')
    expect(home.agents[MAIN]!.phase).toBe('idle')
  })

  test('a teammate resting in the break room is left alone', async () => {
    const s = run([spawn('t1', 1000, { name: 'scout', isTeammate: true }), { kind: 'handedBack', agentId: 't1', reason: 'answer', at: 9000 }])
    const later = reduce(s, { kind: 'tick', at: 9000 + 5 * IDLE_MS })
    expect(later.agents.t1).toBe(s.agents.t1)
    expect(later.agents.t1!.station).toBe('breakroom')
    expect(later.agents.t1!.phase).toBe('idle')
    expect(later.agents.t1!.walk).toBe(s.agents.t1!.walk)
  })

  test('a stopped subagent leaves like any other', async () => {
    const s = run([spawn('a1', 1000), { kind: 'handedBack', agentId: 'a1', reason: 'aborted', at: 2000 }])
    expect(s.agents.a1!.phase).toBe('gone')
    expect(lastLine(s)).toBe('Explore was stopped and left')
    const failed = run([spawn('a1', 1000), { kind: 'handedBack', agentId: 'a1', reason: 'error', at: 2000 }])
    expect(lastLine(failed)).toBe('Explore ran into a problem, reported to Main and left')
  })
})

describe('hand-backs and departures', () => {
  test('a finished subagent reports to its parent and leaves by elevator', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000), end('a1', 'c1', 4000)])
    const main = s.agents[MAIN]!
    const done = reduce(s, { kind: 'handedBack', agentId: 'a1', reason: 'answer', at: 20000 })
    const a1 = done.agents.a1!
    expect(a1.phase).toBe('gone')
    expect(a1.station).toBe('elevator')
    expect(a1.walk?.points).toContainEqual({ x: main.pos.x + 9, y: main.pos.y })
    expect(a1.goneAt).toBe(20000 + a1.walk!.durationMs)
    expect(lastLine(done)).toBe('Explore handed its report to Main and left')
  })

  test('a teammate reports and takes a break instead of leaving', async () => {
    const s = run([spawn('t1', 1000, { name: 'scout', isTeammate: true }), { kind: 'handedBack', agentId: 't1', reason: 'answer', at: 9000 }])
    expect(s.agents.t1!.label).toBe('scout')
    expect(s.agents.t1!.phase).toBe('idle')
    expect(s.agents.t1!.station).toBe('breakroom')
    expect(lastLine(s)).toBe('scout reported to Main and took a break')
  })

  test('a departed agent that works again comes back through the elevator', async () => {
    const s = run([spawn('a1', 1000), { kind: 'handedBack', agentId: 'a1', reason: 'answer', at: 2000 }])
    const back = reduce(s, start('a1', 'Read', 'again.ts', 'c9', 60000))
    expect(back.agents.a1!.phase).toBe('working')
    expect(back.agents.a1!.goneAt).toBeNull()
    expect(back.agents.a1!.walk?.points[0]).toEqual(slotPoint('elevator', 0))
  })

  test('departed agents are pruned past 50', async () => {
    let s = emptyScene()
    for (let i = 0; i < 60; i++) {
      s = reduce(s, spawn(`x${i}`, i))
      s = reduce(s, { kind: 'handedBack', agentId: `x${i}`, reason: 'answer', at: i + 0.5 })
    }
    const gone = Object.values(s.agents).filter(a => a.phase === 'gone')
    expect(gone.length).toBe(GONE_KEEP)
    expect(s.order.length).toBe(GONE_KEEP + 1)
  })
})

describe('sweeps', () => {
  test('agents linger, then walk home, then go for coffee', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000), end('a1', 'c1', 3500)])
    expect(needsSweep(s, 3500 + LINGER_MS - 1)).toBe(false)
    expect(needsSweep(s, 3500 + LINGER_MS)).toBe(true)
    const home = reduce(s, { kind: 'tick', at: 3500 + LINGER_MS })
    expect(home.agents.a1!.station).toBe('desk')
    const coffee = reduce(home, { kind: 'tick', at: 3500 + IDLE_MS })
    expect(coffee.agents.a1!.station).toBe('breakroom')
    expect(coffee.agents.a1!.phase).toBe('idle')
  })

  test('a briefing that never gets a first tool ends after a minute at the agent\'s desk', async () => {
    const hired = run([spawn('a1', 1000)])
    // Main has gone home long before the minute is up, so only the briefing is left to sweep.
    const settled = reduce(hired, { kind: 'tick', at: 1000 + LINGER_MS })
    expect(settled.agents.a1!.phase).toBe('briefing')
    expect(needsSweep(settled, 1000 + BRIEFING_MAX_MS - 1)).toBe(false)
    expect(needsSweep(settled, 1000 + BRIEFING_MAX_MS)).toBe(true)

    const early = reduce(settled, { kind: 'tick', at: 1000 + BRIEFING_MAX_MS - 1 })
    expect(early).toBe(settled)
    expect(early.agents.a1!.phase).toBe('briefing')
    expect(early.agents.a1!.station).toBe('meeting')
    expect(early.briefing).toBe('find auth code')

    const late = reduce(settled, { kind: 'tick', at: 1000 + BRIEFING_MAX_MS })
    const a1 = late.agents.a1!
    expect(a1.phase).toBe('working')
    expect(a1.station).toBe('desk')
    expect(a1.pos).toEqual(slotPoint('desk', a1.desk))
    expect(a1.walk?.startedAt).toBe(1000 + BRIEFING_MAX_MS)
    expect(late.briefing).toBeNull()
    expect(needsSweep(late, 1000 + BRIEFING_MAX_MS)).toBe(false)
  })

  test('an agent that is still briefed keeps the whiteboard, and its waiting parent walks home', async () => {
    const s = run([spawn('a1', 1000, { description: 'find auth code' }), spawn('a2', 57_000, { description: 'review the tests' })])
    expect(s.agents[MAIN]!.station).toBe('meeting')
    const swept = reduce(s, { kind: 'tick', at: 1000 + BRIEFING_MAX_MS })
    expect(swept.agents.a1!.phase).toBe('working')
    expect(swept.agents.a1!.station).toBe('desk')
    expect(swept.agents.a2!.phase).toBe('briefing')
    expect(swept.briefing).toBe('review the tests')
    expect(swept.agents[MAIN]!.station).toBe('office')
    expect(swept.agents[MAIN]!.lastEventAt).toBe(1000 + BRIEFING_MAX_MS)
  })

  test('a first tool inside the minute still ends the briefing as before', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 30_000)])
    expect(s.agents.a1!.phase).toBe('working')
    expect(s.agents.a1!.station).toBe('library')
    expect(reduce(s, { kind: 'tick', at: 1000 + BRIEFING_MAX_MS }).agents.a1!.station).toBe('library')
  })

  test('a tick with nothing to do returns the same scene', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000)])
    expect(reduce(s, { kind: 'tick', at: 3600 })).toBe(s)
  })
})

describe('review focus', () => {
  test('a contractor becomes the named agent when its spawn lands late', async () => {
    const early = run([start('x9', 'Grep', 'login', 'c1', 1000)])
    expect(early.agents.x9!.type).toBe('contractor')
    expect(early.agents.x9!.label).toBe('Contractor')
    const named = reduce(early, spawn('x9', 1100, { type: 'Plan' }))
    expect(named.agents.x9!.label).toBe('Plan')
    expect(named.agents.x9!.type).toBe('Plan')
    expect(named.agents.x9!.station).toBe('library')
    expect(named.agents.x9!.desk).toBe(early.agents.x9!.desk)
    expect(named.order).toHaveLength(early.order.length)
  })

  test('crowded stations give everyone their own spot', async () => {
    let s = emptyScene()
    for (let i = 0; i < 12; i++) s = reduce(s, spawn(`r${i}`, 1000))
    for (let i = 0; i < 12; i++) s = reduce(s, start(`r${i}`, 'Read', 'f.ts', `c${i}`, 2000))
    const spots = new Set(
      Object.values(s.agents)
        .filter(a => a.station === 'library')
        .map(a => `${a.pos.x},${a.pos.y}`),
    )
    expect(spots.size).toBe(12)
  })

  test("desks overflow into a queue, never onto someone else's seat", async () => {
    let s = emptyScene()
    for (let i = 0; i < 10; i++) s = reduce(s, spawn(`d${i}`, 1000))
    for (let i = 0; i < 10; i++) s = reduce(s, start(`d${i}`, 'Edit', 'f.ts', `e${i}`, 2000))
    const seated = Object.values(s.agents).filter(a => a.station === 'desk')
    expect(new Set(seated.map(a => `${a.pos.x},${a.pos.y}`)).size).toBe(10)
    expect(seated.map(a => a.desk).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('the ticker keeps only the last 8 lines', async () => {
    let s = emptyScene()
    for (let i = 0; i < 20; i++) s = reduce(s, start(MAIN, 'Read', `f${i}.ts`, `c${i}`, i))
    expect(s.ticker).toHaveLength(8)
    expect(lastLine(s)).toBe('Main is reading f19.ts')
  })

  test('events for unknown agents leave the scene alone', async () => {
    const s = emptyScene()
    expect(reduce(s, end('nobody', 'c1', 1))).toBe(s)
    expect(reduce(s, { kind: 'handedBack', agentId: 'nobody', reason: 'answer', at: 1 })).toBe(s)
    expect(reduce(s, { kind: 'handedBack', agentId: MAIN, reason: 'answer', at: 1 })).toBe(s)
  })
})
