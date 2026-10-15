import type { Activity, OfficeEvent, Scene } from '../types'
import { gist, stationFor } from './stations'

export const REPORT_IN_FEED = 60

function nameOf(scene: Scene, id: string | null): string {
  if (id === null) return 'An agent'
  return scene.agents[id]?.label ?? 'An agent'
}

// "Run the tests" continues a sentence as "run the tests"; "NPM", "CI" and other capitals stay as they are.
const lowerFirst = (text: string): string => (/^[A-Z][a-z]/.test(text) ? `${text[0]?.toLowerCase() ?? ''}${text.slice(1)}` : text)

// `mcp__github__create_issue` is GitHub's "create issue".
function service(tool: string): { name: string; action: string } {
  const [, name = tool, action = ''] = tool.split('__')
  return { name, action: action.replace(/_+/g, ' ').trim() }
}

// What an agent is doing, said the way you would say it of a colleague, with no subject: "reading auth.ts",
// "running a command to test the code". The feed puts a name in front of it; the panel shows it as is.
export function doing(activity: Pick<Activity, 'tool' | 'target' | 'detail'>): string {
  const { tool, target, detail } = activity
  const t = target === '' ? '' : ` ${target}`
  switch (tool) {
    case 'Read':
      return `reading${t}`
    case 'Edit':
    case 'MultiEdit':
      return `editing${t}`
    case 'Write':
      return `writing${t}`
    case 'NotebookEdit':
      return `editing the notebook${t}`
    case 'Grep':
      return `searching the files for${t}`
    case 'Glob':
      return `looking for files named${t}`
    case 'LSP':
      return t === '' ? 'asking the code index' : `asking the code index about${t}`
    case 'ToolSearch':
      return 'looking up which tools it can use'
    case 'Skill':
      return t === '' ? 'reading a manual' : `reading the${t} manual`
    case 'Bash':
    case 'PowerShell':
      return detail === '' ? `running a command:${t}` : `running a command to ${lowerFirst(detail)}`
    case 'BashOutput':
      return 'checking on a background command'
    case 'Monitor':
      return 'keeping an eye on a background job'
    case 'KillShell':
    case 'TaskStop':
      return 'stopping a background job'
    case 'WebSearch':
      return `searching the web for${t}`
    case 'WebFetch':
      return `reading a web page on${t}`
    case 'SendMessage':
      return `messaging${t}${detail === '' ? '' : `: ${detail}`}`
    case 'AskUserQuestion':
      return 'waiting for you to answer a question'
    case 'ExitPlanMode':
      return 'waiting for you to approve a plan'
  }
  const station = stationFor(tool)
  if (station === 'taskboard') return 'updating the task board'
  if (station === 'mailroom') {
    const { name, action } = service(tool)
    return action === '' ? `using ${name}${t}` : `using ${name} to ${action}`
  }
  return `using ${tool}${t}`
}

// What a permission prompt is asking for, in words: "run a command" rather than "use Bash".
function permissionFor(tool: string): string {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return 'run a command'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'change a file'
    case 'WebFetch':
    case 'WebSearch':
      return 'go on the web'
  }
  return tool.startsWith('mcp__') ? `use ${service(tool).name}` : `use ${tool}`
}

const quoted = (report: string): string => {
  const excerpt = gist(report, REPORT_IN_FEED)
  return excerpt === '' ? '' : `: ${excerpt}`
}

// The line for the moment a boss stops waiting: every helper it hired to work while it waited has reported.
export const allBackLine = (boss: string): string => `${boss} has every report back and is reviewing the results`

export function narrate(scene: Scene, ev: OfficeEvent): string | null {
  switch (ev.kind) {
    case 'spawned': {
      const who = nameOf(scene, ev.id)
      const boss = nameOf(scene, ev.parentId)
      if (ev.isTeammate) {
        return ev.isResume ? `${boss} brought ${who} back to the team: ${ev.description}` : `${boss} added ${who} to the team: ${ev.description}`
      }
      const verb = ev.isResume ? `called ${who} back` : `hired ${who}`
      if (ev.isBackground) return `${boss} ${verb} to work alongside it: ${ev.description}`
      return `${boss} ${verb} and is waiting for its report: ${ev.description}`
    }
    case 'toolStarted':
      return `${nameOf(scene, ev.agentId)} is ${doing(ev)}`
    case 'toolEnded':
      return ev.isError ? `${nameOf(scene, ev.agentId)} hit an error` : null
    case 'waiting':
      return `${nameOf(scene, ev.agentId)} needs your permission to ${permissionFor(ev.tool)}`
    case 'turnStarted':
      return ev.isContinuation ? 'Main picked up where it left off' : 'You gave Main a new task'
    case 'turnEnded':
      return 'Main finished and is waiting for your next message'
    case 'handedBack': {
      const agent = scene.agents[ev.agentId]
      if (agent === undefined) return null
      const boss = nameOf(scene, agent.parentId)
      const isStopped = ev.reason === 'aborted'
      const isFailed = ev.reason === 'error' || ev.reason === 'refusal'
      if (agent.isTeammate) {
        return isStopped
          ? `${agent.label} was stopped and took a break`
          : `${agent.label} reported to ${boss} and took a break${quoted(ev.report)}`
      }
      if (isStopped) return `${agent.label} was stopped and left`
      if (isFailed) return `${agent.label} ran into a problem, told ${boss} and left${quoted(ev.report)}`
      return `${agent.label} handed its report to ${boss} and left${quoted(ev.report)}`
    }
    case 'todos':
    case 'tick':
      return null
  }
}
