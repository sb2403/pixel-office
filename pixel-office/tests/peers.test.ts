import { describe, expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce } from '../hooks/model'
import {
  PEER_AGENTS_MAX,
  PEER_FILE_MAX,
  PEER_SCHEMA,
  STALE_MS,
  agentsOf,
  officeOf,
  baseName,
  contentOf,
  doingOf,
  freeSlots,
  isLive,
  isTakenFrom,
  livePeers,
  parsePeer,
  peerDirOf,
  peerRows,
  peerStatusOf,
  peersHeading,
  shownOf,
  sinceWords,
  slotName,
  slotOf,
  snapshotOf,
  tombstoneOf,
  urgentOf,
} from '../hooks/peers'
import type { SlotSeen } from '../hooks/peers'
import { renderOffice } from '../hooks/render'
import type { OfficeEvent, PeerAgent, PeerSession, Scene } from '../types'

const NOW = new Date(2026, 9, 16, 12, 0).getTime()
const META = { instance: 'me', sessionId: 's-me', startedAt: NOW - 60_000, project: 'pixel-office', since: NOW - 1000 }

const peer = (extra: Partial<PeerSession> = {}): PeerSession => ({
  v: PEER_SCHEMA,
  instance: 'other',
  sessionId: 's-other',
  beatAt: NOW,
  startedAt: NOW - 120_000,
  endedAt: null,
  project: 'api-server',
  status: 'working',
  since: NOW - 5000,
  doing: 'running a command',
  task: 'fix the login bug',
  needsYou: 0,
  agents: [],
  ...extra,
})

const play = (events: OfficeEvent[]): Scene => events.reduce((s, ev) => reduce(s, ev), emptyScene())
const turn = (task: string, at = NOW): OfficeEvent => ({ kind: 'turnStarted', isContinuation: false, task, at })
const tool = (name: string, target: string, at = NOW): OfficeEvent => ({
  kind: 'toolStarted',
  agentId: MAIN,
  tool: name,
  target,
  detail: 'rm -rf the secret folder',
  callId: 'c1',
  at,
})

describe('where the sessions meet', () => {
  test('the folder is under the Claude config folder, else under home', async () => {
    expect(peerDirOf({ configDir: '/cfg/', home: '/home/me' })).toBe('/cfg/pixel-office/sessions')
    expect(peerDirOf({ home: '/home/me' })).toBe('/home/me/.claude/pixel-office/sessions')
    expect(peerDirOf({ home: ' ', userProfile: 'C:\\Users\\me\\' })).toBe('C:\\Users\\me/.claude/pixel-office/sessions')
    expect(peerDirOf({})).toBeNull()
  })

  test('slots are 32 numbered files and nothing else', async () => {
    expect(slotName(3)).toBe('slot-03.json')
    expect(slotOf('slot-03.json')).toBe(3)
    expect(slotOf('slot-31.json')).toBe(31)
    expect(slotOf('slot-32.json')).toBeNull()
    expect(slotOf('slot-3.json')).toBeNull()
    expect(slotOf('notes.txt')).toBeNull()
  })

  test('a project is named by its folder, on any system', async () => {
    expect(baseName('/home/me/code/pixel-office')).toBe('pixel-office')
    expect(baseName('C:\\code\\api-server\\')).toBe('api-server')
    expect(baseName('/')).toBe('')
  })
})

