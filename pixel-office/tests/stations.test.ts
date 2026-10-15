import { describe, expect, test } from 'claude-code/testing'

import {
  CORRIDOR_Y,
  HEIGHT,
  STATIONS,
  STATION_ORDER,
  WIDTH,
  clip,
  detailOf,
  doorOf,
  explainCommand,
  fullText,
  gist,
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

  test('drops control characters from what it shows', async () => {
    expect(targetOf('Bash', { command: 'echo \x1b[31mred\x1b[0m\x07' })).toBe('echo [31mred[0m')
    expect(targetOf('Read', { file_path: '/work/\x00odd\x7f.ts' })).toBe('odd.ts')
  })
})

describe('clip', () => {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

  test('cuts by whole characters, never through a surrogate pair', async () => {
    const out = clip('😀'.repeat(30), 24)
    expect(out).toBe(`${'😀'.repeat(23)}…`)
    expect(Array.from(out)).toHaveLength(24)
    expect(LONE_SURROGATE.test(out)).toBe(false)
  })

  test('counts a whole emoji as one character against the limit', async () => {
    expect(clip('😀'.repeat(24), 24)).toBe('😀'.repeat(24))
    expect(clip('ab😀cd', 5)).toBe('ab😀cd')
    expect(clip('ab😀cde', 5)).toBe('ab😀c…')
  })

  test('drops lone surrogates and the two non-characters', async () => {
    expect(clip('a\uD800b\uDC00c\uFFFEd\uFFFFe')).toBe('abcde')
    expect(clip('hi \uD83D')).toBe('hi')
    expect(clip('a😀b')).toBe('a😀b')
  })
})

describe('plain-English details', () => {
  test('a command uses the description Claude gave it', async () => {
    expect(detailOf('Bash', { command: 'npm test', description: 'Run the test suite' })).toBe('Run the test suite')
    expect(detailOf('PowerShell', { command: 'dir', description: '  List   the files\n' })).toBe('List the files')
  })

  test('a command Claude did not describe falls back to what it is commonly for', async () => {
    expect(detailOf('Bash', { command: 'npm test' })).toBe('Test the code')
    expect(detailOf('Bash', { command: 'ls -la' })).toBe('Look through folders')
    expect(detailOf('Bash', { command: 'some-tool --flag' })).toBe('')
  })

  test('the explainer reads past cd, settings, sudo and npx to the first real step', async () => {
    expect(explainCommand('cd /work/app && npm run build')).toBe('Build the project')
    expect(explainCommand('CI=1 NODE_ENV=test npx jest auth')).toBe('Test the code')
    expect(explainCommand('sudo pip install requests')).toBe('Install packages')
    expect(explainCommand('git status && git diff')).toBe('See what has changed')
    expect(explainCommand('git commit -m "wip"')).toBe('Save a checkpoint of the work')
    expect(explainCommand('git push -u origin main')).toBe('Upload the work')
    expect(explainCommand('cat log.txt | tail -5')).toBe('Show a file')
    expect(explainCommand('makefile-lint')).toBe('')
    expect(explainCommand('')).toBe('')
  })

  test('a message reads as its summary, else its first line', async () => {
    expect(detailOf('SendMessage', { to: 'scout', summary: 'assign task 1', message: 'start on task #1' })).toBe('assign task 1')
    expect(detailOf('SendMessage', { to: 'scout', message: 'Found the bug\nIt is in auth.ts' })).toBe('Found the bug')
  })

  test('other tools have no detail', async () => {
    expect(detailOf('Read', { file_path: '/a/b.ts', description: 'not used' })).toBe('')
  })

  test('a text kept in full keeps its lines and loses only what Markdown cannot take', async () => {
    expect(fullText('## Found it\r\n\r\n\r\n\r\n- auth.ts\n- session.ts\x07\x1b', 100)).toBe('## Found it\n\n- auth.ts\n- session.ts')
    expect(fullText('a\tb', 10)).toBe('a\tb')
    expect(fullText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(Array.from(fullText('😀'.repeat(20), 5))).toHaveLength(5)
  })

  test('gist drops Markdown marks and fits the text on one line', async () => {
    expect(gist('## Summary\n**Found** the `login` code', 80)).toBe('Summary Found the login code')
    expect(gist('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`)
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
