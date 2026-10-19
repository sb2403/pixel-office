import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { SETTINGS, USAGE, configKeyOf, currentValues, replyAfterSet, parseSet, settingLines } from '../hooks/settings'

const RUN = { command: 'office', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const PANE_PROPS = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

// Stands for the `/config` writer: keeps each change, or refuses every one with `deny`.
function configWorld(on: On, { deny }: { deny?: string } = {}) {
  mock.clock(on, { now: new Date(2026, 9, 18, 12, 0).getTime() })
  const sets: { key: string; value: unknown }[] = []
  on('config.set', ($, e) => {
    sets.push({ key: e.key, value: e.value })
    return deny === undefined ? { value: e.value } : { deny }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { sets }
}

describe('the settings list', () => {
  // The test kit hands the plugin its manifest's defaults when a test gives no options, and has no file reading, so
  // the defaults are what this can hold the list to.
  test('starts from the defaults plugin.json declares', async ($, on) => {
    configWorld(on)
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ran = await $.command.run({ ...RUN, args: 'settings' })
    expect(ran.text?.split('\n').slice(0, SETTINGS.length)).toEqual(
      SETTINGS.map(s => `${s.title} (${s.field}): ${s.fallback}, ${s.choices.find(c => c.value === s.fallback)?.meaning}`),
    )
  })

  test('a value outside the choices reads as the default', () => {
    expect(settingLines({ history: 'forever' })[1]).toBe('Keep a history of jobs (history): off, nothing kept after the session')
    expect(settingLines({ history: 'last-20' })[1]).toBe('Keep a history of jobs (history): last-20, the newest 20 jobs, on this computer')
  })
})

describe('/office set', () => {
  test('a value saved but not in force is said as such, and the rows win over the loaded options', () => {
    const history = SETTINGS[1]!
    expect(replyAfterSet(history, 'last-20', undefined, 'off')).toBe(
      'Keep a history of jobs was saved as last-20, but this session still uses off. It applies after /reload-plugins or in a new session.',
    )
    expect(replyAfterSet(history, 'last-20', undefined, 'last-20')).toBe('Keep a history of jobs is now last-20 (the newest 20 jobs, on this computer).')
    expect(replyAfterSet(history, 'last-20', 'locked', 'off')).toBe('Keep a history of jobs was not changed: locked')
    expect(currentValues([{ key: 'pixel-office.history', value: 'last-20' }], { history: 'off', notify: 'after-30s' })).toMatchObject({
      history: 'last-20',
      notify: 'after-30s',
      debug: 'off',
    })
  })

  test('reads a name and a value, forgiving case', () => {
    const request = parseSet('  OTHERSESSIONS   On ')
    expect('error' in request ? request.error : `${request.setting.field}=${request.value}`).toBe('otherSessions=on')
  })

  test('says what is wrong with anything else', () => {
    const errorOf = (args: string): string => {
      const request = parseSet(args)
      return 'error' in request ? request.error : ''
    }
    expect(errorOf('')).toContain('as in /office set history last-20')
    expect(errorOf('history')).toContain('as in /office set history last-20')
    expect(errorOf('colour blue')).toBe('There is no setting called colour. The settings are autoOpen, history, notify, otherSessions, debug.')
    expect(errorOf('history forever')).toBe('history can be off or last-20.')
  })

  test("the key is the one the engine lists for this plugin, else the plain one", () => {
    expect(configKeyOf([], 'history')).toBe('pixel-office.history')
    expect(configKeyOf(['theme', 'other-plugin.history', 'pixel-office@pixel-office.history'], 'history')).toBe('pixel-office@pixel-office.history')
    expect(configKeyOf(['pixel-office@pixel-office.notify'], 'history')).toBe('pixel-office.history')
    // Two copies loaded: which row is this one's cannot be told.
    expect(configKeyOf(['pixel-office@pixel-office.history', 'pixel-office@inline.history'], 'history')).toBeNull()
  })
})

test('/office settings lists every setting and how to change one', async ($, on) => {
  configWorld(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, args: 'settings' })
  const lines = ran.text?.split('\n') ?? []
  expect(lines[0]).toBe('Open the office (autoOpen): on-first-subagent, when the first helper is hired')
  expect(lines).toHaveLength(SETTINGS.length + 1)
  expect(lines[lines.length - 1]).toContain('/office set <name> <value>')
})

test('/office set changes the setting through the /config writer and says so', async ($, on) => {
  const { sets } = configWorld(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, args: 'set history last-20' })
  expect(sets).toEqual([{ key: 'pixel-office.history', value: 'last-20' }])
  expect(ran.text).toBe('Keep a history of jobs is now last-20 (the newest 20 jobs, on this computer).')
})

test('/office set passes on a refusal and changes nothing on a typo', async ($, on) => {
  const { sets } = configWorld(on, { deny: 'your organization sets it' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ ...RUN, args: 'set notify after-30s' })).text).toBe(
    'Remind me when an agent waits on me was not changed: your organization sets it',
  )
  expect((await $.command.run({ ...RUN, args: 'set notify sometimes' })).text).toBe('notify can be off or after-30s.')
  expect(sets).toHaveLength(1)
})

test('/office alone still shows the pane, and a word it does not know says what it takes', async ($, on) => {
  configWorld(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect((await $.command.run({ ...RUN, args: 'setting' })).text).toBe(USAGE)
  expect((await $.command.run({ ...RUN, args: '' })).text).toBe('Office opened.')
})

test('the Settings box shows the current values and changes one when pressed', { options: { notify: 'after-30s' } }, async ($, on) => {
  const { sets } = configWorld(on)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await ui.find({ type: 'Text', text: /^Settings$/ })).toBeUndefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /^● after-30s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ off$/ })).toBeDefined()
  await ui.press({ key: 'set-otherSessions-on' })
  expect(sets).toEqual([{ key: 'pixel-office.otherSessions', value: 'on' }])
  expect(await ui.find({ type: 'Text', text: 'Show my other sessions is now on (list them, sharing this one\'s status and message start through a small file).' })).toBeDefined()
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /^● after-30s$/ })).toBeUndefined()
})
