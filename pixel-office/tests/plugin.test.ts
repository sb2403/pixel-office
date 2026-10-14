import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Scene } from '../types'

const SCENE = { plugin: 'pixel-office', key: 'scene' } as const
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
  // The test's `$` has no `state` noun, so the scene is read from what the plugin writes.
  on('state.set', SCENE, ($, e, next) => {
    latest = e.value
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
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  return { clock, opened, scene: () => latest }
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
