import type { FsEntry, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PEER_SCHEMA, POLL_MS, STALE_MS, parsePeer, slotName } from '../hooks/peers'
import type { PeerSession } from '../types'

// The other sessions on this computer, end to end: the plugin runs against a folder kept in memory, and the other
// sessions are files the test puts there, as another copy of the office would.
const DIR = '/home/me/.claude/pixel-office/sessions'
const ON = { options: { otherSessions: 'on' } }
const PANE_PROPS = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
// A poll and a little more, in flushes.
const LOOK = POLL_MS + 400

type File = { text: string; mtimeMs: number; kind?: FsEntry['kind']; isLink?: boolean }

function world(on: On, files: Record<string, File> = {}, { isListBroken = false, hangs = (_path: string): boolean => false } = {}) {
  const clock = mock.clock(on, { now: new Date(2026, 9, 16, 12, 0).getTime() })
  mock.env(on, { HOME: '/home/me' })
  const fs = new Map<string, File>(Object.entries(files).map(([name, file]) => [`${DIR}/${name}`, file]))
  const writes: { path: string; text: string }[] = []
  let sessionId = 's-me'
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    fs.set(e.path, { text: e.text, mtimeMs: clock.now() })
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    if (hangs(e.path)) return new Promise<never>(() => {})
    const file = fs.get(e.path)
    return file === undefined ? { deny: 'ENOENT' } : { value: file.text }
  })
  on('fs.list', ($, e) => {
    if (isListBroken) return { deny: 'EACCES' }
    const inside = [...fs.entries()].filter(([path]) => path.startsWith(`${e.path}/`))
    if (inside.length === 0) return { deny: 'ENOENT' }
    return {
      value: inside.map(([path, file]) => ({
        name: path.slice(e.path.length + 1),
        kind: file.kind ?? 'file',
        size: file.text.length,
        mtimeMs: file.mtimeMs,
        isLink: file.isLink ?? false,
      })),
    }
  })
  // A folder that cannot be listed is there all the same.
  on('fs.exists', ($, e) => ({ value: isListBroken || [...fs.keys()].some(path => path === e.path || path.startsWith(`${e.path}/`)) }))
  on('session.id', () => ({ value: sessionId }))
  on('session.root', () => ({ value: '/home/me/code/pixel-office' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const mine = (): { slot: string; peer: PeerSession | null }[] =>
    [...fs.entries()]
      .map(([path, file]) => ({ slot: path.slice(DIR.length + 1), peer: parsePeer(file.text) }))
      .filter(found => found.peer?.instance !== undefined && found.peer.sessionId === sessionId)
  return {
    clock,
    fs,
    writes,
    toasts,
    mine,
    put: (name: string, file: File) => fs.set(`${DIR}/${name}`, file),
    setSessionId: (id: string) => {
      sessionId = id
    },
  }
}

const other = (now: number, extra: Partial<PeerSession> = {}): string =>
  JSON.stringify({
    v: PEER_SCHEMA,
    instance: 'other',
    sessionId: 's-other',
    beatAt: now,
    startedAt: now - 60_000,
    endedAt: null,
    project: 'api-server',
    status: 'working',
    since: now - 5000,
    doing: 'running a command',
    task: 'fix the login bug',
    needsYou: 0,
    agents: [],
    ...extra,
  } satisfies PeerSession)

const start = ($: Engine) =>
  $.session.start({ cwd: '/home/me/code/pixel-office', surface: 'desktop', isInteractive: true })

const mount = ($: Engine, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: 'pixel-office', surface, component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })

test('by default nothing is written to or read from the shared folder', async ($, on) => {
  const { clock, writes, put } = world(on)
  put(slotName(0), { text: other(clock.now()), mtimeMs: clock.now() })
  await start($)
  await clock.advance(LOOK * 3)
  expect(writes.filter(w => w.path.startsWith(DIR))).toHaveLength(0)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Your other sessions/ })).toBeUndefined()
})

test('with it on, the session claims a slot and writes what it is doing, and nothing more', ON, async ($, on) => {
  const { clock, mine } = world(on)
  await start($)
  await $.tool.call({ tool: 'Read', tool_use_id: 'tu-1', file_path: '/home/me/code/pixel-office/secret-plans.md' })
  await clock.advance(LOOK * 2)
  const claimed = mine()
  expect(claimed).toHaveLength(1)
  expect(claimed[0]?.slot).toMatch(/^slot-\d\d\.json$/)
  const snap = claimed[0]?.peer
  expect(snap?.project).toBe('pixel-office')
  expect(['', 'reading and searching']).toContain(snap?.doing)
  expect(JSON.stringify(snap)).not.toContain('secret')
  expect(JSON.stringify(snap)).not.toContain('/home/me')
})

