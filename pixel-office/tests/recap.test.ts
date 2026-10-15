import { describe, expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce } from '../hooks/model'
import {
  HISTORY_MAX,
  historyLine,
  isRecord,
  jobRecord,
  recapOf,
  recapRows,
  recapSummary,
  recapSvg,
  span,
  speedUp,
  withRecord,
} from '../hooks/recap'
import type { JobRecord, OfficeEvent, Scene, Usage } from '../types'

const T = new Date(2026, 9, 15, 14, 5).getTime()
const s = (seconds: number): number => T + seconds * 1000
const used = (tokens: number): Usage => ({ tokens, reused: 0, model: 'claude-haiku-5-5' })

const turn = (seconds: number, task = 'fix the login bug', isContinuation = false): OfficeEvent => ({
  kind: 'turnStarted',
  isContinuation,
  task,
  at: s(seconds),
})
const turnEnd = (seconds: number, usage: Usage | null = null): OfficeEvent => ({ kind: 'turnEnded', usage, at: s(seconds) })
const hire = (id: string, seconds: number, extra: Partial<Extract<OfficeEvent, { kind: 'spawned' }>> = {}): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type: 'Explore',
  description: 'look around',
  brief: '',
  name: null,
  isTeammate: false,
  isBackground: false,
  isResume: false,
  at: s(seconds),
  ...extra,
})
const back = (id: string, seconds: number, usage: Usage | null = null, reason: 'answer' | 'aborted' | 'error' = 'answer'): OfficeEvent => ({
  kind: 'handedBack',
  agentId: id,
  reason,
  report: '',
  usage,
  at: s(seconds),
})
const run = (events: OfficeEvent[], from: Scene = emptyScene()): Scene => events.reduce(reduce, from)

describe('recapOf', () => {
  test('there is no recap before the first message', async () => {
    expect(recapOf(emptyScene(), s(10))).toBeNull()
  })

  test('lanes follow who hired whom, and say how each agent worked with Main', async () => {
    const scene = run([
      turn(0),
      hire('a1', 10),
      hire('a2', 12, { type: 'Plan', isBackground: true }),
      hire('a3', 20, { parentId: 'a1', type: 'general-purpose' }),
      back('a3', 50),
      back('a1', 60),
      back('a2', 80),
      turnEnd(90),
    ])
    const recap = recapOf(scene, s(100))!
    expect(recap.lanes.map(l => [l.label, l.depth, l.kind])).toEqual([
      ['Main', 0, 'main'],
      ['Researcher', 1, 'waited'],
      ['Assistant', 2, 'waited'],
      ['Planner', 1, 'alongside'],
    ])
    expect(recap.lanes.map(l => [(l.start - T) / 1000, (l.end - T) / 1000])).toEqual([
      [0, 90],
      [10, 60],
      [20, 50],
      [12, 80],
    ])
    expect(recap.isOpen).toBe(false)
    expect(recap.endedAt).toBe(s(90))
  })

  test('helper time, time together, the peak and the tokens add up', async () => {
    // a1 10-60, a2 30-40 (inside a1), a3 70-100 (after a gap): 50 + 10 + 30 = 90s of work, 50 + 30 = 80s together.
    const scene = run([
      turn(0),
      hire('a1', 10),
      hire('a2', 30),
      back('a2', 40, used(1000)),
      back('a1', 60, used(4000)),
      hire('a3', 70),
      back('a3', 100, used(500)),
      turnEnd(110, used(2000)),
    ])
    const recap = recapOf(scene, s(120))!
    expect(recap.helpers).toBe(3)
    expect(recap.helperMs).toBe(90_000)
    expect(recap.togetherMs).toBe(80_000)
    expect(recap.peak).toBe(2)
    expect(recap.tokens).toBe(7500)
    // 90 over 80 is under the 1.2 that counts as a real saving.
    expect(speedUp(recap)).toBeNull()
  })

  test('a helper that starts the moment another hands in is not counted as at the same time', async () => {
    const scene = run([turn(0), hire('a1', 10), back('a1', 20), hire('a2', 20), back('a2', 30), turnEnd(40)])
    expect(recapOf(scene, s(50))!.peak).toBe(1)
  })

  test('parallel helpers are worth saying so', async () => {
    const scene = run([turn(0), hire('a1', 10), hire('a2', 10), hire('a3', 10), back('a1', 70), back('a2', 70), back('a3', 70), turnEnd(80)])
    const recap = recapOf(scene, s(90))!
    expect(speedUp(recap)).toBe(3)
    expect(recapSummary(recap)).toEqual([
      'This job: fix the login bug',
      'Took 1m 20s · 3 helpers, up to 3 at once',
      'Helpers did 3m 0s of work in 1m 0s: about 3.0× faster than one after another',
    ])
  })

  test('a job still running says so, and its open lanes run to now', async () => {
    const scene = run([turn(0), hire('a1', 10)])
    const recap = recapOf(scene, s(45))!
    expect(recap.isOpen).toBe(true)
    expect(recap.lanes.every(l => l.end === s(45) && l.isOpen)).toBe(true)
    expect(recapSummary(recap)[1]).toBe('Running for 45s · 1 helper, up to 1 at once')
    expect(recapRows(recap)).toEqual(['Main: 45s, still working', '  Researcher: 35s, still working'])
  })

  test('a new message starts a new job; a turn that carries on keeps the same one', async () => {
    const first = run([turn(0), hire('a1', 10), back('a1', 20), turnEnd(30)])
    const carriedOn = run([turn(40, '', true), turnEnd(50)], first)
    expect(recapOf(carriedOn, s(60))!.startedAt).toBe(s(0))
    expect(recapOf(carriedOn, s(60))!.lanes).toHaveLength(2)
    const second = run([turn(100, 'write the docs'), turnEnd(120)], carriedOn)
    const recap = recapOf(second, s(130))!
    expect(recap.task).toBe('write the docs')
    expect(recap.lanes.map(l => l.label)).toEqual(['Main'])
    expect(recapSummary(recap)[1]).toBe('Took 20s · no helpers')
  })

  test('rows say how each job ended, in words', async () => {
    const scene = run([turn(0), hire('a1', 1, { description: '' }), hire('a2', 1, { description: '' }), hire('a3', 1, { description: '' }), back('a1', 5, used(41_200)), back('a2', 6, null, 'aborted'), back('a3', 7, null, 'error'), turnEnd(9)])
    expect(recapRows(recapOf(scene, s(10))!)).toEqual([
      'Main: 9s, finished',
      '  Researcher: 4s, 41k tokens, handed in its report',
      '  Researcher 2: 5s, was stopped',
      '  Researcher 3: 6s, ran into a problem',
    ])
  })
})

