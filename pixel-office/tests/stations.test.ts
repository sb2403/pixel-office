import { describe, expect, test } from 'claude-code/testing'

import {
  CORRIDOR_Y,
  HEIGHT,
  STATIONS,
  STATION_ORDER,
  WIDTH,
  doorOf,
  pathLength,
  pointAlong,
  route,
  slotPoint,
  splitAt,
  stationFor,
  targetOf,
  todoCounts,
} from '../hooks/stations'

describe('stationFor', () => {
  test('maps tools to the zones the legend promises', async () => {
    expect(stationFor('Edit')).toBe('desk')
    expect(stationFor('Write')).toBe('desk')
    expect(stationFor('Read')).toBe('library')
    expect(stationFor('Grep')).toBe('library')
    expect(stationFor('Skill')).toBe('library')
    expect(stationFor('Bash')).toBe('server')
    expect(stationFor('PowerShell')).toBe('server')
    expect(stationFor('WebSearch')).toBe('phone')
    expect(stationFor('WebFetch')).toBe('phone')
    expect(stationFor('SendMessage')).toBe('meeting')
    expect(stationFor('AskUserQuestion')).toBe('reception')
    expect(stationFor('TodoWrite')).toBe('taskboard')
    expect(stationFor('mcp__ccd_turn__update_plan')).toBe('taskboard')
    expect(stationFor('mcp__github__create_issue')).toBe('mailroom')
    expect(stationFor('SomethingNew')).toBe('desk')
  })
})

describe('targetOf', () => {
  test('uses the file name of a path on either slash style', async () => {
    expect(targetOf('Read', { file_path: 'D:\\Claude\\x\\src\\auth.ts' })).toBe('auth.ts')
    expect(targetOf('Edit', { file_path: '/work/src/login.tsx' })).toBe('login.tsx')
  })

  test('flattens and clips long commands', async () => {
    const t = targetOf('Bash', { command: 'npm run build && npm test -- --watch=false' })
    expect(t).toBe('npm run build && npm te…')
    expect(t).toHaveLength(24)
    expect(targetOf('Bash', { command: 'echo a\n  echo b' })).toBe('echo a echo b')
  })

  test('reads patterns, queries, hosts and outside services', async () => {
    expect(targetOf('Grep', { pattern: 'login' })).toBe('login')
    expect(targetOf('WebSearch', { query: 'pixel art' })).toBe('pixel art')
    expect(targetOf('WebFetch', { url: 'https://docs.anthropic.com/en/x' })).toBe('docs.anthropic.com')
    expect(targetOf('mcp__github__create_issue', { title: 'Bug' })).toBe('github')
    expect(targetOf('Mystery', {})).toBe('')
  })
})

describe('todoCounts', () => {
  test('counts done and open items from todos or items', async () => {
    const list = [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }]
    expect(todoCounts({ todos: list })).toEqual({ done: 1, open: 2 })
    expect(todoCounts({ items: list })).toEqual({ done: 1, open: 2 })
    expect(todoCounts({ other: 1 })).toBeNull()
  })
})

describe('geometry', () => {
  test('every station has a name, tools, a color and at least one slot', async () => {
    for (const id of STATION_ORDER) {
      expect(STATIONS[id].name.length).toBeGreaterThan(0)
      expect(STATIONS[id].tools.length).toBeGreaterThan(0)
      expect(STATIONS[id].slots.length).toBeGreaterThan(0)
    }
  })

  test('slots past the last one form a queue inside the floor', async () => {
    const first = slotPoint('elevator', 0)
    const queued = slotPoint('elevator', 3)
    expect(queued).not.toEqual(first)
    expect(queued.x).toBeGreaterThanOrEqual(4)
    expect(queued.x).toBeLessThanOrEqual(WIDTH - 4)
    expect(queued.y).toBeLessThanOrEqual(HEIGHT - 2)
  })

  test('routes run along the corridor in straight lines', async () => {
    const from = slotPoint('desk', 0)
    const to = slotPoint('server', 0)
    const pts = route(from, doorOf('desk', 0), to, doorOf('server', 0))
    expect(pts[0]).toEqual(from)
    expect(pts[pts.length - 1]).toEqual(to)
    expect(pts.some(p => p.y === CORRIDOR_Y)).toBe(true)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  test('splitAt and pointAlong walk a path by fraction', async () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(pathLength(line)).toBe(10)
    expect(splitAt(line, 0.5)).toEqual([{ x: 5, y: 0 }, { x: 10, y: 0 }])
    expect(pointAlong(line, 1)).toEqual({ x: 10, y: 0 })
    expect(pointAlong(line, 0)).toEqual({ x: 0, y: 0 })
  })
})