test('nothing changed means a heartbeat now and then, not a write every look', ON, async ($, on) => {
  const { clock, writes } = world(on)
  await start($)
  await clock.advance(LOOK)
  const first = writes.length
  await clock.advance(POLL_MS * 2)
  expect(writes.length).toBe(first)
  await clock.advance(POLL_MS * 3)
  expect(writes.length).toBeGreaterThan(first)
})

test('another live session shows in the pane, and a stale or ended one does not', ON, async ($, on) => {
  const { clock, put } = world(on)
  const now = clock.now()
  put(slotName(4), { text: other(now), mtimeMs: now })
  put(slotName(5), { text: other(now, { instance: 'old', sessionId: 's-old', project: 'old-thing', beatAt: now - STALE_MS * 2 }), mtimeMs: now })
  put(slotName(6), { text: other(now, { instance: 'done', sessionId: 's-done', project: 'done-thing', endedAt: now }), mtimeMs: now })
  put('notes.txt', { text: 'hello', mtimeMs: now })
  await start($)
  await clock.advance(LOOK)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^Your other sessions \(1\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /api-server · working · running a command/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /→ fix the login bug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /old-thing|done-thing/ })).toBeUndefined()
  const text = await mount($, 'terminal')
  expect(await text.find({ type: 'Text', text: /api-server · working/ })).toBeDefined()
})

test('a session that stops beating leaves the list', ON, async ($, on) => {
  const { clock, put } = world(on)
  put(slotName(4), { text: other(clock.now()), mtimeMs: clock.now() })
  await start($)
  await clock.advance(LOOK)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /api-server/ })).toBeDefined()
  await ui.unmount()
  await clock.advance(STALE_MS + LOOK)
  expect(await (await mount($)).find({ type: 'Text', text: /api-server/ })).toBeUndefined()
})

test('a live slot is never taken, and a slot taken from under this copy makes it move', ON, async ($, on) => {
  const { clock, put, mine } = world(on)
  // Every slot but one is held by someone live: the session must take that one.
  const now = clock.now()
  for (let slot = 0; slot < 32; slot += 1) {
    if (slot !== 17) put(slotName(slot), { text: other(now, { instance: `o${slot}`, sessionId: `s${slot}` }), mtimeMs: now })
  }
  await start($)
  await clock.advance(LOOK)
  expect(mine().map(m => m.slot)).toEqual([slotName(17)])
  // Someone else lands in slot 17, and slot 3 frees up: this copy moves there and leaves 17 alone.
  const later = clock.now()
  put(slotName(17), { text: other(later, { instance: 'intruder', sessionId: 's-intruder' }), mtimeMs: later })
  put(slotName(3), { text: other(later, { instance: 'o3', sessionId: 's3', endedAt: later }), mtimeMs: later })
  // Keep the others live meanwhile.
  for (let slot = 0; slot < 32; slot += 1) {
    if (slot !== 17 && slot !== 3) put(slotName(slot), { text: other(later, { instance: `o${slot}`, sessionId: `s${slot}` }), mtimeMs: later })
  }
  await clock.advance(LOOK)
  expect(mine().map(m => m.slot)).toEqual([slotName(3)])
})

test('with every slot held the session reads but writes nothing', ON, async ($, on) => {
  const { clock, put, writes } = world(on)
  const now = clock.now()
  for (let slot = 0; slot < 32; slot += 1) put(slotName(slot), { text: other(now, { instance: `o${slot}`, sessionId: `s${slot}` }), mtimeMs: now })
  await start($)
  await clock.advance(LOOK)
  expect(writes.filter(w => w.path.startsWith(DIR))).toHaveLength(0)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Your other sessions \(32\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+26 more/ })).toBeDefined()
})

