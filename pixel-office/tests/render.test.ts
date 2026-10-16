import { describe, expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce, restore } from '../hooks/model'
import {
  LEAD_MS,
  MAX_LAYERS,
  PUFF_MS,
  STATUS_WORDS,
  SVG_BUDGET,
  agentDetails,
  altText,
  clockLabel,
  escapeXml,
  fitSize,
  forgetLayers,
  isNight,
  officeLayers,
  orgRows,
  renderOffice,
  forgetOffice,
  officeSource,
  pictureSignature,
  sceneTimeOf,
  svgSize,
  tagsBelow,
} from '../hooks/render'
import type { Agent, OfficeEvent, Scene } from '../types'

const spawnEv = (id: string, at: number, description = 'find auth code'): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type: 'Explore',
  description,
  brief: 'Find where the login flow creates a session',
  name: null,
  isTeammate: false,
  isBackground: false,
  isResume: false,
  at,
})
const readEv = (id: string, target: string, at: number): OfficeEvent => ({
  kind: 'toolStarted',
  agentId: id,
  tool: 'Read',
  target,
  detail: '',
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
    const s = reduce(run([spawnEv('a1', 1000)]), { kind: 'handedBack', agentId: 'a1', reason: 'answer', report: '', usage: null, at: 2000 })
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

  test('no title carries the ticking On the job line', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    const svg = renderOffice(s, 66_000)
    const titles = [...svg.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(m => m[1] ?? '')
    expect(titles.length).toBeGreaterThan(1)
    expect(titles.some(t => t.includes('On the job'))).toBe(false)
    expect(titles.some(t => t.includes('Job: find auth code'))).toBe(true)
    expect(titles.some(t => t.includes('Brief:'))).toBe(false)
    // Drawn through the pane's cache, an idle office is the same text a second later.
    forgetOffice()
    expect(officeSource(s, 67_000)).toBe(officeSource(s, 66_000))
  })

  test('a boss waiting on its helpers says who it is waiting on', async () => {
    const one = run([{ kind: 'turnStarted', isContinuation: false, task: '', at: 500 }, spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    expect(groupOf(renderOffice(one, 60_000), MAIN)).toContain('>waiting on Researcher</text>')
    const two = reduce(one, spawnEv('a2', 1200))
    expect(groupOf(renderOffice(reduce(two, readEv('a2', 'b.ts', 1300)), 60_000), MAIN)).toContain('>waiting on 2</text>')
  })

  test('a helper carries its report to its boss and hands it over on the way out', async () => {
    const s = reduce(run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)]), {
      kind: 'handedBack',
      agentId: 'a1',
      reason: 'answer',
      report: 'done',
      usage: null,
      at: 20_000,
    })
    const until = s.agents.a1!.carry!.until
    const group = groupOf(renderOffice(s, 20_001), 'a1')
    expect(group).toContain('#fac775')
    expect(group).toContain(`<set attributeName="visibility" to="hidden" begin="${until - 20_001}ms"/>`)
    // Once it is handed over the folder is no longer drawn.
    expect(groupOf(renderOffice(s, until + 1), 'a1').includes(`begin="${until - 20_001}ms"`)).toBe(false)
  })

  test('neighbours whose name tags would collide get one over the head and one under the feet', async () => {
    // Main sits between the two helpers it is briefing, its tag right where theirs reach.
    const s = run([spawnEv('a1', 1000), spawnEv('a2', 1000, 'check hooks')])
    const row = [MAIN, 'a1', 'a2'].map(id => s.agents[id]!)
    expect(new Set(row.map(a => a.pos.y)).size).toBe(1)
    const below = tagsBelow(row, 60_000)
    expect(below.size).toBeGreaterThan(0)
    // No two tags on the same line cover each other by more than the width of their outline.
    const span = (a: (typeof row)[number]) => [a.pos.x - a.label.length * 1.05, a.pos.x + a.label.length * 1.05] as const
    for (const [i, a] of row.entries()) {
      for (const b of row.slice(i + 1)) {
        if (below.has(a.id) !== below.has(b.id)) continue
        const [a0, a1] = span(a)
        const [b0, b1] = span(b)
        expect(Math.min(a1, b1) - Math.max(a0, b0)).toBeLessThanOrEqual(1)
      }
    }
    // The drawing puts each tag where it was placed.
    const svg = renderOffice(s, 60_000)
    const tagY = (id: string): string | undefined => /<text x="0" y="([-\d.]+)" font-size="3.5"/.exec(groupOf(svg, id))?.[1]
    for (const a of row) expect(tagY(a.id)).toBe(below.has(a.id) ? '5.5' : '-14')
    // An agent on its own always has its tag over its head.
    expect(tagsBelow([s.agents.a1!], 60_000).size).toBe(0)
  })

  test('the picture is the same text until the scene changes, so the desktop never draws it again', async () => {
    forgetOffice()
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1500)])
    expect(sceneTimeOf(s)).toBe(1500)
    // Walking is under way, yet a moment later, and a second after that, it is the very same picture.
    const first = officeSource(s, 2000)
    expect(officeSource(s, 2350)).toBe(first)
    expect(officeSource(s, 3700)).toBe(first)
    // Drawn as of the clock instead, it would be a new picture each time.
    expect(renderOffice(s, 2350)).not.toBe(renderOffice(s, 3700))
    // Another agent's event is a new picture, drawn as of now, so a walk in progress carries on from where it is.
    const later = reduce(s, readEv('a1', 'login.ts', 4000))
    const again = officeSource(later, 4100)
    expect(again).not.toBe(first)
    expect(again).toBe(renderOffice(later, 4100 + LEAD_MS))
    expect(officeSource(later, 4600)).toBe(again)
  })

  test('an event that changes nothing in the picture does not draw it again, and one that does, does', async () => {
    expect(LEAD_MS).toBeGreaterThanOrEqual(100)
    expect(LEAD_MS).toBeLessThanOrEqual(500)
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1500)])
    forgetOffice()
    const first = officeSource(s, 2000)
    // The same read again changes nothing anyone can see.
    const that = reduce(s, readEv('a1', 'auth.ts', 2600))
    expect(officeSource(that, 3000)).toBe(first)
    expect(pictureSignature(that)).toBe(pictureSignature(s))
    // A different target is a different picture, drawn a little ahead of now.
    const thatToo = reduce(that, readEv('a1', 'login.ts', 3500))
    expect(pictureSignature(thatToo)).not.toBe(pictureSignature(s))
    expect(officeSource(thatToo, 4000)).not.toBe(first)
    expect(officeSource(thatToo, 4000)).toBe(renderOffice(thatToo, 4000 + LEAD_MS))
  })

  test('a walking agent carries its bubble, so what it is about to do shows before it arrives', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1500)])
    const group = groupOf(renderOffice(s, 1700), 'a1')
    expect(group).toContain('animateMotion')
    expect(group).toContain('>auth.ts</text>')
  })

  test('a station in use is outlined in its colour, and only while someone works there', async () => {
    const working = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1500)])
    const library = '<rect x="177" y="11" width="63" height="24" fill="#7f77dd"'
    expect(renderOffice(working, 9000)).toContain(library)
    expect(renderOffice(run([spawnEv('a1', 1000)]), 9000)).not.toContain(library)
    // Two agents at one shared station outline it once.
    const two = run([spawnEv('a1', 1000), spawnEv('a2', 1000), readEv('a1', 'a.ts', 1500), readEv('a2', 'b.ts', 1500)])
    expect(renderOffice(two, 9000).split(library)).toHaveLength(2)
    // A desk belongs to one agent: its own desk is outlined.
    const editing: OfficeEvent = { kind: 'toolStarted', agentId: 'a1', tool: 'Edit', target: 'x.ts', detail: '', callId: 'e1', at: 1500 }
    expect(renderOffice(run([spawnEv('a1', 1000), editing]), 9000)).toMatch(/<rect x="77" y="20" width="18" height="19" fill="#378add"/)
  })

  test('bubbles of agents standing together take different lanes, and one with no room is left out', async () => {
    const reads = ['a', 'b', 'c'].flatMap((id, i) => [spawnEv(id, 1000), readEv(id, `a-long-file-name-${i}.ts`, 1500)])
    const svg = renderOffice(run(reads), 9000)
    // The library has room for two rows of bubbles: two of the three helpers are shown, one above the other, and
    // the third is left out rather than hidden under them.
    const shown = [...svg.matchAll(/>(a-long-file-name-\d\.ts)<\/text>/g)].map(m => m[1])
    expect(shown).toHaveLength(2)
    const tops = [...svg.matchAll(/<g transform="translate\(-?[\d.]+,(-?[\d.]+)\)"><rect x="0" y="0" width="\d+" height="8"[^>]*\/>(?:(?!<g transform).)*?>a-long-file-name-\d\.ts</g)].map(m => Number(m[1]))
    expect(tops).toHaveLength(2)
    expect(Math.abs((tops[0] ?? 0) - (tops[1] ?? 0))).toBeGreaterThanOrEqual(10)
  })

  test('a click in the panel draws the picture again as of now, so a restart carries on from where everyone is', async () => {
    forgetOffice()
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1500)])
    const idle = officeSource(s, 2000, '|false|false|')
    expect(officeSource(s, 5000, '|false|false|')).toBe(idle)
    // Opening a row, the legend or the job view is a new picture, drawn at the time of the click.
    const clicked = officeSource(s, 5000, 'a1|false|false|')
    expect(clicked).not.toBe(idle)
    expect(clicked).toBe(renderOffice(s, 5000 + LEAD_MS))
    expect(officeSource(s, 9000, 'a1|false|false|')).toBe(clicked)
  })

  test('a scroll into another bucket draws the picture again as of now, a small one does not', async () => {
    forgetOffice()
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1500)])
    const first = officeSource(s, 2000, 'a1|false|false||0')
    expect(officeSource(s, 5000, 'a1|false|false||0')).toBe(first)
    const scrolled = officeSource(s, 7000, 'a1|false|false||1')
    expect(scrolled).not.toBe(first)
    expect(scrolled).toBe(renderOffice(s, 7000 + LEAD_MS))
  })

  test('night and day differ', async () => {
    expect(isNight(new Date(2026, 9, 14, 22).getTime())).toBe(true)
    expect(isNight(new Date(2026, 9, 14, 12).getTime())).toBe(false)
  })
})

