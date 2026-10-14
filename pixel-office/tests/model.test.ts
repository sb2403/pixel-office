import { describe, expect, test } from 'claude-code/testing'

import { GONE_KEEP, IDLE_MS, LINGER_MS, MAIN, emptyScene, needsSweep, positionAt, reduce } from '../hooks/model'
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
    const s = reduce(emptyScene(), { kind: 'turnStarted', at: 1 })
    expect(s.agents[MAIN]!.phase).toBe('working')
    expect(s.agents[MAIN]!.station).toBe('office')
    expect(lastLine(s)).toBe('You gave Main a new task')
  })
})

describe('hand-backs and departures', () => {
  test('a finished subagent reports to its parent and leaves by elevator', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000), end('a1', 'c1', 4000)])
    const main = s.agents[MAIN]!
    const done = reduce(s, { kind: 'handedBack', agentId: 'a1', at: 20000 })
    const a1 = done.agents.a1!
    expect(a1.phase).toBe('gone')
    expect(a1.station).toBe('elevator')
    expect(a1.walk?.points).toContainEqual({ x: main.pos.x + 9, y: main.pos.y })
    expect(a1.goneAt).toBe(20000 + a1.walk!.durationMs)
    expect(lastLine(done)).toBe('Explore handed its report to Main and left')
  })

  test('a teammate reports and takes a break instead of leaving', async () => {
    const s = run([spawn('t1', 1000, { name: 'scout', isTeammate: true }), { kind: 'handedBack', agentId: 't1', at: 9000 }])
    expect(s.agents.t1!.label).toBe('scout')
    expect(s.agents.t1!.phase).toBe('idle')
    expect(s.agents.t1!.station).toBe('breakroom')
    expect(lastLine(s)).toBe('scout reported to Main and took a break')
  })

  test('a departed agent that works again comes back through the elevator', async () => {
    const s = run([spawn('a1', 1000), { kind: 'handedBack', agentId: 'a1', at: 2000 }])
    const back = reduce(s, start('a1', 'Read', 'again.ts', 'c9', 60000))
    expect(back.agents.a1!.phase).toBe('working')
    expect(back.agents.a1!.goneAt).toBeNull()
    expect(back.agents.a1!.walk?.points[0]).toEqual(slotPoint('elevator', 0))
  })

  test('departed agents are pruned past 50', async () => {
    let s = emptyScene()
    for (let i = 0; i < 60; i++) {
      s = reduce(s, spawn(`x${i}`, i))
      s = reduce(s, { kind: 'handedBack', agentId: `x${i}`, at: i + 0.5 })
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
    expect(reduce(s, { kind: 'handedBack', agentId: 'nobody', at: 1 })).toBe(s)
    expect(reduce(s, { kind: 'handedBack', agentId: MAIN, at: 1 })).toBe(s)
  })
})