describe('what a session tells the others', () => {
  test('an idle office is idle and says nothing more', async () => {
    const snap = snapshotOf(emptyScene(), META, NOW)
    expect(snap.status).toBe('idle')
    expect(snap.doing).toBe('')
    expect(snap.task).toBe('')
    expect(snap.project).toBe('pixel-office')
    expect(snap.endedAt).toBeNull()
  })

  test('work is named by its kind, never by its file or command', async () => {
    const scene = play([turn('fix the login bug in **auth.ts** please'), tool('Bash', 'secret.sh')])
    const snap = snapshotOf(scene, META, NOW)
    expect(snap.status).toBe('working')
    expect(snap.doing).toBe('running a command')
    expect(snap.task).toBe('fix the login bug in auth.ts please')
    const text = JSON.stringify(snap)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('rm -rf')
    expect(doingOf(play([tool('Read', 'a.ts')]))).toBe('reading and searching')
    expect(doingOf(play([tool('mcp__linear__search', 'x')]))).toBe('using a connected service')
  })

  test('the job message is cut to 60 characters, and a finished job is not sent', async () => {
    const long = 'a'.repeat(200)
    expect(snapshotOf(play([turn(long)]), META, NOW).task.length).toBeLessThanOrEqual(60)
    const done = play([turn('fix it'), { kind: 'turnEnded', usage: null, at: NOW + 10 }])
    expect(snapshotOf(done, META, NOW).task).toBe('')
  })

  test('anyone waiting on you makes the session wait on you', async () => {
    const scene = play([turn('go'), { kind: 'waiting', agentId: null, tool: 'Bash', at: NOW }])
    expect(peerStatusOf(scene)).toBe('waiting')
    expect(snapshotOf(scene, META, NOW).needsYou).toBe(1)
    expect(doingOf(scene)).toBe('waiting on you')
  })

  test('a tombstone carries no text', async () => {
    const t = tombstoneOf(META, NOW)
    expect(t.endedAt).toBe(NOW)
    expect(t.project + t.task + t.doing).toBe('')
    expect(isLive(t, NOW)).toBe(false)
  })

  test('a heartbeat alone does not change the content', async () => {
    const a = snapshotOf(emptyScene(), META, NOW)
    const b = snapshotOf(emptyScene(), META, NOW + 5000)
    expect(contentOf(a)).toBe(contentOf(b))
  })
})

describe('reading what others wrote', () => {
  test('a snapshot round-trips', async () => {
    const p = peer()
    expect(parsePeer(JSON.stringify(p))).toEqual(p)
  })

  test('junk is no session', async () => {
    for (const text of ['', '{', 'null', '[]', '42', '"x"', JSON.stringify({ ...peer(), v: 2 }), JSON.stringify({ ...peer(), status: 'busy' })]) {
      expect(parsePeer(text)).toBeNull()
    }
    expect(parsePeer(JSON.stringify({ ...peer(), beatAt: 'now' }))).toBeNull()
    expect(parsePeer(JSON.stringify({ ...peer(), instance: '' }))).toBeNull()
    expect(parsePeer(JSON.stringify({ ...peer(), instance: 'x'.repeat(65) }))).toBeNull()
    expect(parsePeer(JSON.stringify({ ...peer(), endedAt: 'soon' }))).toBeNull()
    expect(parsePeer(JSON.stringify({ ...peer(), needsYou: -1 }))).toBeNull()
    const { task: _, ...noTask } = peer()
    expect(parsePeer(JSON.stringify(noTask))).toBeNull()
  })

  test('a crafted file cannot reach the prototype or the screen', async () => {
    const text = `{"__proto__":{"polluted":true},${JSON.stringify(peer()).slice(1)}`
    const p = parsePeer(text)
    expect(p).not.toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(p!)).not.toContain('__proto__')
    const sneaky = parsePeer(JSON.stringify(peer({ project: '\u001b[31mred\u202e\u0085x', task: 'ok\u0000' })))
    expect(sneaky?.project).toBe('redx')
    expect(sneaky?.task).toBe('ok')
  })

  test('only the words an office writes are shown as what it is doing', async () => {
    expect(parsePeer(JSON.stringify(peer({ doing: 'reading /etc/passwd' })))?.doing).toBe('')
    expect(parsePeer(JSON.stringify(peer({ doing: 'waiting on 3 helpers' })))?.doing).toBe('waiting on 3 helpers')
    expect(parsePeer(JSON.stringify(peer({ doing: 'editing files' })))?.doing).toBe('editing files')
  })
})

