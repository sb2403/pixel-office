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

// Kept in step with plugin.json's `userConfig` by hand: the test kit can check the defaults, not the rest.
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
      { value: 'on', meaning: 'list them, sharing this one\'s status and message start through a small file' },
    ],
  },
  {
    field: 'debug',
    title: 'Debug log',
    fallback: 'off',
    choices: [
      { value: 'off', meaning: 'nothing recorded' },
      { value: 'on', meaning: 'write a log of timings to a file, for troubleshooting' },
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

export const USAGE = '/office shows or hides the office, /office settings lists its settings, and /office set <name> <value> changes one.'

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
  if (choice === undefined) return { error: `${setting.field} can be ${setting.choices.map(c => c.value).join(' or ')}.` }
  return { setting, value: choice.value }
}

function fieldList(): string {
  return SETTINGS.map(s => s.field).join(', ')
}

// The `/config` key of a field: `<plugin>.<field>`, unless another plugin of the same name is loaded too (an
// installed copy beside a development one), when each copy's rows carry its marketplace. Which of those is this
// copy cannot be told from here, so then there is no key, and the change is left to `/config`.
export function configKeyOf(keys: readonly string[], field: string): string | null {
  const plain = `${PLUGIN}.${field}`
  if (keys.includes(plain)) return plain
  const copies = keys.filter(key => key.startsWith(`${PLUGIN}@`) && key.endsWith(`.${field}`))
  if (copies.length > 1) return null
  return copies[0] ?? plain
}

export const MANY_COPIES = 'more than one copy of the office is loaded, so change it in /config'
export const CANNOT = 'this Claude Code cannot change it from here, so change it in /config'

// What the office says once a change is asked for: the engine's refusal in its own words, or that it took.
export function setReply(setting: Setting, value: string, deny: string | undefined): string {
  if (deny !== undefined) return `${setting.title} was not changed: ${deny}`
  return `${setting.title} is now ${value} (${meaningOf(setting, value)}).`
}

// The same once the row has been read back: a value saved but not in force (a `--settings` file that sets it, or
// an engine that did not load the office again) is said as such. `stored` is undefined when it could not be read.
export function replyAfterSet(setting: Setting, value: string, deny: string | undefined, stored: unknown): string {
  if (deny !== undefined || stored === undefined || stored === value) return setReply(setting, value, deny)
  return `${setting.title} was saved as ${value}, but this session still uses ${String(stored)}. It applies after /reload-plugins or in a new session.`
}

// What each setting holds now: the `/config` rows when the engine lists them, else the options the office loaded with.
export function currentValues(rows: ReadonlyArray<{ key: string; value: unknown }>, options: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const setting of SETTINGS) {
    const key = configKeyOf(rows.map(row => row.key), setting.field)
    const row = key === null ? undefined : rows.find(r => r.key === key)
    out[setting.field] = valueOf(row === undefined ? options : { [setting.field]: row.value }, setting)
  }
  return out
}
