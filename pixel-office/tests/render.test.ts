import { describe, expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce } from '../hooks/model'
import { PUFF_MS, SVG_BUDGET, agentDetails, altText, clockLabel, escapeXml, isNight, orgRows, renderOffice } from '../hooks/render'
import type { OfficeEvent, Scene } from '../types'

const spawnEv = (id: string, at: number): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type: 'Explore',
  description: 'find auth code',
  name: null,
  isTeammate: false,
  at,
})
const readEv = (id: string, target: string, at: number): OfficeEvent => ({
  kind: 'toolStarted',
  agentId: id,
  tool: 'Read',
  target,
  callId: `c-${id}`,
  at,
})
const run = (events: OfficeEvent[]): Scene => events.reduce(reduce, emptyScene())
const groupOf = (svg: string, id: string): string => {
  const start = svg.indexOf(`<g id="agent-${id}"`)
  const next = svg.indexOf('<g id="agent-', start + 1)
  return start < 0 ? '' : svg.slice(start, next < 0 ? undefined : next)
}

describe('renderOffice', () => {
  test('draws a complete svg with Main in it', async () => {
    const svg = renderOffice(emptyScene(), 1000)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
    expect(svg).toContain('viewBox="0 0 240 150"')
    expect(svg).toContain('id="agent-main"')
  })

  test('a walking agent continues its walk for the time left', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    const walk = s.agents.a1!.walk!
    const now = walk.startedAt + 100
    const group = groupOf(renderOffice(s, now), 'a1')
    expect(group).toContain(`<animateMotion dur="${walk.startedAt + walk.durationMs - now}ms"`)
  })

  test('an agent at work stands still with a bubble naming its target', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    const group = groupOf(renderOffice(s, 60_000), 'a1')
    expect(group.includes('animateMotion')).toBe(false)
    expect(group).toContain(`translate(${s.agents.a1!.pos.x},${s.agents.a1!.pos.y})`)
    expect(group).toContain('>auth.ts</text>')
    expect(group).toContain('#7f77dd')
  })

  test('markup in targets is escaped', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', '<b>&"x"', 1100)])
    const svg = renderOffice(s, 60_000)
    expect(svg).toContain('&lt;b&gt;&amp;&quot;x&quot;')
    expect(svg.includes('<b>')).toBe(false)
  })

  test('a departing agent hides when its walk ends and is gone after', async () => {
    const s = reduce(run([spawnEv('a1', 1000)]), { kind: 'handedBack', agentId: 'a1', reason: 'answer', at: 2000 })
    const goneAt = s.agents.a1!.goneAt!
    expect(groupOf(renderOffice(s, 2001), 'a1')).toContain('<set attributeName="visibility" to="hidden"')
    expect(renderOffice(s, goneAt + 1).includes('id="agent-a1"')).toBe(false)
  })

  test('an error puffs red for a moment', async () => {
    const s = run([
      spawnEv('a1', 1000),
      readEv('a1', 'x.ts', 1100),
      { kind: 'toolEnded', agentId: 'a1', callId: 'c-a1', isError: true, at: 5000 },
    ])
    expect(groupOf(renderOffice(s, 5100), 'a1')).toContain('#e8453c')
    expect(groupOf(renderOffice(s, 5000 + PUFF_MS + 1), 'a1').includes('#e8453c')).toBe(false)
  })

  test('twenty agents fit the budget', async () => {
    let s = emptyScene()
    for (let i = 0; i < 20; i++) s = reduce(s, spawnEv(`a${i}`, 1000 + i))
    for (let i = 0; i < 20; i++) s = reduce(s, readEv(`a${i}`, `file-${i}.ts`, 2000 + i))
    const svg = renderOffice(s, 120_000)
    expect(svg.length).toBeLessThan(SVG_BUDGET)
    expect(svg).toContain('id="po-decor"')
  })

  test('a tiny budget drops decor and caps agents', async () => {
    let s = emptyScene()
    for (let i = 0; i < 20; i++) s = reduce(s, spawnEv(`a${i}`, 1000 + i))
    const svg = renderOffice(s, 120_000, 1)
    expect(svg.includes('id="po-decor"')).toBe(false)
    expect(svg).toContain('+20 more')
    expect(svg).toContain('id="agent-main"')
  })

  test('control characters in a target never reach the svg', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', '\x1b[31mred\x1b[0m\x07\x00\x7f', 1100)])
    const svg = renderOffice(s, 60_000)
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(svg)).toBe(false)
    expect(svg).toContain('>[31mred[0m</text>')
  })

  test('night and day differ', async () => {
    expect(isNight(new Date(2026, 9, 14, 22).getTime())).toBe(true)
    expect(isNight(new Date(2026, 9, 14, 12).getTime())).toBe(false)
  })
})

describe('labels', () => {
  test('org rows nest subagents under their parent', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'x.ts', 1100)])
    const rows = orgRows(s)
    expect(rows[0]).toEqual({ id: MAIN, depth: 0, label: 'Main', status: 'working', place: 'Corner office' })
    expect(rows[1]).toEqual({ id: 'a1', depth: 1, label: 'Explore', status: 'working', place: 'Records library' })
    const done = reduce(s, { kind: 'handedBack', agentId: 'a1', reason: 'answer', at: 9000 })
    expect(orgRows(done)[1]).toMatchObject({ status: 'done', place: 'left' })
  })

  test('live agents are listed before finished ones, so a trimmed chart keeps them', async () => {
    const events: OfficeEvent[] = []
    for (let i = 0; i < 14; i++) {
      events.push(spawnEv(`old${i}`, 1000 + i))
      events.push({ kind: 'handedBack', agentId: `old${i}`, reason: 'answer', at: 2000 + i })
    }
    events.push(spawnEv('fresh', 3000), readEv('fresh', 'x.ts', 3100))
    const rows = orgRows(run(events))
    expect(rows).toHaveLength(16)
    expect(rows[0]?.id).toBe(MAIN)
    expect(rows.findIndex(row => row.id === 'fresh')).toBeLessThan(14)
    expect(rows.slice(1).map(row => row.status === 'done')).toEqual([false, ...Array<boolean>(14).fill(true)])
    // Arrival order holds inside each group.
    expect(rows.slice(2).map(row => row.id)).toEqual(Array.from({ length: 14 }, (_, i) => `old${i}`))
  })

  test('clock labels are HH:MM in local time', async () => {
    expect(clockLabel(new Date(2026, 9, 14, 9, 5).getTime())).toBe('09:05')
  })

  test('alt text lists who is where', async () => {
    expect(altText(emptyScene())).toBe('Pixel office with 1 agent: Main at Corner office')
  })

  test('escapeXml escapes the five XML characters', async () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;')
  })

  test('escapeXml drops control characters but keeps tabs and line breaks', async () => {
    expect(escapeXml('a\x00b\x08c\x0Bd\x0Ce\x1b[31mf\x7fg')).toBe('abcde[31mfg')
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  test('agent details say who, what, for whom and for how long', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    expect(agentDetails(s, 'a1', 66_000)).toEqual([
      'Explore (Explore)',
      'Task: find auth code',
      'Doing: Read auth.ts',
      'Reports to: Main',
      'On the job: 1m 5s',
    ])
    expect(agentDetails(s, MAIN, 66_000)[0]).toBe('Main (your main agent)')
    expect(agentDetails(s, 'nobody', 66_000)).toEqual([])
  })
})
