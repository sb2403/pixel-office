// What a shell command is for, in words a colleague would use: "Open a pull request", "Write bar.ts", "Search for
// sceneTimeOf". A command is rarely its own explanation: it starts with `cd somewhere &&`, sets variables, makes a
// folder, pipes into `head`, and carries a heredoc, so the intent is read from its first real step.

export type Intent = {
  // The first real step, as typed, with the setup in front of it left out.
  step: string
  // What it is for, as an instruction ("Run the tests"); empty when the program is not one the office knows.
  phrase: string
  // How many other real steps follow it.
  more: number
}

// Splits a command into its steps at `&&`, `||`, `;` and line breaks, leaving quoted text whole, dropping a heredoc's
// body, and keeping only the first command of a pipe: what a pipe feeds is not what the step is for.
export function stepsOf(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  let isPiped = false
  // Inside `$( ... )` or `( ... )` nothing separates steps: the whole substitution is one word.
  let depth = 0
  const flush = (): void => {
    const text = cur.trim()
    if (text !== '' && !isPiped) out.push(text)
    cur = ''
    isPiped = false
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string
    if (quote !== '') {
      if (!isPiped) cur += ch
      if (ch === '\\' && quote === '"') {
        if (!isPiped) cur += command[i + 1] ?? ''
        i++
      } else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      if (!isPiped) cur += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')' && depth > 0) depth--
    if (depth > 0) {
      if (!isPiped) cur += ch
      continue
    }
    if (ch === '<' && command[i + 1] === '<') break
    if (ch === '\n' || ch === ';') {
      flush()
      continue
    }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      flush()
      i++
      continue
    }
    if (ch === '|') {
      if (!isPiped) {
        const text = cur.trim()
        if (text !== '') out.push(text)
        cur = ''
      }
      isPiped = true
      continue
    }
    if (!isPiped) cur += ch
  }
  flush()
  return out
}

