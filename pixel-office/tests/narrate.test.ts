import { expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce } from '../hooks/model'
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
  expect(narrate(s, { kind: 'turnStarted', isContinuation: false, at: 1 })).toBe('You gave Main a new task')
  expect(narrate(s, { kind: 'waiting', agentId: 'main', tool: 'Bash', at: 1 })).toBe('Main needs your permission to use Bash')
})

test('a turn that ends leaves Main waiting for the next message', async () => {
  expect(narrate(emptyScene(), { kind: 'turnEnded', at: 1 })).toBe('Main finished and is waiting for your next message')
})

test('a turn without a typed prompt is a continuation', async () => {
  const s = emptyScene()
  expect(narrate(s, { kind: 'turnStarted', isContinuation: true, at: 1 })).toBe('Main picked up where it left off')
  expect(narrate(s, { kind: 'turnStarted', isContinuation: false, at: 1 })).toBe('You gave Main a new task')
})

test('hand-backs say whether the report came, the run was stopped or it failed', async () => {
  const hired = reduce(emptyScene(), {
    kind: 'spawned',
    id: 'a1',
    parentId: MAIN,
    type: 'Explore',
    description: 'find auth code',
    name: null,
    isTeammate: false,
    at: 1,
  })
  const back = (reason: 'answer' | 'aborted' | 'refusal' | 'error') =>
    narrate(hired, { kind: 'handedBack', agentId: 'a1', reason, at: 2 })
  expect(back('answer')).toBe('Explore handed its report to Main and left')
  expect(back('aborted')).toBe('Explore was stopped and left')
  expect(back('error')).toBe('Explore ran into a problem, reported to Main and left')
  expect(back('refusal')).toBe('Explore ran into a problem, reported to Main and left')
})

test('a teammate that is stopped still takes a break', async () => {
  const hired = reduce(emptyScene(), {
    kind: 'spawned',
    id: 't1',
    parentId: MAIN,
    type: 'Explore',
    description: 'scout around',
    name: 'scout',
    isTeammate: true,
    at: 1,
  })
  const back = (reason: 'answer' | 'aborted') => narrate(hired, { kind: 'handedBack', agentId: 't1', reason, at: 2 })
  expect(back('answer')).toBe('scout reported to Main and took a break')
  expect(back('aborted')).toBe('scout was stopped and took a break')
})