test('a link, a folder or a big file in a slot is never read, written or taken', ON, async ($, on) => {
  const { clock, put, writes } = world(on)
  const now = clock.now()
  for (let slot = 0; slot < 32; slot += 1) {
    const file: File =
      slot === 0
        ? { text: '', mtimeMs: 0, kind: 'other', isLink: true }
        : slot === 1
          ? { text: '', mtimeMs: 0, kind: 'dir' }
          : slot === 2
            ? { text: 'x'.repeat(9000), mtimeMs: 0 }
            : { text: other(now, { instance: `o${slot}`, sessionId: `s${slot}` }), mtimeMs: now }
    put(slotName(slot), file)
  }
  await start($)
  await clock.advance(LOOK)
  expect(writes.filter(w => w.path.startsWith(DIR))).toHaveLength(0)
})

test('the end of the session frees its slot; a /clear keeps it under the new id', ON, async ($, on) => {
  const { clock, mine, setSessionId, fs } = world(on)
  await start($)
  await clock.advance(LOOK)
  const [claimed] = mine()
  expect(claimed).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's-me', resume: { id: 's-me' } })
  setSessionId('s-new')
  await clock.advance(LOOK * 3)
  expect(mine().map(m => m.slot)).toEqual([claimed!.slot])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-new', resume: { id: 's-new' } })
  const after = parsePeer(fs.get(`${DIR}/${claimed!.slot}`)!.text)
  expect(after?.endedAt).not.toBeNull()
  expect(after?.task).toBe('')
  // Nothing is written after the tombstone, though the timer still runs until the process goes.
  await clock.advance(LOOK * 4)
  expect(parsePeer(fs.get(`${DIR}/${claimed!.slot}`)!.text)?.endedAt).not.toBeNull()
})

test('a hot reload takes back the slot its older copy held', ON, async ($, on) => {
  const { clock, put, mine } = world(on)
  const now = clock.now()
  put(slotName(9), { text: other(now, { instance: 'older-copy', sessionId: 's-me', project: 'pixel-office' }), mtimeMs: now })
  await start($)
  await clock.advance(LOOK)
  expect(mine().map(m => m.slot)).toEqual([slotName(9)])
  expect(mine()[0]?.peer?.instance).not.toBe('older-copy')
  // Its own older copy is not shown as another session meanwhile.
  expect(await (await mount($)).find({ type: 'Text', text: /Your other sessions/ })).toBeUndefined()
})

test('a session waiting on you comes first and, with reminders on, is said once as a toast', { options: { otherSessions: 'on', notify: 'after-30s' } }, async ($, on) => {
  const { clock, put, toasts } = world(on)
  const now = clock.now()
  const beat = (at: number) => {
    put(slotName(1), { text: other(at), mtimeMs: at })
    put(slotName(2), { text: other(at, { instance: 'w', sessionId: 's-w', project: 'website', status: 'waiting', since: now - 40_000, doing: 'waiting on you', needsYou: 1 }), mtimeMs: at })
  }
  beat(now)
  await start($)
  await clock.advance(LOOK)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Your other sessions \(2, 1 needs you\)/ })).toBeDefined()
  const rows = await ui.findAll({ type: 'Text', text: / · (working|needs you)/ })
  expect(rows.map(r => String(r.text))[0]).toMatch(/^website · needs you/)
  expect(toasts).toEqual(['In website, an agent is waiting on you'])
  for (let i = 0; i < 4; i += 1) {
    beat(clock.now())
    await clock.advance(LOOK)
  }
  expect(toasts).toHaveLength(1)
})

test('a change only in what another session is doing waits before it redraws the pane', ON, async ($, on) => {
  const { clock, put } = world(on)
  const now = clock.now()
  put(slotName(1), { text: other(now), mtimeMs: now })
  await start($)
  await clock.advance(LOOK)
  const later = clock.now()
  put(slotName(1), { text: other(later, { doing: 'editing files' }), mtimeMs: later })
  await clock.advance(LOOK)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /running a command/ })).toBeDefined()
  await ui.unmount()
  for (let i = 0; i < 5; i += 1) {
    put(slotName(1), { text: other(clock.now(), { doing: 'editing files' }), mtimeMs: clock.now() })
    await clock.advance(LOOK)
  }
  expect(await (await mount($)).find({ type: 'Text', text: /editing files/ })).toBeDefined()
})

