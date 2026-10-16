import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Scene } from '../types'

const SCENE = { plugin: 'pixel-office', key: 'scene' } as const
const CLOCK = { plugin: 'pixel-office', key: 'clock' } as const
const SELECTED = { plugin: 'pixel-office', key: 'selected' } as const
const PANE_PROPS = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const FLUSH = 1100

// The options object is read as the hooks run, so a test can break something part way through.
function world(on: On, options: { isCommandBroken?: boolean; isSceneBroken?: boolean; stored?: Record<string, unknown>; hiredId?: () => string } = {}) {
  const clock = mock.clock(on, { now: new Date(2026, 9, 14, 12, 0).getTime() })
  // The world keeps the plugin's store itself, as it answers its other calls, so a test can read what was kept.
  // Values go in and come out as JSON, as the engine's do.
  const stored: Record<string, unknown> = { ...options.stored }
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value)) as unknown
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete stored[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(stored) }))
  const toasts: string[] = []
  const notes: { text: string; title?: string }[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', ($, e) => {
    notes.push({ text: e.text, title: e.title })
    return { value: { isSent: true, channel: 'terminal_bell' } as never }
  })
  const opened: string[] = []
  let latest: Scene | undefined
  const clockWrites: number[] = []
  let latestSelected: string | null | undefined
  // The test's `$` has no `state` noun, so the scene is read from what the plugin writes.
  on('state.set', SCENE, ($, e, next) => {
    // A hook that throws is skipped by the engine, so a write that cannot land is a refusal that never gives way:
    // `update` retries it and then gives up.
    if (options.isSceneBroken === true) return { value: { isSet: false as const, version: 0 } }
    latest = e.value
    return next(e)
  })
  on('state.set', SELECTED, ($, e, next) => {
    latestSelected = e.value
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
  on('agent.spawn', () => ({ model: 'test-model', agentId: options.hiredId?.() ?? 'agent-1' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  return { clock, opened, scene: () => latest, selected: () => latestSelected, clockWrites, stored, toasts, notes }
}

const endSession = (reason: 'clear' | 'prompt_input_exit') => ({ reason, sessionId: 's-1', resume: { id: 's-1' } })

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
  prompt: '## Task\nFind where the **login** flow creates a session.',
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
  const pictures = await ui.findAll({ type: 'Svg' })
  // The default is layered: the scenery, then one transparent picture each for Main and the helper.
  expect(pictures).toHaveLength(3)
  expect(String(pictures[0]?.props.source)).not.toContain('<g id="agent-')
  expect(String(pictures[2]?.props.source)).toContain('id="agent-agent-1"')
  expect(await ui.find({ type: 'Text', text: /Main hired Researcher and is waiting for its report: find auth code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Main · coordinating · waiting on Researcher/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Researcher · working · being briefed/ })).toBeDefined()
})

test('with the single picture, everybody is drawn in one picture', { options: { picture: 'single' } }, async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  const pictures = await ui.findAll({ type: 'Svg' })
  expect(pictures).toHaveLength(1)
  expect(String(pictures[0]?.props.source)).toContain('id="agent-agent-1"')
  expect(String(pictures[0]?.props.source)).toContain('id="agent-main"')
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
  expect(lines).toEqual([
    'Main hired Researcher and is waiting for its report: find auth code',
    'Researcher is searching the files for login',
    'Researcher handed its report to Main and left: found it',
    'Main has every report back and is reviewing the results',
  ])
  expect(value?.agents['agent-1']?.phase).toBe('gone')
  expect(value?.agents['agent-1']?.report).toBe('found it')
  // The whole brief is kept as written; the details box shows it as one line.
  expect(value?.agents['agent-1']?.brief).toBe('## Task\nFind where the **login** flow creates a session.')
})

test('a helper that is called back after leaving comes back instead of being hired again', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer' })
  await clock.advance(FLUSH)
  expect(scene()?.agents['agent-1']?.phase).toBe('gone')
  await $.agent.spawn({ ...SPAWN, prompt: 'Now check session.ts too', resume: { agentId: 'agent-1' } })
  await clock.advance(FLUSH)
  expect(ticker(scene())).toContain('Main called Researcher back and is waiting for its report: find auth code')
  expect(scene()?.agents['agent-1']?.phase).toBe('briefing')
  expect(scene()?.agents['agent-1']?.brief).toBe('Now check session.ts too')
  expect(Object.keys(scene()?.agents ?? {})).toHaveLength(2)
})

