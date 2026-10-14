import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Scene } from '../types'

const SCENE = { plugin: 'pixel-office', key: 'scene' } as const
const CLOCK = { plugin: 'pixel-office', key: 'clock' } as const
const PANE_PROPS = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const FLUSH = 1100

function world(on: On, options: { isCommandBroken?: boolean } = {}) {
  const clock = mock.clock(on, { now: new Date(2026, 9, 14, 12, 0).getTime() })
  mock.store(on)
  const opened: string[] = []
  let latest: Scene | undefined
  const clockWrites: number[] = []
  // The test's `$` has no `state` noun, so the scene is read from what the plugin writes.
  on('state.set', SCENE, ($, e, next) => {
    latest = e.value
    return next(e)
  })
  // The job clock is the same: the writes are all there is to see of it.
  on('state.set', CLOCK, ($, e, next) => {
    clockWrites.push(e.value)
    return next(e)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    if (options.isCommandBroken === true) throw new Error('command registry is down')
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('tool.call', ($, e) => (String(e.tool) === 'Bash' ? { deny: 'not allowed' } : { result: `ran ${String(e.tool)}`, text: 'ok' }))
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'agent-1' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  return { clock, opened, scene: () => latest, clockWrites }
}

const ticker = (scene: Scene | undefined): string[] => scene?.ticker.map(line => line.text) ?? []
const QUESTION = {
  tool: 'AskUserQuestion' as const,
  tool_use_id: 'tu-q',
  questions: [
    {
      question: 'Which one?',
      header: 'Pick',
      options: [
        { label: 'A', description: 'The first' },
        { label: 'B', description: 'The second' },
      ],
      multiSelect: false,
    },
  ],
}

const SPAWN = {
  tool_use_id: 'tu-spawn',
  prompt: 'find auth code',
  description: 'find auth code',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' } as never,
  parentModel: 'test-model',
  background: false,
  fork: false,
}

test('a Read call shows in the ticker and passes through unchanged', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Read', tool_use_id: 'tu-1', file_path: '/work/src/auth.ts' })
  expect(ran).toEqual({ result: 'ran Read', text: 'ok' })
  await clock.advance(FLUSH)
  const value = scene()
  expect(value?.ticker.map(line => line.text)).toContain('Main is reading auth.ts')
})

test('the office keeps working when the command cannot be registered', async ($, on) => {
  const { clock, scene } = world(on, { isCommandBroken: true })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', tool_use_id: 'tu-1', file_path: '/work/src/auth.ts' })
  await clock.advance(FLUSH)
  expect(scene()?.ticker.map(line => line.text)).toContain('Main is reading auth.ts')
})

test('a denied call passes through unchanged', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-2', command: 'rm -rf build' })
  expect(ran).toEqual({ deny: 'not allowed' })
  await clock.advance(FLUSH)
  const value = scene()
  expect(value?.agents.main?.lastErrorAt).toBeNull()
})

test('a spawned subagent opens the office and appears in the drawing', async ($, on) => {
  const { clock, opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  expect(opened).toContain('pixel-office')
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('id="agent-agent-1"')
  expect(await ui.find({ type: 'Text', text: /Main hired Explore: find auth code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore · working · Meeting room/ })).toBeDefined()
})

test('a spawn returns before the pane opens', async ($, on) => {
  const { clock, opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  expect(opened).toEqual([])
  await clock.advance(FLUSH)
  expect(opened).toContain('pixel-office')
})

test('opening at session start waits for the first flush', { options: { autoOpen: 'session-start' } }, async ($, on) => {
  const { clock, opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])
  await clock.advance(FLUSH)
  expect(opened).toEqual(['pixel-office'])
})

test('never opening on its own means no pane without the command', { options: { autoOpen: 'never' } }, async ($, on) => {
  const { clock, opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  expect(opened).toEqual([])
})

test('a subagent works, hands back and leaves', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  // The declarations document `agentId` riding along on `tool.call` but leave it out of the input
  // type, so the call goes through a variable, which skips the object literal's excess-property check.
  const fromSubagent = { tool: 'Grep', tool_use_id: 'tu-3', pattern: 'login', agentId: 'agent-1' } as const
  await $.tool.call(fromSubagent)
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer' })
  await clock.advance(FLUSH)
  const value = scene()
  const lines = value?.ticker.map(line => line.text) ?? []
  expect(lines).toContain('Explore searched files for login')
  expect(lines).toContain('Explore handed its report to Main and left')
  expect(value?.agents['agent-1']?.phase).toBe('gone')
})

test('a permission prompt sends Main to reception', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(FLUSH)
  const value = scene()
  expect(value?.agents.main?.phase).toBe('waiting')
  expect(value?.agents.main?.station).toBe('reception')
})

