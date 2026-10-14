import type { OfficeEvent, Scene } from '../types'
import { stationFor } from './stations'

function nameOf(scene: Scene, id: string | null): string {
  if (id === null) return 'An agent'
  return scene.agents[id]?.label ?? 'An agent'
}

function toolLine(who: string, tool: string, target: string): string {
  const t = target === '' ? '' : ` ${target}`
  switch (tool) {
    case 'Read':
      return `${who} is reading${t}`
    case 'Edit':
    case 'MultiEdit':
      return `${who} is editing${t}`
    case 'Write':
      return `${who} is writing${t}`
    case 'NotebookEdit':
      return `${who} is editing notebook${t}`
    case 'Grep':
      return `${who} searched files for${t}`
    case 'Glob':
      return `${who} looked for files matching${t}`
    case 'Bash':
    case 'PowerShell':
      return `${who} ran a command:${t}`
    case 'WebSearch':
      return `${who} searched the web for${t}`
    case 'WebFetch':
      return `${who} opened a web page:${t}`
    case 'SendMessage':
      return `${who} sent a message to${t}`
    case 'Skill':
      return `${who} pulled the${t} manual`
    case 'AskUserQuestion':
      return `${who} is waiting on you with a question`
    case 'ExitPlanMode':
      return `${who} is waiting for you to approve a plan`
  }
  const station = stationFor(tool)
  if (station === 'taskboard') return `${who} updated the task board`
  if (station === 'mailroom') return `${who} called an outside service:${t}`
  return t === '' ? `${who} used ${tool}` : `${who} used ${tool}:${t}`
}

export function narrate(scene: Scene, ev: OfficeEvent): string | null {
  switch (ev.kind) {
    case 'spawned': {
      const who = nameOf(scene, ev.id)
      const boss = nameOf(scene, ev.parentId)
      return ev.isTeammate ? `${boss} added teammate ${who}: ${ev.description}` : `${boss} hired ${who}: ${ev.description}`
    }
    case 'toolStarted':
      return toolLine(nameOf(scene, ev.agentId), ev.tool, ev.target)
    case 'toolEnded':
      return ev.isError ? `${nameOf(scene, ev.agentId)} hit an error` : null
    case 'waiting':
      return `${nameOf(scene, ev.agentId)} needs your permission to use ${ev.tool}`
    case 'turnStarted':
      return 'You gave Main a new task'
    case 'handedBack': {
      const agent = scene.agents[ev.agentId]
      if (agent === undefined) return null
      const boss = nameOf(scene, agent.parentId)
      return agent.isTeammate
        ? `${agent.label} reported to ${boss} and took a break`
        : `${agent.label} handed its report to ${boss} and left`
    }
    case 'todos':
    case 'tick':
      return null
  }
}
