import { expect, test } from 'claude-code/testing'

import { emptyScene } from '../hooks/model'
import { narrate } from '../hooks/narrate'

const started = (tool: string, target: string, agentId = 'main') =>
  ({ kind: 'toolStarted', agentId, tool, target, callId: 'c', at: 1 }) as const

test('tool lines read as plain English', async () => {
  const s = emptyScene()
  expect(narrate(s, started('Read', 'auth.ts'))).toBe('Main is reading auth.ts')
  expect(narrate(s, started('Edit', 'login.tsx'))).toBe('Main is editing login.tsx')
  expect(narrate(s, started('Grep', 'login'))).toBe('Main searched files for login')
  expect(narrate(s, started('Bash', 'npm test'))).toBe('Main ran a command: npm test')
  expect(narrate(s, started('WebSearch', 'pixel art'))).toBe('Main searched the web for pixel art')
  expect(narrate(s, started('Skill', 'commit'))).toBe('Main pulled the commit manual')
  expect(narrate(s, started('AskUserQuestion', ''))).toBe('Main is waiting on you with a question')
  expect(narrate(s, started('mcp__ccd_turn__update_plan', ''))).toBe('Main updated the task board')
  expect(narrate(s, started('mcp__github__create_issue', 'github'))).toBe('Main called an outside service: github')
  expect(narrate(s, started('Frobnicate', ''))).toBe('Main used Frobnicate')
})

test('unknown agents are named generically', async () => {
  expect(narrate(emptyScene(), started('Read', 'x', 'zz'))).toBe('An agent is reading x')
})

test('quiet events have no line', async () => {
  const s = emptyScene()
  expect(narrate(s, { kind: 'toolEnded', agentId: 'main', callId: 'c', isError: false, at: 1 })).toBeNull()
  expect(narrate(s, { kind: 'tick', at: 1 })).toBeNull()
  expect(narrate(s, { kind: 'todos', done: 1, open: 1, at: 1 })).toBeNull()
  expect(narrate(s, { kind: 'toolEnded', agentId: 'main', callId: 'c', isError: true, at: 1 })).toBe('Main hit an error')
  expect(narrate(s, { kind: 'turnStarted', at: 1 })).toBe('You gave Main a new task')
  expect(narrate(s, { kind: 'waiting', agentId: 'main', tool: 'Bash', at: 1 })).toBe('Main needs your permission to use Bash')
})
