import { expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce } from '../hooks/model'
import { doing, narrate } from '../hooks/narrate'
import type { OfficeEvent } from '../types'

const started = (tool: string, target: string, agentId = 'main', detail = '') =>
  ({ kind: 'toolStarted', agentId, tool, target, detail, callId: 'c', at: 1 }) as const

const hire = (extra: Partial<Extract<OfficeEvent, { kind: 'spawned' }>> = {}): OfficeEvent => ({
  kind: 'spawned',
  id: 'a1',
  parentId: MAIN,
  type: 'Explore',
  description: 'find auth code',
  brief: '',
  name: null,
  isTeammate: false,
  isBackground: false,
  at: 1,
  ...extra,
})

test('tool lines read as plain English', async () => {
  const s = emptyScene()
  expect(narrate(s, started('Read', 'auth.ts'))).toBe('Main is reading auth.ts')
  expect(narrate(s, started('Edit', 'login.tsx'))).toBe('Main is editing login.tsx')
  expect(narrate(s, started('Grep', 'login'))).toBe('Main is searching the files for login')
  expect(narrate(s, started('Glob', '*.ts'))).toBe('Main is looking for files named *.ts')
  expect(narrate(s, started('Bash', 'npm test'))).toBe('Main is running a command: npm test')
  expect(narrate(s, started('WebSearch', 'pixel art'))).toBe('Main is searching the web for pixel art')
  expect(narrate(s, started('WebFetch', 'example.com'))).toBe('Main is reading a web page on example.com')
  expect(narrate(s, started('Skill', 'commit'))).toBe('Main is reading the commit manual')
  expect(narrate(s, started('ToolSearch', 'slack'))).toBe('Main is looking up which tools it can use')
  expect(narrate(s, started('AskUserQuestion', ''))).toBe('Main is waiting for you to answer a question')
  expect(narrate(s, started('ExitPlanMode', ''))).toBe('Main is waiting for you to approve a plan')
  expect(narrate(s, started('mcp__ccd_turn__update_plan', ''))).toBe('Main is updating the task board')
  expect(narrate(s, started('mcp__github__create_issue', 'github'))).toBe('Main is using github to create issue')
  expect(narrate(s, started('Frobnicate', ''))).toBe('Main is using Frobnicate')
})

test("a command reads as what Claude said it is for, and a message as its summary", async () => {
  const s = emptyScene()
  expect(narrate(s, started('Bash', 'npm test', MAIN, 'Run the test suite'))).toBe('Main is running a command to run the test suite')
  expect(narrate(s, started('Bash', 'npm test', MAIN, 'Test the code'))).toBe('Main is running a command to test the code')
  expect(narrate(s, started('SendMessage', 'scout', MAIN, 'start on task 1'))).toBe('Main is messaging scout: start on task 1')
  expect(narrate(s, started('SendMessage', 'scout'))).toBe('Main is messaging scout')
  expect(doing({ tool: 'Bash', target: 'git push', detail: 'Upload the work' })).toBe('running a command to upload the work')
  expect(doing({ tool: 'Bash', target: 'npm ci', detail: 'NPM install from the lockfile' })).toBe(
    'running a command to NPM install from the lockfile',
  )
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
})

test('a permission prompt says what it is for, not which tool', async () => {
  const s = emptyScene()
  const asks = (tool: string) => narrate(s, { kind: 'waiting', agentId: 'main', tool, at: 1 })
  expect(asks('Bash')).toBe('Main needs your permission to run a command')
  expect(asks('Write')).toBe('Main needs your permission to change a file')
  expect(asks('WebFetch')).toBe('Main needs your permission to go on the web')
  expect(asks('mcp__github__create_issue')).toBe('Main needs your permission to use github')
  expect(asks('Frobnicate')).toBe('Main needs your permission to use Frobnicate')
})

test('a turn that ends leaves Main waiting for the next message', async () => {
  expect(narrate(emptyScene(), { kind: 'turnEnded', at: 1 })).toBe('Main finished and is waiting for your next message')
})

test('a turn without a typed prompt is a continuation', async () => {
  const s = emptyScene()
  expect(narrate(s, { kind: 'turnStarted', isContinuation: true, at: 1 })).toBe('Main picked up where it left off')
  expect(narrate(s, { kind: 'turnStarted', isContinuation: false, at: 1 })).toBe('You gave Main a new task')
})

test('a hire says whether the boss waits for the report, works alongside, or gains a teammate', async () => {
  const line = (extra: Partial<Extract<OfficeEvent, { kind: 'spawned' }>>) => {
    const ev = hire(extra)
    return narrate(reduce(emptyScene(), ev), ev)
  }
  expect(line({})).toBe('Main hired Researcher and is waiting for its report: find auth code')
  expect(line({ isBackground: true })).toBe('Main hired Researcher to work alongside it: find auth code')
  expect(line({ isTeammate: true, isBackground: true, name: 'scout' })).toBe('Main added Scout to the team: find auth code')
})

test('hand-backs say whether the report came, the run was stopped or it failed', async () => {
  const hired = reduce(emptyScene(), hire())
  const back = (reason: 'answer' | 'aborted' | 'refusal' | 'error', report = '') =>
    narrate(hired, { kind: 'handedBack', agentId: 'a1', reason, report, at: 2 })
  expect(back('answer')).toBe('Researcher handed its report to Main and left')
  expect(back('answer', 'The login flow starts in auth.ts')).toBe(
    'Researcher handed its report to Main and left: The login flow starts in auth.ts',
  )
  expect(back('aborted', 'half done')).toBe('Researcher was stopped and left')
  expect(back('error')).toBe('Researcher ran into a problem, told Main and left')
  expect(back('refusal', 'I cannot do that')).toBe('Researcher ran into a problem, told Main and left: I cannot do that')
})

test('a long report is cut short in the feed', async () => {
  const hired = reduce(emptyScene(), hire())
  const line = narrate(hired, { kind: 'handedBack', agentId: 'a1', reason: 'answer', report: 'x'.repeat(300), at: 2 })
  expect(line?.endsWith('…')).toBe(true)
  expect(line!.length).toBeLessThan(120)
})

test('a teammate that is stopped still takes a break', async () => {
  const hired = reduce(emptyScene(), hire({ id: 't1', name: 'scout', isTeammate: true, isBackground: true }))
  const back = (reason: 'answer' | 'aborted') => narrate(hired, { kind: 'handedBack', agentId: 't1', reason, report: '', at: 2 })
  expect(back('answer')).toBe('Scout reported to Main and took a break')
  expect(back('aborted')).toBe('Scout was stopped and took a break')
})