const tokens = (text: string): string[] => (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(t => t.replace(/^(["'])(.*)\1$/, '$2'))

// Steps that say where or how, not what.
const SETUP = /^(cd|pushd|popd|set|export|unset|source|alias|umask|trap|shopt|ulimit|true|false|set-location|push-location|pop-location|set-strictmode|set-executionpolicy)$/i
const ASSIGNMENT = /^\$?[A-Za-z_][\w:]*=(\$\(.*\)|"[^"]*"|'[^']*'|\S*)$/s
const POWERSHELL_ASSIGNMENT = /^\$[\w:]+\s*=\s*/

const basename = (path: string): string => {
  const parts = path.replace(/["']/g, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

// Tokens after the program that are not flags; `-name` style values are not guessed at.
const operands = (args: readonly string[]): string[] => args.filter(a => !a.startsWith('-') && a !== '')

const WRAPPERS = /^(sudo|time|nohup|env|command|exec|call|nice|builtin)$/i
const RUNNERS = /^(npx|bunx|pnpx|uvx|pipx)$/i

// The program and its arguments, past what runs it: `CI=1 sudo npx -y tsx@4 a.ts` is `tsx a.ts`.
function programOf(step: string): { program: string; args: string[] } | null {
  let text = step.replace(POWERSHELL_ASSIGNMENT, '').trim()
  let words = tokens(text)
  while (words.length > 0 && ASSIGNMENT.test(words[0] as string)) words = words.slice(1)
  for (;;) {
    const head = words[0] ?? ''
    if (WRAPPERS.test(head)) words = words.slice(1)
    else if (RUNNERS.test(head)) {
      words = words.slice(1)
      while (words.length > 0 && (words[0] as string).startsWith('-')) words = words.slice(1)
    } else if (/^(pnpm|yarn)$/i.test(head) && /^dlx$/i.test(words[1] ?? '')) words = words.slice(2)
    else break
  }
  text = words.join(' ')
  if (words.length === 0) return null
  let program = words[0] as string
  let args = words.slice(1)
  // `"$CLAUDE" plugin list`: a variable that holds the program leaves only what follows to go on.
  if (/^\$\{?\w+\}?$/.test(program)) {
    if (/^(plugin|mcp|config)$/.test(args[0] ?? '')) program = 'claude'
    else if (args.length > 0) {
      program = args[0] as string
      args = args.slice(1)
    }
  }
  program = basename(program)
    .replace(/\.(exe|cmd|bat|ps1|sh)$/i, '')
    .replace(/@[\d.][\w.-]*$/, '')
  return { program, args }
}

const MAX_NAME = 22
const short = (text: string): string => {
  const chars = Array.from(basename(text))
  return chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME - 1).join('')}…` : chars.join('')
}

// A file or folder as a person says it: the last part of the path.
const named = (args: readonly string[]): string => {
  const first = operands(args)[0]
  return first === undefined ? '' : short(first)
}

const scriptArg = (args: readonly string[]): string => {
  const file = args.find(a => !a.startsWith('-') && /\.[A-Za-z0-9]+$/.test(a))
  return file === undefined ? '' : short(file)
}

const GIT: Readonly<Record<string, string>> = {
  status: 'See what has changed',
  diff: 'See what has changed',
  log: 'See what has changed',
  show: 'See what has changed',
  add: 'Stage the changes',
  commit: 'Save a checkpoint of the work',
  push: 'Upload the work',
  pull: 'Download the latest changes',
  fetch: 'Download the latest changes',
  clone: 'Copy a project to work on',
  checkout: 'Work with branches',
  switch: 'Work with branches',
  branch: 'Work with branches',
  merge: 'Work with branches',
  rebase: 'Work with branches',
  stash: 'Set changes aside',
  worktree: 'Work with worktrees',
  tag: 'Tag a release',
  reset: 'Undo changes',
  restore: 'Undo changes',
  revert: 'Undo changes',
  clean: 'Tidy up untracked files',
  remote: 'Check the remote repository',
  config: 'Check the git settings',
  blame: 'See who changed a line',
  'cherry-pick': 'Bring over one change',
}

const GH_PR: Readonly<Record<string, string>> = {
  create: 'Open a pull request',
  merge: 'Merge a pull request',
  checks: 'Check on a pull request',
  status: 'Check on a pull request',
  view: 'Check on a pull request',
  list: 'Check on a pull request',
  diff: 'Check on a pull request',
  edit: 'Edit a pull request',
  comment: 'Comment on a pull request',
  review: 'Review a pull request',
  close: 'Close a pull request',
  checkout: 'Check out a pull request',
}

const POWERSHELL: Readonly<Record<string, (args: readonly string[]) => string>> = {
  'get-childitem': a => lookThrough(a),
  gci: a => lookThrough(a),
  'get-content': a => read(a),
  gc: a => read(a),
  'set-content': a => write(a),
  'add-content': a => write(a),
  'out-file': a => write(a),
  'select-string': a => search(a),
  sls: a => search(a),
  'remove-item': a => remove(a),
  ri: a => remove(a),
  'copy-item': a => `Copy ${named(a)}`.trim(),
  'move-item': a => `Move ${named(a)}`.trim(),
  'new-item': a => (named(a) === '' ? 'Create something new' : `Create ${named(a)}`),
  'test-path': a => (named(a) === '' ? 'Check that a path exists' : `Check whether ${named(a)} exists`),
  'get-process': () => 'See what is running',
  'stop-process': () => 'Stop a process',
  'invoke-webrequest': a => fetchFrom(a),
  'invoke-restmethod': a => fetchFrom(a),
  iwr: a => fetchFrom(a),
  irm: a => fetchFrom(a),
  'start-process': a => (named(a) === '' ? 'Start a program' : `Open ${named(a)}`),
  'start-sleep': a => wait(a),
  'write-output': () => 'Print a message',
  'write-host': () => 'Print a message',
  'get-command': a => (named(a) === '' ? 'Find a program' : `Find where ${named(a)} is`),
  convertfrom: () => 'Read some JSON',
  'convertfrom-json': () => 'Read some JSON',
  'get-location': () => 'Check the current folder',
}

function lookThrough(args: readonly string[]): string {
  const where = named(args)
  return where === '' ? 'Look through folders' : `Look through ${where}`
}
function read(args: readonly string[]): string {
  const file = named(args)
  return file === '' ? 'Show a file' : `Read ${file}`
}
function write(args: readonly string[]): string {
  const file = named(args)
  return file === '' ? 'Write a file' : `Write ${file}`
}
function search(args: readonly string[]): string {
  const what = operands(args)[0]
  return what === undefined ? 'Search the files' : `Search for ${short(what)}`
}
function remove(args: readonly string[]): string {
  const what = named(args)
  return what === '' ? 'Delete files' : `Delete ${what}`
}
function fetchFrom(args: readonly string[]): string {
  const url = operands(args).find(a => /^https?:\/\//i.test(a)) ?? operands(args)[0]
  if (url === undefined) return 'Fetch something from the web'
  try {
    return `Fetch from ${new URL(url).host}`
  } catch {
    return 'Fetch something from the web'
  }
}
function wait(args: readonly string[]): string {
  const secs = args.find(a => /^\d+(\.\d+)?$/.test(a))
  return secs === undefined ? 'Wait a moment' : `Wait ${secs} second${secs === '1' ? '' : 's'}`
}

// Ordered: the first that matches names the step. Each reads the program and what follows it.
function phraseFor(program: string, args: readonly string[], step: string): string {
  const p = program.toLowerCase()
  const sub = (args.find(a => !a.startsWith('-')) ?? '').toLowerCase()
  const tool = POWERSHELL[p]
  if (tool !== undefined) return tool(args)
  // `cat > out.ts <<EOF`, `echo x >> log`: a redirect names the file written, whatever program feeds it.
  if (/^(cat|echo|printf)$/.test(p)) {
    const to = /\s>>?\s*("[^"]+"|'[^']+'|[^\s&|]+)\s*$/.exec(step)
    if (to !== null && !to[1]!.startsWith('&')) return `Write ${short(to[1] as string)}`
  }

  // Tests, builds, installs: the same wherever they are run from.
  if (/^((npm|pnpm|yarn|bun)( run)? test|jest|vitest|mocha|pytest|(go|cargo|dotnet|deno) test|python3? -m (pytest|unittest)|claude plugin test)\b/.test(step)) return 'Test the code'
  if (/^((npm|pnpm|bun) (install|i|ci|add)|yarn (install|add)|pip3? install|(uv|poetry) (add|install|sync)|cargo add|go get)\b|^yarn$/.test(step)) return 'Install packages'
  if (/^((npm|pnpm|yarn|bun) run build|tsc|make|cargo build|go build|dotnet build)\b/.test(step)) return 'Build the project'
  if (/^((npm|pnpm|yarn|bun) run (lint|format|typecheck)|eslint|prettier|ruff|black|biome|clippy)\b/.test(step)) return 'Check the code for mistakes'

  switch (p) {
    case 'git': {
      const verb = args.filter(a => !a.startsWith('-')).find(a => !/[\\/]/.test(a) || GIT[a] !== undefined) ?? ''
      return GIT[verb] ?? 'Work with git'
    }
    case 'gh': {
      const [area = '', verb = ''] = operands(args)
      if (area === 'pr') return GH_PR[verb] ?? 'Work with a pull request'
      if (area === 'issue') return 'Work with an issue'
      if (area === 'run' || area === 'workflow') return 'Check a CI run'
      if (area === 'api') return 'Call the GitHub API'
      if (area === 'repo') return 'Work with a repository'
      if (area === 'release') return 'Work with a release'
      if (area === 'auth') return 'Check GitHub sign-in'
      return 'Work with GitHub'
    }
    case 'claude': {
      const [area = '', verb = ''] = operands(args)
      if (area === 'plugin') {
        if (verb === 'validate') return 'Check the plugin'
        if (verb === 'update' || verb === 'install') return 'Update a plugin'
        if (verb === 'marketplace') return 'Update a plugin marketplace'
        if (verb === 'list') return 'List the plugins'
        return 'Manage Claude plugins'
      }
      return 'Run Claude Code'
    }
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      if (sub === 'run' || sub === 'run-script') {
        const script = operands(args)[1]
        return script === undefined ? 'Run a script' : `Run the ${short(script)} script`
      }
      if (/^(start|dev|serve)$/.test(sub)) return 'Start the app'
      if (sub === 'publish') return 'Publish a package'
      if (/^(update|upgrade|outdated)$/.test(sub)) return 'Update packages'
      if (/^(list|ls|why)$/.test(sub)) return 'List packages'
      if (sub === 'x' || sub === 'exec') return 'Run a package'
      return `Run ${p}`
    }
    case 'python':
    case 'python3':
    case 'py': {
      if (args[0] === '-m') return `Run the ${short(args[1] ?? 'python')} module`
      if (args[0] === '-c' || args[0] === '-' || args.length === 0) return 'Run a Python snippet'
      const file = scriptArg(args)
      return file === '' ? 'Run a Python script' : `Run ${file}`
    }
    case 'node':
    case 'tsx':
    case 'ts-node':
    case 'deno':
    case 'ruby':
    case 'perl':
    case 'php':
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'pwsh':
    case 'powershell': {
      if (/^-(e|p|c|command|eval|print)$/i.test(args[0] ?? '') || args[0] === '-') return `Run a ${p === 'node' || p === 'tsx' || p === 'ts-node' ? 'Node' : 'shell'} snippet`
      const file = scriptArg(args)
      return file === '' ? `Run a ${p} script` : `Run ${file}`
    }
    case 'pip':
    case 'pip3':
      return /^(list|freeze|show)$/.test(sub) ? 'List packages' : 'Manage Python packages'
    case 'cargo':
      return /^(run)$/.test(sub) ? 'Run the program' : /^(check|fmt|doc)$/.test(sub) ? 'Check the code for mistakes' : 'Work with Cargo'
    case 'go':
      return sub === 'run' ? 'Run the program' : /^(vet|fmt|mod)$/.test(sub) ? 'Check the code for mistakes' : 'Work with Go'
    case 'dotnet':
      return sub === 'run' ? 'Run the program' : 'Work with .NET'
    case 'docker':
    case 'docker-compose':
    case 'podman': {
      if (sub === 'build') return 'Build an image'
      if (sub === 'run' || sub === 'up' || sub === 'start') return 'Start a container'
      if (sub === 'compose') return 'Run the containers'
      if (sub === 'ps' || sub === 'logs') return 'Check on the containers'
      return 'Work with containers'
    }
    case 'kubectl':
    case 'helm':
      return /^(logs|get|describe)$/.test(sub) ? 'Check on the cluster' : 'Work with the cluster'
    case 'terraform':
    case 'tofu':
      return 'Plan the infrastructure'
    case 'aws':
    case 'gcloud':
    case 'az':
      return 'Talk to the cloud'
    case 'cat':
    case 'head':
    case 'tail':
    case 'less':
    case 'more':
    case 'bat':
    case 'type':
      return read(args)
    case 'ls':
    case 'dir':
    case 'tree':
    case 'find':
    case 'fd':
      return lookThrough(args)
    case 'grep':
    case 'rg':
    case 'egrep':
    case 'fgrep':
    case 'ag':
    case 'ack':
    case 'findstr':
      return search(args)
    case 'sed':
      return args.some(a => /^-[A-Za-z]*i/.test(a)) ? 'Edit a file in place' : 'Process some text'
    case 'awk':
    case 'tr':
    case 'sort':
    case 'uniq':
    case 'wc':
    case 'cut':
    case 'jq':
    case 'xargs':
      return 'Process some text'
    case 'rm':
    case 'rmdir':
    case 'del':
    case 'erase':
      return remove(args)
    case 'mv':
    case 'move':
      return named(args) === '' ? 'Move files' : `Move ${named(args)}`
    case 'cp':
    case 'copy':
    case 'xcopy':
    case 'robocopy':
      return named(args) === '' ? 'Copy files' : `Copy ${named(args)}`
    case 'mkdir':
    case 'md':
      return named(args) === '' ? 'Make a folder' : `Make the ${named(args)} folder`
    case 'touch':
      return named(args) === '' ? 'Create a file' : `Create ${named(args)}`
    case 'chmod':
    case 'chown':
    case 'icacls':
      return 'Change who can use a file'
    case 'ln':
      return 'Link a file'
    case 'tar':
    case 'zip':
    case 'unzip':
    case '7z':
    case 'gzip':
      return 'Pack or unpack files'
    case 'curl':
    case 'wget':
      return fetchFrom(args)
    case 'ssh':
    case 'scp':
    case 'rsync':
      return 'Talk to another machine'
    case 'ping':
    case 'nslookup':
    case 'dig':
    case 'netstat':
      return 'Check the network'
    case 'sleep':
    case 'timeout':
      return wait(args)
    case 'ps':
    case 'tasklist':
    case 'top':
      return 'See what is running'
    case 'kill':
    case 'pkill':
    case 'taskkill':
      return 'Stop a process'
    case 'open':
    case 'start':
    case 'xdg-open':
      return named(args) === '' ? 'Open something' : `Open ${named(args)}`
    case 'which':
    case 'where':
    case 'whereis':
      return named(args) === '' ? 'Find a program' : `Find where ${named(args)} is`
    case 'env':
    case 'printenv':
      return 'Look at the environment'
    case 'pwd':
      return 'Check the current folder'
    case 'whoami':
    case 'hostname':
    case 'uname':
      return 'Check which machine this is'
    case 'date':
      return 'Check the date'
    case 'echo':
    case 'printf': {
      const redirect = /\s>>?\s*("[^"]+"|'[^']+'|\S+)\s*$/.exec(step)
      return redirect === null ? 'Print a message' : `Write ${short(redirect[1] as string)}`
    }
    case 'tee':
      return write(args)
    case 'test':
    case '[':
    case '[[':
      return 'Check a condition'
    case 'diff':
    case 'cmp':
    case 'fc':
      return 'Compare two files'
    case 'sqlite3':
    case 'psql':
    case 'mysql':
      return 'Query a database'
    case 'ffmpeg':
      return 'Convert some media'
    case 'magick':
    case 'convert':
      return 'Process an image'
    case 'make':
    case 'cmake':
    case 'ninja':
      return 'Build the project'
    case 'code':
    case 'vim':
    case 'nano':
    case 'notepad':
      return named(args) === '' ? 'Open an editor' : `Open ${named(args)} in an editor`
    case 'tsc':
      return 'Check the types'
    case 'playwright':
    case 'cypress':
      return 'Run browser tests'
  }
  // A redirect writes a file whatever the program is: `python gen.py > out.json`.
  const redirect = /\s>>?\s*("[^"]+"|'[^']+'|[^\s&|]+)\s*$/.exec(step)
  if (redirect !== null && !/^&/.test(redirect[1] as string)) return `Write ${short(redirect[1] as string)}`
  return ''
}

export function commandIntent(command: string): Intent {
  const real: Array<{ step: string; program: string; args: string[] }> = []
  for (const raw of stepsOf(command)) {
    const parsed = programOf(raw)
    if (parsed === null) continue
    // A bare assignment (`SP="C:/work"`) or a `cd` says where, not what; so does `$x = 'value'`, which only sets
    // a variable, unlike `$x = Get-ChildItem`, which is a command whose answer is kept.
    if (ASSIGNMENT.test(raw.trim())) continue
    if (POWERSHELL_ASSIGNMENT.test(raw) && !/^[A-Za-z][A-Za-z]*-[A-Za-z]+/.test(raw.replace(POWERSHELL_ASSIGNMENT, ''))) continue
    if (SETUP.test(parsed.program)) continue
    real.push({ step: raw.replace(POWERSHELL_ASSIGNMENT, '').trim(), ...parsed })
  }
  // Making a folder is the groundwork for what comes after it.
  const meaningful = real.filter((r, i) => !(/^(mkdir|md)$/i.test(r.program) && i < real.length - 1))
  const first = meaningful[0] ?? real[0]
  if (first === undefined) return { step: command.trim(), phrase: '', more: 0 }
  const cleaned = [first.program, ...first.args].join(' ')
  return { step: first.step, phrase: phraseFor(first.program, first.args, cleaned), more: Math.max(0, meaningful.length - 1) }
}

// What a common command is for, in words; empty when the office does not know the program.
export function explainCommand(command: string): string {
  return commandIntent(command).phrase
}
