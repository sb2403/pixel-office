import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { isExempt, writesFile } from './rules'

// Off until it is switched on, for the session: `/coordinator on` makes Main hire helpers for file changes,
// `/coordinator off` lets it edit again. Only Main is held to it: the main loop has no agentId, a helper's loop does.
const enabledAtom = atom({ plugin: 'coordinator-guard', key: 'enabled' } as const, false)

export const WHY =
  'coordinator-guard: Main is the coordinator and does not change files itself while /coordinator is on. Hire a helper with the Agent tool, give it this job and its brief, and put its report together. (/coordinator off lets Main edit again.)'

export const whyShell = (what: string): string =>
  `coordinator-guard: this command writes a file (${what}), which is a helper's job while /coordinator is on. Hire a helper with the Agent tool for it. Main may still read, search, run tests and git, and write to its scratchpad. (/coordinator off lets Main write again.)`

const HELP = 'Usage: /coordinator on | off | status'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'coordinator', description: 'Keep Main a coordinator: on, off or status' })
    } catch {
      // The command is a convenience; the guard still works without it.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'coordinator' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    const isOn = await read($, enabledAtom)
    if (word === 'on' || word === 'off') {
      const wants = word === 'on'
      await update($, enabledAtom, () => wants)
      return {
        text: wants
          ? 'Coordinator mode is on: Main will hire helpers instead of changing files itself.'
          : 'Coordinator mode is off: Main may change files itself.',
      }
    }
    if (word === '' || word === 'status') return { text: `Coordinator mode is ${isOn ? 'on' : 'off'}. ${HELP}` }
    return { text: HELP }
  })

  // Editing tools: Main is refused anywhere but its own scratch places. A failure of the guard itself lets the call
  // through: it is a convenience, not a lock.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabledAtom)) || isExempt(e.file_path)) return next(e)
    return { deny: WHY }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabledAtom)) || isExempt(e.file_path)) return next(e)
    return { deny: WHY }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabledAtom)) || isExempt(e.notebook_path)) return next(e)
    return { deny: WHY }
  }).catch(($, e, next) => next(e))

  // Shell commands that write a file: a redirect, tee, an in-place edit, a PowerShell writer.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabledAtom))) return next(e)
    const what = writesFile(e.command)
    return what === null ? next(e) : { deny: whyShell(what) }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabledAtom))) return next(e)
    const what = writesFile(e.command)
    return what === null ? next(e) : { deny: whyShell(what) }
  }).catch(($, e, next) => next(e))
}