describe('a scene saved by an older version', () => {
  // What 0.2.2 saved: no role, name, brief, report, outcome, background flag or carried item.
  const OLD_KEYS = ['role', 'name', 'brief', 'report', 'outcome', 'isBackground', 'carry'] as const
  const aged = (s: Scene): Scene => ({
    ...s,
    agents: Object.fromEntries(
      Object.entries(s.agents).map(([id, a]) => {
        const old: Record<string, unknown> = { ...a }
        for (const key of OLD_KEYS) delete old[key]
        return [id, old as unknown as Agent]
      }),
    ),
  })

  test('draws and lists without a missing field getting in the way', async () => {
    const s = aged(reduce(run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)]), { kind: 'handedBack', agentId: 'a1', reason: 'answer', report: '', usage: null, at: 5000 }))
    expect(() => renderOffice(s, 5100)).toThrow()
    const whole = restore(s)
    expect(renderOffice(whole, 5100)).toContain('id="agent-a1"')
    expect(orgRows(whole).map(row => row.label)).toEqual(['Main', 'Researcher'])
    expect(whole.agents.a1!.role).toBe('Researcher')
    // Without the flag nothing says Main waited on it, so Main is not shown coordinating.
    expect(whole.agents.a1!.isBackground).toBe(true)
    // The events that come next apply on top of it.
    expect(reduce(whole, readEv('a1', 'b.ts', 6000)).agents.a1!.phase).toBe('working')
  })

  test('a scene that is already whole comes back as the same object, so it is never rewritten', async () => {
    const s = run([spawnEv('a1', 1000)])
    expect(restore(s)).toBe(s)
    expect(restore(emptyScene()).agents[MAIN]!.role).toBe('Coordinator')
  })
})

