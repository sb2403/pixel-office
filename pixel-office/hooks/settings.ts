import type { EngineInterface } from 'claude-code'

// The office's own settings: the options plugin.json declares, read and changed from inside the office (its
// Settings button, `/office settings`, `/office set`) rather than at install time. There is no file of the office's
// own: a change goes through `$.config.set`, the same writer as the `/config` menu, so it lands in settings.json
// under `pluginConfigs` and the engine loads the office again with the new value.

export type Setting = {
  field: string
  title: string
  fallback: string
  // Each value plugin.json allows, in its order, with what it does in a few words.
  choices: ReadonlyArray<{ value: string; meaning: string }>
}

// Kept in step with plugin.json's `userConfig` by a test.
export const SETTINGS: readonly Setting[] = [
  {
    field: 'autoOpen',
    title: 'Open the office',
    fallback: 'on-first-subagent',
    choices: [
      { value: 'on-first-subagent', meaning: 'when the first helper is hired' },
      { value: 'session-start', meaning: 'as each session starts' },
      { value: 'never', meaning: 'only with /office' },
    ],
  },
  {
    field: 'history',
    title: 'Keep a history of jobs',
    fallback: 'off',
    choices: [
      { value: 'off', meaning: 'nothing kept after the session' },
      { value: 'last-20', meaning: 'the newest 20 jobs, on this computer' },
    ],
  },
  {
    field: 'notify',
    title: 'Remind me when an agent waits on me',
    fallback: 'off',
    choices: [
      { value: 'off', meaning: 'no reminders' },
      { value: 'after-30s', meaning: 'once, after 30 seconds' },
    ],
  },
  {
    field: 'otherSessions',
    title: 'Show my other sessions',
    fallback: 'off',
    choices: [
      { value: 'off', meaning: 'nothing written or read' },
      { value: 'on', meaning: 'list your other sessions on this computer' },
    ],
  },
  {
    field: 'debug',
    title: 'Debug log',
    fallback: 'off',
    choices: [
      { value: 'off', meaning: 'nothing recorded' },
      { value: 'on', meaning: 'log timings for troubleshooting' },
    ],
  },
]

// The `/config` row of a field when no listing names it: `<plugin>.<field>`.
export const PLUGIN = 'pixel-office'

export function valueOf(options: Readonly<Record<string, unknown>>, setting: Setting): string {
  const value = options[setting.field]
  return typeof value === 'string' && setting.choices.some(c => c.value === value) ? value : setting.fallback
}

export function meaningOf(setting: Setting, value: string): string {
  return setting.choices.find(c => c.value === value)?.meaning ?? ''
}

// One line per setting, for the terminal and the command's reply: "Keep a history of jobs: off (nothing kept after the session)".
export function settingLines(options: Readonly<Record<string, unknown>>): string[] {
  return SETTINGS.map(setting => {
    const value = valueOf(options, setting)
    return `${setting.title} (${setting.field}): ${value}, ${meaningOf(setting, value)}`
  })
}

export const SETTINGS_HELP = 'Change one with /office set <name> <value> (for example /office set history last-20), from Settings in the office, or in /config.'

export type SetRequest = { setting: Setting; value: string } | { error: string }

// Reads `/office set`'s arguments: a field's name, then one of its values. Case is forgiven on both, as the field
// names are camelCase and easy to mistype.
export function parseSet(args: string): SetRequest {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  if (words.length !== 2) return { error: `Say which setting and its value, as in /office set history last-20. The settings are ${fieldList()}.` }
  const [name, raw] = words as [string, string]
  const setting = SETTINGS.find(s => s.field.toLowerCase() === name.toLowerCase())
  if (setting === undefined) return { error: `There is no setting called ${name}. The settings are ${fieldList()}.` }
  const choice = setting.choices.find(c => c.value.toLowerCase() === raw.toLowerCase())
  if (choice === undefined) return { error: `${setting.field} takes ${setting.choices.map(c => c.value).join(', ')}.` }
  return { setting, value: choice.value }
}

function fieldList(): string {
  return SETTINGS.map(s => s.field).join(', ')
}

// The `/config` key of a field: the one the engine lists for this plugin when it can list its rows, else
// `<plugin>.<field>`. An installed plugin's key may carry its marketplace, so a listing wins when there is one.
export function configKeyOf(keys: readonly string[], field: string): string {
  return keys.find(key => key === `${PLUGIN}.${field}` || (key.startsWith(`${PLUGIN}@`) && key.endsWith(`.${field}`))) ?? `${PLUGIN}.${field}`
}

// Changes one setting the way the `/config` menu does, and says how it went. The key comes from `$.config.list`
// where this engine has it; an engine without `$.config` at all is told apart by the error its call throws.
export async function applySetting($: EngineInterface, setting: Setting, value: string): Promise<string> {
  let keys: string[] = []
  try {
    keys = (await $.config.list()).map(row => row.key)
  } catch {
    // An engine without the listing: the key is the plain one.
  }
  const key = configKeyOf(keys, setting.field)
  try {
    const result = await $.config.set({ key, value })
    return setReply(setting, value, result.deny)
  } catch (err) {
    return setReply(setting, value, err instanceof TypeError ? TOO_OLD : err instanceof Error ? err.message : 'the settings could not be written')
  }
}

const TOO_OLD = 'this Claude Code cannot change it from here; use /plugin configure pixel-office@pixel-office'

// What the office says once a change is asked for: the engine's refusal in its own words, or that it took.
export function setReply(setting: Setting, value: string, deny: string | undefined): string {
  if (deny !== undefined) return `${setting.title} was not changed: ${deny}`
  return `${setting.title} is now ${value} (${meaningOf(setting, value)}).`
}
