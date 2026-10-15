import type { Register } from 'claude-code'

// The main loop has no agentId; a helper's loop does, so only Main is refused. Tools that change files:
// Edit, Write and NotebookEdit.
export const WHY =
  'coordinator-guard: Main coordinates and does not edit files itself. Hire a helper with the Agent tool, give it this job and its brief, and put its report together.'

export const register: Register = on => {
  on('tool.call', { tool: 'Edit' }, ($, e, next) => (e.agentId === undefined ? { deny: WHY } : next(e))).catch(($, e, next) =>
    next.called ? next(e) : { deny: WHY },
  )
  on('tool.call', { tool: 'Write' }, ($, e, next) => (e.agentId === undefined ? { deny: WHY } : next(e))).catch(($, e, next) =>
    next.called ? next(e) : { deny: WHY },
  )
  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => (e.agentId === undefined ? { deny: WHY } : next(e))).catch(($, e, next) =>
    next.called ? next(e) : { deny: WHY },
  )
}