test('a folder that cannot be read leaves the office as it was', ON, async ($, on) => {
  const { clock, writes } = world(on, {}, { isListBroken: true })
  await start($)
  await $.tool.call({ tool: 'Read', tool_use_id: 'tu-1', file_path: '/x/a.ts' })
  await clock.advance(LOOK)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Main is reading a\.ts/ })).toBeDefined()
  // Every slot would look free, so nothing is written into one that someone else may hold.
  expect(writes.filter(w => w.path.startsWith(DIR))).toHaveLength(0)
})

test('a session caught half way through a write stays in the list', ON, async ($, on) => {
  const { clock, put } = world(on)
  put(slotName(1), { text: other(clock.now()), mtimeMs: clock.now() })
  await start($)
  await clock.advance(LOOK)
  const whole = other(clock.now())
  put(slotName(1), { text: whole.slice(0, whole.length / 2), mtimeMs: clock.now() })
  await clock.advance(LOOK)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /api-server · working/ })).toBeDefined()
})

test('a file that never answers is let go, and the rest goes on', ON, async ($, on) => {
  let isHung = false
  const { clock, put, writes } = world(on, {}, { hangs: path => isHung && path.endsWith(slotName(7)) })
  const now = clock.now()
  put(slotName(7), { text: other(now), mtimeMs: now })
  put(slotName(8), { text: other(now, { instance: 'b', sessionId: 's-b', project: 'bee' }), mtimeMs: now })
  await start($)
  await clock.advance(LOOK)
  isHung = true
  put(slotName(7), { text: other(clock.now(), { doing: 'editing files' }), mtimeMs: clock.now() })
  const before = writes.length
  // Slot 8 stops beating: once the hung look is let go, later looks drop it, and this copy keeps beating.
  await clock.advance(STALE_MS * 3)
  expect(writes.length).toBeGreaterThan(before)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /bee/ })).toBeUndefined()
  await ui.unmount()
  // The end of the session does not wait on it either.
  const ended = $.session.end({ reason: 'prompt_input_exit', sessionId: 's-me', resume: { id: 's-me' } })
  await clock.advance(1000)
  await ended
})

const AGENT = { boss: null, type: 'main', label: 'Main', phase: 'working', station: 'desk', slot: 0, x: 85, y: 30, look: { shirt: '#185fa5', hair: '#2c2c2a', skin: '#f5c4b3' }, isBusy: true, isTeammate: false, isBackground: false } as const

test('pressing another session shows its office in the picture, and Back or its end brings this one back', ON, async ($, on) => {
  const { clock, put } = world(on)
  const now = clock.now()
  const agents = [
    { ...AGENT, id: 'main' },
    { ...AGENT, id: 'a1', boss: 'main', type: 'Explore', label: 'Researcher', station: 'library', x: 190, y: 20 },
  ]
  put(slotName(1), { text: other(now, { agents }), mtimeMs: now })
  await start($)
  await clock.advance(LOOK)
  const ui = await mount($)
  const picture = async () => (await ui.findAll({ type: 'Svg' }))[0]
  expect(String((await picture())?.props.alt)).not.toContain('Another session')
  expect(await ui.find({ type: 'Text', text: /Press one to look in/ })).toBeDefined()
  await ui.press({ key: 'look-s-other:other' })
  expect(String((await picture())?.props.alt)).toContain("Another session's office")
  expect(String((await picture())?.props.alt)).toContain('Researcher at Records library')
  expect(await ui.find({ type: 'Text', text: /^Looking in on api-server · working/ })).toBeDefined()
  // A new beat from that session moves its people without waiting for the list's calm window.
  const later = clock.now()
  put(slotName(1), { text: other(later, { agents: [agents[0]!, { ...agents[1]!, station: 'server', x: 200, y: 110 }] }), mtimeMs: later })
  await clock.advance(LOOK)
  expect(String((await picture())?.props.alt)).toContain('Researcher at Server room')
  await ui.press({ key: 'back' })
  expect(String((await picture())?.props.alt)).not.toContain('Another session')
  // Looked in on again, then the session ends: the picture goes back to this office.
  await ui.press({ key: 'look-s-other:other' })
  expect(String((await picture())?.props.alt)).toContain("Another session's office")
  const end = clock.now()
  put(slotName(1), { text: other(end, { endedAt: end }), mtimeMs: end })
  await clock.advance(LOOK)
  expect(String((await picture())?.props.alt)).not.toContain('Another session')
  expect(await ui.find({ type: 'Text', text: /^Looking in on/ })).toBeUndefined()
})
