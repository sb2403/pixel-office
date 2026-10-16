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
  // When it handed in its report this stint; null while it works.
  doneAt: number | null
  goneAt: number | null
  carry: Carry | null
  look: Look
}

// `routineOf` names the agent whose routine work the line reports (reading, editing, running a command): the
// feed keeps only the latest of those per agent. It is null for the moments that make the story (a hire, a
// hand-back, a message, a wait on you, an error), which are kept until newer lines push them out.
export type TickerLine = { at: number; text: string; routineOf: string | null }

// One job: everything from a message you send until the next one. A turn that carries on without a new message
// (a background helper reporting in, say) belongs to the same job. `task` is the start of your message.
// `mainEdits` counts the file edits Main made itself this job rather than leaving them to a helper; a job saved
// before it was counted has none.
export type Job = { startedAt: number; endedAt: number | null; task: string; mainUsage: Usage | null; mainEdits?: number }

// A finished job as the history keeps it, across sessions, when that is switched on.
// The token split and Main's edits were added later: a record saved before them lacks these three.
export type JobRecord = {
  startedAt: number
  task: string
  tookMs: number
  helpers: number
  peak: number
  tokens: number | null
  mainTokens?: number | null
  helperTokens?: number | null
  mainEdits?: number
}

export type Scene = {
  agents: Record<string, Agent>
  order: string[]
  ticker: TickerLine[]
  todos: { done: number; open: number } | null
  briefing: string | null
  job: Job | null
}

// Another session on this computer, as its own office describes itself in its slot file (`hooks/peers.ts`).
// `instance` is one load of the mod; `endedAt` set means the session has ended and the slot is free. `since` is
// when `status` last changed; `doing` names a kind of work ("running a command"), never its object.
export type PeerStatus = 'working' | 'coordinating' | 'waiting' | 'idle'
export type PeerSession = {
  v: 1
  instance: string
  sessionId: string
  beatAt: number
  startedAt: number
  endedAt: number | null
  project: string
  status: PeerStatus
  since: number
  doing: string
  task: string
  needsYou: number
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
  | { kind: 'turnStarted'; isContinuation: boolean; task: string; at: number }
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
      jobOpen: boolean
      history: JobRecord[]
      // Every job since the conversation started or was cleared, kept in memory.
      session: JobRecord[]
      // The other sessions on this computer, when that is switched on.
      others: PeerSession[]
    }
  }
}
