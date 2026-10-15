import { describe, expect, test } from 'claude-code/testing'

import { etaDetail, etaOf, etaWords } from '../hooks/eta'
import { emptyScene, reduce } from '../hooks/model'
import { agentDetails, etaBar, orgRows, renderOffice } from '../hooks/render'
import type { OfficeEvent, Scene } from '../types'

const hire = (id: string, at: number, extra: Partial<Extract<OfficeEvent, { kind: 'spawned' }>> = {}): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: 'main',
  type: 'Explore',
  description: 'look around',
  brief: '',
  name: null,
  isTeammate: false,
  isBackground: false,
  isResume: false,
  at,
  ...extra,
})
const back = (id: string, at: number): OfficeEvent => ({ kind: 'handedBack', agentId: id, reason: 'answer', report: 'ok', at })
const run = (events: OfficeEvent[]): Scene => events.reduce(reduce, emptyScene())

// Two helpers took about 10 s and 30 s: the typical helper takes 20 s.
const history = [hire('h1', 0), back('h1', 10_000), hire('h2', 0), back('h2', 30_000)]

describe('how long a helper usually takes', () => {
  test('it says nothing until two similar helpers have reported', async () => {
    const one = run([hire('h1', 0), back('h1', 10_000), hire('h3', 20_000)])
    expect(etaOf(one, one.agents.h3!, 25_000)).toBeNull()
  })

  test('it is the middle of what similar helpers took, and counts down', async () => {
    const s = run([...history, hire('h3', 100_000)])
    const early = etaOf(s, s.agents.h3!, 105_000)!
    expect(early.samples).toBe(2)
    expect(early.typicalMs).toBeGreaterThan(18_000)
    expect(early.typicalMs).toBeLessThan(23_000)
    expect(etaWords(early)).toMatch(/^about \d+s left$/)
    const late = etaOf(s, s.agents.h3!, 100_000 + 60_000)!
    expect(etaWords(late)).toBe('taking longer than usual')
  })

  test('only helpers of the same kind, still out on a job, and not teammates, get one', async () => {
    const s = run([...history, hire('p1', 100_000, { type: 'Plan' }), hire('b1', 100_000, { isBackground: true }), hire('t1', 100_000, { isTeammate: true })])
    expect(etaOf(s, s.agents.p1!, 101_000)).toBeNull()
    // A helper started in the background, as the Agent tool does by default, gets one like any other.
    expect(etaOf(s, s.agents.b1!, 101_000)).not.toBeNull()
    expect(etaOf(s, s.agents.t1!, 101_000)).toBeNull()
    expect(etaOf(s, s.agents.main!, 101_000)).toBeNull()
    expect(etaOf(s, s.agents.h1!, 101_000)).toBeNull()
  })

  test('the org chart and the details box show it, and the picture does not', async () => {
    const s = run([...history, hire('h3', 100_000)])
    const row = orgRows(s, 105_000).find(r => r.id === 'h3')!
    expect(row.now).toMatch(/about \d+s left$/)
    expect(orgRows(s).find(r => r.id === 'h3')!.now).not.toMatch(/left/)
    const lines = agentDetails(s, 'h3', 105_000)
    expect(lines.some(l => l.startsWith('Expected: usually about'))).toBe(true)
    expect(etaDetail(etaOf(s, s.agents.h3!, 105_000)!)).toContain('from 2 similar helpers')
  })

  test('a bar under the helper fills over the time left, then pulses amber once it is overdue', async () => {
    const s = run([...history, hire('h3', 100_000)])
    // Predecessors took about 20 s; 5 s in, a quarter is full and the rest fills over the 15 s left.
    const bar = etaBar(s, s.agents.h3!, 105_000)
    expect(bar).toContain('width="2.25"')
    expect(bar).toContain('from="2.25" to="9" dur="15000ms"')
    expect(bar).toContain('#97c459')
    const late = etaBar(s, s.agents.h3!, 200_000)
    expect(late).toContain('#fac775')
    expect(late).toContain('values="1;0.4;1"')
    // No estimate, no bar; and it is drawn inside the picture, on the helper.
    expect(etaBar(s, s.agents.h1!, 105_000)).toBe('')
    expect(renderOffice(s, 105_000)).toContain('dur="15000ms"')
    expect(renderOffice(run(history), 105_000)).not.toContain('dur="15000ms"')
  })
})