describe('labels', () => {
  test('org rows nest subagents under their parent and say what each is doing', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'x.ts', 1100)])
    const rows = orgRows(s)
    expect(rows[0]).toEqual({ id: MAIN, depth: 0, label: 'Main', status: 'coordinating', now: 'waiting on Researcher' })
    expect(rows[1]).toEqual({ id: 'a1', depth: 1, label: 'Researcher', status: 'working', now: 'reading x.ts' })
    const done = reduce(s, { kind: 'handedBack', agentId: 'a1', reason: 'answer', report: '', usage: null, at: 9000 })
    expect(orgRows(done)[0]).toMatchObject({ status: 'working', now: 'thinking' })
    expect(orgRows(done)[1]).toMatchObject({ status: 'done', now: 'handed in its report' })
    const stopped = reduce(s, { kind: 'handedBack', agentId: 'a1', reason: 'aborted', report: '', usage: null, at: 9000 })
    expect(orgRows(stopped)[1]).toMatchObject({ status: 'done', now: 'was stopped' })
  })

  test('the panel tells waiting on you apart from waiting on helpers', async () => {
    expect(STATUS_WORDS.waiting).toBe('needs you')
    expect(STATUS_WORDS.coordinating).toBe('coordinating')
    const asked = run([{ kind: 'toolStarted', agentId: MAIN, tool: 'AskUserQuestion', target: '', detail: '', callId: 'q', at: 1 }])
    expect(orgRows(asked)[0]).toMatchObject({ status: 'waiting', now: 'waiting for you to answer a question' })
    // A command held at a permission prompt has not run yet.
    const held = reduce(run([{ kind: 'toolStarted', agentId: MAIN, tool: 'Bash', target: 'rm -rf build', detail: '', callId: 'b', at: 1 }]), {
      kind: 'waiting',
      agentId: MAIN,
      tool: 'Bash',
      at: 2,
    })
    expect(orgRows(held)[0]).toMatchObject({ status: 'waiting', now: 'waiting for your permission' })
    const resting = run([{ kind: 'turnStarted', isContinuation: false, task: '', at: 1 }, { kind: 'turnEnded', usage: null, at: 2 }])
    expect(orgRows(resting)[0]).toMatchObject({ status: 'idle', now: 'ready for your next message' })
  })

  test('live agents are listed before finished ones, so a trimmed chart keeps them', async () => {
    const events: OfficeEvent[] = []
    for (let i = 0; i < 14; i++) {
      events.push(spawnEv(`old${i}`, 1000 + i))
      events.push({ kind: 'handedBack', agentId: `old${i}`, reason: 'answer', report: '', usage: null, at: 2000 + i })
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

  test('escapeXml drops lone surrogates and the non-characters U+FFFE and U+FFFF', async () => {
    expect(escapeXml('a\uD800b\uFFFFc')).toBe('abc')
    expect(escapeXml('a\uDC00b\uFFFEc')).toBe('abc')
    expect(escapeXml('x\uD83D')).toBe('x')
    // A whole pair is a real character and stays.
    expect(escapeXml('a😀b')).toBe('a😀b')
  })

  test('agent details say who, what kind, what job, what now, for whom and for how long', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    expect(agentDetails(s, 'a1', 66_000)).toEqual([
      'Researcher · Explore agent',
      'Reads and searches, then reports what it found. Changes nothing',
      'Job: find auth code',
      'Brief: Find where the login flow creates a session',
      'Now: reading auth.ts',
      'Reports to: Main, who waits for its report',
      'On the job: 1m 5s',
    ])
    expect(agentDetails(s, MAIN, 66_000)).toEqual([
      'Main · Coordinator',
      'Talks with you, splits the work into jobs, hires helpers and puts their reports together',
      'Now: waiting on Researcher',
    ])
    expect(agentDetails(s, 'nobody', 66_000)).toEqual([])
  })

  test('details say what the work cost, once it is known, and keep it out of the drawing', async () => {
    const s = reduce(run([spawnEv('a1', 1000)]), {
      kind: 'handedBack',
      agentId: 'a1',
      reason: 'answer',
      report: 'done',
      usage: { tokens: 38_400, reused: 31_200, model: 'claude-haiku-5-5' },
      at: 9000,
    })
    expect(agentDetails(s, 'a1', 10_000)).toContain('Used: 38k tokens (31k reused) on Haiku 5.5')
    expect(agentDetails(run([spawnEv('a1', 1000)]), 'a1', 2000).some(line => line.startsWith('Used'))).toBe(false)
    const svg = renderOffice(s, 9100)
    expect(svg.includes('38k tokens')).toBe(false)
  })

  test('details show the report a helper handed back, and how its boss works with it', async () => {
    const s = reduce(run([spawnEv('a1', 1000)]), { kind: 'handedBack', agentId: 'a1', reason: 'answer', report: 'Sessions start in auth.ts', usage: null, at: 9000 })
    expect(agentDetails(s, 'a1', 10_000)).toContain('Report: Sessions start in auth.ts')
    expect(agentDetails(s, 'a1', 10_000)).toContain('Now: handed in its report')
    const alongside = run([{ ...spawnEv('a1', 1000), isBackground: true } as OfficeEvent])
    expect(agentDetails(alongside, 'a1', 2000)).toContain('Reports to: Main, who keeps working meanwhile')
    const named = run([{ ...spawnEv('t1', 1000), name: 'scout', isTeammate: true, isBackground: true } as OfficeEvent])
    expect(agentDetails(named, 't1', 2000).slice(0, 1)).toEqual(['Scout · Researcher (Explore agent)'])
    expect(agentDetails(named, 't1', 2000)).toContain('Reports to: Main, who leads the team')
  })

  test("a finished helper's time on the job stops counting when it leaves", async () => {
    const s = reduce(run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)]), {
      kind: 'handedBack',
      agentId: 'a1',
      reason: 'answer',
      report: 'Sessions start in auth.ts',
      usage: null,
      at: 20_000,
    })
    const goneAt = s.agents.a1!.goneAt!
    const onTheJob = (now: number): string | undefined => agentDetails(s, 'a1', now).find(line => line.startsWith('On the job'))
    expect(onTheJob(goneAt + 5000)).toBe(onTheJob(goneAt + 60_000))
    const secs = Math.round((goneAt - 1000) / 1000)
    expect(onTheJob(goneAt + 5000)).toBe(`On the job: ${Math.floor(secs / 60)}m ${secs % 60}s`)
    // Before it leaves, the clock still runs.
    expect(onTheJob(goneAt - 1000)).not.toBe(onTheJob(goneAt))
  })
})

