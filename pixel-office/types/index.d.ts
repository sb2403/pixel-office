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

export type TickerLine = { at: number; text: string }

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
  | { kind: 'turnEnded'; at: number }
  | { kind: 'handedBack'; agentId: string; reason: 'answer' | 'aborted' | 'refusal' | 'error'; report: string; at: number }
  | { kind: 'todos'; done: number; open: number; at: number }
  | { kind: 'tick'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'pixel-office': { scene: Scene; legendOpen: boolean; selected: string | null; clock: number }
  }
}