describe('who is live', () => {
  const self = { instance: 'me', sessionId: 's-me' }

  test('a heartbeat counts within the stale window, either way', async () => {
    expect(isLive(peer({ beatAt: NOW - STALE_MS }), NOW)).toBe(true)
    expect(isLive(peer({ beatAt: NOW - STALE_MS - 1 }), NOW)).toBe(false)
    expect(isLive(peer({ beatAt: NOW + STALE_MS + 1 }), NOW)).toBe(false)
  })

  test('this copy, this session under an older copy, the ended and the stale are left out', async () => {
    const found = [
      peer({ instance: 'me', sessionId: 's-me' }),
      peer({ instance: 'old-me', sessionId: 's-me' }),
      peer({ instance: 'gone', sessionId: 's-gone', endedAt: NOW }),
      peer({ instance: 'stale', sessionId: 's-stale', beatAt: NOW - 60_000 }),
      peer(),
    ]
    expect(livePeers(found, self, NOW).map(p => p.instance)).toEqual(['other'])
  })

  test('one row per session: the later load of two', async () => {
    const found = [peer({ instance: 'b', startedAt: NOW - 10 }), peer({ instance: 'a', startedAt: NOW - 1000, beatAt: NOW + 100 })]
    expect(livePeers(found, self, NOW).map(p => p.instance)).toEqual(['b'])
    expect(livePeers([...found].reverse(), self, NOW).map(p => p.instance)).toEqual(['b'])
  })

  test('the ones waiting on you come first, then the busy, then the idle', async () => {
    const found = [
      peer({ instance: 'i', sessionId: 'i', status: 'idle', startedAt: 1 }),
      peer({ instance: 'w', sessionId: 'w', status: 'working', startedAt: 3 }),
      peer({ instance: 'n', sessionId: 'n', status: 'waiting', startedAt: 5 }),
      peer({ instance: 'w2', sessionId: 'w2', status: 'working', startedAt: 2 }),
    ]
    expect(livePeers(found, self, NOW).map(p => p.instance)).toEqual(['n', 'w2', 'w', 'i'])
  })
})

describe('slots', () => {
  const self = { instance: 'me', sessionId: 's-me' }
  const seen = (entries: [number, SlotSeen][]): Map<number, SlotSeen> => new Map(entries)

  test('missing, ended and stale slots are free; live ones are not', async () => {
    const { free } = freeSlots(
      seen([
        [0, { peer: peer(), mtimeMs: NOW, isOdd: false }],
        [1, { peer: peer({ endedAt: NOW }), mtimeMs: NOW, isOdd: false }],
        [2, { peer: peer({ beatAt: NOW - STALE_MS - 1 }), mtimeMs: NOW, isOdd: false }],
      ]),
      self,
      NOW,
    )
    expect(free).not.toContain(0)
    expect(free).toContain(1)
    expect(free).toContain(2)
    expect(free).toContain(3)
    expect(free).toHaveLength(31)
  })

  test('a file caught half written is not free until it stays broken; an odd one never is', async () => {
    const { free } = freeSlots(
      seen([
        [0, { peer: null, mtimeMs: NOW - 1000, isOdd: false }],
        [1, { peer: null, mtimeMs: NOW - STALE_MS - 1, isOdd: false }],
        [2, { peer: null, mtimeMs: 0, isOdd: true }],
      ]),
      self,
      NOW,
    )
    expect(free).not.toContain(0)
    expect(free).toContain(1)
    expect(free).not.toContain(2)
  })

  test('a slot set far ahead by a clock set back is free', async () => {
    const { free } = freeSlots(seen([[0, { peer: peer({ beatAt: NOW + 3_600_000 }), mtimeMs: NOW, isOdd: false }]]), self, NOW)
    expect(free).toContain(0)
  })

  test("this session's slot under an older copy is found to take back", async () => {
    const { own, free } = freeSlots(seen([[5, { peer: peer({ instance: 'old-me', sessionId: 's-me' }), mtimeMs: NOW, isOdd: false }]]), self, NOW)
    expect(own).toBe(5)
    expect(free).not.toContain(5)
  })

  test('a slot taken from this copy is one holding someone else, live', async () => {
    expect(isTakenFrom({ peer: peer(), mtimeMs: NOW, isOdd: false }, 'me', NOW)).toBe(true)
    expect(isTakenFrom({ peer: peer({ instance: 'me' }), mtimeMs: NOW, isOdd: false }, 'me', NOW)).toBe(false)
    expect(isTakenFrom({ peer: null, mtimeMs: NOW, isOdd: false }, 'me', NOW)).toBe(false)
    expect(isTakenFrom(undefined, 'me', NOW)).toBe(false)
  })
})