test("a helper's tokens and model come from its hand-back", async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  const usage = { input_tokens: 2000, output_tokens: 1500, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 4000, model: 'claude-haiku-5-5' }
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer', usage })
  await clock.advance(FLUSH)
  expect(scene()?.agents['agent-1']?.usage).toEqual({ tokens: 37_500, reused: 30_000, model: 'claude-haiku-5-5' })
})

test('a helper hired in the background leaves its boss free', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, background: true })
  await clock.advance(FLUSH)
  expect(scene()?.agents['agent-1']?.isBackground).toBe(true)
  expect(ticker(scene())).toEqual(['Main hired Researcher to work alongside it: find auth code'])
})

test('a command shows the description Claude gave it', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', tool_use_id: 'tu-r', file_path: '/work/a.ts' })
  // The test world refuses Bash, so a command that runs is shown through PowerShell, which takes the same input.
  await $.tool.call({ tool: 'PowerShell', tool_use_id: 'tu-p', command: 'npm test', description: 'Run the test suite' } as never)
  await clock.advance(FLUSH)
  expect(ticker(scene())).toContain('Main is running a command to run the test suite')
  expect(scene()?.agents.main?.activity).toBeNull()
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
  expect(lines.filter(line => /waiting for you/.test(line))).toHaveLength(1)
  expect(lines.some(line => /permission/.test(line))).toBe(false)
})

test('a permission request for any other tool still says so', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(FLUSH)
  expect(ticker(scene())).toContain('Main needs your permission to run a command')
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

test('a helper starting its run is not a new task for Main', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix the login bug', turnId: 'turn-1' })
  await $.turn.start({ text: 'Read-only. Do these steps...', turnId: 'turn-2', agentId: 'agent-1' })
  await clock.advance(FLUSH)
  expect(scene()?.job?.task).toMatch(/login bug/)
  expect(ticker(scene()).filter(line => line === 'You gave Main a new task')).toHaveLength(1)
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
  expect(ticker(scene())).toContain('Researcher was stopped and left')
  expect(ticker(scene()).some(line => /handed its report/.test(line))).toBe(false)
})

test('a /clear empties the office and deselects', async ($, on) => {
  const { clock, scene, selected } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.start({ text: 'fix the login bug', turnId: 'turn-1' })
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-agent-1' })
  expect(Object.keys(scene()?.agents ?? {})).toEqual(['main', 'agent-1'])
  expect(selected()).toBe('agent-1')
  const ended = await $.session.end(endSession('clear'))
  expect(ended).toEqual({ sessionId: 's-1' })
  expect(Object.keys(scene()?.agents ?? {})).toEqual(['main'])
  expect(scene()?.order).toEqual(['main'])
  expect(ticker(scene())).toEqual([])
  expect(scene()?.briefing).toBeNull()
  expect(selected()).toBeNull()
})

test('after a /clear the office draws the new conversation from scratch', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  // This hire is still waiting for a flush when the /clear arrives, and it belongs to the old conversation.
  await $.agent.spawn(SPAWN)
  await $.session.end(endSession('clear'))
  await clock.advance(FLUSH)
  expect(Object.keys(scene()?.agents ?? {})).toEqual(['main'])
  await $.turn.start({ text: 'a fresh start', turnId: 'turn-2' })
  await clock.advance(FLUSH)
  expect(ticker(scene())).toEqual(['You gave Main a new task'])
})

