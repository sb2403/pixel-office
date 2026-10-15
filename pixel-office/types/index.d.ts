export type Point = { x: number; y: number }

export type StationId =
  | 'office'
  | 'desk'
  | 'library'
  | 'phone'
  | 'mailroom'
  | 'server'
  | 'meeting'
  | 'taskboard'
  | 'reception'
  | 'elevator'
  | 'breakroom'

export type Phase = 'arriving' | 'briefing' | 'working' | 'waiting' | 'idle' | 'gone'

export type Look = { shirt: string; hair: string; skin: string }

export type Walk = { points: Point[]; startedAt: number; durationMs: number }

// `detail` is the plain-English gist of the call when the tool input carries one: the description Claude gives a
// command, or the summary of a message. Empty otherwise.
export type Activity = { tool: string; target: string; detail: string; callId: string; since: number }

// Something an agent carries on a walk to another agent: a report up to its boss, a message across. It is handed
// over at `until`, when the walk reaches the other agent.
export type Carry = { item: 'report' | 'message'; until: number }

// What an agent's work cost, summed over its turns: every token the model read or wrote, how many of those it
// reused from the prompt cache (far cheaper than fresh ones), and the model that answered last. Tokens, not
// money: prices change, and a stale price would be a wrong number.
export type Usage = { tokens: number; reused: number; model: string }

// How a helper's job ended: it handed in its report, it was stopped, or it ran into a problem.
export type Outcome = 'reported' | 'stopped' | 'failed'

// `type` is the engine's name for the kind of agent (`Explore`); `role` is what the office calls it (Researcher).
// `name` is the name the engine knows the agent by, when it has one: messages are addressed to it.
// `isBackground` is true when the boss keeps working while this agent works, false when the boss waits for its report.
export type Agent = {
  id: string
  parentId: string | null
  type: string
  role: string
  name: string | null
  label: string
  description: string
  brief: string
  report: string
  outcome: Outcome | null
  usage: Usage | null
  isTeammate: boolean
  isBackground: boolean
  phase: Phase
  station: StationId
  slot: number
  desk: number
  pos: Point
  walk: Walk | null
  activity: Activity | null
  lastErrorAt: number | null
  lastEventAt: number
  arrivedAt: number
  goneAt: number | null
  carry: Carry | null
  look: Look
}

// `routineOf` names the agent whose routine work the line reports (reading, editing, running a command): the
// feed keeps only the latest of those per agent. It is null for the moments that make the story (a hire, a
// hand-back, a message, a wait on you, an error), which are kept until newer lines push them out.
export type TickerLine = { at: number; text: string; routineOf: string | null }

export type Scene = {
  agents: Record<string, Agent>
  order: string[]
  ticker: TickerLine[]
  todos: { done: number; open: number } | null
  briefing: string | null
}

export type OfficeEvent =
  | {
      kind: 'spawned'
      id: string
      parentId: string
      type: string
      description: string
      brief: string
      name: string | null
      isTeammate: boolean
      isBackground: boolean
      // True when this spawn continues an agent that ran before (called back, or a teammate brought back).
      isResume: boolean
      at: number
    }
  | { kind: 'toolStarted'; agentId: string; tool: string; target: string; detail: string; callId: string; at: number }
  | { kind: 'toolEnded'; agentId: string; callId: string; isError: boolean; at: number }
  | { kind: 'waiting'; agentId: string | null; tool: string; at: number }
  | { kind: 'turnStarted'; isContinuation: boolean; at: number }
  | { kind: 'turnEnded'; usage: Usage | null; at: number }
  | {
      kind: 'handedBack'
      agentId: string
      reason: 'answer' | 'aborted' | 'refusal' | 'error'
      report: string
      usage: Usage | null
      at: number
    }
  | { kind: 'todos'; done: number; open: number; at: number }
  | { kind: 'tick'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'pixel-office': {
      scene: Scene
      legendOpen: boolean
      selected: string | null
      clock: number
      // Which of the selected agent's texts the details box shows in full.
      expanded: 'brief' | 'report' | null
    }
  }
}