describe('the list', () => {
  test('a row names the project, its status and its kind of work, and the job under it', async () => {
    const [row] = peerRows([peer()], NOW)
    expect(row?.line).toBe('api-server · working · running a command')
    expect(row?.job).toBe('→ fix the login bug')
  })

  test('waiting and idle say for how long', async () => {
    const rows = peerRows(
      [
        peer({ sessionId: 'a', status: 'waiting', since: NOW - 3 * 60_000, doing: 'waiting on you' }),
        peer({ sessionId: 'b', status: 'idle', since: NOW - 125 * 60_000, doing: '', task: '' }),
      ],
      NOW,
    )
    expect(rows.map(r => r.line)).toEqual(['api-server · needs you 3m', 'api-server (2) · idle 2h 5m'])
    expect(rows[1]?.job).toBe('')
    expect(sinceWords(59_000)).toBe('')
    expect(sinceWords(60 * 60_000)).toBe('1h')
  })

  test('the heading counts the sessions and the ones waiting on you', async () => {
    expect(peersHeading([peer()])).toBe('Your other sessions (1)')
    expect(peersHeading([peer(), peer({ status: 'waiting' })])).toBe('Your other sessions (2, 1 needs you)')
    expect(peersHeading([peer({ status: 'waiting' }), peer({ status: 'waiting' })])).toBe('Your other sessions (2, 2 need you)')
  })

  test('only comings, goings and waits on you are urgent', async () => {
    const a = [peer()]
    expect(urgentOf(a)).toBe(urgentOf([peer({ doing: 'editing files', since: NOW })]))
    expect(shownOf(a)).not.toBe(shownOf([peer({ doing: 'editing files' })]))
    expect(urgentOf(a)).not.toBe(urgentOf([peer({ status: 'waiting' })]))
    expect(urgentOf(a)).not.toBe(urgentOf([]))
    const b = peer({ sessionId: 'b', instance: 'b' })
    expect(urgentOf([a[0]!, b])).toBe(urgentOf([b, a[0]!]))
  })
})

const hire = (id: string, type: string, name: string | null = null, at = NOW): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type,
  description: 'find the secret auth code',
  brief: 'Look in secret.ts',
  name,
  isTeammate: false,
  isBackground: false,
  isResume: false,
  at,
})
const its = (agentId: string, name: string, target: string, at = NOW + 10): OfficeEvent => ({
  kind: 'toolStarted',
  agentId,
  tool: name,
  target,
  detail: 'rm -rf the secret folder',
  callId: `c-${agentId}`,
  at,
})