test('a batch a flush has already taken is not applied after a /clear', async ($, on) => {
  const { clock, scene } = world(on)
  // Hold the flush at its first read of the scene, after it has swapped the queue, so the /clear lands mid-flush.
  let isHeld = false
  let reached: () => void = () => {}
  let release: () => void = () => {}
  const isAtGate = new Promise<void>(resolve => {
    reached = resolve
  })
  on('state.get', SCENE, async ($, e, next) => {
    if (!isHeld) return next(e)
    isHeld = false
    reached()
    await new Promise<void>(resolve => {
      release = resolve
    })
    return next(e)
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  isHeld = true
  await clock.advance(FLUSH)
  await isAtGate
  await $.session.end(endSession('clear'))
  release()
  await clock.advance(FLUSH)
  expect(Object.keys(scene()?.agents ?? {})).toEqual(['main'])
  expect(ticker(scene())).toEqual([])
})

test('a /clear still lets the session end when the office cannot be reset', async ($, on) => {
  const options = { isSceneBroken: false }
  const { clock, selected } = world(on, options)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-agent-1' })
  expect(selected()).toBe('agent-1')
  options.isSceneBroken = true
  const ended = await $.session.end(endSession('clear'))
  expect(ended).toEqual({ sessionId: 's-1' })
  // Each reset stands alone: the failed scene write does not keep the selection from clearing.
  expect(selected()).toBeNull()
})

test('a selected id that is not in the scene gets no job clock', async ($, on) => {
  const { clock, clockWrites } = world(on)
  // Stands in for a selection whose agent has since been pruned from the scene.
  on('state.get', SELECTED, () => ({ value: { value: 'pruned-agent', version: 1 } }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(5000)
  expect(clockWrites).toEqual([])
})

test('a session that ends for any other reason leaves the office alone', async ($, on) => {
  const { clock, scene } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  await $.session.end(endSession('prompt_input_exit'))
  expect(Object.keys(scene()?.agents ?? {})).toEqual(['main', 'agent-1'])
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
  expect(await ui.find({ type: 'Text', text: /^Job: find auth code$/ })).toBeUndefined()
  await ui.press({ key: 'agent-agent-1' })
  expect(await ui.find({ type: 'Text', text: /^Researcher · Explore agent$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Job: find auth code$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Brief: Task Find where the login flow creates a session\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Reports to: Main, who waits for its report$/ })).toBeDefined()
  await ui.press({ key: 'agent-agent-1' })
  expect(await ui.find({ type: 'Text', text: /^Job: find auth code$/ })).toBeUndefined()
})

test('a long brief and report can be read in full from the details box', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const brief = `## Task\n${'Look in every file that touches the session. '.repeat(10)}\n\n- auth.ts\n- session.ts`
  await $.agent.spawn({ ...SPAWN, prompt: brief })
  await $.turn.complete({ answer: 'Short answer.', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer' })
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-agent-1' })
  expect(await ui.find({ type: 'Text', text: /^Brief: Task Look in every file/ })).toBeDefined()
  // A report the one line already shows whole offers nothing more.
  expect(await ui.find({ type: 'Text', text: /^Report: Short answer\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read the full report/ })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.press({ key: 'read-brief' })
  const whole = await ui.find({ type: 'Markdown' })
  expect(whole?.props.text).toBe(brief)
  expect(await ui.find({ type: 'Text', text: /Hide the full brief/ })).toBeDefined()
  // Choosing another agent closes it.
  await ui.press({ key: 'agent-main' })
  await ui.press({ key: 'agent-agent-1' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
})

test('the recap of this job opens from its button and tells the story in words and a picture', async ($, on) => {
  const { clock, stored } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  // Before the first message there is no job, so no button.
  expect(await ui.find({ type: 'Button', key: 'job' })).toBeUndefined()
  await $.turn.start({ text: 'Fix the login bug', turnId: 'turn-1' })
  await $.agent.spawn(SPAWN)
  await clock.advance(5000)
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer' })
  await clock.advance(5000)
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(FLUSH)
  expect(await ui.find({ type: 'Text', text: /^This job: Fix the login bug$/ })).toBeUndefined()
  await ui.press({ key: 'job' })
  expect(await ui.find({ type: 'Text', text: /^This job: Fix the login bug$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Took \d+s · 1 helper, up to 1 at once$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^  Researcher: \d+s, handed in its report$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^This session: 1 job · 1 helper · \d+s$/ })).toBeDefined()
  const pictures = await ui.findAll({ type: 'Svg' })
  expect(pictures).toHaveLength(3)
  expect(String(pictures[2]?.props.alt)).toContain('Researcher')
  // History is off unless switched on: nothing is kept past the session.
  expect(await ui.find({ type: 'Text', text: /^Earlier jobs$/ })).toBeUndefined()
  expect(stored.jobs).toBeUndefined()
  // The terminal gets the summary as text.
  const terminal = await $.ui.mount({ plugin: 'pixel-office', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await terminal.find({ type: 'Text', text: /^This job: Fix the login bug$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^This session: 1 job · 1 helper · \d+s$/ })).toBeDefined()
})

// One job: a message, a helper that reports back, and Main's own answer.
async function runJob($: Parameters<Parameters<typeof test>[1]>[0], clock: { advance: (ms: number) => Promise<void> }, hired: { id: string }, text: string, turnId: string) {
  hired.id = `helper-${turnId}`
  await $.turn.start({ text, turnId })
  await $.agent.spawn(SPAWN)
  await clock.advance(5000)
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId, agentId: hired.id, reason: 'answer' })
  await clock.advance(5000)
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId, reason: 'answer' })
  await clock.advance(FLUSH)
}

test('the session total adds up each job, and a /clear starts it over', async ($, on) => {
  // Each job hires a helper of its own, as the engine gives each hire a new id.
  const hired = { id: 'agent-1' }
  const { clock, stored } = world(on, { hiredId: () => hired.id })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await runJob($, clock, hired, 'Fix the login bug', 'turn-1')
  await ui.press({ key: 'job' })
  expect(await ui.find({ type: 'Text', text: /^This session: 1 job · 1 helper · / })).toBeDefined()
  await runJob($, clock, hired, 'Write the docs', 'turn-2')
  expect(await ui.find({ type: 'Text', text: /^This session: 2 jobs · 2 helpers · / })).toBeDefined()
  // Kept in memory only: nothing reaches the store without the history option.
  expect(stored.jobs).toBeUndefined()
  await $.session.end(endSession('clear'))
  await runJob($, clock, hired, 'Start over', 'turn-3')
  expect(await ui.find({ type: 'Text', text: /^This session: 1 job · 1 helper · / })).toBeDefined()
})

test('with history on, past jobs load at the start and each job is saved as it ends', { options: { history: 'last-20' } }, async ($, on) => {
  const earlier = { startedAt: new Date(2026, 9, 13, 9, 30).getTime(), task: 'write the docs', tookMs: 95_000, helpers: 2, peak: 2, tokens: 61_000 }
  const { clock, stored } = world(on, { stored: { jobs: [earlier, { startedAt: 'broken' }] } })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Fix the login bug', turnId: 'turn-1' })
  await clock.advance(4000)
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(FLUSH)
  const saved = stored.jobs as { task: string; tookMs: number }[]
  expect(saved.map(r => r.task)).toEqual(['write the docs', 'Fix the login bug'])
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'job' })
  expect(await ui.find({ type: 'Text', text: /^Earlier jobs$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^13 Oct 09:30 write the docs: took 1m 35s, 2 helpers, 61k tokens$/ })).toBeDefined()
  // A turn that carries on updates the same record instead of adding one.
  await $.turn.start({ text: '', turnId: 'turn-2' })
  await clock.advance(2000)
  await $.turn.complete({ answer: 'more', durationMs: 5, isAborted: false, turnId: 'turn-2', reason: 'answer' })
  await clock.advance(FLUSH)
  const again = stored.jobs as { task: string; tookMs: number }[]
  expect(again).toHaveLength(2)
  expect(again[1]!.tookMs).toBeGreaterThan(saved[1]!.tookMs)
})

test('reminders are off unless switched on', async ($, on) => {
  const { clock, toasts, notes } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(60_000)
  expect(toasts).toEqual([])
  expect(notes).toEqual([])
})

test('with reminders on, an agent waiting on you is said once, after 30 seconds', { options: { notify: 'after-30s' } }, async ($, on) => {
  const { clock, toasts, notes } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(20_000)
  expect(notes).toEqual([])
  await clock.advance(12_000)
  expect(toasts).toEqual(['Main is waiting for your permission'])
  expect(notes).toEqual([{ text: 'Main is waiting for your permission', title: 'Pixel Office' }])
  // Not again for the same wait.
  await clock.advance(120_000)
  expect(notes).toHaveLength(1)
  // A wait that ends and begins again is a new wait.
  await $.turn.start({ text: 'go on', turnId: 'turn-2' })
  await clock.advance(2000)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } })
  await clock.advance(33_000)
  expect(notes).toHaveLength(2)
})

test("a helper's wait names the helper and what it waits for", { options: { notify: 'after-30s' } }, async ($, on) => {
  const { clock, notes } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' }, agent_id: 'agent-1' } as never)
  await clock.advance(32_000)
  expect(notes.map(n => n.text)).toEqual(['Researcher is waiting for your permission'])
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

test('selecting Main never writes the job clock, as Main has no time on the job', async ($, on) => {
  const { clock, clockWrites } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-main' })
  expect(await ui.find({ type: 'Text', text: /^Main · Coordinator$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Now: waiting on Researcher$/ })).toBeDefined()
  await clock.advance(3000)
  expect(clockWrites).toEqual([])
})

test('the job clock stops when the selected helper has left', async ($, on) => {
  const { clock, clockWrites } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  await ui.press({ key: 'agent-agent-1' })
  await clock.advance(3000)
  expect(clockWrites.length).toBeGreaterThanOrEqual(2)
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer' })
  await clock.advance(FLUSH)
  const afterLeaving = clockWrites.length
  await clock.advance(3000)
  expect(clockWrites.length).toBe(afterLeaving)
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
  expect(await ui.find({ type: 'Text', text: /Main: idle, ready for your next message/ })).toBeDefined()
})