test('a question is announced once, not again as a permission request', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call(QUESTION)
  await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: {} })
  await clock.advance(FLUSH)
  const lines = ticker(scene())
  expect(lines.filter(line => /waiting on you/.test(line))).toHaveLength(1)
  expect(lines.some(line => /permission/.test(line))).toBe(false)
})

test('a permission request for any other tool still says so', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(FLUSH)
  expect(ticker(scene())).toContain('Main needs your permission to use Bash')
})

test('Main is idle between turns and works during them', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix the login bug', turnId: 'turn-1' })
  await clock.advance(FLUSH)
  expect(scene()?.agents.main?.phase).toBe('working')
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(FLUSH)
  expect(scene()?.agents.main?.phase).toBe('idle')
  expect(scene()?.agents.main?.station).toBe('office')
  expect(ticker(scene())).toContain('Main finished and is waiting for your next message')
})

test('a turn that carries on without a prompt is a continuation', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix the login bug', turnId: 'turn-1' })
  await $.turn.start({ text: '', turnId: 'turn-2' })
  await clock.advance(FLUSH)
  expect(ticker(scene())).toEqual(['You gave Main a new task', 'Main picked up where it left off'])
})

test('a stopped subagent is not reported as having handed in a report', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 'turn-1', agentId: 'agent-1', reason: 'aborted' })
  await clock.advance(FLUSH)
  expect(ticker(scene())).toContain('Explore was stopped and left')
})

test('the office command opens the pane', async ($, on) => {
  const { opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({
    command: 'office',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toBe('Office opened.')
  expect(opened).toContain('pixel-office')
})

test('the legend opens and closes', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await ui.find({ type: 'Text', text: /Records library: Read/ })).toBeUndefined()
  await ui.press({ key: 'legend' })
  expect(await ui.find({ type: 'Text', text: /Records library: Read/ })).toBeDefined()
})

test('pressing an agent in the org chart shows and hides its details', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await ui.find({ type: 'Text', text: /^Task: find auth code$/ })).toBeUndefined()
  await ui.press({ key: 'agent-agent-1' })
  expect(await ui.find({ type: 'Text', text: /^Task: find auth code$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reports to: Main$/ })).toBeDefined()
  await ui.press({ key: 'agent-agent-1' })
  expect(await ui.find({ type: 'Text', text: /^Task: find auth code$/ })).toBeUndefined()
})

test('the time on the job of a selected agent keeps counting', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-agent-1' })
  const before = await ui.find({ type: 'Text', text: /^On the job:/ })
  expect(before).toBeDefined()
  await clock.advance(3000)
  const after = await ui.find({ type: 'Text', text: /^On the job:/ })
  expect(after).toBeDefined()
  expect(after?.text).not.toBe(before?.text)
})

test('with nothing selected the job clock is never written', async ($, on) => {
  const { clock, clockWrites } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(5000)
  expect(clockWrites).toEqual([])
})

test('the job clock is written through state while an agent is selected, and stops when it is not', async ($, on) => {
  const { clock, clockWrites } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-agent-1' })
  const beforeSelected = clockWrites.length
  await clock.advance(3000)
  expect(clockWrites.length - beforeSelected).toBeGreaterThanOrEqual(2)
  await ui.press({ key: 'agent-agent-1' })
  const afterDeselected = clockWrites.length
  await clock.advance(3000)
  expect(clockWrites.length).toBe(afterDeselected)
})

test('every helper shows its objective under its name, on both surfaces', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const desktop = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await desktop.find({ type: 'Text', text: /↳ find auth code/ })).toBeDefined()
  expect(await desktop.findAll({ type: 'Text', text: /↳/ })).toHaveLength(1)
  const terminal = await $.ui.mount({ plugin: 'pixel-office', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await terminal.find({ type: 'Text', text: /↳ find auth code/ })).toBeDefined()
  expect(await terminal.findAll({ type: 'Text', text: /↳/ })).toHaveLength(1)
})

test('a long objective is clipped to its column', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, description: 'find every place the login flow stores or reads a session token' })
  await clock.advance(FLUSH)
  const narrow = { ...PANE_PROPS, bodyColumns: 40 }
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: narrow, requestId: 'pixel-office' })
  const line = await ui.find({ type: 'Text', text: /↳/ })
  // The column is 24 wide at this size: two for the indent, two for the arrow, the rest for words.
  expect(line?.text.length).toBeLessThanOrEqual(24)
  expect(line?.text).toContain('…')
})

test('the office is drawn as an image, not an interactive frame', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.isInteractive).toBeUndefined()
})

test('the terminal gets a text office', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await ui.find({ type: 'Text', text: /desktop app/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Main: idle, Corner office/ })).toBeDefined()
})