describe('who is in the office, for looking in', () => {
  test('agents go by kind and role words, never by a name, a job or a file', async () => {
    const scene = play([turn('go'), hire('x1', 'Explore'), hire('x2', 'my-plugin:secret-reviewer'), hire('x3', 'general-purpose', 'secret-teammate'), its('x1', 'Read', 'secret.ts')])
    const agents = agentsOf(scene)
    expect(agents.map(a => a.id)).toEqual(['main', 'a1', 'a2', 'a3'])
    // A helper starting work changes what it does, not who is who.
    expect(agentsOf(play([turn('go'), hire('x1', 'Explore'), hire('x2', 'Plan')])).map(a => a.label)).toEqual(['Main', 'Researcher', 'Planner'])
    expect(agents[0]).toMatchObject({ id: 'main', boss: null, type: 'main', label: 'Main' })
    expect(agents.map(a => a.type).sort()).toEqual(['Explore', 'general-purpose', 'helper', 'main'])
    expect(agents.map(a => a.label).sort()).toEqual(['Assistant', 'Helper', 'Main', 'Researcher'])
    expect(agents.find(a => a.type === 'Explore')).toMatchObject({ boss: 'main', isBusy: true })
    const text = JSON.stringify(snapshotOf(scene, META, NOW))
    expect(text).not.toContain('secret')
    expect(text).not.toContain('x1')
  })

  test('a crowd is cut to the busiest few, and its snapshot stays well under the file limit', async () => {
    const events: OfficeEvent[] = [turn('go')]
    for (let i = 0; i < 40; i += 1) events.push(hire(`h${i}`, 'claude-code-guide', null, NOW + i))
    const snap = snapshotOf(play(events), META, NOW)
    expect(snap.agents).toHaveLength(PEER_AGENTS_MAX)
    expect(snap.agents[0]?.id).toBe('main')
    expect(JSON.stringify(snap).length).toBeLessThan(PEER_FILE_MAX * 0.75)
    expect(parsePeer(JSON.stringify(snap))?.agents).toEqual(snap.agents)
  })

  test('a snapshot from a copy without agents, or with anything off in them, shows an empty office', async () => {
    const { agents: _, ...old } = peer()
    expect(parsePeer(JSON.stringify(old))?.agents).toEqual([])
    const good: PeerAgent = { id: 'main', boss: null, type: 'main', label: 'Main', phase: 'working', station: 'desk', slot: 0, x: 85, y: 30, look: { shirt: '#185fa5', hair: '#2c2c2a', skin: '#f5c4b3' }, isBusy: true, isTeammate: false, isBackground: false }
    expect(parsePeer(JSON.stringify(peer({ agents: [good] })))?.agents).toEqual([good])
    const bad: unknown[] = [
      { ...good, x: 999 },
      { ...good, look: { ...good.look, shirt: 'url(#x)' } },
      { ...good, type: 'my-secret-agent' },
      { ...good, station: 'roof' },
      { ...good, phase: 'gone' },
      { ...good, id: '<script>' },
      { ...good, isBusy: 'yes' },
    ]
    for (const agent of bad) expect(parsePeer(JSON.stringify({ ...peer(), agents: [agent] }))?.agents).toEqual([])
    expect(parsePeer(JSON.stringify({ ...peer(), agents: [good, good] }))?.agents).toEqual([])
    // A label is cleaned like any other text from another copy.
    expect(parsePeer(JSON.stringify({ ...peer(), agents: [{ ...good, label: '\u001b[31mMain\u202e' }] }))?.agents[0]?.label).toBe('Main')
  })

  test("another session's office is drawn by the same code, with nothing but signs in its bubbles", async () => {
    const scene = play([turn('go'), hire('x1', 'Explore'), its('x1', 'Read', 'secret.ts'), its(MAIN, 'Bash', 'secret.sh')])
    const peerScene = officeOf(parsePeer(JSON.stringify(snapshotOf(scene, META, NOW)))!, NOW + 60_000)
    expect(Object.keys(peerScene.agents).sort()).toEqual(['a1', 'main'])
    expect(peerScene.agents.a1?.parentId).toBe(MAIN)
    const svg = renderOffice(peerScene, NOW + 60_000)
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('secret')
    // Nobody walks: each stands where it is headed.
    expect(svg).toContain('<g id="agent-a1" transform=')
    expect(svg).toContain('Researcher')
    expect(svg).toContain('Now: busy at Records library')
  })
})
