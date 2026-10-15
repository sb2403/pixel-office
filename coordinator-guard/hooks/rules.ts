// What the guard counts as Main doing a helper's job: changing a file itself.

// Places Main may always write: its own memory and plans, and scratch space. Anything else is the work, and the
// work is for a helper.
const EXEMPT: readonly RegExp[] = [/\/\.claude\/(projects|plans|dev-mods)\//, /\/scratchpad\//, /\/AppData\/Local\/Temp\/claude\//, /^\/tmp\//]

export const isExempt = (path: string): boolean => {
  const normal = path.replace(/\\/g, '/')
  return EXEMPT.some(pattern => pattern.test(normal))
}

const NOWHERE = /^(\/dev\/null|nul|\$null)$/i

// The files a shell command writes with a redirect: `> out`, `>> log`, `1> out`, `&> out`, `>| out`, found
// outside quotes and before any heredoc body, not counting `2>&1`, `>&2` or a write to /dev/null.
export function redirectTargets(command: string): string[] {
  const out: string[] = []
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string
    if (quote !== '') {
      if (ch === '\\' && quote === '"') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '<' && command[i + 1] === '<') break
    if (ch !== '>') continue
    if (command[i + 1] === '&') {
      i++
      continue
    }
    let j = i + 1
    if (command[j] === '>' || command[j] === '|') j++
    while (command[j] === ' ' || command[j] === '\t') j++
    let target = ''
    let inQuote = ''
    for (; j < command.length; j++) {
      const c = command[j] as string
      if (inQuote !== '') {
        if (c === inQuote) inQuote = ''
        else target += c
      } else if (c === '"' || c === "'") inQuote = c
      else if (/[\s;&|<>)]/.test(c)) break
      else target += c
    }
    i = j - 1
    if (target !== '' && !NOWHERE.test(target)) out.push(target)
  }
  return out
}

// Other ways a command writes a file, whatever its redirects: tee, an in-place edit, PowerShell's writers.
const WRITERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[\s;&|(])tee(\s|$)/, 'tee'],
  [/(^|[\s;&|(])(sed|perl|ruby)\s+(?:[^;&|]*\s)?-[A-Za-z]*i(\.\w+)?(\s|$)/, 'an in-place edit'],
  [/(^|[\s;&|(])(Set-Content|Add-Content|Out-File|New-Item|Export-Csv|Export-Clixml)(\s|$)/i, 'a PowerShell file writer'],
  [/(^|[\s;&|(])(git\s+apply|patch)(\s|$)/, 'a patch'],
]

// What in a command changes a file when Main is meant not to, or null when it does not: a redirect to a place Main
// may not write, or one of the writers above. A redirect into an exempt place (the scratchpad) is allowed.
export function writesFile(command: string): string | null {
  const head = command.split(/<<-?\s*['"]?\w+['"]?/)[0] ?? command
  const blocked = redirectTargets(command).find(target => !isExempt(target))
  if (blocked !== undefined) return `a redirect to ${blocked}`
  for (const [pattern, name] of WRITERS) {
    if (pattern.test(head.replace(/"[^"]*"|'[^']*'/g, '""'))) return name
  }
  return null
}
