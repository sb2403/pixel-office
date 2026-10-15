// What the guard counts as Main doing a helper's job: changing a file itself.
//
// This is a nudge towards delegating, not a security boundary: it reads a command's text, so it cannot see what a
// script does, and it does not resolve symbolic links.

// Places Main may always write: its own memory and plans, and the temporary folder its scratchpad lives in.
// Anything else is the work, and the work is for a helper. They are anchored to the home and temp folders, so a
// `scratchpad` or `.claude/projects` folder inside a project is not exempt.
const EXEMPT: readonly RegExp[] = [
  /^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+\/\.claude\/(?:projects|plans|dev-mods)\//,
  /^\/root\/\.claude\/(?:projects|plans|dev-mods)\//,
  /^(?:[A-Za-z]:)?\/Users\/[^/]+\/AppData\/Local\/Temp\/claude\//,
  /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T\//,
  /^\/tmp\//,
]

// A path with backslashes, repeated slashes, `.` and `..` made plain; null when `..` climbs out of the root.
export function normalize(path: string): string | null {
  const parts: string[] = []
  const raw = path.replace(/\\/g, '/').replace(/\/+/g, '/')
  const drive = /^[A-Za-z]:/.exec(raw)?.[0] ?? ''
  for (const part of raw.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.pop() === undefined) return null
      continue
    }
    parts.push(part)
  }
  return `${drive}/${parts.join('/')}${raw.endsWith('/') && parts.length > 0 ? '/' : ''}`
}

export const isExempt = (path: string): boolean => {
  const normal = normalize(path)
  return normal !== null && EXEMPT.some(pattern => pattern.test(normal))
}

// The command with heredoc bodies taken out: `cat <<'EOF' > f\nbody\nEOF\necho x` becomes `cat  > f\n\necho x`.
// Only the body goes (the lines up to the line that is the delimiter): what is on the operator's line and what
// follows the end of the body is still a command.
export function withoutHeredocBodies(command: string): string {
  let out = ''
  let quote = ''
  const pending: Array<{ delimiter: string; isTabbed: boolean }> = []
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string
    if (quote !== '') {
      out += ch
      if (ch === '\\' && quote === '"') {
        out += command[i + 1] ?? ''
        i++
      } else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
      continue
    }
    // `<<<` is a here-string, one word: its last two characters are not a heredoc operator.
    if (ch === '<' && command.startsWith('<<<', i)) {
      out += '<<<'
      i += 2
      continue
    }
    if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      const found = /^<<(-?)\s*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/.exec(command.slice(i))
      if (found !== null) {
        pending.push({ delimiter: found[2] ?? found[3] ?? found[4] ?? '', isTabbed: found[1] === '-' })
        out += ' '
        i += found[0].length - 1
        continue
      }
    }
    out += ch
    if (ch === '\n' && pending.length > 0) {
      // Skip the lines up to each pending delimiter, in order.
      let at = i + 1
      for (const { delimiter, isTabbed } of pending.splice(0)) {
        for (;;) {
          if (at >= command.length) break
          const end = command.indexOf('\n', at)
          const line = command.slice(at, end === -1 ? command.length : end)
          at = end === -1 ? command.length : end + 1
          if ((isTabbed ? line.replace(/^\t+/, '') : line) === delimiter) break
        }
      }
      i = at - 1
    }
  }
  return out
}

const NOWHERE = /^(\/dev\/null|nul|\$null)$/i

// The files a shell command writes with a redirect: `> out`, `>> log`, `1> out`, `&> out`, `>| out`, found
// outside quotes and outside heredoc bodies, not counting `2>&1`, `>&2` or a write to /dev/null.
export function redirectTargets(command: string): string[] {
  const text = withoutHeredocBodies(command)
  const out: string[] = []
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (quote !== '') {
      if (ch === '\\' && quote === '"') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch !== '>') continue
    if (text[i + 1] === '&') {
      i++
      continue
    }
    let j = i + 1
    if (text[j] === '>' || text[j] === '|') j++
    while (text[j] === ' ' || text[j] === '\t') j++
    let target = ''
    let inQuote = ''
    for (; j < text.length; j++) {
      const c = text[j] as string
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
  const blocked = redirectTargets(command).find(target => !isExempt(target))
  if (blocked !== undefined) return `a redirect to ${blocked}`
  const text = withoutHeredocBodies(command).replace(/"[^"]*"|'[^']*'/g, '""')
  for (const [pattern, name] of WRITERS) {
    if (pattern.test(text)) return name
  }
  return null
}