test('a picture states the size its markup declares, so the pane keeps its height while the picture is swapped', async () => {
  expect(svgSize(renderOffice(emptyScene(), 10_000))).toEqual({ width: 960, height: 600 })
  expect(svgSize('<svg width="672" height="398"><svg width="640" height="172"></svg></svg>')).toEqual({ width: 672, height: 398 })
  expect(svgSize('<svg viewBox="0 0 1 1"></svg>')).toBeUndefined()
  expect(svgSize('<svg width="0" height="10">')).toBeUndefined()
  expect(svgSize('not svg')).toBeUndefined()
})

test('the picture is sized from the pane columns, keeping its shape', async () => {
  const size = { width: 960, height: 600 }
  expect(fitSize(size, 160)).toEqual({ width: 1200, height: 750 })
  expect(fitSize(size, 20)).toEqual({ width: 320, height: 200 })
  expect(fitSize(size, 1000)).toEqual({ width: 2400, height: 1500 })
  expect(fitSize(undefined, 100)).toBeUndefined()
  expect(fitSize(size, NaN)).toBeUndefined()
})

describe('officeLayers', () => {
  const team = (): Scene => run([spawnEv('a', 1000), spawnEv('b', 1001), readEv('b', 'x.ts', 1500)])

  test('the scenery is one picture and each agent is its own transparent one', () => {
    forgetLayers()
    const { base, agents } = officeLayers(team(), 9000)
    expect(base.source).not.toContain('<g id="agent-')
    expect(base.source).toContain('id="po-pet"')
    expect(agents.map(l => l.key)).toEqual(['agent-main', 'agent-a', 'agent-b'])
    for (const layer of agents) {
      const id = layer.key.slice('agent-'.length)
      expect(layer.source.split(`<g id="agent-${id}"`).length - 1).toBe(1)
      expect(layer.source.split('<g id="agent-').length - 1).toBe(1)
      expect(layer.source).not.toContain('po-wood')
      expect(layer.source).toStartWith('<svg')
      expect(layer.source).toEndWith('</svg>')
    }
    expect(base.source).toContain('po-wood')
    for (const layer of [base, ...agents]) expect(layer.source).toContain('width="960" height="600"')
  })

  test('an event of one agent changes only its own picture', () => {
    forgetLayers()
    const before = officeLayers(team(), 9000)
    const after = officeLayers(reduce(team(), readEv('b', 'y.ts', 11000)), 12000)
    expect(after.agents[0]!.source).toBe(before.agents[0]!.source)
    expect(after.agents[1]!.source).toBe(before.agents[1]!.source)
    expect(after.agents[2]!.source).not.toBe(before.agents[2]!.source)
    expect(after.base.source).toBe(before.base.source)
  })

  test('an agent starting to use a station outlines it in the scenery, not in any agent picture', () => {
    forgetLayers()
    const idle = run([spawnEv('a', 1000), spawnEv('b', 1001)])
    const before = officeLayers(idle, 30000)
    const after = officeLayers(reduce(idle, readEv('b', 'y.ts', 30500)), 31000)
    expect(after.base.source).not.toBe(before.base.source)
    expect(before.base.source).not.toContain('values="0.95;0.35;0.95"')
    expect(after.base.source).toContain('values="0.95;0.35;0.95"')
    for (const layer of after.agents) expect(layer.source).not.toContain('values="0.95;0.35;0.95"')
  })

  test('a walking agent is drawn again when the scroll changes bucket, a standing one is not', () => {
    forgetLayers()
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    const walk = s.agents.a1!.walk!
    const now = walk.startedAt + 100
    const first = officeLayers(s, now, 0)
    const later = officeLayers(s, now + 1000, 0)
    const moved = officeLayers(s, now + 1000, 1)
    expect(later.agents[1]!.source).toBe(first.agents[1]!.source)
    expect(moved.agents[1]!.source).not.toBe(first.agents[1]!.source)
    // Main stands: the same bucket or another leaves its picture alone.
    const standing = officeLayers(s, now + 1000, 0)
    expect(moved.agents[0]!.source).toBe(standing.agents[0]!.source)
  })

  test('at most MAX_LAYERS agents are drawn and the base says how many more there are', () => {
    forgetLayers()
    let s = emptyScene()
    for (let i = 0; i < 30; i++) s = reduce(s, spawnEv(`h${i}`, 1000 + i))
    const { base, agents } = officeLayers(s, 9000)
    expect(agents.length).toBe(MAX_LAYERS)
    expect(agents[0]!.key).toBe('agent-main')
    expect(base.source).toContain(`+${31 - MAX_LAYERS} more`)
  })
})