describe('recapSvg', () => {
  const finished = run([turn(0), hire('a1', 10), hire('a2', 15, { isBackground: true, name: '<b>&co' }), back('a1', 60), back('a2', 70, null, 'error'), turnEnd(90)])
  const svg = recapSvg(recapOf(finished, s(100))!)

  test('draws one bar per agent, with a legend for the kinds it has and only those', async () => {
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
    expect(svg.match(/class="k-(main|waited|alongside)" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="10" rx="4"/g)).toHaveLength(3)
    expect(svg).toContain('>Main</text>')
    expect(svg).toContain('A helper Main waited for')
    expect(svg).toContain('A helper working alongside')
    const alone = recapSvg(recapOf(run([turn(0), turnEnd(5)]), s(10))!)
    expect(alone.includes('A helper')).toBe(false)
  })

  test('marks how each job ended with a shape as well as a color', async () => {
    expect(svg).toContain('✓</tspan>')
    expect(svg).toContain('✕</tspan>')
  })

  test('escapes names, and carries dark steps for a dark surface', async () => {
    expect(svg).toContain('&lt;b&gt;&amp;co')
    expect(svg.includes('<b>')).toBe(false)
    expect(svg).toContain('@media (prefers-color-scheme: dark)')
  })

  test('every bar starts and ends inside the plot', async () => {
    const bars = [...svg.matchAll(/class="k-\w+" x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="10" rx="4"/g)]
    expect(bars).toHaveLength(3)
    for (const m of bars) {
      const x = Number(m[1])
      const w = Number(m[2])
      expect(x).toBeGreaterThanOrEqual(148)
      expect(x + w).toBeLessThanOrEqual(554.5)
    }
  })
})

describe('history', () => {
  const record = (startedAt: number, task = 'a'): JobRecord => ({ startedAt, task, tookMs: 1000, helpers: 1, peak: 1, tokens: null })

  test('a job saved again replaces its record, and only the newest are kept', async () => {
    let list: JobRecord[] = []
    for (let i = 0; i < HISTORY_MAX + 5; i++) list = withRecord(list, record(i))
    expect(list).toHaveLength(HISTORY_MAX)
    expect(list[0]?.startedAt).toBe(5)
    const updated = withRecord(list, { ...record(10), task: 'carried on' })
    expect(updated).toHaveLength(HISTORY_MAX)
    expect(updated.filter(r => r.startedAt === 10).map(r => r.task)).toEqual(['carried on'])
  })

  test('what comes back from disk is checked before it is used', async () => {
    expect(isRecord(record(1))).toBe(true)
    expect(isRecord({ ...record(1), tokens: 5 })).toBe(true)
    for (const bad of [null, 3, 'x', {}, { ...record(1), task: 7 }, { ...record(1), tokens: '5' }]) expect(isRecord(bad)).toBe(false)
  })

  test('a record reads as a line', async () => {
    const recap = recapOf(run([turn(0), hire('a1', 10), back('a1', 60, used(182_000)), turnEnd(250)]), s(260))!
    expect(historyLine(jobRecord(recap))).toBe('15 Oct 14:05 fix the login bug: took 4m 10s, 1 helper, 182k tokens')
    expect(historyLine({ ...jobRecord(recap), task: '', helpers: 0, tokens: null })).toBe('15 Oct 14:05 a job: took 4m 10s, no helpers')
  })

  test('durations read the way people say them', async () => {
    expect([0, 45_000, 250_000, 3_720_000].map(span)).toEqual(['0s', '45s', '4m 10s', '1h 2m'])
  })
})
